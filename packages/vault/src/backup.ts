import { gunzipSync, gzipSync } from 'node:zlib';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { contentHash, decryptBytes, encryptBytes } from '@cairn/crypto';
import { PRODUCT } from '@cairn/config';
import { IntegrityError, ValidationError } from '@cairn/domain';

/**
 * The recovery artifact.
 *
 * Deliberately independent of this deployment: the archive is encrypted with a key
 * derived from a passphrase the person chooses, not with the workspace key held by
 * the server. That is what makes "my computer and my account are both gone" a
 * recoverable situation rather than a total loss.
 *
 * Layout:
 *   "CAIRNBK\n" | header JSON line (plaintext) | encrypted gzip(payload JSON)
 *
 * The header is plaintext on purpose: a restore tool must be able to read the
 * format version and key-derivation parameters before it can decrypt anything. It
 * contains no memory content.
 */

const MAGIC = 'CAIRNBK\n';

const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 } as const;

export const backupHeaderSchema = z.object({
  formatVersion: z.literal(PRODUCT.backupFormatVersion),
  product: z.string(),
  createdAt: z.string(),
  kdf: z.object({
    algorithm: z.literal('scrypt'),
    N: z.number().int(),
    r: z.number().int(),
    p: z.number().int(),
    saltBase64: z.string(),
  }),
  /** Hash of the *plaintext* payload; verified after decryption. */
  payloadHash: z.string(),
  workspaceName: z.string(),
  projectName: z.string(),
});
export type BackupHeader = z.infer<typeof backupHeaderSchema>;

export const backupPayloadSchema = z.object({
  formatVersion: z.literal(PRODUCT.backupFormatVersion),
  workspace: z.object({ id: z.string(), name: z.string() }),
  project: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  version: z
    .object({
      id: z.string(),
      manifestHash: z.string(),
      createdAt: z.string(),
      reason: z.string(),
      authorLabel: z.string(),
    })
    .nullable(),
  files: z.array(z.object({ path: z.string(), content: z.string(), contentHash: z.string() })),
  /**
   * Enough of each source to rebuild a working citation: which document it was,
   * where it came from, and when it arrived. Source *bodies* are deliberately not
   * included — a backup of your memory should not also be a second copy of every
   * file you ever imported.
   */
  sources: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      externalId: z.string(),
      title: z.string(),
      mimeType: z.string(),
      canonicalUri: z.string().nullable(),
      revisions: z.array(
        z.object({
          id: z.string(),
          contentHash: z.string(),
          externalRevision: z.string().nullable(),
          byteSize: z.number(),
          importedAt: z.string(),
        }),
      ),
    }),
  ),
  memory: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      status: z.string(),
      title: z.string(),
      value: z.string(),
      topics: z.array(z.string()),
      sensitivity: z.string(),
      visibility: z.string(),
      observedAt: z.string().nullable(),
      /** Preserved so a restored version re-renders to identical bytes. */
      updatedAt: z.string(),
      importedAt: z.string(),
      extractionMethod: z.string(),
      extractionModel: z.string().nullable(),
      canonicalPath: z.string().nullable(),
      canonicalVersionId: z.string().nullable(),
      evidence: z.array(
        z.object({
          sourceProvider: z.string(),
          sourceTitle: z.string(),
          sourceItemId: z.string(),
          sourceRevisionId: z.string(),
          locator: z.string().nullable(),
          startOffset: z.number(),
          endOffset: z.number(),
          excerpt: z.string(),
          contentHash: z.string(),
          importedAt: z.string(),
        }),
      ),
    }),
  ),
  history: z.array(
    z.object({
      id: z.string(),
      parentVersionId: z.string().nullable(),
      manifestHash: z.string(),
      reason: z.string(),
      authorLabel: z.string(),
      createdAt: z.string(),
      provenance: z.unknown(),
    }),
  ),
});
export type BackupPayload = z.infer<typeof backupPayloadSchema>;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT.maxmem,
  });
}

