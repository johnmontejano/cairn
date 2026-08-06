import { describe, expect, it } from 'vitest';
import {
  CANONICAL_DOCS,
  EvidenceRequiredError,
  ForbiddenError,
  assertApprovable,
  canDisclose,
  decidePrecedence,
  disclosureBlockReason,
  normalizeValue,
  normalizedTokens,
  parseCanonicalDocument,
  renderCanonicalDocument,
  requireRole,
  requireScope,
  type ActorContext,
  type RenderableItem,
} from '@cairn/domain';

const owner: ActorContext = { userId: 'u1', workspaceId: 'ws1', role: 'owner' };

function client(overrides: Partial<NonNullable<ActorContext['client']>> = {}): ActorContext {
  return {
    userId: null,
    workspaceId: 'ws1',
    role: 'viewer',
    client: {
      id: 'c1',
      name: 'Test client',
      scopes: ['memory:read'],
      projectIds: null,
      memoryTypes: null,
      maxSensitivity: 'normal',
      ...overrides,
    },
  };
}

const approvedNormal = {
  status: 'approved' as const,
  type: 'fact' as const,
  sensitivity: 'normal' as const,
  visibility: 'share_with_authorized_clients' as const,
  projectId: 'p1',
};

describe('disclosure', () => {
  it('lets a signed-in member see their own approved memory', () => {
    expect(canDisclose(owner, approvedNormal)).toBe(true);
  });

  it('never discloses memory that is not approved', () => {
    for (const status of ['proposed', 'rejected', 'superseded', 'conflicted'] as const) {
      expect(disclosureBlockReason(owner, { ...approvedNormal, status })).toBe(`status:${status}`);
      expect(disclosureBlockReason(client(), { ...approvedNormal, status })).toBe(
        `status:${status}`,
      );
    }
  });

  it('never discloses deleted memory', () => {
    expect(disclosureBlockReason(owner, { ...approvedNormal, deletedAt: new Date() })).toBe(
      'deleted',
    );
  });

  it('withholds website-only and never-share memory from AI clients but not from the person', () => {
    const websiteOnly = { ...approvedNormal, visibility: 'website_only' as const };
    const neverShare = { ...approvedNormal, visibility: 'never_share' as const };
    expect(canDisclose(owner, websiteOnly)).toBe(true);
    expect(canDisclose(owner, neverShare)).toBe(true);
    expect(disclosureBlockReason(client(), websiteOnly)).toBe('visibility:website_only');
    expect(disclosureBlockReason(client(), neverShare)).toBe('visibility:never_share');
  });

  it('enforces a client sensitivity ceiling', () => {
    const sensitive = { ...approvedNormal, sensitivity: 'sensitive' as const };
    expect(disclosureBlockReason(client(), sensitive)).toBe('sensitivity:sensitive');
    expect(canDisclose(client({ maxSensitivity: 'sensitive' }), sensitive)).toBe(true);
    expect(
      disclosureBlockReason(client({ maxSensitivity: 'sensitive' }), {
        ...approvedNormal,
        sensitivity: 'restricted',
      }),
    ).toBe('sensitivity:restricted');
  });

  it('enforces per-project grants', () => {
    expect(disclosureBlockReason(client({ projectIds: ['p2'] }), approvedNormal)).toBe(
      'project_not_granted',
    );
    expect(canDisclose(client({ projectIds: ['p1'] }), approvedNormal)).toBe(true);
  });

  it('requires the read scope', () => {
    expect(disclosureBlockReason(client({ scopes: ['memory:propose'] }), approvedNormal)).toBe(
      'scope',
    );
  });
});

describe('roles and scopes', () => {
  it('ranks roles', () => {
    expect(() => requireRole({ ...owner, role: 'viewer' }, 'member')).toThrow(ForbiddenError);
    expect(() => requireRole({ ...owner, role: 'member' }, 'member')).not.toThrow();
    expect(() => requireRole(owner, 'admin')).not.toThrow();
  });

  it('checks client scopes but leaves people alone', () => {
    expect(() => requireScope(owner, 'memory:propose')).not.toThrow();
    expect(() => requireScope(client(), 'memory:propose')).toThrow(ForbiddenError);
    expect(() =>
      requireScope(client({ scopes: ['memory:read', 'memory:propose'] }), 'memory:propose'),
    ).not.toThrow();
  });
});

describe('evidence', () => {
  it('refuses approval without evidence', () => {
    expect(() => assertApprovable(0)).toThrow(EvidenceRequiredError);
    expect(() => assertApprovable(1)).not.toThrow();
  });
});

describe('precedence between disagreeing assertions', () => {
  const base = { normalizedValue: 'the date is 4 september', observedAt: null };

  it('treats an identical value as a duplicate', () => {
    expect(
      decidePrecedence(
        { ...base, extractionMethod: 'ai_extraction' },
        { ...base, extractionMethod: 'user_manual' },
      ).outcome,
    ).toBe('duplicate');
  });

  it('lets an explicit correction supersede a passive extraction', () => {
    expect(
      decidePrecedence(
        {
          normalizedValue: 'the date is 18 september',
          observedAt: null,
          extractionMethod: 'user_edit',
        },
        { ...base, extractionMethod: 'ai_extraction' },
      ).outcome,
    ).toBe('supersede');
  });

  it('never lets an extraction quietly overwrite what a person wrote', () => {
    expect(
      decidePrecedence(
        {
          normalizedValue: 'the date is 18 september',
          observedAt: null,
          extractionMethod: 'ai_extraction',
        },
        { ...base, extractionMethod: 'user_manual' },
      ).outcome,
    ).toBe('conflict');
  });

  it('asks a person when two equally authoritative statements disagree', () => {
    expect(
      decidePrecedence(
        {
          normalizedValue: 'the date is 18 september',
          observedAt: null,
          extractionMethod: 'ai_extraction',
        },
        { ...base, extractionMethod: 'ai_extraction' },
      ).outcome,
    ).toBe('conflict');
  });
});

