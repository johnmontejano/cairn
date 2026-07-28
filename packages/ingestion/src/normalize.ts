import { ValidationError } from '@cairn/domain';

/**
 * Turning an uploaded file into text we can cite.
 *
 * Everything downstream — chunks, evidence offsets, citations — is expressed as
 * character offsets into the string this module returns. So normalization has to
 * be deterministic: the same bytes must always produce the same string, or a
 * citation stored last week would point at the wrong words today.
 */

export interface NormalizedSource {
  text: string;
  /** What the text actually is after conversion, which may differ from the upload. */
  mimeType: string;
  warnings: string[];
}

const TEXT_LIKE = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/x-ndjson',
];

export async function normalizeSource(input: {
  bytes: Uint8Array;
  mimeType: string;
  filename?: string;
}): Promise<NormalizedSource> {
  const mime = (input.mimeType || guessMime(input.filename ?? ''))
    .split(';')[0]!
    .trim()
    .toLowerCase();

  if (TEXT_LIKE.includes(mime)) {
    return { text: canonicalizeText(decodeUtf8(input.bytes)), mimeType: mime, warnings: [] };
  }
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    return {
      text: canonicalizeText(htmlToText(decodeUtf8(input.bytes))),
      mimeType: mime,
      warnings: [],
    };
  }
  if (mime === 'application/pdf') {
    return normalizePdf(input.bytes);
  }
  if (
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'application/msword'
  ) {
    return normalizeDocx(input.bytes, mime);
  }

  // Unknown type: accept it only if it decodes as text without control noise.
  const decoded = decodeUtf8(input.bytes);
  if (looksLikeText(decoded)) {
    return {
      text: canonicalizeText(decoded),
      mimeType: 'text/plain',
      warnings: [`Treated ${mime || 'this file'} as plain text.`],
    };
  }
  throw new ValidationError(
    `Unsupported file type ${mime}`,
    'We cannot read that kind of file yet. Try a PDF, a Word document, or a text file.',
  );
}

async function normalizePdf(bytes: Uint8Array): Promise<NormalizedSource> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(document, { mergePages: true });
    const merged = Array.isArray(text) ? text.join('\n\n') : text;
    const canonical = canonicalizeText(merged);
    return {
      text: canonical,
      mimeType: 'application/pdf',
      warnings:
        canonical.trim().length === 0
          ? [
              'This PDF has no selectable text. It may be a scan; text recognition is not available yet.',
            ]
          : [],
    };
  } catch (error) {
    throw new ValidationError(
      `PDF extraction failed: ${(error as Error).message}`,
      'We could not read the text in that PDF.',
    );
  }
}

async function normalizeDocx(bytes: Uint8Array, mime: string): Promise<NormalizedSource> {
  try {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return {
      text: canonicalizeText(result.value),
      mimeType: mime,
      warnings: result.messages
        .filter((m) => m.type === 'warning')
        .map((m) => m.message)
        .slice(0, 3),
    };
  } catch (error) {
    throw new ValidationError(
      `Word extraction failed: ${(error as Error).message}`,
      'We could not read the text in that Word document.',
    );
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function looksLikeText(value: string): boolean {
  if (value.length === 0) return false;
  let control = 0;
  for (let i = 0; i < Math.min(value.length, 2000); i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0 || code < 9 || (code > 13 && code < 32)) control += 1;
  }
  return control / Math.min(value.length, 2000) < 0.02;
}

/**
 * The one place line endings, whitespace and Unicode form are settled. Called on
 * every path so offsets computed at ingest time remain valid forever.
 */
export function canonicalizeText(input: string): string {
  return (
    input
      .normalize('NFC')
      .replace(/\r\n?/g, '\n')
      // Non-breaking space becomes an ordinary space; zero-width joiners, the
      // zero-width space, and the byte-order mark are removed entirely. Left in,
      // they make identical-looking text hash differently.
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
  );
}

const BLOCK_TAGS =
  /<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer|blockquote|pre)[^>]*>/gi;

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(nav|aside|noscript)[\s\S]*?<\/\1>/gi, ' ')
      .replace(BLOCK_TAGS, '\n')
      .replace(/<[^>]+>/g, ' '),
  );
}

function decodeEntities(input: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    rsquo: '’',
    lsquo: '‘',
    ldquo: '“',
    rdquo: '”',
  };
  return input
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

const EXTENSION_MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  txt: 'text/plain',
  text: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  rtf: 'text/plain',
};

export function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MIME[ext] ?? 'application/octet-stream';
}

export const SUPPORTED_UPLOAD_EXTENSIONS = Object.keys(EXTENSION_MIME).map((e) => `.${e}`);
