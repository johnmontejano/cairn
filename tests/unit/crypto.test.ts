import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  EnvKeyProvider,
  KmsKeyProvider,
  WorkspaceCrypto,
  aad,
  contentHash,
  decryptText,
  deriveSubkey,
  encryptText,
  generateMasterKeyBase64,
  manifestHash,
  type KmsClient,
} from '@cairn/crypto';

describe('authenticated encryption', () => {
  const key = randomBytes(32);
  const context = aad({ workspaceId: 'ws-1', purpose: 'memory_value', id: 'item-1' });

  it('round-trips text', () => {
    const envelope = encryptText(key, 'the opening date is 4 September', context);
    expect(decryptText(key, envelope, context)).toBe('the opening date is 4 September');
  });

  it('produces different ciphertext each time for the same plaintext', () => {
    const a = encryptText(key, 'same words', context);
    const b = encryptText(key, 'same words', context);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it('refuses a ciphertext whose bytes were changed', () => {
    const envelope = Buffer.from(encryptText(key, 'do not tamper', context));
    envelope[envelope.length - 1] = (envelope[envelope.length - 1] ?? 0) ^ 0x01;
    expect(() => decryptText(key, envelope, context)).toThrow(DecryptionError);
  });

  it('refuses a ciphertext moved to a different row', () => {
    const envelope = encryptText(key, 'belongs to item-1', context);
    const otherRow = aad({ workspaceId: 'ws-1', purpose: 'memory_value', id: 'item-2' });
    expect(() => decryptText(key, envelope, otherRow)).toThrow(DecryptionError);
  });

  it('refuses a ciphertext moved to a different workspace', () => {
    const envelope = encryptText(key, 'belongs to ws-1', context);
    const otherTenant = aad({ workspaceId: 'ws-2', purpose: 'memory_value', id: 'item-1' });
    expect(() => decryptText(key, envelope, otherTenant)).toThrow(DecryptionError);
  });

  it('refuses the wrong key', () => {
    const envelope = encryptText(key, 'secret', context);
    expect(() => decryptText(randomBytes(32), envelope, context)).toThrow(DecryptionError);
  });

  it('refuses data that is not a Cairn ciphertext', () => {
    const longEnough = Buffer.alloc(64, 0x41);
    expect(() => decryptText(key, longEnough, context)).toThrow(/not a Cairn ciphertext/i);
    expect(() => decryptText(key, Buffer.from('short'), context)).toThrow(/too short/);
  });
});

describe('the key hierarchy', () => {
  it('derives independent subkeys per purpose', () => {
    const dek = randomBytes(32);
    const content = deriveSubkey(dek, 'content', 'ws-1');
    const credential = deriveSubkey(dek, 'credential', 'ws-1');
    const index = deriveSubkey(dek, 'blind-index', 'ws-1');
    expect(Buffer.from(content).equals(Buffer.from(credential))).toBe(false);
    expect(Buffer.from(content).equals(Buffer.from(index))).toBe(false);
  });

  it('derives different subkeys for different workspaces from the same key', () => {
    const dek = randomBytes(32);
    expect(
      Buffer.from(deriveSubkey(dek, 'content', 'ws-1')).equals(
        Buffer.from(deriveSubkey(dek, 'content', 'ws-2')),
      ),
    ).toBe(false);
  });

  it('rotates the master key without changing any stored ciphertext', async () => {
    const oldProvider = new EnvKeyProvider(generateMasterKeyBase64(), 'v1');
    const { dek, wrapped } = await oldProvider.createDek('ws-1');
    const crypto = WorkspaceCrypto.fromDek('ws-1', dek);
    const ciphertext = crypto.encryptContent('memory that must survive', 'memory_value', 'item-1');

    // A new master key wraps the *same* data key, so nothing has to be re-encrypted.
    const rewrapped = await oldProvider.rewrap('ws-1', wrapped);
    const reopened = await WorkspaceCrypto.unwrap(oldProvider, 'ws-1', rewrapped);
    expect(reopened.decryptContent(ciphertext, 'memory_value', 'item-1')).toBe(
      'memory that must survive',
    );
  });

  it('cannot unwrap a data key with a different master key', async () => {
    const a = new EnvKeyProvider(generateMasterKeyBase64());
    const b = new EnvKeyProvider(generateMasterKeyBase64());
    const { wrapped } = await a.createDek('ws-1');
    await expect(b.unwrapDek('ws-1', wrapped)).rejects.toThrow(DecryptionError);
  });

  it('rejects a master key of the wrong length', () => {
    expect(() => new EnvKeyProvider(Buffer.from('too short').toString('base64'))).toThrow(
      /must decode to 32 bytes/,
    );
  });

  it('never sends the plaintext data key to a KMS after creation', async () => {
    const calls: string[] = [];
    const fake: KmsClient = {
      async encrypt({ plaintext, context }) {
        calls.push(`encrypt:${context.workspace_id}`);
        return {
          ciphertext: Buffer.concat([Buffer.from('wrapped:'), plaintext]),
          keyVersion: 'v9',
        };
      },
      async decrypt({ ciphertext, context }) {
        calls.push(`decrypt:${context.workspace_id}`);
        return Buffer.from(ciphertext).subarray('wrapped:'.length);
      },
    };
    const provider = new KmsKeyProvider(fake, 'key-1');
    const { dek, wrapped } = await provider.createDek('ws-1');
    expect(wrapped.kekVersion).toBe('v9');
    const unwrapped = await provider.unwrapDek('ws-1', wrapped);
    expect(Buffer.from(unwrapped).equals(Buffer.from(dek))).toBe(true);
    expect(calls).toEqual(['encrypt:ws-1', 'decrypt:ws-1']);
  });
});

describe('blind index', () => {
  it('is deterministic within a workspace and different across workspaces', () => {
    const dek = randomBytes(32);
    const a = WorkspaceCrypto.fromDek('ws-1', dek);
    const b = WorkspaceCrypto.fromDek('ws-2', dek);
    expect(a.blindTerm('lease').equals(a.blindTerm('lease'))).toBe(true);
    expect(a.blindTerm('lease').equals(a.blindTerm('leases'))).toBe(false);
    expect(a.blindTerm('lease').equals(b.blindTerm('lease'))).toBe(false);
  });

  it('does not reveal the term', () => {
    const crypto = WorkspaceCrypto.fromDek('ws-1', randomBytes(32));
    const hashed = crypto.blindTerm('confidential').toString('hex');
    expect(hashed).not.toContain(Buffer.from('confidential').toString('hex'));
    expect(hashed).toHaveLength(64);
  });
});

describe('content addressing', () => {
  it('hashes identical content identically', () => {
    expect(contentHash('one two three')).toBe(contentHash('one two three'));
    expect(contentHash('one two three')).not.toBe(contentHash('one two four'));
    expect(contentHash('x')).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('changes the manifest hash when any file, name, or content changes', () => {
    const base = [
      { path: 'memory/DECISIONS.md', contentHash: contentHash('a') },
      { path: 'memory/FACTS.md', contentHash: contentHash('b') },
    ];
    const same = [...base].reverse(); // order must not matter
    expect(manifestHash(base)).toBe(manifestHash(same));

    expect(manifestHash(base)).not.toBe(
      manifestHash([base[0]!, { path: 'memory/FACTS.md', contentHash: contentHash('b2') }]),
    );
    expect(manifestHash(base)).not.toBe(
      manifestHash([base[0]!, { path: 'memory/OTHER.md', contentHash: contentHash('b') }]),
    );
    expect(manifestHash(base)).not.toBe(manifestHash([base[0]!]));
  });
});
