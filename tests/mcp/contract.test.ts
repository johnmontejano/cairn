import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { MCP_PROTOCOL_REVISION, PRODUCT } from '@cairn/config';
import { auditRepo, clientsRepo, memoryRepo, schema, withSystem, withTenant } from '@cairn/db';
import type { ActorContext, SensitivityLevel } from '@cairn/domain';
import { approveMemoryItem, submitSource } from '@cairn/ingestion';
import { McpAuthenticator, createMcpServer } from '@cairn/mcp';
import { searchMemory } from '@cairn/search';
import { createTestWorld, type TestWorld } from '@cairn/testing';

/**
 * MCP contract.
 *
 * Driven through a real MCP client over the SDK's in-process transport, so what
 * is asserted is the protocol behaviour a connected tool actually sees — not the
 * internal functions behind it.
 */
describe('the MCP server as a client sees it', () => {
  let world: TestWorld;
  let client: Client;
  let approvedId: string;
  let sensitiveId: string;

  async function connect(actor: ActorContext, name = 'Test assistant'): Promise<Client> {
    const server = createMcpServer({ services: world.services, actor, clientName: name });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
    return mcpClient;
  }

  function principal(overrides: Partial<NonNullable<ActorContext['client']>> = {}): ActorContext {
    return {
      userId: null,
      workspaceId: world.actor.workspaceId,
      role: 'viewer',
      client: {
        id: '00000000-0000-4000-8000-00000000c11e',
        name: 'Test assistant',
        scopes: ['memory:read'],
        projectIds: null,
        maxSensitivity: 'normal' as SensitivityLevel,
        ...overrides,
      },
    };
  }

  beforeAll(async () => {
    world = await createTestWorld();
    await submitSource(world.services, {
      actor: world.actor,
      projectId: world.project.id,
      provider: 'paste',
      externalId: 'paste:mcp',
      title: 'Planning notes',
      mimeType: 'text/markdown',
      bytes: new TextEncoder().encode(
        '# Planning\n\nWe decided to sign the Mill Street lease.\n\nTom needs to chase the solicitor this week.\n',
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
    const decision = proposals.find((p) => /mill street/i.test(p.value))!;
    approvedId = decision.id;
    await approveMemoryItem(world.services, world.actor, {
      memoryItemId: decision.id,
      projectId: world.project.id,
      authorLabel: 'Test',
    });

    // A second, sensitive memory to prove the ceiling is enforced over the wire.
    sensitiveId = await withTenant(world.handle, world.actor, async (tx) => {
      const item = await memoryRepo.insertMemoryItem(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        projectId: world.project.id,
        type: 'fact',
        status: 'approved',
        title: 'Mill Street rent',
        value: 'The confidential Mill Street rent is £2,400 a month.',
        topics: ['rent'],
        sensitivity: 'sensitive',
        extractionMethod: 'user_manual',
      });
      const [source] = await tx.select().from(schema.sourceItems).limit(1);
      const [revision] = await tx.select().from(schema.sourceRevisions).limit(1);
      await memoryRepo.addEvidence(tx, crypto, {
        workspaceId: world.actor.workspaceId,
        memoryItemId: item.id,
        sourceItemId: source!.id,
        sourceRevisionId: revision!.id,
        startOffset: 0,
        endOffset: 10,
        excerpt: 'rent excerpt',
      });
      const { indexMemoryItems } = await import('@cairn/search');
      await indexMemoryItems(tx, crypto, world.services.embedder, [item]);
      return item.id;
    });

    client = await connect(principal());
  });

  afterAll(async () => {
    await client?.close();
    await world.close();
  });

  it('advertises the read-first tool surface and nothing that writes', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      // Read-only despite writing a row: asking is reading, and the row is job
      // bookkeeping rather than saved content.
      'ask_deeply',
      'get_memory_item',
      'list_recent_changes',
      'propose_memory_update',
      'read_deep_answer',
      'search_memory',
      // Read-only: it reports where setup stands and what is missing. Advancing
      // setup is not reachable from here, for the same reason update_identity
      // is not — nothing over MCP writes without the person present.
      'setup_status',
      // Read-only: it reports the summary, and replacing it is deliberately not
      // reachable from here. See the note where update_identity would have been.
      'whoami',
    ]);

    const search = tools.find((t) => t.name === 'search_memory')!;
    expect(search.annotations?.readOnlyHint).toBe(true);
    // Descriptions are what a model reads; they must be honest about limits.
    expect(tools.find((t) => t.name === 'propose_memory_update')!.description).toMatch(
      /never changes saved memory|review/i,
    );
  });

  it('negotiates the stable protocol revision this server targets', () => {
    expect(client.getServerVersion()?.name).toBe(PRODUCT.slug);
    expect(MCP_PROTOCOL_REVISION).toBe('2025-11-25');
  });

  it('exposes the canonical documents as resources with their version', async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(`${PRODUCT.resourceScheme}://memory/decision`);

    const read = await client.readResource({ uri: `${PRODUCT.resourceScheme}://memory/decision` });
    const content = read.contents[0]!;
    expect(content.mimeType).toBe('text/markdown');
    expect(String((content as { text?: string }).text)).toContain('Mill Street');
    expect((content._meta as Record<string, unknown>).canonical_path).toBe('memory/DECISIONS.md');
    expect((content._meta as Record<string, unknown>).memory_version_id).toBeTruthy();
  });

  it('returns the same results the website would, with citations', async () => {
    const result = await client.callTool({
      name: 'search_memory',
      arguments: { query: 'Mill Street lease' },
    });
    const structured = result.structuredContent as {
      count: number;
      results: Array<{ memory_item_id: string; citations: unknown[] }>;
    };
    expect(structured.count).toBeGreaterThan(0);
    expect(structured.results[0]!.citations.length).toBeGreaterThan(0);

    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const direct = await withTenant(world.handle, world.actor, (tx) =>
      searchMemory({ tx, crypto, embedder: world.services.embedder }, principal(), {
        query: 'Mill Street lease',
        limit: 8,
      }),
    );
    expect(structured.results.map((r) => r.memory_item_id)).toEqual(
      direct.map((p) => p.memoryItem.id),
    );
  });

  it('gives every citation a resolvable source, offsets, and a memory version', async () => {
    const result = await client.callTool({
      name: 'get_memory_item',
      arguments: { memory_item_id: approvedId },
    });
    const structured = result.structuredContent as {
      found: boolean;
      canonical_path: string;
      citations: Array<{
        excerpt: string;
        offsets: { start: number; end: number };
        source: { provider: string; title: string; revision_id: string };
      }>;
    };
    expect(structured.found).toBe(true);
    expect(structured.canonical_path).toBe('memory/DECISIONS.md');
    const citation = structured.citations[0]!;
    expect(citation.excerpt.length).toBeGreaterThan(0);
    expect(citation.offsets.end).toBeGreaterThan(citation.offsets.start);
    expect(citation.source.title).toBe('Planning notes');
    expect(citation.source.revision_id).toBeTruthy();
  });

  it('withholds sensitive memory unless the connection was granted it', async () => {
    const restricted = await client.callTool({
      name: 'search_memory',
      arguments: { query: 'confidential rent' },
    });
    const ids = (
      restricted.structuredContent as { results: Array<{ memory_item_id: string }> }
    ).results.map((r) => r.memory_item_id);
    expect(ids).not.toContain(sensitiveId);

    const permitted = await connect(principal({ maxSensitivity: 'sensitive' }));
    const allowed = await permitted.callTool({
      name: 'search_memory',
      arguments: { query: 'confidential rent' },
    });
    expect(
      (allowed.structuredContent as { results: Array<{ memory_item_id: string }> }).results.map(
        (r) => r.memory_item_id,
      ),
    ).toContain(sensitiveId);
    await permitted.close();
  });

  it('refuses a tool the connection has no scope for', async () => {
    const readOnly = await connect(principal({ scopes: ['memory:read'] }));
    const result = await readOnly.callTool({
      name: 'propose_memory_update',
      arguments: {
        type: 'fact',
        title: 'Sneaky',
        value: 'This should never be stored',
        why: 'testing',
      },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/scope/i);
    await readOnly.close();
  });

  it('refuses to read anything for a connection without the read scope', async () => {
    const proposeOnly = await connect(principal({ scopes: ['memory:propose'] }));
    const result = await proposeOnly.callTool({
      name: 'search_memory',
      arguments: { query: 'Mill Street' },
    });
    expect(result.isError).toBe(true);
    await proposeOnly.close();
  });

  it('creates only a reviewable suggestion, never a saved memory', async () => {
    const proposer = await connect(principal({ scopes: ['memory:read', 'memory:propose'] }));
    const result = await proposer.callTool({
      name: 'propose_memory_update',
      arguments: {
        type: 'next_step',
        title: 'Order the signage',
        value: 'Order the signage once opening hours are decided.',
        why: 'The notes say hours must be decided before signage.',
      },
    });
    const structured = result.structuredContent as {
      status: string;
      committed: boolean;
      proposal_id: string;
    };
    expect(structured.status).toBe('awaiting_review');
    expect(structured.committed).toBe(false);

    const crypto = await world.services.keyring.get(world.actor.workspaceId);
    const stored = await withTenant(world.handle, world.actor, async (tx) => {
      const [proposal] = await tx
        .select()
        .from(schema.memoryProposals)
        .where(eqProposal(structured.proposal_id));
      const item = await memoryRepo.getMemoryItem(
        tx,
        crypto,
        world.actor.workspaceId,
        proposal!.memoryItemId,
      );
      return { proposal, item };
    });
    expect(stored.proposal!.origin).toBe('mcp_client');
    expect(stored.item!.status).toBe('proposed');
    // Until a person reviews it, a client suggestion is not shared onward.
    expect(stored.item!.visibility).toBe('website_only');

    // And it is not retrievable, by the proposing client or any other.
    const search = await proposer.callTool({
      name: 'search_memory',
      arguments: { query: 'Order the signage' },
    });
    expect(
      (search.structuredContent as { results: Array<{ memory_item_id: string }> }).results.map(
        (r) => r.memory_item_id,
      ),
    ).not.toContain(stored.item!.id);
    await proposer.close();
  });

  it('lists recent changes with their fingerprints', async () => {
    const result = await client.callTool({ name: 'list_recent_changes', arguments: {} });
    const changes = (
      result.structuredContent as {
        changes: Array<{ memory_version_id: string; manifest_hash: string; reason: string }>;
      }
    ).changes;
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.manifest_hash).toMatch(/^sha256:/);
  });

  it('audits every call, attributing it to the client rather than a person', async () => {
    await client.callTool({ name: 'search_memory', arguments: { query: 'lease' } });
    const events = await withTenant(world.handle, world.actor, (tx) =>
      auditRepo.listAuditEvents(tx, world.actor.workspaceId, { action: 'mcp.retrieved' }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.actorClientId).toBeTruthy();
    expect(events[0]!.actorUserId).toBeNull();
    // Audit metadata records what happened, never what was said.
    expect(JSON.stringify(events[0]!.metadata)).not.toContain('Mill Street');
  });

  it('never returns anything resembling a provider token', async () => {
    const result = await client.callTool({
      name: 'search_memory',
      arguments: { query: 'Mill Street lease' },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/ya29\.|ghs_|gho_|Bearer /);
    expect(serialized).not.toContain('encryptedCredential');
    expect(serialized).not.toContain('token');
  });
});

