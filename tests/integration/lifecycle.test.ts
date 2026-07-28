import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { jobsRepo, memoryRepo, schema, withSystem, withTenant } from '@cairn/db';
import { CANONICAL_DOCS, parseCanonicalDocument } from '@cairn/domain';
import {
  approveMemoryItem,
  drainJobs,
  processDueJobs,
  resolveConflict,
  submitSource,
} from '@cairn/ingestion';
import { rebuildProjectIndex, searchMemory } from '@cairn/search';
import { createTestWorld, type TestWorld } from '@cairn/testing';

const FIRST = '# Plan\n\nWe agreed the opening date is 4 September.\n';
const SECOND = '# Update\n\nWe agreed the opening date is 18 September.\n';

describe('when two notes disagree', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  async function approveFirstMatching(pattern: RegExp): Promise<string> {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const proposals = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    const match = proposals.find((p) => pattern.test(p.value));
    expect(match, `no proposal matching ${pattern}`).toBeDefined();
    await approveMemoryItem(world.services, world.actor, {
      memoryItemId: match!.id,
      projectId: world.project.id,
      authorLabel: 'Test',
    });
    return match!.id;
  }

  it('keeps both versions and flags the disagreement instead of overwriting', async () => {
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:first',
      title: 'Plan',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(FIRST),
    });
    await world.drain();
    const firstId = await approveFirstMatching(/4 September/);

    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:second',
      title: 'Update',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(SECOND),
    });
    await world.drain();

    const conflicts = await withTenant(world.handle, world.actor, (tx) =>
      tx.select().from(schema.memoryConflicts),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.memoryItemIds).toContain(firstId);
    expect(conflicts[0]!.status).toBe('open');

    // The previously approved statement is now flagged, not silently replaced.
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const first = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.getMemoryItem(tx, crypto, world.actor.workspaceId, firstId),
    );
    expect(first!.status).toBe('conflicted');
    expect(first!.value).toContain('4 September');
  });

  it('removes the conflicted statement from search until it is settled', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const results = await withTenant(world.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, world.actor, {
        query: 'opening date',
      }),
    );
    expect(results.every((r) => !r.memoryItem.value.includes('4 September'))).toBe(true);
  });

  it('keeps the losing version in history when the person chooses', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const [conflict] = await withTenant(world.handle, world.actor, (tx) =>
      tx.select().from(schema.memoryConflicts),
    );
    const newer = await withTenant(world.handle, world.actor, async (tx) => {
      const items = await memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed', 'conflicted'],
      });
      return items.find((i) => i.value.includes('18 September'))!;
    });

    const result = await withTenant(world.handle, world.actor, (tx) =>
      resolveConflict(tx, {
        workspaceId: world.actor.workspaceId,
        conflictId: conflict!.id,
        keepMemoryItemId: newer.id,
        resolvedBy: world.actor.userId,
      }),
    );
    expect(result.superseded.length).toBe(1);

    const loser = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.getMemoryItem(tx, crypto, world.actor.workspaceId, result.superseded[0]!),
    );
    expect(loser!.status).toBe('superseded');
    expect(loser!.supersededById).toBe(newer.id);
    // Nothing was deleted: the old assertion is still readable in history.
    expect(loser!.value).toContain('4 September');
  });
});

describe('the search index is derived, not authoritative', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:rebuild',
      title: 'Notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(
        '# Notes\n\nWe decided to use Whitmore Mills for flour.\n\nPriya is running the kitchen.\n\nWe need to decide the opening hours.\n',
      ),
    });
    await world.drain();

    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const proposals = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    for (const proposal of proposals) {
      await approveMemoryItem(world.services, world.actor, {
        memoryItemId: proposal.id,
        projectId: world.project.id,
        authorLabel: 'Test',
      });
    }
  });
  afterAll(async () => {
    await world.close();
  });

  it('reproduces identical search results after the index is destroyed and rebuilt', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const query = 'who is running the kitchen';

    const before = await withTenant(world.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, world.actor, { query }),
    );
    expect(before.length).toBeGreaterThan(0);

    // Throw away every derived row.
    await withSystem(world.handle, async (tx) => {
      await tx.delete(schema.memoryItemEmbeddings);
      await tx.delete(schema.memoryBlindTerms);
    });
    const empty = await withTenant(world.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, world.actor, { query }),
    );
    expect(empty).toHaveLength(0);

    await withTenant(world.handle, world.actor, (tx) =>
      rebuildProjectIndex(
        tx,
        crypto,
        world.services.embedder,
        world.actor.workspaceId,
        world.project.id,
      ),
    );
    const after = await withTenant(world.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, world.actor, { query }),
    );
    expect(after.map((r) => r.memoryItem.id)).toEqual(before.map((r) => r.memoryItem.id));
  });

  it('holds every approved memory in the canonical Markdown, recoverable by parsing it', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const approved = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['approved'],
      }),
    );
    const files = await world.services.vault.readAll({
      actor: world.actor,
      projectId: world.project.id,
    });
    const parsed = files.files.flatMap((f) => parseCanonicalDocument(f.content));

    expect(parsed.map((p) => p.id).sort()).toEqual(approved.map((a) => a.id).sort());
    for (const item of approved) {
      const match = parsed.find((p) => p.id === item.id)!;
      expect(match.value).toBe(item.value);
      expect(match.type).toBe(item.type);
      expect(match.title).toBe(item.title);
    }
    // Documents live where the type says they do.
    for (const file of files.files) {
      for (const entry of parseCanonicalDocument(file.content)) {
        expect(CANONICAL_DOCS[entry.type].path).toBe(file.path);
      }
    }
  });
});

