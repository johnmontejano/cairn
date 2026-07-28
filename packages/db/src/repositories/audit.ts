import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { AuditAction, AuditEvent, AuditSink, Uuid } from '@cairn/domain';
import type { CairnTx, DbHandle } from '../client';
import * as schema from '../schema';
import { withSystem } from '../tenancy';

/** Keys whose values are never written to an audit record, whatever a caller passes. */
const FORBIDDEN_METADATA_KEYS = [
  'token',
  'access_token',
  'refresh_token',
  'accesstoken',
  'refreshtoken',
  'secret',
  'password',
  'passphrase',
  'key',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'credential',
  'value',
  'content',
  'text',
  'excerpt',
  'body',
];

/**
 * Redaction applied at the boundary, not at the call sites.
 *
 * Audit metadata is meant to answer "what happened", never "what did it say". A
 * caller that accidentally passes an excerpt or a token gets `[redacted]` instead
 * of a durable copy of it in a table that outlives the memory itself.
 */
export function redactMetadata(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (FORBIDDEN_METADATA_KEYS.includes(key.toLowerCase())) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      out[key] = value.length > 200 ? `${value.slice(0, 200)}…` : value;
    } else if (value === null || ['number', 'boolean'].includes(typeof value)) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 20).map((v) => (typeof v === 'string' ? v.slice(0, 120) : v));
    } else if (typeof value === 'object') {
      out[key] = redactMetadata(value as Record<string, unknown>);
    }
  }
  return out;
}

export async function recordAudit(
  tx: CairnTx,
  event: {
    workspaceId: Uuid;
    actorUserId?: Uuid | null;
    actorClientId?: Uuid | null;
    action: AuditAction;
    subjectType?: string | null;
    subjectId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    id: randomUUID(),
    workspaceId: event.workspaceId,
    actorUserId: event.actorUserId ?? null,
    actorClientId: event.actorClientId ?? null,
    action: event.action,
    subjectType: event.subjectType ?? null,
    subjectId: event.subjectId ?? null,
    metadata: redactMetadata(event.metadata ?? {}),
  });
}

export class DatabaseAuditSink implements AuditSink {
  constructor(private readonly handle: DbHandle) {}

  async record(event: Parameters<AuditSink['record']>[0]): Promise<void> {
    await withSystem(this.handle, (tx) => recordAudit(tx, event));
  }
}

export async function listAuditEvents(
  tx: CairnTx,
  workspaceId: Uuid,
  options?: { limit?: number; action?: AuditAction },
): Promise<AuditEvent[]> {
  const conditions = [eq(schema.auditEvents.workspaceId, workspaceId)];
  if (options?.action) conditions.push(eq(schema.auditEvents.action, options.action));
  const rows = await tx
    .select()
    .from(schema.auditEvents)
    .where(and(...conditions))
    .orderBy(desc(schema.auditEvents.createdAt))
    .limit(options?.limit ?? 100);
  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    actorUserId: row.actorUserId,
    actorClientId: row.actorClientId,
    action: row.action as AuditAction,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    metadata: row.metadata as Record<string, unknown>,
    createdAt: row.createdAt,
  }));
}
