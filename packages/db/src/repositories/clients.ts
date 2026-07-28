import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { sha256Hex } from '@cairn/crypto';
import type { McpClient, McpScope, SensitivityLevel, Uuid } from '@cairn/domain';
import { ValidationError } from '@cairn/domain';
import type { CairnTx } from '../client';
import * as schema from '../schema';

/**
 * Connected AI clients.
 *
 * The connection code is shown once and stored only as a SHA-256 hash, so a
 * database copy cannot be replayed as a credential. Revocation is a timestamp, not
 * a delete, so the audit trail keeps referring to a real row.
 */

const CODE_PREFIX = 'cairn_';

export function generateClientToken(): { token: string; hash: string; preview: string } {
  const token = `${CODE_PREFIX}${randomBytes(24).toString('base64url')}`;
  return { token, hash: sha256Hex(token), preview: `${token.slice(0, 12)}…` };
}

export async function createMcpClient(
  tx: CairnTx,
  input: {
    workspaceId: Uuid;
    name: string;
    scopes: McpScope[];
    projectIds: Uuid[] | null;
    maxSensitivity: SensitivityLevel;
    subject?: string | null;
  },
): Promise<{ client: McpClient; token: string }> {
  if (input.scopes.length === 0) throw new ValidationError('A connection needs at least one scope');
  // `memory:write` is reserved for a future release and is never granted here.
  for (const scope of input.scopes) {
    if (scope !== 'memory:read' && scope !== 'memory:propose') {
      throw new ValidationError(`Scope ${scope} cannot be granted in this release`);
    }
  }
  const { token, hash } = generateClientToken();
  const [row] = await tx
    .insert(schema.mcpClients)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name,
      scopes: input.scopes,
      projectIds: input.projectIds,
      maxSensitivity: input.maxSensitivity,
      tokenHash: hash,
      subject: input.subject ?? null,
    })
    .returning();
  if (!row) throw new Error('client insert returned no row');
  return { client: toClient(row), token };
}

export async function listMcpClients(tx: CairnTx, workspaceId: Uuid): Promise<McpClient[]> {
  const rows = await tx
    .select()
    .from(schema.mcpClients)
    .where(eq(schema.mcpClients.workspaceId, workspaceId))
    .orderBy(desc(schema.mcpClients.createdAt));
  return rows.map(toClient);
}

export async function revokeMcpClient(tx: CairnTx, workspaceId: Uuid, id: Uuid): Promise<void> {
  await tx
    .update(schema.mcpClients)
    .set({ revokedAt: sql`now()`, tokenHash: null })
    .where(and(eq(schema.mcpClients.workspaceId, workspaceId), eq(schema.mcpClients.id, id)));
}

/**
 * Resolves a bearer token to a client. Runs on the system path because the caller
 * has not yet proven which workspace it belongs to — that is what this establishes.
 */
export async function findClientByToken(tx: CairnTx, token: string): Promise<McpClient | null> {
  if (!token.startsWith(CODE_PREFIX)) return null;
  const [row] = await tx
    .select()
    .from(schema.mcpClients)
    .where(
      and(eq(schema.mcpClients.tokenHash, sha256Hex(token)), isNull(schema.mcpClients.revokedAt)),
    )
    .limit(1);
  return row ? toClient(row) : null;
}

export async function findClientBySubject(
  tx: CairnTx,
  workspaceId: Uuid,
  subject: string,
): Promise<McpClient | null> {
  const [row] = await tx
    .select()
    .from(schema.mcpClients)
    .where(
      and(
        eq(schema.mcpClients.workspaceId, workspaceId),
        eq(schema.mcpClients.subject, subject),
        isNull(schema.mcpClients.revokedAt),
      ),
    )
    .limit(1);
  return row ? toClient(row) : null;
}

export async function touchClient(tx: CairnTx, id: Uuid): Promise<void> {
  await tx
    .update(schema.mcpClients)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(schema.mcpClients.id, id));
}

function toClient(row: typeof schema.mcpClients.$inferSelect): McpClient {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    scopes: (row.scopes ?? []) as McpScope[],
    projectIds: row.projectIds,
    maxSensitivity: row.maxSensitivity as SensitivityLevel,
    tokenHash: row.tokenHash,
    subject: row.subject,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
  };
}
