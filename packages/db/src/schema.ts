import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, vector } from './columns';

/**
 * Drizzle schema.
 *
 * Mirrors `migrations/0001_init.sql`, which stays the source of truth for DDL
 * (it carries the RLS policies and role grants Drizzle does not model). The
 * `schema-matches-migrations` test fails if the two drift apart.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  externalId: text('external_id'),
  authProvider: text('auth_provider').notNull().default('fixture'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  ownerUserId: uuid('owner_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('projects_workspace_id_slug_key').on(t.workspaceId, t.slug)],
);

export const authChallenges = pgTable('auth_challenges', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  codeHash: text('code_hash').notNull(),
  purpose: text('purpose').notNull().default('email_code'),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  userId: uuid('user_id').notNull(),
  workspaceId: uuid('workspace_id'),
  csrfSecret: text('csrf_secret').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ip: text('ip'),
});

export const workspaceKeys = pgTable('workspace_keys', {
  workspaceId: uuid('workspace_id').primaryKey(),
  wrappedDek: bytea('wrapped_dek').notNull(),
  keyProvider: text('key_provider').notNull(),
  kekVersion: text('kek_version').notNull(),
  state: text('state').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  rotatedAt: timestamp('rotated_at', { withTimezone: true }),
});

export const sourceConnections = pgTable(
  'source_connections',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    provider: text('provider').notNull(),
    displayName: text('display_name').notNull(),
    state: text('state').notNull().default('active'),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    cursor: text('cursor'),
    externalAccountLabel: text('external_account_label'),
    encryptedCredential: bytea('encrypted_credential'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (t) => [index('source_connections_ws_idx').on(t.workspaceId, t.projectId)],
);

export const sourceItems = pgTable(
  'source_items',
  {
    id: uuid('id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    connectionId: uuid('connection_id'),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    title: text('title').notNull(),
    mimeType: text('mime_type').notNull(),
    canonicalUri: text('canonical_uri'),
    currentRevisionId: uuid('current_revision_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    uniqueIndex('source_items_workspace_id_provider_external_id_key').on(
      t.workspaceId,
      t.provider,
      t.externalId,
    ),
  ],
);

export const sourceRevisions = pgTable(
  'source_revisions',
  {
    id: uuid('id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    sourceItemId: uuid('source_item_id').notNull(),
    externalRevision: text('external_revision'),
    contentHash: text('content_hash').notNull(),
    byteSize: integer('byte_size').notNull(),
    normalizedChars: integer('normalized_chars').notNull().default(0),
    storageKey: text('storage_key'),
    encryptedNormalized: bytea('encrypted_normalized'),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    uniqueIndex('source_revisions_workspace_id_source_item_id_content_hash_key').on(
      t.workspaceId,
      t.sourceItemId,
      t.contentHash,
    ),
  ],
);

export const storedObjects = pgTable(
  'stored_objects',
  {
    workspaceId: uuid('workspace_id').notNull(),
    key: text('key').notNull(),
    bytes: bytea('bytes').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.key] })],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sourceRevisionId: uuid('source_revision_id').notNull(),
    ordinal: integer('ordinal').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    charCount: integer('char_count').notNull(),
    encryptedText: bytea('encrypted_text').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('chunks_workspace_id_source_revision_id_ordinal_key').on(
      t.workspaceId,
      t.sourceRevisionId,
      t.ordinal,
    ),
  ],
);

export const chunkEmbeddings = pgTable('chunk_embeddings', {
  chunkId: uuid('chunk_id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  embedding: vector('embedding').notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memoryItems = pgTable(
  'memory_items',
  {
    id: uuid('id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    encryptedTitle: bytea('encrypted_title').notNull(),
    encryptedValue: bytea('encrypted_value').notNull(),
    normalizedHash: bytea('normalized_hash').notNull(),
    topics: text('topics')
      .array()
      .notNull()
      .default(sql`'{}'`),
    sensitivity: text('sensitivity').notNull().default('normal'),
    visibility: text('visibility').notNull().default('share_with_authorized_clients'),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    validFrom: timestamp('valid_from', { withTimezone: true }),
    validTo: timestamp('valid_to', { withTimezone: true }),
    supersedesId: uuid('supersedes_id'),
    supersededById: uuid('superseded_by_id'),
    conflictGroupId: uuid('conflict_group_id'),
    extractionMethod: text('extraction_method').notNull(),
    extractionModel: text('extraction_model'),
    extractionPromptVersion: text('extraction_prompt_version'),
    extractionSchemaVersion: text('extraction_schema_version'),
    confidence: real('confidence'),
    canonicalPath: text('canonical_path'),
    canonicalVersionId: uuid('canonical_version_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.id] }),
    index('memory_items_ws_project_idx').on(t.workspaceId, t.projectId, t.status),
    index('memory_items_norm_idx').on(t.workspaceId, t.projectId, t.normalizedHash),
    index('memory_items_conflict_idx').on(t.workspaceId, t.conflictGroupId),
  ],
);

export const memoryItemEmbeddings = pgTable(
  'memory_item_embeddings',
  {
    memoryItemId: uuid('memory_item_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    embedding: vector('embedding').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.memoryItemId] })],
);

export const memoryBlindTerms = pgTable(
  'memory_blind_terms',
  {
    workspaceId: uuid('workspace_id').notNull(),
    memoryItemId: uuid('memory_item_id').notNull(),
    termHash: bytea('term_hash').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.memoryItemId, t.termHash] }),
    index('memory_blind_terms_lookup_idx').on(t.workspaceId, t.termHash),
  ],
);

export const memoryEvidence = pgTable(
  'memory_evidence',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    memoryItemId: uuid('memory_item_id').notNull(),
    sourceItemId: uuid('source_item_id').notNull(),
    sourceRevisionId: uuid('source_revision_id').notNull(),
    startOffset: integer('start_offset').notNull(),
    endOffset: integer('end_offset').notNull(),
    encryptedExcerpt: bytea('encrypted_excerpt').notNull(),
    locator: text('locator'),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('memory_evidence_item_idx').on(t.workspaceId, t.memoryItemId)],
);

export const memoryConflicts = pgTable('memory_conflicts', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id').notNull(),
  memoryItemIds: uuid('memory_item_ids').array().notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  resolvedMemoryItemId: uuid('resolved_memory_item_id'),
  resolvedBy: uuid('resolved_by'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const memoryProposals = pgTable(
  'memory_proposals',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    memoryItemId: uuid('memory_item_id').notNull(),
    origin: text('origin').notNull(),
    clientId: uuid('client_id'),
    note: text('note'),
    state: text('state').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by'),
  },
  (t) => [index('memory_proposals_pending_idx').on(t.workspaceId, t.projectId, t.state)],
);

export const vaultObjects = pgTable(
  'vault_objects',
  {
    workspaceId: uuid('workspace_id').notNull(),
    contentHash: text('content_hash').notNull(),
    encryptedContent: bytea('encrypted_content').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.contentHash] })],
);

export const vaultVersions = pgTable(
  'vault_versions',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id').notNull(),
    parentVersionId: uuid('parent_version_id'),
    authorUserId: uuid('author_user_id'),
    authorLabel: text('author_label').notNull(),
    reason: text('reason').notNull(),
    manifestHash: text('manifest_hash').notNull(),
    manifest: jsonb('manifest').notNull(),
    provenance: jsonb('provenance').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('vault_versions_project_idx').on(t.workspaceId, t.projectId, t.createdAt)],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id'),
    type: text('type').notNull(),
    state: text('state').notNull().default('queued'),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull().default({}),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    errorCategory: text('error_category'),
    lastError: text('last_error'),
    lockedBy: text('locked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('jobs_workspace_id_idempotency_key_key').on(t.workspaceId, t.idempotencyKey),
    index('jobs_claim_idx').on(t.state, t.runAt),
  ],
);

export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  connectionId: uuid('connection_id').notNull(),
  state: text('state').notNull().default('running'),
  itemsSeen: integer('items_seen').notNull().default(0),
  itemsImported: integer('items_imported').notNull().default(0),
  itemsSkipped: integer('items_skipped').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  message: text('message'),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    provider: text('provider').notNull(),
    deliveryId: text('delivery_id').notNull(),
    workspaceId: uuid('workspace_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.deliveryId] })],
);

export const mcpClients = pgTable('mcp_clients', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  scopes: text('scopes').array().notNull(),
  projectIds: uuid('project_ids').array(),
  maxSensitivity: text('max_sensitivity').notNull().default('normal'),
  tokenHash: text('token_hash'),
  subject: text('subject'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    actorUserId: uuid('actor_user_id'),
    actorClientId: uuid('actor_client_id'),
    action: text('action').notNull(),
    subjectType: text('subject_type'),
    subjectId: text('subject_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_ws_idx').on(t.workspaceId, t.createdAt)],
);

export const deletionRequests = pgTable('deletion_requests', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  requestedBy: uuid('requested_by'),
  scope: text('scope').notNull(),
  targetId: uuid('target_id'),
  state: text('state').notNull().default('pending'),
  details: jsonb('details').notNull().default({}),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
});

export const backups = pgTable('backups', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  projectId: uuid('project_id'),
  kind: text('kind').notNull(),
  formatVersion: integer('format_version').notNull(),
  byteSize: integer('byte_size').notNull(),
  contentHash: text('content_hash').notNull(),
  storageKey: text('storage_key'),
  encryptedArchive: bytea('encrypted_archive'),
  versionId: uuid('version_id'),
  createdBy: uuid('created_by'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const modelUsage = pgTable(
  'model_usage',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id').notNull(),
    projectId: uuid('project_id'),
    jobId: uuid('job_id'),
    operation: text('operation').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 12, scale: 6 })
      .notNull()
      .default('0'),
    cached: boolean('cached').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('model_usage_month_idx').on(t.workspaceId, t.createdAt)],
);

export const workspaceSettings = pgTable('workspace_settings', {
  workspaceId: uuid('workspace_id').primaryKey(),
  aiMonthlyBudgetUsd: numeric('ai_monthly_budget_usd', { precision: 12, scale: 4 })
    .notNull()
    .default('5'),
  aiHardLimitEnabled: boolean('ai_hard_limit_enabled').notNull().default(true),
  privacyMode: boolean('privacy_mode').notNull().default(false),
  retentionDaysRaw: integer('retention_days_raw').notNull().default(365),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull().default(0),
});

/** Tables carrying tenant data. The RLS test asserts every one of these is protected. */
export const TENANT_TABLES = [
  'workspaces',
  'memberships',
  'projects',
  'workspace_keys',
  'source_connections',
  'source_items',
  'source_revisions',
  'stored_objects',
  'chunks',
  'chunk_embeddings',
  'memory_items',
  'memory_item_embeddings',
  'memory_blind_terms',
  'memory_evidence',
  'memory_conflicts',
  'memory_proposals',
  'vault_objects',
  'vault_versions',
  'jobs',
  'sync_runs',
  'mcp_clients',
  'audit_events',
  'deletion_requests',
  'backups',
  'model_usage',
  'workspace_settings',
] as const;
