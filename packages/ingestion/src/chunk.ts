/**
 * Chunking.
 *
 * Splits on structure first (headings, blank lines) and only falls back to a
 * hard character cut when a single block is too long. Every chunk carries its
 * exact offsets into the normalized text, because those offsets are what a
 * citation ultimately resolves to.
 */

export interface Chunk {
  ordinal: number;
  text: string;
  startOffset: number;
  endOffset: number;
  /** Nearest preceding heading, used as a human-readable locator in citations. */
  heading: string | null;
}

export interface ChunkOptions {
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const target = options.targetChars ?? 1200;
  const max = options.maxChars ?? 2000;
  const overlap = options.overlapChars ?? 120;
  if (text.trim().length === 0) return [];

  const blocks = splitIntoBlocks(text);
  const chunks: Chunk[] = [];
  let buffer: { start: number; end: number; heading: string | null } | null = null;

  const flush = () => {
    if (!buffer) return;
    const slice = text.slice(buffer.start, buffer.end);
    if (slice.trim().length > 0) {
      chunks.push({
        ordinal: chunks.length,
        text: slice,
        startOffset: buffer.start,
        endOffset: buffer.end,
        heading: buffer.heading,
      });
    }
    buffer = null;
  };

  for (const block of blocks) {
    // A heading starts a new chunk: it is the strongest structural signal there is.
    if (block.isHeading && buffer) flush();

    if (block.end - block.start > max) {
      flush();
      for (let cursor = block.start; cursor < block.end; cursor += max - overlap) {
        const end = Math.min(cursor + max, block.end);
        const slice = text.slice(cursor, end);
        if (slice.trim().length > 0) {
          chunks.push({
            ordinal: chunks.length,
            text: slice,
            startOffset: cursor,
            endOffset: end,
            heading: block.heading,
          });
        }
        if (end >= block.end) break;
      }
      continue;
    }

    if (!buffer) {
      buffer = { start: block.start, end: block.end, heading: block.heading };
    } else if (block.end - buffer.start <= target) {
      buffer.end = block.end;
    } else {
      flush();
      buffer = { start: block.start, end: block.end, heading: block.heading };
    }
  }
  flush();
  return chunks;
}

interface Block {
  start: number;
  end: number;
  isHeading: boolean;
  heading: string | null;
}

export function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let currentHeading: string | null = null;
  let offset = 0;

  for (const raw of text.split('\n\n')) {
    const start = offset;
    const end = offset + raw.length;
    offset = end + 2;
    if (raw.trim().length === 0) continue;

    const headingMatch = raw.match(/^\s*(#{1,6})\s+(.+?)\s*$/m);
    const isHeading = /^\s*#{1,6}\s+/.test(raw);
    if (isHeading && headingMatch?.[2]) currentHeading = headingMatch[2].trim();
    blocks.push({ start, end, isHeading, heading: currentHeading });
  }
  return blocks;
}

/**
 * Sentence and bullet spans with offsets.
 *
 * Used by extraction to point evidence at the smallest honest span rather than a
 * whole paragraph — "we agreed the opening date is 4 September" is a better
 * citation than the section it appeared in.
 */
export interface Span {
  text: string;
  startOffset: number;
  endOffset: number;
  heading: string | null;
  isBullet: boolean;
}

export function splitIntoSpans(text: string): Span[] {
  const spans: Span[] = [];
  let currentHeading: string | null = null;
  let paragraphStart = 0;

  for (const paragraph of text.split('\n\n')) {
    const start = paragraphStart;
    paragraphStart += paragraph.length + 2;
    if (paragraph.trim().length === 0) continue;

    const lines = paragraph.split('\n');
    const isBulletBlock = lines.some((line) => /^\s*([-*+]|\d+[.)])\s+/.test(line));
    const isHeadingBlock = lines.every(
      (line) => /^\s*#{1,6}\s+/.test(line.trim()) || line.trim() === '',
    );

    if (isHeadingBlock) {
      const match = paragraph.trim().match(/^#{1,6}\s+(.+)$/m);
      if (match?.[1]) currentHeading = match[1].trim();
      continue;
    }

    if (isBulletBlock) {
      let lineStart = start;
      for (const line of lines) {
        const offset = lineStart;
        lineStart += line.length + 1;
        const trimmedStart = line.length - line.trimStart().length;
        const content = line.trim();
        if (content.length === 0) continue;
        const bullet = content.match(/^([-*+]|\d+[.)])\s+/);
        const bodyStart = offset + trimmedStart + (bullet ? bullet[0].length : 0);
        const body = bullet ? content.slice(bullet[0].length) : content;
        if (body.length === 0) continue;
        spans.push({
          text: body,
          startOffset: bodyStart,
          endOffset: bodyStart + body.length,
          heading: currentHeading,
          isBullet: Boolean(bullet),
        });
      }
      continue;
    }

    // Prose is very often hard-wrapped, so a sentence routinely spans several
    // lines. Replacing each newline with a space is length-preserving, which
    // means offsets computed here still index the original text exactly — and a
    // wrapped sentence is no longer chopped in half.
    const flattened = paragraph.replace(/\n/g, ' ');
    let cursor = 0;
    const sentenceRe = /(?:[^.!?]|\.(?=\d))+(?:[.!?]+["')\]]*|$)/g;
    for (const match of flattened.matchAll(sentenceRe)) {
      const raw = match[0];
      const sentence = raw.trim();
      if (sentence.length < 3) continue;
      const relative = flattened.indexOf(sentence, cursor);
      if (relative < 0) continue;
      cursor = relative + sentence.length;
      spans.push({
        text: sentence,
        startOffset: start + relative,
        endOffset: start + relative + sentence.length,
        heading: currentHeading,
        isBullet: false,
      });
    }
  }
  return spans;
}
