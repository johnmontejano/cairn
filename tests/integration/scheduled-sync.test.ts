import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, withSystem } from '@cairn/db';
import { enqueueScheduledSyncs } from '@cairn/ingestion';
import { createTestWorld, type TestWorld } from '@cairn/testing';

/**
 * The scheduled refresh is the only thing in the product that acts without a
 * person present, so the two properties worth pinning down are which
 * connections it touches and what happens when it runs twice.
 */
describe('the scheduled refresh', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  async function addConnection(
    displayName: string,
    state: string,
    disconnectedAt: Date | null = null,
  ): Promise<string> {
    const id = randomUUID();
    await withSystem(world.handle, (tx) =>
      tx.insert(schema.sourceConnections).values({
        id,
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        provider: 'gmail',
        displayName,
        state,
        scopes: [],
        disconnectedAt,
      }),
    );
    return id;
  }

  async function queuedSyncTargets(): Promise<string[]> {
    const rows = await withSystem(world.handle, (tx) =>
      tx
        .select({ payload: schema.jobs.payload })
        .from(schema.jobs)
        .where(eq(schema.jobs.type, 'connection.sync')),
    );
    return rows
      .map((row) => (row.payload as { connectionId?: string } | null)?.connectionId)
      .filter((id): id is string => typeof id === 'string');
  }

  it('syncs live connections and leaves demo and disconnected ones alone', async () => {
    const active = await addConnection('real-active', 'active');
    const ready = await addConnection('real-ready', 'ready');
    const demo = await addConnection('fixture', 'demo');
    const disconnectedState = await addConnection('gone', 'disconnected');
    // The row that matters most: still marked active, but disconnected. Reading
    // it would mean using a permission the person already withdrew.
    const withdrawn = await addConnection('withdrawn', 'active', new Date());

    const result = await enqueueScheduledSyncs(world.services, { now: 0 });

    expect(result.failed).toBe(0);
    expect(result.connections).toBe(2);
    expect(result.enqueued).toBe(2);

    const targets = await queuedSyncTargets();
    expect(targets).toContain(active);
    expect(targets).toContain(ready);
    expect(targets).not.toContain(demo);
    expect(targets).not.toContain(disconnectedState);
    expect(targets).not.toContain(withdrawn);
  });

  it('collapses a second run in the same bucket instead of syncing twice', async () => {
    const before = (await queuedSyncTargets()).length;

    const again = await enqueueScheduledSyncs(world.services, { now: 0 });

    expect(again.connections).toBe(2);
    expect(again.enqueued).toBe(0);
    expect(again.alreadyQueued).toBe(2);
    expect(await queuedSyncTargets()).toHaveLength(before);
  });

  it('runs again once the bucket rolls over', async () => {
    const before = (await queuedSyncTargets()).length;

    const later = await enqueueScheduledSyncs(world.services, { now: 3_600_000 });

    expect(later.enqueued).toBe(2);
    expect(await queuedSyncTargets()).toHaveLength(before + 2);
  });
});
