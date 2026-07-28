export * from './envelope';
export * from './hash';
export * from './keys';
export * from './workspaceCrypto';

import { getConfig } from '@cairn/config';
import { EnvKeyProvider, type KeyProvider, type KmsClient, KmsKeyProvider } from './keys';

let cachedProvider: KeyProvider | undefined;

/**
 * Resolves the deployment's key provider.
 *
 * A KMS provider needs a `KmsClient` supplied by the host application (so this
 * package depends on no cloud SDK); until one is registered, selecting `kms`
 * fails loudly rather than silently downgrading to an env key.
 */
let kmsClientFactory: (() => KmsClient) | null = null;

export function registerKmsClient(factory: () => KmsClient): void {
  kmsClientFactory = factory;
  cachedProvider = undefined;
}

export function getKeyProvider(): KeyProvider {
  if (cachedProvider) return cachedProvider;
  const { env } = getConfig();

  if (env.CAIRN_KEY_PROVIDER === 'kms') {
    if (!kmsClientFactory) {
      throw new Error(
        'CAIRN_KEY_PROVIDER=kms but no KMS client is registered. Call registerKmsClient() during server start-up (see docs/DEPLOYMENT.md).',
      );
    }
    if (!env.CAIRN_KMS_KEY_ID) throw new Error('CAIRN_KEY_PROVIDER=kms requires CAIRN_KMS_KEY_ID');
    cachedProvider = new KmsKeyProvider(kmsClientFactory(), env.CAIRN_KMS_KEY_ID);
    return cachedProvider;
  }

  if (!env.CAIRN_MASTER_KEY) {
    throw new Error(
      'CAIRN_MASTER_KEY is not set. Run `pnpm setup` to create a local development key, or set it from your secret manager in production.',
    );
  }
  cachedProvider = new EnvKeyProvider(env.CAIRN_MASTER_KEY, env.CAIRN_MASTER_KEY_VERSION);
  return cachedProvider;
}

export function resetKeyProvider(): void {
  cachedProvider = undefined;
}
