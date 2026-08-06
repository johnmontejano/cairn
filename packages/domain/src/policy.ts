import { EvidenceRequiredError, ForbiddenError } from './errors';
import type {
  ActorContext,
  ClientVisibilityPolicy,
  MemberRole,
  McpScope,
  MemoryItem,
  MemoryStatus,
  MemoryType,
  SensitivityLevel,
} from './types';

/* ------------------------------------------------------------------ *
 * Roles
 * ------------------------------------------------------------------ */

const ROLE_RANK: Record<MemberRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function requireRole(actor: ActorContext, minimum: MemberRole): void {
  if (ROLE_RANK[actor.role] < ROLE_RANK[minimum]) {
    throw new ForbiddenError(`Requires ${minimum}; actor is ${actor.role}`);
  }
}

/** People act on their own behalf; MCP clients act on a narrower, scoped behalf. */
export function requireHuman(actor: ActorContext): void {
  if (actor.client || !actor.userId)
    throw new ForbiddenError('This action requires a signed-in person');
}

export function requireScope(actor: ActorContext, scope: McpScope): void {
  if (!actor.client) return;
  if (!actor.client.scopes.includes(scope)) {
    throw new ForbiddenError(`Client is missing scope ${scope}`);
  }
}

/* ------------------------------------------------------------------ *
 * Disclosure
 * ------------------------------------------------------------------ */

const SENSITIVITY_RANK: Record<SensitivityLevel, number> = {
  normal: 0,
  sensitive: 1,
  restricted: 2,
};

export function sensitivityAtMost(level: SensitivityLevel, ceiling: SensitivityLevel): boolean {
  return SENSITIVITY_RANK[level] <= SENSITIVITY_RANK[ceiling];
}

/** Only approved memory is ever retrievable. Everything else is invisible to retrieval. */
export const RETRIEVABLE_STATUSES: readonly MemoryStatus[] = ['approved'];

export interface DisclosureSubject {
  status: MemoryStatus;
  type: MemoryType;
  sensitivity: SensitivityLevel;
  visibility: ClientVisibilityPolicy;
  projectId: string;
  deletedAt?: Date | null;
}

/**
 * The single gate deciding whether a memory item may be disclosed to this actor.
 *
 * Used identically by web search, the Ask answerer, and MCP so the three surfaces
 * cannot drift apart. Returns a reason string rather than throwing so callers can
 * filter lists cheaply; `null` means "may disclose".
 */
export function disclosureBlockReason(actor: ActorContext, item: DisclosureSubject): string | null {
  if (item.deletedAt) return 'deleted';
  if (!RETRIEVABLE_STATUSES.includes(item.status)) return `status:${item.status}`;

  if (!actor.client) {
    // A signed-in member of the workspace. `never_share`/`website_only` are both
    // visible here; those policies restrict AI clients, not the owner.
    return null;
  }

  if (!actor.client.scopes.includes('memory:read')) return 'scope';
  if (item.visibility === 'never_share') return 'visibility:never_share';
  if (item.visibility === 'website_only') return 'visibility:website_only';
  if (!sensitivityAtMost(item.sensitivity, actor.client.maxSensitivity)) {
    return `sensitivity:${item.sensitivity}`;
  }
  if (actor.client.projectIds && !actor.client.projectIds.includes(item.projectId)) {
    return 'project_not_granted';
  }
  if (actor.client.memoryTypes && !actor.client.memoryTypes.includes(item.type)) {
    return `type_not_granted:${item.type}`;
  }
  return null;
}

export function canDisclose(actor: ActorContext, item: DisclosureSubject): boolean {
  return disclosureBlockReason(actor, item) === null;
}

/* ------------------------------------------------------------------ *
 * Approval
 * ------------------------------------------------------------------ */

/**
 * Evidence is structurally required: an item with no evidence record can never
 * become `approved`, whatever the caller asks for.
 */
export function assertApprovable(evidenceCount: number): void {
  if (evidenceCount < 1) throw new EvidenceRequiredError();
}

/* ------------------------------------------------------------------ *
 * Precedence and contradiction
 * ------------------------------------------------------------------ */

/** Higher wins. Explicit human intent always outranks passive extraction. */
export const PRECEDENCE: Record<MemoryItem['extractionMethod'], number> = {
  ai_extraction: 0,
  import: 1,
  user_manual: 2,
  user_edit: 3,
};

export interface PrecedenceDecision {
  /** `supersede` keeps both rows; the loser is marked superseded, never deleted. */
  outcome: 'supersede' | 'conflict' | 'duplicate';
  reason: string;
}

/**
 * Decide what happens when a newly extracted item collides with an existing one.
 *
 * Never last-write-wins: equal-precedence disagreement produces a `conflict` a
 * person resolves, and the losing assertion is retained in history either way.
 */
export function decidePrecedence(
  incoming: Pick<MemoryItem, 'extractionMethod' | 'normalizedValue' | 'observedAt'>,
  existing: Pick<MemoryItem, 'extractionMethod' | 'normalizedValue' | 'observedAt'>,
): PrecedenceDecision {
  if (incoming.normalizedValue === existing.normalizedValue) {
    return { outcome: 'duplicate', reason: 'Identical normalized value' };
  }
  const a = PRECEDENCE[incoming.extractionMethod];
  const b = PRECEDENCE[existing.extractionMethod];
  if (a > b) {
    return {
      outcome: 'supersede',
      reason: `${incoming.extractionMethod} outranks ${existing.extractionMethod}`,
    };
  }
  if (a < b) {
    return {
      outcome: 'conflict',
      reason: `${existing.extractionMethod} outranks ${incoming.extractionMethod}; kept for review`,
    };
  }
  return { outcome: 'conflict', reason: 'Two assertions of equal authority disagree' };
}

/** Memory types where at most one approved item should exist per project. */
export const SINGLETON_TYPES: readonly MemoryType[] = ['project_brief', 'current_state'];

export function isSingletonType(type: MemoryType): boolean {
  return SINGLETON_TYPES.includes(type);
}

/* ------------------------------------------------------------------ *
 * Normalization
 * ------------------------------------------------------------------ */

/** Canonical comparison form. Deliberately lossy: only for equality/blind indexing. */
export function normalizeValue(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[^\p{L}\p{N}'"\s.-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizedTokens(value: string): string[] {
  return normalizeValue(value)
    .split(/[\s.'"-]+/)
    .filter((t) => t.length >= 2 && t.length <= 40);
}
