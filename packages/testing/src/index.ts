import { randomUUID } from 'node:crypto';
import { generateMasterKeyBase64, resetKeyProvider } from '@cairn/crypto';
import { resetConfig } from '@cairn/config';
import { migrate } from '@cairn/db/migrate';
import {
  type DbHandle,
  Keyring,
  openDatabase,
  schema,
  withSystem,
  workspacesRepo,
} from '@cairn/db';
import type { ActorContext, Project, Workspace } from '@cairn/domain';
import { type CairnServices, createServices, drainJobs } from '@cairn/ingestion';

/**
 * Test harness.
 *
 * Every test file gets its own in-memory PostgreSQL, so tests are isolated,
 * parallel-safe, and run against the same SQL — including row-level security and
 * pgvector — as production. Nothing here mocks the database.
 */

export interface TestWorld {
  handle: DbHandle;
  services: CairnServices;
  actor: ActorContext;
  workspace: Workspace;
  project: Project;
  userId: string;
  close(): Promise<void>;
  /** Runs queued jobs to completion, as the worker would. */
  drain(): Promise<{ processed: number; failed: number }>;
  /** Creates a second, unrelated workspace for cross-tenant tests. */
  otherWorkspace(): Promise<{ actor: ActorContext; workspaceId: string; projectId: string }>;
}

export interface TestWorldOptions {
  email?: string;
  env?: Record<string, string | undefined>;
}

export async function createTestWorld(options: TestWorldOptions = {}): Promise<TestWorld> {
  // `NODE_ENV` is typed read-only by Next's ambient types; assign through the
  // record so this harness works whether or not those types are loaded.
  (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
  process.env.CAIRN_MASTER_KEY ??= generateMasterKeyBase64();
  process.env.CAIRN_MODE = 'demo';
  process.env.AI_PROVIDER = 'fixture';
  process.env.AUTH_PROVIDER = 'fixture';
  delete process.env.DATABASE_URL;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
  resetKeyProvider();

  const handle = await openDatabase({ dataDir: ':memory:' });
  await migrate(handle, { silent: true });

  const keyring = new Keyring(handle);
  const provisioned = await workspacesRepo.provisionUser(handle, keyring, {
    email: options.email ?? `test-${randomUUID().slice(0, 8)}@example.com`,
    displayName: 'Test Person',
    externalId: null,
    authProvider: 'fixture',
  });
  const services = await createServices({ handle });

  const actor: ActorContext = {
    userId: provisioned.user.id,
    workspaceId: provisioned.workspace.id,
    role: 'owner',
  };

  return {
    handle,
    services: { ...services, keyring },
    actor,
    workspace: provisioned.workspace,
    project: provisioned.project,
    userId: provisioned.user.id,
    async close() {
      await handle.close();
    },
    async drain() {
      const result = await drainJobs({ ...services, keyring }, { maxRounds: 30, batch: 10 });
      return { processed: result.processed, failed: result.failed };
    },
    async otherWorkspace() {
      const other = await workspacesRepo.provisionUser(handle, keyring, {
        email: `other-${randomUUID().slice(0, 8)}@example.com`,
        displayName: 'Someone Else',
        externalId: null,
        authProvider: 'fixture',
      });
      return {
        actor: { userId: other.user.id, workspaceId: other.workspace.id, role: 'owner' },
        workspaceId: other.workspace.id,
        projectId: other.project.id,
      };
    },
  };
}

/** Counts rows without RLS, to prove what deletion actually removed. */
export async function countRows(handle: DbHandle, table: keyof typeof schema): Promise<number> {
  return withSystem(handle, async (tx) => {
    const rows = await tx.select().from(schema[table] as never);
    return (rows as unknown[]).length;
  });
}

export { schema };