describe('normalization', () => {
  it('is stable across punctuation, case, and quote styles', () => {
    expect(normalizeValue('We DECIDED — the “Mill Street” lease!')).toBe(
      normalizeValue('we decided   the "mill street" lease'),
    );
  });

  it('drops one-character tokens from the index', () => {
    expect(normalizedTokens('a bakery on X street')).toEqual(['bakery', 'on', 'street']);
  });
});

describe('canonical Markdown', () => {
  const item: RenderableItem = {
    id: '11111111-1111-4111-8111-111111111111',
    type: 'decision',
    title: 'Sign the Mill Street lease',
    value: 'We decided to sign the Mill Street lease rather than the unit by the station.',
    topics: ['lease', 'premises'],
    sensitivity: 'normal',
    observedAt: new Date('2026-03-12T00:00:00Z'),
    updatedAt: new Date('2026-03-14T00:00:00Z'),
    evidence: [
      {
        provider: 'paste',
        sourceTitle: 'Planning notes',
        locator: 'Section: What we decided',
        startOffset: 100,
        endOffset: 180,
        importedAt: new Date('2026-03-13T00:00:00Z'),
      },
    ],
  };

  it('renders readable Markdown a person could keep forever', () => {
    const markdown = renderCanonicalDocument('decision', [item]);
    expect(markdown).toContain('# Decisions');
    expect(markdown).toContain('## Sign the Mill Street lease');
    expect(markdown).toContain('We decided to sign the Mill Street lease');
    expect(markdown).toContain('Planning notes');
  });

  it('is byte-identical for the same input, so version hashes mean something', () => {
    expect(renderCanonicalDocument('decision', [item])).toBe(
      renderCanonicalDocument('decision', [item]),
    );
  });

  it('does not depend on the order items are passed in', () => {
    const second = {
      ...item,
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Another decision',
    };
    expect(renderCanonicalDocument('decision', [item, second])).toBe(
      renderCanonicalDocument('decision', [second, item]),
    );
  });

  it('round-trips back into structured items', () => {
    const parsed = parseCanonicalDocument(renderCanonicalDocument('decision', [item]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: item.id,
      type: 'decision',
      title: item.title,
      sensitivity: 'normal',
      topics: ['lease', 'premises'],
    });
    expect(parsed[0]!.value).toBe(item.value);
  });

  it('renders an empty document rather than omitting it', () => {
    const markdown = renderCanonicalDocument('fact', []);
    expect(markdown).toContain('# Facts');
    expect(markdown).toContain('Nothing here yet');
    expect(parseCanonicalDocument(markdown)).toHaveLength(0);
  });

  it('gives every memory type its own file', () => {
    const paths = Object.values(CANONICAL_DOCS).map((d) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('per-type grants', () => {
  const approvedNormal = {
    status: 'approved' as const,
    type: 'fact' as const,
    sensitivity: 'normal' as const,
    visibility: 'share_with_authorized_clients' as const,
    projectId: 'p1',
  };

  it('withholds a type the connection was not granted', () => {
    // The scope a person reasons about when connecting a coding assistant to a
    // memory that also holds personal context: not how secret something is,
    // but what it is about.
    const codingAssistant = client({ memoryTypes: ['operating_rule', 'preference'] });
    expect(disclosureBlockReason(codingAssistant, approvedNormal)).toBe('type_not_granted:fact');
    expect(
      canDisclose(codingAssistant, { ...approvedNormal, type: 'operating_rule' as const }),
    ).toBe(true);
    expect(disclosureBlockReason(codingAssistant, { ...approvedNormal, type: 'person_org' })).toBe(
      'type_not_granted:person_org',
    );
  });

  it('treats null as every type, so an unnarrowed connection is unaffected', () => {
    expect(canDisclose(client({ memoryTypes: null }), approvedNormal)).toBe(true);
    expect(
      canDisclose(client({ memoryTypes: null }), { ...approvedNormal, type: 'person_org' }),
    ).toBe(true);
  });

  it('does not let a type grant override any other rule', () => {
    // Granting a type must widen nothing else: status, visibility, sensitivity
    // and project all still apply.
    const wide = client({ memoryTypes: ['fact'], projectIds: ['p2'] });
    expect(disclosureBlockReason(wide, approvedNormal)).toBe('project_not_granted');
    expect(
      disclosureBlockReason(client({ memoryTypes: ['fact'] }), {
        ...approvedNormal,
        visibility: 'never_share' as const,
      }),
    ).toBe('visibility:never_share');
    expect(
      disclosureBlockReason(client({ memoryTypes: ['fact'] }), {
        ...approvedNormal,
        sensitivity: 'sensitive' as const,
      }),
    ).toBe('sensitivity:sensitive');
  });
});
