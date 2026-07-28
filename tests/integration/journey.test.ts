import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLE_DOCUMENT, EXAMPLE_DOCUMENT_TITLE } from '@cairn/connectors';
import { memoryRepo, withTenant } from '@cairn/db';
import { CANONICAL_DOCS, parseCanonicalDocument } from '@cairn/domain';
import { approveMemoryItem, submitSource } from '@cairn/ingestion';
import { searchMemory } from '@cairn/search';
import { PostgresMemoryVault } from '@cairn/vault';
import { createTestWorld, type TestWorld } from '@cairn/testing';

/**
 * The whole promise of the product, in one test.
 *
 * Paste something → it becomes reviewable proposals with real evidence → approving
 * one writes canonical Markdown → that memory is findable → the answer cites the
 * exact words it came from. If this passes, the product does what the home page
 * says it does.
 */
describe('the complete journey from paste to cited answer', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('turns pasted text into reviewable proposals with exact evidence', async () => {
    const result = await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:journey',
      title: EXAMPLE_DOCUMENT_TITLE,
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(EXAMPLE_DOCUMENT),
    });
    expect(result.deduplicated).toBe(false);

    const drained = await world.drain();
    expect(drained.failed).toBe(0);

    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const proposals = await withTenant(world.services.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    expect(proposals.length).toBeGreaterThan(3);

    // Every proposal must carry evidence whose offsets really point at its words.
    const evidence = await withTenant(world.services.handle, world.actor, (tx) =>
      memoryRepo.listEvidence(
        tx,
        crypto,
        world.actor.workspaceId,
        proposals.map((p) => p.id),
      ),
    );
    for (const proposal of proposals) {
      const records = evidence.get(proposal.id) ?? [];
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(EXAMPLE_DOCUMENT.slice(record.startOffset, record.endOffset)).toBe(record.excerpt);
      }
    }

    // The extractor should recognise the decisions stated in ordinary language.
    const decisions = proposals.filter((p) => p.type === 'decision');
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.some((d) => /mill street/i.test(d.value))).toBe(true);
  });

  it('writes canonical Markdown when a memory is kept', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const proposals = await withTenant(world.services.handle, world.actor, (tx) =>
      memoryRepo.listMemoryItems(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        statuses: ['proposed'],
      }),
    );
    const decision = proposals.find((p) => p.type === 'decision' && /mill street/i.test(p.value));
    expect(decision).toBeDefined();

    const { versionId } = await approveMemoryItem(world.services, world.actor, {
      memoryItemId: decision!.id,
      projectId: world.project.id,
      authorLabel: 'Test Person',
    });
    expect(versionId).toBeTruthy();

    const vault = world.services.vault as PostgresMemoryVault;
    const markdown = await vault.read({
      actor: world.actor,
      projectId: world.project.id,
      path: CANONICAL_DOCS.decision.path,
    });
    expect(markdown).toContain(decision!.title);

    // The Markdown round-trips: parsing it recovers the same item and identity.
    const parsed = parseCanonicalDocument(markdown!);
    expect(parsed.map((p) => p.id)).toContain(decision!.id);
    expect(parsed.find((p) => p.id === decision!.id)?.value).toContain('Mill Street');

    const verification = await vault.verify({ actor: world.actor, projectId: world.project.id });
    expect(verification.ok).toBe(true);
    expect(verification.checked).toBeGreaterThan(0);
  });

  it('finds the saved memory and answers with citations that resolve', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const passages = await withTenant(world.services.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, world.actor, {
        query: 'Which lease did we sign?',
        projectId: world.project.id,
      }),
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]!.citations.length).toBeGreaterThan(0);

    const citation = passages[0]!.citations[0]!;
    expect(citation.excerpt.length).toBeGreaterThan(0);
    expect(citation.sourceItemTitle).toBe(EXAMPLE_DOCUMENT_TITLE);
    expect(EXAMPLE_DOCUMENT.slice(citation.startOffset, citation.endOffset)).toBe(citation.excerpt);

    const { answer } = await world.services.answerer.answer({
      question: 'Which lease did we sign?',
      passages,
    });
    expect(answer.status).toBe('answered');
    expect(answer.statements.length).toBeGreaterThan(0);
    // Every statement must point at real evidence.
    for (const statement of answer.statements) {
      expect(statement.citationIndexes.length).toBeGreaterThan(0);
      for (const index of statement.citationIndexes) {
        expect(answer.citations[index]).toBeDefined();
      }
    }
  });

  it('says so plainly when there is not enough saved to answer', async () => {
    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const passages = await withTenant(world.services.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, world.actor, {
        query: 'What is the airspeed velocity of an unladen swallow?',
        projectId: world.project.id,
      }),
    );
    const { answer } = await world.services.answerer.answer({
      question: 'What is the airspeed velocity of an unladen swallow?',
      passages,
    });
    expect(answer.status).toBe('insufficient_evidence');
    expect(answer.citations).toHaveLength(0);
  });

  it('recognises the same document a second time instead of duplicating it', async () => {
    const before = await world.drain();
    expect(before.failed).toBe(0);

    const again = await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:journey',
      title: EXAMPLE_DOCUMENT_TITLE,
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(EXAMPLE_DOCUMENT),
    });
    expect(again.deduplicated).toBe(true);
    expect(again.jobId).toBeNull();
  });
});
