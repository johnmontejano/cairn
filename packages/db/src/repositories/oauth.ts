import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { sha256Hex } from '@cairn/crypto';
import type { McpScope, MemoryType, SensitivityLevel, Uuid } from '@cairn/domain';
import { ValidationError } from '@cairn/domain';
import type { CairnTx } from '../client';
import * as schema from '../schema';

/**
 * OAuth 2.1 storage for remote MCP authorization.
 *
 * Every credential here is stored only as a SHA-256 hash, so a database copy
 * yields nothing replayable — the same rule the connection codes already
 * follow. The raw value is returned exactly once, to the caller that created
 * it, and never read back.
 */

const ACCESS_PREFIX = 'cairn_at_';
const REFRESH_PREFIX = 'cairn_rt_';
const CODE_PREFIX = 'cairn_ac_';

/** Authorization codes are single-use and exchanged immediately. */
const CODE_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000;

function mint(prefix: string): { value: string; hash: string } {
  const value = `${prefix}${randomBytes(32).toString('base64url')}`;
  return { value, hash: sha256Hex(value) };
}

export interface OauthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  clientUri: string | null;
  registrationType: 'dynamic' | 'client_id_doc';
  createdAt: Date;
}

export async function upsertOauthClient(
  tx: CairnTx,
  input: {
    clientId: string;
    clientName: string;
    redirectUris: string[];
    clientUri?: string | null;
    registrationType?: 'dynamic' | 'client_id_doc';
  },
): Promise<OauthClientRecord> {
  if (input.redirectUris.length === 0) {
    throw new ValidationError('A client must register at least one redirect URI');
  }
  const [row] = await tx
    .insert(schema.oauthClients)
    .values({
      clientId: input.clientId,
      clientName: input.clientName,
      redirectUris: input.redirectUris,
      clientUri: input.clientUri ?? null,
      registrationType: input.registrationType ?? 'dynamic',
      metadataFetchedAt: input.registrationType === 'client_id_doc' ? new Date() : null,
    })
    .onConflictDoUpdate({
      target: schema.oauthClients.clientId,
      set: {
        clientName: input.clientName,
        redirectUris: input.redirectUris,
        clientUri: input.clientUri ?? null,
        metadataFetchedAt: input.registrationType === 'client_id_doc' ? new Date() : null,
      },
    })
    .returning();
  if (!row) throw new Error('oauth client upsert returned no row');
  return toClientRecord(row);
}

export async function findOauthClient(
  tx: CairnTx,
  clientId: string,
): Promise<OauthClientRecord | null> {
  const [row] = await tx
    .select()
    .from(schema.oauthClients)
    .where(eq(schema.oauthClients.clientId, clientId))
    .limit(1);
  return row ? toClientRecord(row) : null;
}

/**
 * Records what a person consented to, and returns the code once.
 *
 * The code is bound to the client, the redirect URI, the PKCE challenge and the
 * resource together. Any one of them differing at exchange time invalidates it,
 * which is what stops a code intercepted in a redirect from being useful on its
 * own.
 */
export async function createAuthorizationCode(
  tx: CairnTx,
  input: {
    workspaceId: Uuid;
    oauthClientId: string;
    mcpClientId: Uuid;
    redirectUri: string;
    codeChallenge: string;
    scopes: McpScope[];
    resource: string;
    grantedBy: Uuid | null;
  },
): Promise<{ code: string; expiresAt: Date }> {
  const { value, hash } = mint(CODE_PREFIX);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);
  await tx.insert(schema.oauthAuthorizationCodes).values({
    id: randomUUID(),
    workspaceId: input.workspaceId,
    codeHash: hash,
    oauthClientId: input.oauthClientId,
    mcpClientId: input.mcpClientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: 'S256',
    scopes: input.scopes,
    resource: input.resource,
    grantedBy: input.grantedBy,
    expiresAt,
  });
  return { code: value, expiresAt };
}

export interface ConsumedCode {
  workspaceId: Uuid;
  oauthClientId: string;
  mcpClientId: Uuid;
  redirectUri: string;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
}

/**
 * Exchanges a code exactly once.
 *
 * Returns `null` for unknown, expired, or already-used codes without saying
 * which — the distinction is useful to an attacker and to nobody else. The
 * consumed row is kept rather than deleted so a replay is visible afterwards.
 */