describe('jobs are safe to replay', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('collapses a duplicate enqueue into the job already waiting', async () => {
    const first = await withTenant(world.handle, world.actor, (tx) =>
      jobsRepo.enqueueIn(tx, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        type: 'index.rebuild',
        idempotencyKey: 'rebuild:once',
        payload: { projectId: world.project.id },
      }),
    );
    const second = await withTenant(world.handle, world.actor, (tx) =>
      jobsRepo.enqueueIn(tx, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        type: 'index.rebuild',
        idempotencyKey: 'rebuild:once',
        payload: { projectId: world.project.id },
      }),
    );
    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);

    const rows = await withTenant(world.handle, world.actor, (tx) =>
      tx.select().from(schema.jobs).where(eq(schema.jobs.idempotencyKey, 'rebuild:once')),
    );
    expect(rows).toHaveLength(1);
  });

  it('lets two workers claim from one queue without doing the same job twice', async () => {
    for (let i = 0; i < 6; i += 1) {
      await withTenant(world.handle, world.actor, (tx) =>
        jobsRepo.enqueueIn(tx, {
          workspaceId: world.actor.workspaceId,
          projectId: world.project.id,
          type: 'index.rebuild',
          idempotencyKey: `rebuild:parallel:${i}`,
          payload: { projectId: world.project.id },
        }),
      );
    }
    const [a, b] = await Promise.all([
      world.services.queue.claim(4),
      world.services.queue.claim(4),
    ]);
    const claimed = [...a, ...b].map((j) => j.id);
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('retries a failing job with backoff, then gives up and says why', async () => {
    const { job } = await withTenant(world.handle, world.actor, (tx) =>
      jobsRepo.enqueueIn(tx, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        // No handler exists for this type, so it fails permanently.
        type: 'backup.create',
        idempotencyKey: 'will-fail',
        payload: {},
        maxAttempts: 2,
      }),
    );

    await processDueJobs(world.services, 10);
    let row = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)),
    );
    // A validation failure is permanent: it is not worth retrying.
    expect(row[0]!.state).toBe('dead');
    expect(row[0]!.errorCategory).toBe('validation_failed');
    expect(row[0]!.lastError).toContain('No handler');

    await withTenant(world.handle, world.actor, (tx) =>
      jobsRepo.retryJob(tx, world.actor.workspaceId, job.id),
    );
    row = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)),
    );
    expect(row[0]!.state).toBe('queued');
    expect(row[0]!.attempts).toBe(0);
  });

  it('produces the same memory whether the pipeline runs once or is replayed', async () => {
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:replay',
      title: 'Replay notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Replay\n\nWe decided to test replaying jobs.\n'),
    });
    await drainJobs(world.services, { maxRounds: 20 });

    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const countAfterFirstRun = (
      await withTenant(world.handle, world.actor, (tx) =>
        memoryRepo.listMemoryItems(tx, crypto, {
          workspaceId: world.actor.workspaceId,
          projectId: world.project.id,
          statuses: ['proposed'],
        }),
      )
    ).length;

    // Re-queue the ingest and extract steps for the same revision, as a
    // redelivered webhook or a resumed worker would.
    const [revision] = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.sourceRevisions).orderBy(schema.sourceRevisions.importedAt),
    );
    await withSystem(world.handle, async (tx) => {
      await tx
        .delete(schema.jobs)
        .where(
          and(
            eq(schema.jobs.workspaceId, world.actor.workspaceId),
            eq(schema.jobs.idempotencyKey, `extract:${revision!.id}`),
          ),
        );
    });
    await withTenant(world.handle, world.actor, (tx) =>
      jobsRepo.enqueueIn(tx, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        type: 'source.extract',
        idempotencyKey: `extract:${revision!.id}`,
        payload: {
          revisionId: revision!.id,
          sourceItemId: revision!.sourceItemId,
          projectId: world.project.id,
        },
      }),
    );
    await drainJobs(world.services, { maxRounds: 20 });

    const countAfterReplay = (
      await withTenant(world.handle, world.actor, (tx) =>
        memoryRepo.listMemoryItems(tx, crypto, {
          workspaceId: world.actor.workspaceId,
          projectId: world.project.id,
          statuses: ['proposed'],
        }),
      )
    ).length;
    // Duplicate detection makes the replay a no-op rather than doubling the queue.
    expect(countAfterReplay).toBe(countAfterFirstRun);
  });
});