describe('MCP authentication', () => {
  let world: TestWorld;

  beforeAll(async () => {
    world = await createTestWorld();
  });
  afterAll(async () => {
    await world.close();
  });

  it('accepts a connection code and resolves it to a scoped actor', async () => {
    const created = await withTenant(world.handle, world.actor, (tx) =>
      clientsRepo.createMcpClient(tx, {
        workspaceId: world.actor.workspaceId,
        name: 'Claude on my laptop',
        scopes: ['memory:read'],
        projectIds: null,
        maxSensitivity: 'normal',
      }),
    );

    const auth = await new McpAuthenticator(world.handle, world.services.config).authenticate(
      created.token,
    );
    expect(auth.actor.workspaceId).toBe(world.actor.workspaceId);
    expect(auth.actor.client?.scopes).toEqual(['memory:read']);
    expect(auth.actor.userId).toBeNull();
  });

  it('stores only a hash of the code, so the database cannot be replayed', async () => {
    const created = await withTenant(world.handle, world.actor, (tx) =>
      clientsRepo.createMcpClient(tx, {
        workspaceId: world.actor.workspaceId,
        name: 'Another tool',
        scopes: ['memory:read'],
        projectIds: null,
        maxSensitivity: 'normal',
      }),
    );
    const rows = await withSystem(world.handle, (tx) => tx.select().from(schema.mcpClients));
    for (const row of rows) {
      expect(row.tokenHash).not.toBe(created.token);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('refuses a missing, malformed, or unknown code', async () => {
    const authenticator = new McpAuthenticator(world.handle, world.services.config);
    await expect(authenticator.authenticate(null)).rejects.toThrow(/no bearer token/i);
    await expect(authenticator.authenticate('not-a-cairn-code')).rejects.toThrow(/not valid/i);
    await expect(authenticator.authenticate('cairn_deadbeef')).rejects.toThrow(/not valid/i);
  });

  it('stops accepting a code the moment it is turned off', async () => {
    const created = await withTenant(world.handle, world.actor, (tx) =>
      clientsRepo.createMcpClient(tx, {
        workspaceId: world.actor.workspaceId,
        name: 'Temporary',
        scopes: ['memory:read'],
        projectIds: null,
        maxSensitivity: 'normal',
      }),
    );
    const authenticator = new McpAuthenticator(world.handle, world.services.config);
    await expect(authenticator.authenticate(created.token)).resolves.toBeTruthy();

    await withTenant(world.handle, world.actor, (tx) =>
      clientsRepo.revokeMcpClient(tx, world.actor.workspaceId, created.client.id),
    );
    await expect(authenticator.authenticate(created.token)).rejects.toThrow(/not valid/i);
  });

  it('refuses to grant a scope reserved for a future release', async () => {
    await expect(
      withTenant(world.handle, world.actor, (tx) =>
        clientsRepo.createMcpClient(tx, {
          workspaceId: world.actor.workspaceId,
          name: 'Too powerful',
          scopes: ['memory:write' as never],
          projectIds: null,
          maxSensitivity: 'normal',
        }),
      ),
    ).rejects.toThrow(/cannot be granted/i);
  });

  it('reads a bearer token from the header only when correctly formed', () => {
    const header = (value: string) => new Headers({ authorization: value });
    expect(McpAuthenticator.bearerFrom(header('Bearer abc123'))).toBe('abc123');
    expect(McpAuthenticator.bearerFrom(header('bearer abc123'))).toBe('abc123');
    expect(McpAuthenticator.bearerFrom(header('Basic abc123'))).toBeNull();
    expect(McpAuthenticator.bearerFrom(header('Bearer '))).toBeNull();
    expect(McpAuthenticator.bearerFrom(new Headers())).toBeNull();
  });
});

function eqProposal(id: string) {
  return eq(schema.memoryProposals.id, id);
}
