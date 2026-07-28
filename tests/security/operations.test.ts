import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  auditRepo,
  jobsRepo,
  memoryRepo,
  redactMetadata,
  schema,
  withSystem,
  withTenant,
  usageRepo,
} from '@cairn/db';
import { verifyGitHubSignature } from '@cairn/connectors';
import { BudgetExceededError } from '@cairn/domain';
import { JsonLogger, redactLogFields, submitSource } from '@cairn/ingestion';
import { createTestWorld, type TestWorld } from '@cairn/testing';

describe('secrets and memory never reach the logs', () => {
  it('redacts credentials and content, keeping only what is diagnostic', () => {
    const redacted = redactLogFields({
      workspaceId: 'ws-1',
      accessToken: 'ya29.super-secret',
      api_key: 'sk-live-abcdef',
      authorization: 'Bearer abc',
      cookie: 'session=1',
      value: 'We decided the salary is confidential',
      excerpt: 'a quoted sentence from a document',
      question: 'what did we decide about pay?',
      count: 7,
      nested: { password: 'hunter2', ok: true },
    });

    expect(redacted.workspaceId).toBe('ws-1');
    expect(redacted.count).toBe(7);
    for (const key of ['accessToken', 'api_key', 'authorization', 'cookie']) {
      expect(redacted[key]).toBe('[redacted]');
    }
    // Content is reduced to a length: useful for debugging, useless for reading.
    expect(redacted.value).toMatch(/^\[\d+ chars\]$/);
    expect(redacted.excerpt).toMatch(/^\[\d+ chars\]$/);
    expect(redacted.question).toMatch(/^\[\d+ chars\]$/);
    expect((redacted.nested as Record<string, unknown>).password).toBe('[redacted]');
    expect((redacted.nested as Record<string, unknown>).ok).toBe(true);

    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain('ya29');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('salary');
  });

  it('writes structured lines with nothing sensitive in them', () => {
    const lines: string[] = [];
    const logger = new JsonLogger('debug', { service: 'test' }, (line) => lines.push(line));
    logger.info('job.succeeded', {
      jobId: 'j-1',
      token: 'cairn_secretcode',
      value: 'The opening date is 4 September',
    });

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.message).toBe('job.succeeded');
    expect(parsed.jobId).toBe('j-1');
    expect(parsed.token).toBe('[redacted]');
    expect(lines[0]).not.toContain('cairn_secretcode');
    expect(lines[0]).not.toContain('4 September');
  });

  it('keeps audit metadata free of tokens and quoted text', () => {
    const redacted = redactMetadata({
      provider: 'github',
      token: 'ghs_abc',
      excerpt: 'a quoted sentence',
      value: 'a memory value',
      count: 3,
    });
    expect(redacted.provider).toBe('github');
    expect(redacted.count).toBe(3);
    expect(redacted.token).toBe('[redacted]');
    expect(redacted.excerpt).toBe('[redacted]');
    expect(redacted.value).toBe('[redacted]');
  });
});

describe('key rotation', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:rotate',
      title: 'Notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Notes\n\nWe decided to rotate keys regularly.\n'),
    });
    await world.drain();
  });
  afterAll(async () => {
    await world.close();
  });

  it('re-wraps the workspace key and leaves every existing row readable', async () => {
    const before = await withSystem(world.handle, (tx) => tx.select().from(schema.workspaceKeys));
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const itemsBefore = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    expect(itemsBefore.length).toBeGreaterThan(0);

    await world.services.keyring.rotateKek(world.actor.workspaceId);

    const after = await withSystem(world.handle, (tx) => tx.select().from(schema.workspaceKeys));
    expect(Buffer.from(after[0]!.wrappedDek).equals(Buffer.from(before[0]!.wrappedDek))).toBe(
      false,
    );
    expect(after[0]!.rotatedAt).not.toBeNull();

    // The data key is unchanged underneath, so nothing had to be re-encrypted.
    const rotatedCrypto = await world.services.keyring.get(world.actor.workspaceId);
    const itemsAfter = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, rotatedCrypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    expect(itemsAfter.map((i) => i.value).sort()).toEqual(itemsBefore.map((i) => i.value).sort());
  });
});

