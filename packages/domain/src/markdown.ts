import { PRODUCT } from '@cairn/config';
import type { MemoryType, SensitivityLevel, Uuid } from './types';
import { memoryTypes, sensitivityLevels } from './types';

/**
 * Canonical Markdown.
 *
 * The vault stores ordinary Markdown a person can read, edit, or keep forever
 * without this product. Machine metadata rides in HTML comments, which Markdown
 * renderers hide and which survive a round trip, so the Postgres read model can
 * always be rebuilt from the Markdown alone.
 */

export interface CanonicalDoc {
  path: string;
  title: string;
  intro: string;
  type: MemoryType;
}

const ROOT = PRODUCT.canonicalVaultRoot;

export const CANONICAL_DOCS: Record<MemoryType, CanonicalDoc> = {
  project_brief: {
    path: `${ROOT}/PROJECT_BRIEF.md`,
    title: 'Project brief',
    intro: 'What this project is and who it is for.',
    type: 'project_brief',
  },
  current_state: {
    path: `${ROOT}/CURRENT_STATE.md`,
    title: 'Current state',
    intro: 'Where things stand right now.',
    type: 'current_state',
  },
  decision: {
    path: `${ROOT}/DECISIONS.md`,
    title: 'Decisions',
    intro: 'Choices that have been made and why.',
    type: 'decision',
  },
  next_step: {
    path: `${ROOT}/NEXT_STEPS.md`,
    title: 'Next steps',
    intro: 'What happens next.',
    type: 'next_step',
  },
  operating_rule: {
    path: `${ROOT}/OPERATING_RULES.md`,
    title: 'Operating rules',
    intro: 'How work should be done here.',
    type: 'operating_rule',
  },
  fact: {
    path: `${ROOT}/FACTS.md`,
    title: 'Facts',
    intro: 'Details worth remembering.',
    type: 'fact',
  },
  preference: {
    path: `${ROOT}/PREFERENCES.md`,
    title: 'Preferences',
    intro: 'How you like things done.',
    type: 'preference',
  },
  person_org: {
    path: `${ROOT}/PEOPLE_AND_ORGS.md`,
    title: 'People and organizations',
    intro: 'Who is involved.',
    type: 'person_org',
  },
};

export const CANONICAL_PATHS: string[] = memoryTypes.map((t) => CANONICAL_DOCS[t].path);

export function canonicalPathForType(type: MemoryType): string {
  return CANONICAL_DOCS[type].path;
}

