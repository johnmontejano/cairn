import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { memoryRepo, schema, withSystem, withTenant } from '@cairn/db';
import {
  EvidenceRequiredError,
  type ActorContext,
  type MemoryItem,
  type SensitivityLevel,
  type ClientVisibilityPolicy,
} from '@cairn/domain';
import { approveMemoryItem, rejectMemoryItem, submitSource } from '@cairn/ingestion';
import { getDisclosableMemoryItem, indexMemoryItems, searchMemory } from '@cairn/search';
import { createTestWorld, type TestWorld } from '@cairn/testing';

/**
 * What may leave the vault.
 *
 * The rule the product promises is narrow and absolute: only approved memory is
 * retrievable, and an AI client sees less than the person does. These tests try
 * to get each excluded category out through search, through single-item reads,
 * and through the AI-client path.
 */
describe('nothing unapproved, private, or deleted can be retrieved', () => {
  let world: TestWorld;
  let ids: Record<string, string> = {};

  const asClient = (
    overrides: Partial<NonNullable<ActorContext['client']>> = {},
  ): ActorContext => ({
    userId: null,
    workspaceId: world.actor.workspaceId,
    role: 'viewer',
    client: {
      id: '00000000-0000-4000-8000-00000000c11e',
      name: 'Test assistant',
      scopes: ['memory:read'],
      projectIds: null,
      maxSensitivity: 'normal',
      ...overrides,
    },
  });

  async function seed(
    label: string,
    value: string,
    options: {
      status: MemoryItem['status'];
      sensitivity?: SensitivityLevel;
      visibility?: ClientVisibilityPolicy;
      withEvidence?: boolean;
    },
  ): Promise<string> {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    return withTenant(world.handle, world.actor, async (tx) => {
      const item = await memoryRepo.insertMemoryItem(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        type: 'fact',
        status: options.status,
        title: label,
        value,
        topics: ['marker'],
        sensitivity: options.sensitivity ?? 'normal',
        visibility: options.visibility ?? 'share_with_authorized_clients',
        extractionMethod: 'user_manual',
      });
      if (options.withEvidence !== false) {
        const [source] = await tx.select().from(schema.sourceItems).limit(1);
        const [revision] = await tx.select().from(schema.sourceRevisions).limit(1);
        await memoryRepo.addEvidence(tx, crypto, {
          workspaceId: world.actor.workspaceId,
          memoryItemId: item.id,
          sourceItemId: source!.id,
          sourceRevisionId: revision!.id,
          startOffset: 0,
          endOffset: 10,
          excerpt: 'evidence excerpt',
        });
      }
      await indexMemoryItems(tx, crypto, world.services.embedder, [item]);
      return item.id;
    });
  }

  beforeAll(async () => {
    world = await createTestWorld();
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:seed',
      title: 'Seed document',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Seed\n\nA starting document about zebrafish husbandry.\n'),
    });
    await world.drain();

    ids = {
      approved: await seed('Approved zebrafish note', 'The zebrafish tank is checked weekly.', {
        status: 'approved',
      }),
      proposed: await seed('Proposed zebrafish note', 'The zebrafish tank may need a new filter.', {
        status: 'proposed',
      }),
      conflicted: await seed('Conflicted zebrafish note', 'The zebrafish tank is checked daily.', {
        status: 'conflicted',
      }),
      sensitive: await seed(
        'Sensitive zebrafish note',
        'The zebrafish grant salary is confidential.',
        {
          status: 'approved',
          sensitivity: 'sensitive',
        },
      ),
      websiteOnly: await seed(
        'Website-only zebrafish note',
        'The zebrafish supplier is unreliable.',
        {
          status: 'approved',
          visibility: 'website_only',
        },
      ),
      neverShare: await seed(
        'Never-share zebrafish note',
        'The zebrafish budget code is internal.',
        {
          status: 'approved',
          visibility: 'never_share',
        },
      ),
      removed: await seed('Removed zebrafish note', 'The zebrafish plan was abandoned.', {
        status: 'approved',
      }),
    };
    await rejectMemoryItem(world.services, world.actor, ids.removed!);
  });
  afterAll(async () => {
    await world.close();
  });

  async function search(actor: ActorContext): Promise<string[]> {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const passages = await withTenant(world.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, actor, {
        query: 'zebrafish',
        limit: 25,
      }),
    );
    return passages.map((p) => p.memoryItem.id);
  }

  it('shows a signed-in person their approved memory, including the private kinds', async () => {
    const found = await search(world.actor);
    expect(found).toContain(ids.approved);
    expect(found).toContain(ids.sensitive);
    expect(found).toContain(ids.websiteOnly);
    expect(found).toContain(ids.neverShare);
  });

  it('never returns proposed, conflicted, or removed memory to anyone', async () => {
    for (const actor of [world.actor, asClient()]) {
      const found = await search(actor);
      expect(found).not.toContain(ids.proposed);
      expect(found).not.toContain(ids.conflicted);
      expect(found).not.toContain(ids.removed);
    }
  });

  it('withholds sensitive, website-only, and never-share memory from an AI client', async () => {
    const found = await search(asClient());
    expect(found).toContain(ids.approved);
    expect(found).not.toContain(ids.sensitive);
    expect(found).not.toContain(ids.websiteOnly);
    expect(found).not.toContain(ids.neverShare);
  });

  it('gives an AI client sensitive memory only when explicitly allowed, and never `never_share`', async () => {
    const found = await search(asClient({ maxSensitivity: 'sensitive' }));
    expect(found).toContain(ids.sensitive);
    expect(found).not.toContain(ids.neverShare);
    expect(found).not.toContain(ids.websiteOnly);
  });

  it('returns nothing to a client without the read scope', async () => {
    expect(await search(asClient({ scopes: ['memory:propose'] }))).toHaveLength(0);
  });

  it('returns nothing to a client granted a different project', async () => {
    expect(
      await search(asClient({ projectIds: ['00000000-0000-4000-8000-0000000000ff'] })),
    ).toHaveLength(0);
  });

  it('applies the same rule to a direct read by identifier', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const read = (actor: ActorContext, id: string) =>
      withTenant(world.handle, world.actor, (tx) =>
        getDisclosableMemoryItem({ tx, crypto }, actor, id),
      );

    expect(await read(world.actor, ids.approved!)).not.toBeNull();
    expect(await read(asClient(), ids.approved!)).not.toBeNull();
    // Knowing the identifier must not be enough.
    expect(await read(asClient(), ids.proposed!)).toBeNull();
    expect(await read(asClient(), ids.sensitive!)).toBeNull();
    expect(await read(asClient(), ids.neverShare!)).toBeNull();
    expect(await read(asClient(), ids.removed!)).toBeNull();
    expect(await read(world.actor, ids.removed!)).toBeNull();
  });

  it('drops removed memory out of the search index immediately, not at the next rebuild', async () => {
    const remaining = await withSystem(world.handle, (tx) =>
      tx
        .select()
        .from(schema.memoryItemEmbeddings)
        .where(eq(schema.memoryItemEmbeddings.memoryItemId, ids.removed!)),
    );
    expect(remaining).toHaveLength(0);

    const terms = await withSystem(world.handle, (tx) =>
      tx
        .select()
        .from(schema.memoryBlindTerms)
        .where(eq(schema.memoryBlindTerms.memoryItemId, ids.removed!)),
    );
    expect(terms).toHaveLength(0);
  });
});

