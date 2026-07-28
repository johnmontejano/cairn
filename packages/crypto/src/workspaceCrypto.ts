import { aad, decryptBytes, decryptText, encryptBytes, encryptText } from './envelope';
import { blindHmac, deriveSubkey, type KeyProvider, type WrappedDek } from './keys';

/**
 * Everything the rest of the app needs to encrypt or decrypt within one workspace.
 *
 * Obtained only inside server/worker execution and only for the workspace the
 * current request is authorized for. It is deliberately not serializable and never
 * crosses a network boundary.
 */
export class WorkspaceCrypto {
  private constructor(
    readonly workspaceId: string,
    private readonly contentKey: Uint8Array,
    private readonly credentialKey: Uint8Array,
    private readonly indexKey: Uint8Array,
  ) {}

  static fromDek(workspaceId: string, dek: Uint8Array): WorkspaceCrypto {
    return new WorkspaceCrypto(
      workspaceId,
      deriveSubkey(dek, 'content', workspaceId),
      deriveSubkey(dek, 'credential', workspaceId),
      deriveSubkey(dek, 'blind-index', workspaceId),
    );
  }

  static async unwrap(
    provider: KeyProvider,
    workspaceId: string,
    wrapped: WrappedDek,
  ): Promise<WorkspaceCrypto> {
    const dek = await provider.unwrapDek(workspaceId, wrapped);
    return WorkspaceCrypto.fromDek(workspaceId, dek);
  }

  encryptContent(plaintext: string, purpose: string, id: string): Uint8Array {
    return encryptText(
      this.contentKey,
      plaintext,
      aad({ workspaceId: this.workspaceId, purpose, id }),
    );
  }

  decryptContent(envelope: Uint8Array, purpose: string, id: string): string {
    return decryptText(
      this.contentKey,
      envelope,
      aad({ workspaceId: this.workspaceId, purpose, id }),
    );
  }

  encryptBlob(bytes: Uint8Array, purpose: string, id: string): Uint8Array {
    return encryptBytes(
      this.contentKey,
      bytes,
      aad({ workspaceId: this.workspaceId, purpose, id }),
    );
  }

  decryptBlob(envelope: Uint8Array, purpose: string, id: string): Uint8Array {
    return decryptBytes(
      this.contentKey,
      envelope,
      aad({ workspaceId: this.workspaceId, purpose, id }),
    );
  }

  encryptCredential(plaintext: string, connectionId: string): Uint8Array {
    return encryptText(
      this.credentialKey,
      plaintext,
      aad({ workspaceId: this.workspaceId, purpose: 'credential', id: connectionId }),
    );
  }

  decryptCredential(envelope: Uint8Array, connectionId: string): string {
    return decryptText(
      this.credentialKey,
      envelope,
      aad({ workspaceId: this.workspaceId, purpose: 'credential', id: connectionId }),
    );
  }

  /**
   * Deterministic, non-reversible token used for exact-match search. The server can
   * test "does any chunk contain this term?" without a plaintext corpus existing
   * anywhere. Leaks term *frequency* per workspace; see docs/THREAT_MODEL.md.
   */
  blindTerm(term: string): Buffer {
    return blindHmac(this.indexKey, term);
  }

  blindTerms(terms: string[]): Buffer[] {
    return terms.map((t) => this.blindTerm(t));
  }
}
