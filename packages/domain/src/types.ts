import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Identity and tenancy
 * ------------------------------------------------------------------ */

export type Uuid = string;

export const memberRoles = ['owner', 'admin', 'member', 'viewer'] as const;
export type MemberRole = (typeof memberRoles)[number];

export interface User {
  id: Uuid;
  email: string;
  displayName: string | null;
  createdAt: Date;
}

export interface Workspace {
  id: Uuid;
  name: string;
  ownerUserId: Uuid;
  createdAt: Date;
}

export interface Project {
  id: Uuid;
  workspaceId: Uuid;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
}

export interface Membership {
  workspaceId: Uuid;
  userId: Uuid;
  role: MemberRole;
  createdAt: Date;
}

/** An authorized AI client acting on a person's behalf, with a narrower reach. */
export interface ClientPrincipal {
  id: Uuid;
  name: string;
  scopes: McpScope[];
  /** `null` means every project in the workspace. */
  projectIds: Uuid[] | null;
  maxSensitivity: SensitivityLevel;
}

/**
 * The authorization envelope every server-side operation must carry. There is no
 * ambient "current user": callers pass this explicitly so authorization cannot be
 * forgotten by omission.
 */
export interface ActorContext {
  userId: Uuid | null;
  workspaceId: Uuid;
  role: MemberRole;
  /** Present when the caller is an AI client rather than a signed-in person. */
  client?: ClientPrincipal;
  ip?: string | null;
  userAgent?: string | null;
}

/* ------------------------------------------------------------------ *
 * Memory
 * ------------------------------------------------------------------ */

export const memoryTypes = [
  'project_brief',
  'fact',
  'decision',
  'current_state',
  'next_step',
  'operating_rule',
  'preference',
  'person_org',
] as const;
export type MemoryType = (typeof memoryTypes)[number];

export const memoryStatuses = [
  'proposed',
  'approved',
  'rejected',
  'superseded',
  'conflicted',
] as const;
export type MemoryStatus = (typeof memoryStatuses)[number];

/**
 * How freely an item may be disclosed. `restricted` items never leave the website,
 * even to an authorized AI client.
 */
export const sensitivityLevels = ['normal', 'sensitive', 'restricted'] as const;
export type SensitivityLevel = (typeof sensitivityLevels)[number];

export const clientVisibilityPolicies = [
  'share_with_authorized_clients',
  'website_only',
  'never_share',
] as const;
export type ClientVisibilityPolicy = (typeof clientVisibilityPolicies)[number];

export const extractionMethods = ['user_manual', 'user_edit', 'ai_extraction', 'import'] as const;
export type ExtractionMethod = (typeof extractionMethods)[number];