describe('evidence is required before anything can be kept', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('refuses to approve a memory with nothing to point back to', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const item = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.insertMemoryItem(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        type: 'fact',
        status: 'proposed',
        title: 'Unsupported claim',
        value: 'Something nobody wrote down anywhere.',
        topics: [],
        sensitivity: 'normal',
        extractionMethod: 'ai_extraction',
      }),
    );

    await expect(
      approveMemoryItem(world.services, world.actor, {
        memoryItemId: item.id,
        projectId: world.project.id,
        authorLabel: 'Test',
      }),
    ).rejects.toBeInstanceOf(EvidenceRequiredError);

    const after = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.getMemoryItem(tx, crypto, world.actor.workspaceId, item.id),
    );
    expect(after?.status).toBe('proposed');
  });

  it('leaves no approved memory anywhere without evidence', async () => {
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:evidence-check',
      title: 'Notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Notes\n\nWe decided to meet on Tuesdays.\n'),
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
    // The unsupported claim from the previous test is still here, and must stay
    // unapprovable while everything with evidence goes through.
    let refused = 0;
    for (const proposal of proposals) {
      try {
        await approveMemoryItem(world.services, world.actor, {
          memoryItemId: proposal.id,
          projectId: world.project.id,
          authorLabel: 'Test',
        });
      } catch (error) {
        expect(error).toBeInstanceOf(EvidenceRequiredError);
        expect(proposal.title).toBe('Unsupported claim');
        refused += 1;
      }
    }
    expect(refused).toBe(1);

    const approved = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['approved'],
      }),
    );
    expect(approved.length).toBeGreaterThan(0);
    for (const item of approved) {
      const count = await withTenant(world.handle, world.actor, (tx) =>
        memoryRepo.countEvidence(tx, world.actor.workspaceId, item.id),
      );
      expect(count, `${item.title} was approved without evidence`).toBeGreaterThan(0);
    }
  });
});

