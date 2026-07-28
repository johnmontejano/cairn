import { createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { KEY_BYTES, aad, decryptBytes, encryptBytes } from './envelope';

/**
 * Key hierarchy.
 *
 *   KEK  (master, one per deployment)      -> never stored by this app
 *    └── DEK  (one per workspace)          -> stored only wrapped, in `workspace_keys`
 *         ├── content subkey               -> source bodies, vault objects, memory values
 *         ├── credential subkey            -> connector OAuth tokens
 *         └── blind-index subkey           -> HMAC keys for exact-match search
 *
 * Subkeys are derived, never stored, so rotating a DEK rotates everything below it.
 */

export type KeyPurpose = 'content' | 'credential' | 'blind-index';

export interface WrappedDek {
  /** Opaque bytes; meaningless without the KEK. */
  wrapped: Uint8Array;
  keyProvider: string;
  kekVersion: string;
}

export interface KeyProvider {
  readonly kind: 'env' | 'kms';
  readonly id: string;
  readonly kekVersion: string;
  /** Produces a fresh workspace DEK, already wrapped. */
  createDek(workspaceId: string): Promise<{ dek: Uint8Array; wrapped: WrappedDek }>;
  unwrapDek(workspaceId: string, wrapped: WrappedDek): Promise<Uint8Array>;
  /** KEK rotation: re-wrap the same DEK under a new KEK without touching any data. */
  rewrap(workspaceId: string, wrapped: WrappedDek): Promise<WrappedDek>;
}

/* ------------------------------------------------------------------ *
 * Local / self-hosted: KEK from an environment variable
 * ------------------------------------------------------------------ */

export class EnvKeyProvider implements KeyProvider {
  readonly kind = 'env' as const;
  readonly id = 'env';
  private readonly kek: Uint8Array;

  constructor(
    masterKeyBase64: string,
    readonly kekVersion: string = 'v1',
  ) {
    const key = Buffer.from(masterKeyBase64, 'base64');
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `CAIRN_MASTER_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
      );
    }
    this.kek = key;
  }

  async createDek(workspaceId: string): Promise<{ dek: Uint8Array; wrapped: WrappedDek }> {
    const dek = randomBytes(KEY_BYTES);
    return { dek, wrapped: await this.wrap(workspaceId, dek) };
  }

  async unwrapDek(workspaceId: string, wrapped: WrappedDek): Promise<Uint8Array> {
    return decryptBytes(this.kek, wrapped.wrapped, dekAad(workspaceId));
  }

  async rewrap(workspaceId: string, wrapped: WrappedDek): Promise<WrappedDek> {
    const dek = await this.unwrapDek(workspaceId, wrapped);
    return this.wrap(workspaceId, dek);
  }

  private async wrap(workspaceId: string, dek: Uint8Array): Promise<WrappedDek> {
    return {
      wrapped: encryptBytes(this.kek, dek, dekAad(workspaceId)),
      keyProvider: this.id,
      kekVersion: this.kekVersion,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Production: KEK held by an external KMS / secret manager
 * ------------------------------------------------------------------ */

/** The two calls any KMS must provide. Implemented against AWS KMS, GCP KMS, Vault, etc. */
export interface KmsClient {
  encrypt(input: {
    keyId: string;
    plaintext: Uint8Array;
    context: Record<string, string>;
  }): Promise<{
    ciphertext: Uint8Array;
    keyVersion: string;
  }>;
  decrypt(input: {
    keyId: string;
    ciphertext: Uint8Array;
    context: Record<string, string>;
  }): Promise<Uint8Array>;
}

/**
 * Production key provider. The DEK is wrapped *by the KMS*, so this process never
 * holds the master key — only a short-lived DEK for the workspace it is serving.
 */
export class KmsKeyProvider implements KeyProvider {
  readonly kind = 'kms' as const;
  readonly id = 'kms';

  constructor(
    private readonly client: KmsClient,
    private readonly keyId: string,
    readonly kekVersion: string = 'kms',
  ) {}

  async createDek(workspaceId: string): Promise<{ dek: Uint8Array; wrapped: WrappedDek }> {
    const dek = randomBytes(KEY_BYTES);
    const res = await this.client.encrypt({
      keyId: this.keyId,
      plaintext: dek,
      context: { workspace_id: workspaceId, purpose: 'dek' },
    });
    return {
      dek,
      wrapped: { wrapped: res.ciphertext, keyProvider: this.id, kekVersion: res.keyVersion },
    };
  }

  async unwrapDek(workspaceId: string, wrapped: WrappedDek): Promise<Uint8Array> {
    return this.client.decrypt({
      keyId: this.keyId,
      ciphertext: wrapped.wrapped,
      context: { workspace_id: workspaceId, purpose: 'dek' },
    });
  }

  async rewrap(workspaceId: string, wrapped: WrappedDek): Promise<WrappedDek> {
    const dek = await this.unwrapDek(workspaceId, wrapped);
    const res = await this.client.encrypt({
      keyId: this.keyId,
      plaintext: dek,
      context: { workspace_id: workspaceId, purpose: 'dek' },
    });
    return { wrapped: res.ciphertext, keyProvider: this.id, kekVersion: res.keyVersion };
  }
}

function dekAad(workspaceId: string): string {
  return aad({ workspaceId, purpose: 'dek', id: workspaceId });
}

/* ------------------------------------------------------------------ *
 * Subkey derivation
 * ------------------------------------------------------------------ */

export function deriveSubkey(
  dek: Uint8Array,
  purpose: KeyPurpose,
  workspaceId: string,
): Uint8Array {
  const derived = hkdfSync(
    'sha256',
    dek,
    Buffer.from(workspaceId, 'utf8'),
    Buffer.from(`cairn:${purpose}`, 'utf8'),
    KEY_BYTES,
  );
  return Buffer.from(derived);
}

/** HMAC used for blind indexing. Not reversible, and useless without the DEK. */
export function blindHmac(indexKey: Uint8Array, value: string): Buffer {
  return createHmac('sha256', indexKey).update(value, 'utf8').digest();
}

/** Freshly generated 32-byte master key, base64. Used by `pnpm setup`. */
export function generateMasterKeyBase64(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}