export async function consumeAuthorizationCode(
  tx: CairnTx,
  code: string,
): Promise<ConsumedCode | null> {
  if (!code.startsWith(CODE_PREFIX)) return null;
  const [row] = await tx
    .select()
    .from(schema.oauthAuthorizationCodes)
    .where(eq(schema.oauthAuthorizationCodes.codeHash, sha256Hex(code)))
    .limit(1);
  if (!row) return null;
  if (row.consumedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;

  await tx
    .update(schema.oauthAuthorizationCodes)
    .set({ consumedAt: sql`now()` })
    .where(
      and(
        eq(schema.oauthAuthorizationCodes.workspaceId, row.workspaceId),
        eq(schema.oauthAuthorizationCodes.id, row.id),
      ),
    );

  return {
    workspaceId: row.workspaceId as Uuid,
    oauthClientId: row.oauthClientId,
    mcpClientId: row.mcpClientId as Uuid,
    redirectUri: row.redirectUri,
    codeChallenge: row.codeChallenge,
    scopes: (row.scopes ?? []) as McpScope[],
    resource: row.resource,
  };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  scopes: McpScope[];
}

export async function issueTokens(
  tx: CairnTx,
  input: {
    workspaceId: Uuid;
    oauthClientId: string;
    mcpClientId: Uuid;
    scopes: McpScope[];
    resource: string;
  },
): Promise<IssuedTokens> {
  const access = mint(ACCESS_PREFIX);
  const refresh = mint(REFRESH_PREFIX);
  const now = Date.now();

  await tx.insert(schema.oauthTokens).values([
    {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      kind: 'access',
      tokenHash: access.hash,
      oauthClientId: input.oauthClientId,
      mcpClientId: input.mcpClientId,
      scopes: input.scopes,
      resource: input.resource,
      expiresAt: new Date(now + ACCESS_TTL_MS),
    },
    {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      kind: 'refresh',
      tokenHash: refresh.hash,
      oauthClientId: input.oauthClientId,
      mcpClientId: input.mcpClientId,
      scopes: input.scopes,
      resource: input.resource,
      expiresAt: new Date(now + REFRESH_TTL_MS),
    },
  ]);

  return {
    accessToken: access.value,
    refreshToken: refresh.value,
    expiresInSeconds: Math.floor(ACCESS_TTL_MS / 1000),
    scopes: input.scopes,
  };
}

export interface ResolvedAccessToken {
  workspaceId: Uuid;
  mcpClientId: Uuid;
  oauthClientId: string;
  scopes: McpScope[];
  resource: string;
  clientName: string;
  projectIds: Uuid[] | null;
  memoryTypes: MemoryType[] | null;
  maxSensitivity: SensitivityLevel;
}

/**
 * Resolves a bearer access token for the resource server.
 *
 * Joins to `mcp_clients` so a connection turned off in the website stops
 * working immediately, without waiting for the access token to expire —
 * revocation a person performs should be felt at once, not in up to an hour.
 */
export async function findAccessToken(
  tx: CairnTx,
  token: string,
): Promise<ResolvedAccessToken | null> {
  if (!token.startsWith(ACCESS_PREFIX)) return null;
  const [row] = await tx
    .select({
      token: schema.oauthTokens,
      client: schema.mcpClients,
    })
    .from(schema.oauthTokens)
    .innerJoin(schema.mcpClients, eq(schema.mcpClients.id, schema.oauthTokens.mcpClientId))
    .where(
      and(
        eq(schema.oauthTokens.tokenHash, sha256Hex(token)),
        eq(schema.oauthTokens.kind, 'access'),
        isNull(schema.oauthTokens.revokedAt),
        isNull(schema.mcpClients.revokedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.token.expiresAt.getTime() < Date.now()) return null;

  await tx
    .update(schema.oauthTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(schema.oauthTokens.workspaceId, row.token.workspaceId),
        eq(schema.oauthTokens.id, row.token.id),
      ),
    );

  return {
    workspaceId: row.token.workspaceId as Uuid,
    mcpClientId: row.token.mcpClientId as Uuid,
    oauthClientId: row.token.oauthClientId,
    // The effective scopes are the intersection of what the token carries and
    // what the connection still allows. Narrowing a connection in the website
    // therefore narrows every token already issued against it, rather than
    // applying only to the next one.
    scopes: ((row.token.scopes ?? []) as McpScope[]).filter((s) =>
      ((row.client.scopes ?? []) as McpScope[]).includes(s),
    ),
    resource: row.token.resource,
    clientName: row.client.name,
    projectIds: row.client.projectIds as Uuid[] | null,
    // Read from the connection, not the token, for the same reason as `scopes`
    // above: narrowing what a connection may read must take effect on tokens
    // already issued, not only on the next one.
    memoryTypes: row.client.memoryTypes as MemoryType[] | null,
    maxSensitivity: row.client.maxSensitivity as SensitivityLevel,
  };
}

export interface RotationResult {
  tokens: IssuedTokens;
  workspaceId: Uuid;
}

/**
 * Rotates a refresh token, and treats reuse as theft.
 *
 * A refresh token that has already been rotated should never appear again. When
 * it does, the honest reading is that a copy escaped, so the entire chain for
 * that connection is revoked rather than issuing a replacement and hoping. The
 * person reconnects once; an attacker holding the stolen copy gets nothing.
 */
export async function rotateRefreshToken(
  tx: CairnTx,
  token: string,
): Promise<RotationResult | null> {
  if (!token.startsWith(REFRESH_PREFIX)) return null;
  const [row] = await tx
    .select()
    .from(schema.oauthTokens)
    .where(
      and(
        eq(schema.oauthTokens.tokenHash, sha256Hex(token)),
        eq(schema.oauthTokens.kind, 'refresh'),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (row.rotatedTo || row.revokedAt) {
    await revokeTokensForMcpClient(tx, row.workspaceId as Uuid, row.mcpClientId as Uuid);
    return null;
  }
  if (row.expiresAt.getTime() < Date.now()) return null;

  // A connection turned off in the website cannot be refreshed back to life.
  const [client] = await tx
    .select()
    .from(schema.mcpClients)
    .where(and(eq(schema.mcpClients.id, row.mcpClientId), isNull(schema.mcpClients.revokedAt)))
    .limit(1);
  if (!client) return null;

  const scopes = ((row.scopes ?? []) as McpScope[]).filter((s) =>
    ((client.scopes ?? []) as McpScope[]).includes(s),
  );
  if (scopes.length === 0) return null;

  const tokens = await issueTokens(tx, {
    workspaceId: row.workspaceId as Uuid,
    oauthClientId: row.oauthClientId,
    mcpClientId: row.mcpClientId as Uuid,
    scopes,
    resource: row.resource,
  });

  const [replacement] = await tx
    .select({ id: schema.oauthTokens.id })
    .from(schema.oauthTokens)
    .where(eq(schema.oauthTokens.tokenHash, sha256Hex(tokens.refreshToken)))
    .limit(1);

  await tx
    .update(schema.oauthTokens)
    .set({ rotatedTo: replacement?.id ?? null, revokedAt: sql`now()` })
    .where(
      and(eq(schema.oauthTokens.workspaceId, row.workspaceId), eq(schema.oauthTokens.id, row.id)),
    );

  return { tokens, workspaceId: row.workspaceId as Uuid };
}

/** Called when a person turns a connection off, so live tokens die with it. */
export async function revokeTokensForMcpClient(
  tx: CairnTx,
  workspaceId: Uuid,
  mcpClientId: Uuid,
): Promise<void> {
  await tx
    .update(schema.oauthTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(schema.oauthTokens.workspaceId, workspaceId),
        eq(schema.oauthTokens.mcpClientId, mcpClientId),
        isNull(schema.oauthTokens.revokedAt),
      ),
    );
}

function toClientRecord(row: typeof schema.oauthClients.$inferSelect): OauthClientRecord {
  return {
    clientId: row.clientId,
    clientName: row.clientName,
    redirectUris: (row.redirectUris ?? []) as string[],
    clientUri: row.clientUri,
    registrationType: row.registrationType as 'dynamic' | 'client_id_doc',
    createdAt: row.createdAt,
  };
}

/** Exposed for tests: proves a stored hash cannot be replayed as a token. */
export const tokenPrefixes = {
  access: ACCESS_PREFIX,
  refresh: REFRESH_PREFIX,
  code: CODE_PREFIX,
} as const;