export interface MemoryItem {
  id: Uuid;
  workspaceId: Uuid;
  projectId: Uuid;
  type: MemoryType;
  status: MemoryStatus;
  /** Human-readable statement, as it appears in canonical Markdown. */
  value: string;
  /** Lowercased, whitespace-collapsed form used for duplicate/contradiction checks. */
  normalizedValue: string;
  title: string;
  topics: string[];
  sensitivity: SensitivityLevel;
  visibility: ClientVisibilityPolicy;
  observedAt: Date | null;
  importedAt: Date;
  validFrom: Date | null;
  validTo: Date | null;
  supersedesId: Uuid | null;
  supersededById: Uuid | null;
  conflictGroupId: Uuid | null;
  extractionMethod: ExtractionMethod;
  extractionModel: string | null;
  extractionPromptVersion: string | null;
  extractionSchemaVersion: string | null;
  confidence: number | null;
  canonicalPath: string | null;
  canonicalVersionId: Uuid | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A memory item is only meaningful with the evidence that produced it. */
export interface MemoryEvidence {
  id: Uuid;
  workspaceId: Uuid;
  memoryItemId: Uuid;
  sourceItemId: Uuid;
  sourceRevisionId: Uuid;
  /** Character offsets into the normalized text of the source revision. */
  startOffset: number;
  endOffset: number;
  excerpt: string;
  locator: string | null;
  contentHash: string;
  createdAt: Date;
}

export interface MemoryCandidate {
  type: MemoryType;
  title: string;
  value: string;
  topics: string[];
  sensitivity: SensitivityLevel;
  confidence: number;
  observedAt: Date | null;
  evidence: Array<{
    startOffset: number;
    endOffset: number;
    excerpt: string;
    locator?: string | null;
  }>;
}

export const memoryCandidateSchema = z.object({
  type: z.enum(memoryTypes),
  title: z.string().min(1).max(200),
  value: z.string().min(1).max(4000),
  topics: z.array(z.string().min(1).max(48)).max(12).default([]),
  sensitivity: z.enum(sensitivityLevels).default('normal'),
  confidence: z.number().min(0).max(1).default(0.5),
  observedAt: z.coerce.date().nullable().default(null),
  evidence: z
    .array(
      z.object({
        startOffset: z.number().int().min(0),
        endOffset: z.number().int().min(0),
        excerpt: z.string().min(1).max(2000),
        locator: z.string().max(500).nullish(),
      }),
    )
    .min(1),
});

export const memoryCandidateListSchema = z.object({
  candidates: z.array(memoryCandidateSchema).max(50),
});

export interface MemoryConflict {
  id: Uuid;
  workspaceId: Uuid;
  projectId: Uuid;
  memoryItemIds: Uuid[];
  reason: string;
  status: 'open' | 'resolved';
  resolvedMemoryItemId: Uuid | null;
  resolvedBy: Uuid | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/* ------------------------------------------------------------------ *
 * Sources
 * ------------------------------------------------------------------ */

/**
 * First-run setup.
 *
 * The sequence lives here rather than in the database so adding a step is a
 * code change with a test behind it, not a migration.
 *
 * `connect` is the only step that can refuse to advance. One connected app
 * proves the mechanism works; two prove the point of the product, which is that
 * context arrives from more than one place. Below that the answers are thin
 * enough that someone would reasonably conclude it does not work.
 */
export const setupSteps = ['offer', 'connect', 'save_back', 'ready'] as const;
export type SetupStep = (typeof setupSteps)[number];

/**
 * The floor, below which the product cannot demonstrate itself. One source
 * proves the mechanism works; two prove the point, which is that context arrives
 * from more than one place.
 */
export const MINIMUM_CONNECTED_APPS = 2;

/**
 * What the interface should ask for, which is not the same number.
 *
 * The gate is where setup stops being blocked. This is where answers start
 * being good. Collapsing the two would either block people who could have
 * carried on, or let them reach a first answer thin enough to conclude the
 * product does not work — and that conclusion is drawn once and rarely
 * revisited.
 */
export const RECOMMENDED_CONNECTED_APPS = 3;

/** What an assistant may write back without being asked each time. */
export const saveBackModes = ['everything', 'important', 'nothing'] as const;
export type SaveBackMode = (typeof saveBackModes)[number];

export const sourceProviders = [
  'paste',
  'upload',
  'url',
  'google_drive',
  'github',
  'notion',
  // Reached through Pipedream rather than a hand-written client. Drive and
  // GitHub stay hand-written: replacing connectors that already work and are
  // tested with untested ones would trade certainty for consistency.
  'gmail',
  'google_calendar',
] as const;
export type SourceProvider = (typeof sourceProviders)[number];

export const connectionStates = [
  'active',
  'setup_required',
  'needs_reconnect',
  'disconnected',
  'error',
] as const;
export type ConnectionState = (typeof connectionStates)[number];

export interface SourceConnection {
  id: Uuid;
  workspaceId: Uuid;
  projectId: Uuid;
  provider: SourceProvider;
  displayName: string;
  state: ConnectionState;
  scopes: string[];
  cursor: string | null;
  externalAccountLabel: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  disconnectedAt: Date | null;
}

export interface SourceItem {
  id: Uuid;
  workspaceId: Uuid;
  projectId: Uuid;
  connectionId: Uuid | null;
  provider: SourceProvider;
  externalId: string;
  title: string;
  mimeType: string;
  canonicalUri: string | null;
  currentRevisionId: Uuid | null;
  createdAt: Date;
  deletedAt: Date | null;
}

/** Immutable, encrypted snapshot of one version of a source. */
export interface SourceRevision {
  id: Uuid;
  workspaceId: Uuid;
  sourceItemId: Uuid;
  /** Provider's own revision marker when it has one (Drive version, git blob SHA...). */
  externalRevision: string | null;
  contentHash: string;
  byteSize: number;
  normalizedChars: number;
  storageKey: string | null;
  importedAt: Date;
}

/* ------------------------------------------------------------------ *
 * Vault
 * ------------------------------------------------------------------ */

export interface VaultVersion {
  id: Uuid;
  workspaceId: Uuid;
  projectId: Uuid;
  parentVersionId: Uuid | null;
  authorUserId: Uuid | null;
  authorLabel: string;
  reason: string;
  manifestHash: string;
  createdAt: Date;
  provenance: VaultProvenance;
}

export interface VaultProvenance {
  kind: 'user_approval' | 'user_edit' | 'ingestion' | 'restore' | 'system';
  memoryItemIds?: Uuid[];
  sourceItemIds?: Uuid[];
  note?: string;
}

export interface VaultEntry {
  path: string;
  contentHash: string;
  byteSize: number;
}

export interface VaultManifest {
  version: number;
  entries: VaultEntry[];
}

export interface VaultCommitChange {
  path: string;
  /** `null` deletes the path in the new version. */
  content: string | null;
}

/* ------------------------------------------------------------------ *
 * Retrieval and citations
 * ------------------------------------------------------------------ */

export interface Citation {
  memoryItemId: Uuid;
  memoryVersionId: Uuid | null;
  canonicalPath: string | null;
  sourceProvider: SourceProvider;
  sourceItemId: Uuid;
  sourceItemTitle: string;
  sourceRevisionId: Uuid;
  locator: string | null;
  excerpt: string;
  startOffset: number;
  endOffset: number;
  importedAt: Date;
}

export interface RetrievedPassage {
  memoryItem: Pick<
    MemoryItem,
    | 'id'
    | 'type'
    | 'title'
    | 'value'
    | 'topics'
    | 'projectId'
    | 'sensitivity'
    | 'canonicalPath'
    | 'canonicalVersionId'
    | 'updatedAt'
  >;
  score: number;
  matchedBy: Array<'semantic' | 'exact'>;
  citations: Citation[];
}

export interface AnswerStatement {
  text: string;
  citationIndexes: number[];
}

export interface Answer {
  /** `insufficient_evidence` is a first-class outcome, not an error. */
  status: 'answered' | 'insufficient_evidence';
  statements: AnswerStatement[];
  citations: Citation[];
  note?: string;
}

/* ------------------------------------------------------------------ *
 * Jobs
 * ------------------------------------------------------------------ */

export const jobTypes = [
  'source.ingest',
  'source.extract',
  'memory.reconcile',
  'vault.commit',
  'index.rebuild',
  'connection.sync',
  'backup.create',
  'workspace.delete',
  // Synthesis across everything saved, which takes longer than a request should
  // wait for. See migration 0007.
  'query.deep',
] as const;
export type JobType = (typeof jobTypes)[number];

export const jobStates = ['queued', 'running', 'succeeded', 'failed', 'dead'] as const;
export type JobState = (typeof jobStates)[number];

export interface Job {
  id: Uuid;
  workspaceId: Uuid;
  projectId: Uuid | null;
  type: JobType;
  state: JobState;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  errorCategory: string | null;
  lastError: string | null;
  createdAt: Date;
}

export interface SyncRun {
  id: Uuid;
  workspaceId: Uuid;
  connectionId: Uuid;
  state: 'running' | 'succeeded' | 'failed' | 'partial';
  itemsSeen: number;
  itemsImported: number;
  itemsSkipped: number;
  startedAt: Date;
  finishedAt: Date | null;
  message: string | null;
}

/* ------------------------------------------------------------------ *
 * MCP + audit
 * ------------------------------------------------------------------ */

export const mcpScopes = ['memory:read', 'memory:propose'] as const;
export type McpScope = (typeof mcpScopes)[number];

/** Reserved for a future release; never granted by the current UI. */
export const RESERVED_MCP_SCOPES = ['memory:write'] as const;

export interface McpClient {
  id: Uuid;
  workspaceId: Uuid;
  name: string;
  scopes: McpScope[];
  projectIds: Uuid[] | null;
  /** Only sensitivity levels at or below this are ever returned to this client. */
  maxSensitivity: SensitivityLevel;
  tokenHash: string | null;
  subject: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export const auditActions = [
  'auth.sign_in',
  'auth.sign_out',
  'source.connected',
  'source.disconnected',
  'source.ingested',
  'memory.proposed',
  'memory.approved',
  'memory.edited',
  'memory.rejected',
  'memory.removed',
  'memory.conflict_resolved',
  'vault.committed',
  'export.created',
  'backup.created',
  'restore.performed',
  'mcp.retrieved',
  'mcp.proposed',
  'mcp.client_created',
  'mcp.client_revoked',
  'workspace.deletion_requested',
  'workspace.deleted',
  'ai.usage',
] as const;
export type AuditAction = (typeof auditActions)[number];

export interface AuditEvent {
  id: Uuid;
  workspaceId: Uuid;
  actorUserId: Uuid | null;
  actorClientId: Uuid | null;
  action: AuditAction;
  subjectType: string | null;
  subjectId: string | null;
  /** Redacted metadata only — never source text, tokens, or decrypted memory. */
  metadata: Record<string, unknown>;
  createdAt: Date;
}