describe('webhook delivery', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('only accepts a payload whose signature checks out', () => {
    const secret = 'webhook-secret';
    const body = '{"action":"push"}';
    const good = `sha256=${require('node:crypto').createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(verifyGitHubSignature(secret, body, good)).toBe(true);
    expect(verifyGitHubSignature(secret, '{"action":"pushed"}', good)).toBe(false);
  });

  it('treats a redelivered webhook as a duplicate', async () => {
    const record = async () =>
      withSystem(world.handle, async (tx) => {
        const inserted = await tx
          .insert(schema.webhookDeliveries)
          .values({ provider: 'github', deliveryId: 'delivery-abc' })
          .onConflictDoNothing()
          .returning({ id: schema.webhookDeliveries.deliveryId });
        return inserted.length;
      });

    expect(await record()).toBe(1);
    expect(await record()).toBe(0);
    expect(await record()).toBe(0);
  });

  it('does not queue the same sync twice for one delivery', async () => {
    const enqueue = () =>
      withTenant(world.handle, world.actor, (tx) =>
        jobsRepo.enqueueIn(tx, {
          workspaceId: world.actor.workspaceId,
          projectId: world.project.id,
          type: 'connection.sync',
          idempotencyKey: 'github-delivery:delivery-abc:conn-1',
          payload: { connectionId: 'conn-1' },
        }),
      );
    const first = await enqueue();
    const second = await enqueue();
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });
});

describe('spending limits', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('refuses metered work once the workspace reaches its monthly limit', async () => {
    await withTenant(world.handle, world.actor, (tx) =>
      usageRepo.saveSettings(tx, world.actor.workspaceId, {
        aiMonthlyBudgetUsd: 0.01,
        aiHardLimitEnabled: true,
      }),
    );
    await withTenant(world.handle, world.actor, (tx) =>
      usageRepo.recordModelUsage(tx, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        operation: 'extraction',
        provider: 'openai',
        model: 'gpt-5-mini',
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCostUsd: 0.05,
        cached: false,
      }),
    );

    await expect(
      withTenant(world.handle, world.actor, (tx) =>
        usageRepo.assertWithinBudget(tx, world.actor.workspaceId, {
          defaultBudgetUsd: 5,
          softRatio: 0.8,
        }),
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it('stops the ingestion pipeline rather than spending past the limit', async () => {
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:over-budget',
      title: 'Notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Notes\n\nWe decided to watch the budget.\n'),
    });
    const result = await world.drain();
    expect(result.failed).toBeGreaterThan(0);

    const failed = await withSystem(world.handle, (tx) =>
      tx.select().from(schema.jobs).where(eq(schema.jobs.type, 'source.extract')),
    );
    expect(failed[0]!.errorCategory).toBe('budget_exceeded');

    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const items = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
      }),
    );
    expect(items).toHaveLength(0);
  });

  it('warns before the limit, not only at it', async () => {
    const status = await withTenant(world.handle, world.actor, (tx) =>
      usageRepo.checkBudget(tx, world.actor.workspaceId, { defaultBudgetUsd: 5, softRatio: 0.8 }),
    );
    expect(status.overSoftLimit).toBe(true);
    expect(status.blocked).toBe(true);
    expect(status.spentUsd).toBeCloseTo(0.05, 4);
  });

  it('lets the person turn the hard limit off deliberately', async () => {
    await withTenant(world.handle, world.actor, (tx) =>
      usageRepo.saveSettings(tx, world.actor.workspaceId, {
        aiMonthlyBudgetUsd: 0.01,
        aiHardLimitEnabled: false,
      }),
    );
    const status = await withTenant(world.handle, world.actor, (tx) =>
      usageRepo.checkBudget(tx, world.actor.workspaceId, { defaultBudgetUsd: 5, softRatio: 0.8 }),
    );
    expect(status.blocked).toBe(false);
    expect(status.overSoftLimit).toBe(true);
  });
});

describe('rate limiting', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('allows a burst then refuses, and says when to try again', async () => {
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await world.services.rateLimiter.check('test:key', 3, 60_000));
    }
    expect(results.slice(0, 3).every((r) => r.allowed)).toBe(true);
    expect(results.slice(3).every((r) => !r.allowed)).toBe(true);
    expect(results[4]!.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('counts each key separately', async () => {
    for (let i = 0; i < 4; i += 1) await world.services.rateLimiter.check('key-a', 3, 60_000);
    const other = await world.services.rateLimiter.check('key-b', 3, 60_000);
    expect(other.allowed).toBe(true);
  });
});

describe('the audit trail', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('records the events a person would ask about, without their content', async () => {
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:audit',
      title: 'Confidential planning notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Notes\n\nWe decided the secret code is 9876.\n'),
    });
    await world.drain();

    const events = await withTenant(world.handle, world.actor, (tx) =>
      auditRepo.listAuditEvents(tx, world.actor.workspaceId),
    );
    const actions = events.map((e) => e.action);
    expect(actions).toContain('source.ingested');
    expect(actions).toContain('memory.proposed');

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('9876');
    expect(serialized).not.toContain('secret code');
  });
});