describe('history cannot be rewritten', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:immutable',
      title: 'Notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode('# Notes\n\nWe decided to keep a written record.\n'),
    });
    await world.drain();
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const [proposal] = await withTenant(world.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    await approveMemoryItem(world.services, world.actor, {
      memoryItemId: proposal!.id,
      projectId: world.project.id,
      authorLabel: 'Test',
    });
  });
  afterAll(async () => {
    await world.close();
  });

  /** The driver error is wrapped; the database's own message is on the cause. */
  async function expectBlocked(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
      throw new Error('expected the database to refuse this update');
    } catch (error) {
      const chain = [error, (error as { cause?: unknown }).cause]
        .map((e) => (e as Error | undefined)?.message ?? '')
        .join(' | ');
      expect(chain).toMatch(/immutable/i);
    }
  }

  it('refuses to change a saved version, even from the system path', async () => {
    await expectBlocked(() =>
      withSystem(world.handle, async (tx) => {
        await tx.update(schema.vaultVersions).set({ reason: 'rewritten' });
      }),
    );
  });

  it('refuses to change stored documents or evidence', async () => {
    await expectBlocked(() =>
      withSystem(world.handle, async (tx) => {
        await tx.update(schema.vaultObjects).set({ byteSize: 0 });
      }),
    );
    await expectBlocked(() =>
      withSystem(world.handle, async (tx) => {
        await tx.update(schema.memoryEvidence).set({ startOffset: 0 });
      }),
    );
  });

  it('refuses to change the audit log', async () => {
    await expectBlocked(() =>
      withSystem(world.handle, async (tx) => {
        await tx.update(schema.auditEvents).set({ action: 'auth.sign_in' });
      }),
    );
  });

  it('notices when stored bytes no longer match their fingerprint', async () => {
    const before = await world.services.vault.verify({
      actor: world.actor,
      projectId: world.project.id,
    });
    expect(before.ok).toBe(true);

    // Simulate storage corruption: replace an object's bytes with a valid
    // ciphertext of different content. Update is blocked, so delete and re-insert.
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    await withSystem(world.handle, async (tx) => {
      const [object] = await tx.select().from(schema.vaultObjects).limit(1);
      await tx
        .delete(schema.vaultObjects)
        .where(
          and(
            eq(schema.vaultObjects.workspaceId, object!.workspaceId),
            eq(schema.vaultObjects.contentHash, object!.contentHash),
          ),
        );
      await tx.insert(schema.vaultObjects).values({
        workspaceId: object!.workspaceId,
        contentHash: object!.contentHash,
        encryptedContent: crypto.encryptBlob(
          Buffer.from('# Tampered\n'),
          'vault_object',
          object!.contentHash,
        ),
        byteSize: 11,
      });
    });

    const after = await world.services.vault.verify({
      actor: world.actor,
      projectId: world.project.id,
    });
    expect(after.ok).toBe(false);
    expect(after.problems.join(' ')).toMatch(/content hash does not match/i);
  });
});
