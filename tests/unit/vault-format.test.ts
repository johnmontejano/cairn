import { describe, expect, it } from 'vitest';
import { contentHash, manifestHash } from '@cairn/crypto';
import {
  createBackupArchive,
  createZip,
  inspectBackupArchive,
  openBackupArchive,
  readBackupHeader,
  readZip,
  verifyBackup,
  type BackupPayload,
} from '@cairn/vault';

function samplePayload(overrides: Partial<BackupPayload> = {}): BackupPayload {
  const content = '# Decisions\n\nWe decided to sign the Mill Street lease.\n';
  return {
    formatVersion: 1,
    workspace: { id: 'ws-1', name: "Tom's memory" },
    project: { id: 'p-1', name: 'Riverside Bakery', slug: 'riverside-bakery' },
    version: {
      id: 'v-1',
      manifestHash: manifestHash([
        { path: 'memory/DECISIONS.md', contentHash: contentHash(content) },
      ]),
      createdAt: '2026-03-14T10:00:00.000Z',
      reason: 'Approved a memory',
      authorLabel: 'Tom',
    },
    files: [{ path: 'memory/DECISIONS.md', content, contentHash: contentHash(content) }],
    sources: [
      {
        id: 's-1',
        provider: 'paste',
        externalId: 'paste:1',
        title: 'Planning notes',
        mimeType: 'text/markdown',
        canonicalUri: null,
        revisions: [
          {
            id: 'r-1',
            contentHash: contentHash('raw'),
            externalRevision: null,
            byteSize: 3,
            importedAt: '2026-03-13T10:00:00.000Z',
          },
        ],
      },
    ],
    memory: [
      {
        id: 'm-1',
        type: 'decision',
        status: 'approved',
        title: 'Sign the Mill Street lease',
        value: 'We decided to sign the Mill Street lease.',
        topics: ['lease'],
        sensitivity: 'normal',
        visibility: 'share_with_authorized_clients',
        observedAt: null,
        updatedAt: '2026-03-14T10:00:00.000Z',
        importedAt: '2026-03-13T10:00:00.000Z',
        extractionMethod: 'ai_extraction',
        extractionModel: 'built-in-cue-extractor-v1',
        canonicalPath: 'memory/DECISIONS.md',
        canonicalVersionId: 'v-1',
        evidence: [
          {
            sourceProvider: 'paste',
            sourceTitle: 'Planning notes',
            sourceItemId: 's-1',
            sourceRevisionId: 'r-1',
            locator: null,
            startOffset: 0,
            endOffset: 40,
            excerpt: 'We decided to sign the Mill Street lease.',
            contentHash: contentHash('We decided to sign the Mill Street lease.'),
            importedAt: '2026-03-13T10:00:00.000Z',
          },
        ],
      },
    ],
    history: [],
    ...overrides,
  };
}

const PASSPHRASE = 'correct horse battery staple';

