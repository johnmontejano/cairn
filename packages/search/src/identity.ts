import type { MemoryType } from '@cairn/domain';

/**
 * A short summary of who this person is.
 *
 * An AI client wants context at the start of a session, before it knows what to
 * search for. Retrieval cannot serve that: it needs a query, and "tell me about
 * this person" is not one. So the summary is assembled ahead of time and read
 * whole.
 *
 * It is deliberately small. Whatever goes here is sent on every request that
 * asks for it, so the budget is a product decision — a couple of paragraphs
 * that make the next answer better, not a profile.
 *
 * Sections carry a marker naming where they came from. The point is that a
 * person reading their own summary can tell which part the machine inferred
 * from a decision they recorded and which part they typed themselves, and
 * correct the right one.
 */

export const IDENTITY_MAX_CHARS = 2000;

/** Types that describe the person, in the order they appear in the summary. */
const IDENTITY_SECTIONS: ReadonlyArray<{ type: MemoryType; heading: string }> = [
  { type: 'project_brief', heading: 'Working on' },
  { type: 'operating_rule', heading: 'How they work' },
  { type: 'preference', heading: 'Preferences' },
  { type: 'decision', heading: 'Decisions that still hold' },
  { type: 'person_org', heading: 'People and organisations' },
  { type: 'current_state', heading: 'Where things stand' },
];

export interface IdentityInput {
  type: MemoryType;
  title: string;
  value: string;
}

export interface AssembledIdentity {
  markdown: string;
  /** Types that produced a section. Lets a caller say what is still missing. */
  present: MemoryType[];
  /** True when content was dropped to stay under the cap. */
  truncated: boolean;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Builds the summary from saved memory.
 *
 * Ships whatever exists rather than waiting to be complete. A summary naming
 * only two things is still worth more to the next answer than nothing, and a
 * person who sees a thin summary knows to add to it — where a blocked one just
 * looks broken.
 *
 * Items arrive already filtered for what this caller may see, so nothing here
 * re-checks authorisation; that decision belongs at the query, not at
 * formatting.
 */
export function assembleIdentity(
  items: readonly IdentityInput[],
  maxChars = IDENTITY_MAX_CHARS,
): AssembledIdentity {
  const lines: string[] = [];
  const present: MemoryType[] = [];
  let truncated = false;

  for (const section of IDENTITY_SECTIONS) {
    const matching = items.filter((item) => item.type === section.type);
    if (matching.length === 0) continue;

    const block: string[] = [
      `<!-- cairn:${section.type} -->`,
      `## ${section.heading}`,
      ...matching.map((item) => {
        const value = oneLine(item.value);
        const title = oneLine(item.title);
        // A title that merely restates the value would read as a stutter.
        return value.toLowerCase().startsWith(title.toLowerCase())
          ? `- ${value}`
          : `- ${title}: ${value}`;
      }),
      `<!-- /cairn:${section.type} -->`,
      '',
    ];

    const candidate = [...lines, ...block].join('\n');
    if (candidate.length > maxChars) {
      // Stop at a section boundary. Half a section, cut mid-sentence, reads as
      // corruption rather than as a summary that ran out of room.
      truncated = true;
      break;
    }
    lines.push(...block);
    present.push(section.type);
  }

  return { markdown: lines.join('\n').trimEnd(), present, truncated };
}

/** Types with nothing saved yet, so a caller can say what would help. */
export function missingIdentitySections(present: readonly MemoryType[]): MemoryType[] {
  return IDENTITY_SECTIONS.map((s) => s.type).filter((type) => !present.includes(type));
}