export function createBackupArchive(payload: BackupPayload, passphrase: string): Uint8Array {
  if (passphrase.length < 10) {
    throw new ValidationError(
      'Backup passphrase is too short',
      'Choose a backup passphrase of at least 10 characters. It is the only thing that can open this file.',
    );
  }
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const payloadHash = contentHash(json);
  const compressed = gzipSync(json, { level: 9 });
  const salt = randomBytes(16);
  const key = deriveKey(passphrase, salt);

  const header: BackupHeader = {
    formatVersion: PRODUCT.backupFormatVersion,
    product: PRODUCT.name,
    createdAt: new Date().toISOString(),
    kdf: {
      algorithm: 'scrypt',
      N: SCRYPT.N,
      r: SCRYPT.r,
      p: SCRYPT.p,
      saltBase64: salt.toString('base64'),
    },
    payloadHash,
    workspaceName: payload.workspace.name,
    projectName: payload.project.name,
  };
  const headerLine = Buffer.from(`${JSON.stringify(header)}\n`, 'utf8');
  // The header is authenticated as associated data, so editing it invalidates the file.
  const body = encryptBytes(key, compressed, `cairn-backup|${payloadHash}`);
  return Buffer.concat([Buffer.from(MAGIC, 'utf8'), headerLine, Buffer.from(body)]);
}

export function readBackupHeader(archive: Uint8Array): BackupHeader {
  const buf = Buffer.from(archive);
  if (buf.subarray(0, MAGIC.length).toString('utf8') !== MAGIC) {
    throw new ValidationError(
      'Not a Cairn backup file',
      'That file is not a Cairn backup. Look for the file ending in .cairnbackup.',
    );
  }
  const newline = buf.indexOf(0x0a, MAGIC.length);
  if (newline < 0) throw new IntegrityError('Backup header is truncated');
  const header = backupHeaderSchema.parse(
    JSON.parse(buf.subarray(MAGIC.length, newline).toString('utf8')),
  );
  return header;
}

export function openBackupArchive(
  archive: Uint8Array,
  passphrase: string,
): { header: BackupHeader; payload: BackupPayload } {
  const buf = Buffer.from(archive);
  const header = readBackupHeader(buf);
  const newline = buf.indexOf(0x0a, MAGIC.length);
  const body = buf.subarray(newline + 1);
  const key = deriveKey(passphrase, Buffer.from(header.kdf.saltBase64, 'base64'));

  let compressed: Uint8Array;
  try {
    compressed = decryptBytes(key, body, `cairn-backup|${header.payloadHash}`);
  } catch {
    throw new ValidationError(
      'Backup decryption failed',
      'That passphrase did not open the backup, or the file has been changed since it was made.',
    );
  }
  const json = gunzipSync(Buffer.from(compressed));
  const actual = contentHash(json);
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(header.payloadHash))) {
    throw new IntegrityError('Backup contents do not match the hash recorded in its header');
  }
  return { header, payload: backupPayloadSchema.parse(JSON.parse(json.toString('utf8'))) };
}

/**
 * Checks an archive without writing anything: the dry run behind "Check this
 * backup" in the UI and the first half of every restore.
 */
export function inspectBackupArchive(
  archive: Uint8Array,
  passphrase: string,
): {
  header: BackupHeader;
  payload: BackupPayload;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
} {
  const { header, payload } = openBackupArchive(archive, passphrase);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];

  checks.push({
    name: 'Format version',
    ok: payload.formatVersion === PRODUCT.backupFormatVersion,
    detail: `Archive is version ${payload.formatVersion}; this build reads version ${PRODUCT.backupFormatVersion}.`,
  });

  const badFiles = payload.files.filter((f) => contentHash(f.content) !== f.contentHash);
  checks.push({
    name: 'Document contents',
    ok: badFiles.length === 0,
    detail:
      badFiles.length === 0
        ? `All ${payload.files.length} documents match their recorded fingerprints.`
        : `${badFiles.length} document(s) do not match: ${badFiles.map((f) => f.path).join(', ')}`,
  });

  const missingEvidence = payload.memory.filter(
    (m) => m.status === 'approved' && m.evidence.length === 0,
  );
  checks.push({
    name: 'Every saved memory has a source',
    ok: missingEvidence.length === 0,
    detail:
      missingEvidence.length === 0
        ? `${payload.memory.length} memories, each with at least one source.`
        : `${missingEvidence.length} memory item(s) have no source and would not be restored as saved.`,
  });

  return { header, payload, checks };
}
