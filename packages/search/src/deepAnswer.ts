/**
 * How a deep answer is written down.
 *
 * The fast path answers from a handful of passages and cites each one inline.
 * This path synthesises across everything saved, which changes two things.
 *
 * First, the same source gets used in several places, so citations are numbered
 * once and referred to by number rather than repeated. Second — and this is the
 * part worth protecting — an answer built by looking at everything is exactly
 * the kind that sounds complete when it is not. So it carries a section saying
 * what the evidence does not support, and that section is not optional.
 *
 * Cairn already refuses to answer beyond its evidence. The difference here is
 * that refusing silently is not enough at this length: a reader who cannot see
 * the edges of the answer will assume there are none.
 */

export interface DeepCitation {
  memoryItemId: string;
  title: string;
  sourceTitle: string;
  sourceProvider: string;
}

export interface DeepAnswerInput {
  question: string;
  /** Body text, already written, using [n] markers that index into citations. */
  body: string;
  citations: readonly DeepCitation[];
  /** Things the question asked that the evidence could not answer. */
  unsupported: readonly string[];
  /** True when ingestion still had queued work when this ran. */
  indexingPending: boolean;
}

const NO_EVIDENCE =
  'Nothing saved bears on this question, so there is no answer to give. Adding a source that covers it would change that.';

/**
 * Assembles the finished answer.
 *
 * The limits section is written even when nothing is missing, because its
 * absence would otherwise be ambiguous: a reader cannot tell "I checked and
 * found no gaps" from "I did not check".
 */
export function formatDeepAnswer(input: DeepAnswerInput): string {
  if (input.citations.length === 0) return NO_EVIDENCE;

  const parts: string[] = [input.body.trim(), ''];

  parts.push('## What this is based on', '');
  input.citations.forEach((citation, index) => {
    parts.push(
      `${index + 1}. ${citation.title} — ${citation.sourceTitle} (${citation.sourceProvider})`,
    );
  });
  parts.push('');

  parts.push('## What the evidence does not support', '');
  if (input.unsupported.length === 0) {
    parts.push('Nothing in the question went beyond what is saved.');
  } else {
    for (const gap of input.unsupported) parts.push(`- ${gap}`);
  }

  if (input.indexingPending) {
    parts.push(
      '',
      'Some sources were still being read when this was answered, so this is what was known at the time rather than everything saved. Asking again later may give a fuller answer.',
    );
  }

  return parts.join('\n').trimEnd();
}

/**
 * Citation markers actually used by the body.
 *
 * A body that cites [7] against a six-item list is a bug that reads as
 * authority, so the caller is given the means to catch it rather than trusting
 * the writer to have counted.
 */
export function citedIndexes(body: string): number[] {
  const found = new Set<number>();
  for (const match of body.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (Number.isInteger(n) && n > 0) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/** Markers pointing at citations that do not exist. */
export function danglingCitations(body: string, citationCount: number): number[] {
  return citedIndexes(body).filter((n) => n > citationCount);
}
