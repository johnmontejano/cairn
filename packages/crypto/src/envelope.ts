import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Authenticated encryption.
 *
 * AES-256-GCM from Node's built-in OpenSSL bindings. No cryptography is invented
 * here: this module only frames a standard construction so every ciphertext is
 * self-describing and bound to the row it belongs to.
 *
 * Wire format:
 *   magic "CRNE" (4) | format (1) | alg (1) | iv (12) | tag (16) | ciphertext (n)
 *
 * `aad` is *not* stored. The caller must supply the same associated data on
 * decrypt, which is what makes moving a ciphertext to another workspace, row, or
 * column fail loudly instead of silently decrypting.
 */

const MAGIC = Buffer.from('CRNE', 'ascii');
const FORMAT = 1;
const ALG_AES_256_GCM = 1;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = MAGIC.length + 2 + IV_LEN + TAG_LEN;

export const KEY_BYTES = 32;

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

export function encryptBytes(key: Uint8Array, plaintext: Uint8Array, aad: string): Uint8Array {
  assertKey(key);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const header = Buffer.alloc(2);
  header[0] = FORMAT;
  header[1] = ALG_AES_256_GCM;
  return Buffer.concat([MAGIC, header, iv, tag, ct]);
}

export function decryptBytes(key: Uint8Array, envelope: Uint8Array, aad: string): Uint8Array {
  assertKey(key);
  const buf = Buffer.from(envelope);
  if (buf.length < HEADER_LEN) throw new DecryptionError('Ciphertext is too short to be valid');
  if (!buf.subarray(0, 4).equals(MAGIC)) throw new DecryptionError('Not a Cairn ciphertext');
  const format = buf[4];
  const alg = buf[5];
  if (format !== FORMAT) throw new DecryptionError(`Unsupported envelope format ${format}`);
  if (alg !== ALG_AES_256_GCM) throw new DecryptionError(`Unsupported algorithm ${alg}`);

  const iv = buf.subarray(6, 6 + IV_LEN);
  const tag = buf.subarray(6 + IV_LEN, 6 + IV_LEN + TAG_LEN);
  const ct = buf.subarray(HEADER_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    // Deliberately opaque: the caller learns "this did not verify", not why.
    throw new DecryptionError(
      'Ciphertext failed authentication (wrong key, wrong context, or tampered)',
    );
  }
}

export function encryptText(key: Uint8Array, plaintext: string, aad: string): Uint8Array {
  return encryptBytes(key, Buffer.from(plaintext, 'utf8'), aad);
}

export function decryptText(key: Uint8Array, envelope: Uint8Array, aad: string): string {
  return Buffer.from(decryptBytes(key, envelope, aad)).toString('utf8');
}

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) {
    throw new DecryptionError(`Key must be ${KEY_BYTES} bytes, received ${key.length}`);
  }
}

/**
 * Associated data builder. Every ciphertext in the product is bound to
 * `workspace|purpose|row-identity`, so a ciphertext lifted from one row into
 * another fails to decrypt.
 */
export function aad(parts: {
  workspaceId: string;
  purpose: string;
  id: string;
  extra?: string;
}): string {
  return [parts.workspaceId, parts.purpose, parts.id, parts.extra ?? ''].join('|');
}