export function typeForCanonicalPath(path: string): MemoryType | null {
  const found = memoryTypes.find((t) => CANONICAL_DOCS[t].path === path);
  return found ?? null;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

export interface RenderableEvidence {
  provider: string;
  sourceTitle: string;
  locator: string | null;
  startOffset: number;
  endOffset: number;
  importedAt: Date;
}

export interface RenderableItem {
  id: Uuid;
  type: MemoryType;
  title: string;
  value: string;
  topics: string[];
  sensitivity: SensitivityLevel;
  observedAt: Date | null;
  updatedAt: Date;
  evidence: RenderableEvidence[];
}

const META_OPEN = 'cairn:item';
const META_END = 'cairn:end';

function escapeMeta(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .replace(/--+/g, '-')
    .trim();
}

function isoDay(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

function renderItem(item: RenderableItem): string {
  const meta = [
    `id=${item.id}`,
    `type=${item.type}`,
    `sensitivity=${item.sensitivity}`,
    item.topics.length > 0 ? `topics=${escapeMeta(item.topics.join(','))}` : null,
    item.observedAt ? `observed=${isoDay(item.observedAt)}` : null,
    `updated=${isoDay(item.updatedAt)}`,
  ]
    .filter(Boolean)
    .join(' ');

  const lines: string[] = [];
  lines.push(`<!-- ${META_OPEN} ${meta} -->`);
  lines.push(`## ${escapeMeta(item.title)}`);
  lines.push('');
  lines.push(item.value.trim());
  if (item.topics.length > 0) {
    lines.push('');
    lines.push(`Topics: ${item.topics.join(', ')}`);
  }
  if (item.evidence.length > 0) {
    lines.push('');
    lines.push('Source:');
    for (const e of item.evidence) {
      const where = e.locator ? ` (${escapeMeta(e.locator)})` : '';
      lines.push(
        `- ${e.provider} — ${escapeMeta(e.sourceTitle)}${where}, characters ${e.startOffset}–${e.endOffset}, added ${isoDay(e.importedAt)}`,
      );
    }
  }
  lines.push('');
  lines.push(`<!-- ${META_END} ${item.id} -->`);
  return lines.join('\n');
}

/**
 * Renders one canonical document. Items are ordered by title so the same set of
 * memories always produces byte-identical Markdown, which keeps version hashes
 * meaningful.
 */
export function renderCanonicalDocument(type: MemoryType, items: RenderableItem[]): string {
  const doc = CANONICAL_DOCS[type];
  const ordered = [...items].sort(
    (a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id),
  );
  const parts: string[] = [`# ${doc.title}`, '', doc.intro, ''];
  if (ordered.length === 0) {
    parts.push('_Nothing here yet._', '');
  } else {
    for (const item of ordered) {
      parts.push(renderItem(item), '');
    }
  }
  return `${parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

/* ------------------------------------------------------------------ *
 * Parsing (the rebuild path)
 * ------------------------------------------------------------------ */

export interface ParsedItem {
  id: Uuid;
  type: MemoryType;
  title: string;
  value: string;
  topics: string[];
  sensitivity: SensitivityLevel;
  observedAt: Date | null;
}

const ITEM_RE = new RegExp(
  `<!--\\s*${META_OPEN}\\s+([^>]*?)-->\\s*\\n##\\s+(.+?)\\n([\\s\\S]*?)<!--\\s*${META_END}[^>]*-->`,
  'g',
);

function parseMeta(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.trim().split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

/** Inverse of `renderCanonicalDocument`, used to rebuild derived rows from Markdown. */
export function parseCanonicalDocument(content: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  for (const match of content.matchAll(ITEM_RE)) {
    const meta = parseMeta(match[1] ?? '');
    const title = (match[2] ?? '').trim();
    const body = match[3] ?? '';
    const type = meta.type as MemoryType | undefined;
    if (!meta.id || !type || !memoryTypes.includes(type)) continue;

    // The body holds the value, then optional "Topics:" and "Source:" blocks that
    // are rendered restatements of metadata rather than part of the value itself.
    const valueLines: string[] = [];
    for (const line of body.split('\n')) {
      if (
        /^Topics:\s/.test(line) ||
        /^Source:\s*$/.test(line) ||
        /^-\s.+characters \d+/.test(line)
      ) {
        continue;
      }
      valueLines.push(line);
    }
    const sensitivity = (meta.sensitivity ?? 'normal') as SensitivityLevel;
    items.push({
      id: meta.id,
      type,
      title,
      value: valueLines.join('\n').trim(),
      topics: meta.topics ? meta.topics.split(',').filter(Boolean) : [],
      sensitivity: sensitivityLevels.includes(sensitivity) ? sensitivity : 'normal',
      observedAt: meta.observed ? new Date(`${meta.observed}T00:00:00.000Z`) : null,
    });
  }
  return items;
}

/** Front page of an export: a plain-language index of the other files. */
export function renderExportReadme(input: {
  workspaceName: string;
  projectName: string;
  exportedAt: Date;
  versionId: string | null;
  itemCount: number;
}): string {
  return [
    `# ${input.projectName} — memory export`,
    '',
    `These are the notes ${PRODUCT.name} keeps for **${input.projectName}** in the workspace`,
    `**${input.workspaceName}**, exported on ${input.exportedAt.toISOString().slice(0, 10)}.`,
    '',
    'They are ordinary Markdown files. You can read them in any text editor, keep them',
    'in a folder, or put them anywhere you like. Nothing here needs this product to be',
    'useful.',
    '',
    `- Memory items included: ${input.itemCount}`,
    `- Memory version: ${input.versionId ?? '(none yet)'}`,
    '',
    '## Files',
    '',
    ...memoryTypes.map((t) => `- \`${CANONICAL_DOCS[t].path}\` — ${CANONICAL_DOCS[t].intro}`),
    '',
    '## The comment lines',
    '',
    'Lines that look like `<!-- cairn:item id=... -->` are hidden notes that let this',
    'product recognise each memory again if you import the folder later. They do not',
    'show up when the Markdown is displayed, and deleting them only means an import',
    'would treat those entries as new.',
    '',
  ].join('\n');
}