describe('the encrypted backup format', () => {
  it('round-trips through a passphrase', () => {
    const archive = createBackupArchive(samplePayload(), PASSPHRASE);
    const { payload } = openBackupArchive(archive, PASSPHRASE);
    expect(payload.memory[0]!.value).toBe('We decided to sign the Mill Street lease.');
    expect(payload.files[0]!.path).toBe('memory/DECISIONS.md');
  });

  it('is unreadable with the wrong passphrase', () => {
    const archive = createBackupArchive(samplePayload(), PASSPHRASE);
    try {
      openBackupArchive(archive, 'wrong passphrase here');
      throw new Error('expected the wrong passphrase to be refused');
    } catch (error) {
      expect((error as { userMessage: string }).userMessage).toMatch(/passphrase did not open/i);
    }
  });

  it('keeps no memory content in the plaintext header', () => {
    const archive = createBackupArchive(samplePayload(), PASSPHRASE);
    const header = readBackupHeader(archive);
    expect(header.formatVersion).toBe(1);
    expect(header.kdf.algorithm).toBe('scrypt');

    // Everything after the header line must be opaque.
    const asText = Buffer.from(archive).toString('utf8');
    expect(asText).not.toContain('Mill Street');
    expect(asText).not.toContain('Planning notes');
    expect(asText).not.toContain(PASSPHRASE);
  });

  it('refuses a file whose bytes were changed', () => {
    const archive = Buffer.from(createBackupArchive(samplePayload(), PASSPHRASE));
    archive[archive.length - 5] = (archive[archive.length - 5] ?? 0) ^ 0xff;
    expect(() => openBackupArchive(archive, PASSPHRASE)).toThrow(/decryption failed/i);
  });

  it('refuses a file whose header was edited', () => {
    const archive = Buffer.from(createBackupArchive(samplePayload(), PASSPHRASE));
    // The payload hash is authenticated as associated data, so editing it breaks
    // decryption; editing anything else breaks the schema or the hash check.
    const text = archive
      .toString('binary')
      .replace(/"payloadHash":"sha256:[0-9a-f]{4}/, '"payloadHash":"sha256:0000');
    expect(() => openBackupArchive(Buffer.from(text, 'binary'), PASSPHRASE)).toThrow();
  });

  it('rejects a passphrase too short to be worth having', () => {
    expect(() => createBackupArchive(samplePayload(), 'short')).toThrow(/too short/i);
  });

  it('rejects a file that is not a backup at all', () => {
    expect(() => readBackupHeader(Buffer.from('just some text'))).toThrow(
      /not a Cairn backup file/i,
    );
  });
});

describe('verifying a backup before trusting it', () => {
  it('confirms fingerprints match', () => {
    const report = verifyBackup(createBackupArchive(samplePayload(), PASSPHRASE), PASSPHRASE);
    expect(report.ok).toBe(true);
    expect(report.dryRun).toBe(true);
    expect(report.manifestHash.matches).toBe(true);
    expect(report.restored.memoryItems).toBe(1);
  });

  it('reports a document whose content no longer matches its fingerprint', () => {
    const payload = samplePayload();
    payload.files[0]!.content = '# Decisions\n\nSomething else entirely.\n';
    const report = inspectBackupArchive(createBackupArchive(payload, PASSPHRASE), PASSPHRASE);
    const failed = report.checks.find((c) => c.name === 'Document contents');
    expect(failed?.ok).toBe(false);
  });

  it('reports approved memory that arrived without any evidence', () => {
    const payload = samplePayload();
    payload.memory[0]!.evidence = [];
    const report = inspectBackupArchive(createBackupArchive(payload, PASSPHRASE), PASSPHRASE);
    const failed = report.checks.find((c) => c.name.includes('source'));
    expect(failed?.ok).toBe(false);
  });
});

describe('the Markdown export archive', () => {
  it('round-trips through the zip writer', () => {
    const entries = [
      { path: 'README.md', content: '# Your memory\n' },
      { path: 'memory/DECISIONS.md', content: '# Decisions\n\nOne decision.\n' },
    ];
    const read = readZip(createZip(entries));
    expect(read).toHaveLength(2);
    expect(read.map((e) => e.path)).toEqual(['README.md', 'memory/DECISIONS.md']);
    expect(Buffer.from(read[1]!.content as Uint8Array).toString('utf8')).toContain('One decision.');
  });

  it('writes a real zip container', () => {
    const bytes = Buffer.from(createZip([{ path: 'a.md', content: 'hello' }]));
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature at the tail.
    expect([...bytes.subarray(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('handles non-ASCII names and content', () => {
    const read = readZip(createZip([{ path: 'notes/café.md', content: 'naïve — ok\n' }]));
    expect(read[0]!.path).toBe('notes/café.md');
    expect(Buffer.from(read[0]!.content as Uint8Array).toString('utf8')).toBe('naïve — ok\n');
  });
});
