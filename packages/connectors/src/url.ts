import dns from 'node:dns/promises';
import net from 'node:net';
import { getConfig } from '@cairn/config';
import { ValidationError } from '@cairn/domain';

/**
 * Safe URL import.
 *
 * A server that fetches user-supplied URLs is a request forgery primitive unless
 * it is deliberately constrained. Every hop is checked, not just the first:
 * redirects are followed manually so a public hostname cannot bounce the request
 * to an internal address on the second request.
 */

const BLOCKED_PORTS = new Set([22, 23, 25, 445, 3306, 5432, 6379, 9200, 11211, 27017]);
const MAX_REDIRECTS = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

const ALLOWED_CONTENT_TYPES = [
  'text/html',
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/json',
  'application/xhtml+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number) as [number, number, number, number];
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (
      normalized.startsWith('fe80') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd')
    ) {
      return true;
    }
    // IPv4-mapped addresses inherit the IPv4 rules.
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped?.[1]) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true;
}

export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const allowInsecure = getConfig().env.CAIRN_ALLOW_INSECURE_URL_IMPORT;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid URL', 'That does not look like a web address.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ValidationError(
      `Blocked protocol ${url.protocol}`,
      'Only web addresses starting with https:// can be imported.',
    );
  }
  if (url.protocol === 'http:' && !allowInsecure) {
    throw new ValidationError(
      'Refusing plain http',
      'Only secure addresses (https://) can be imported.',
    );
  }
  if (url.port && BLOCKED_PORTS.has(Number(url.port))) {
    throw new ValidationError('Blocked port', 'That address uses a port we do not fetch from.');
  }
  if (allowInsecure) return url;

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname)
    ? [{ address: hostname }]
    : await dns.lookup(hostname, { all: true }).catch(() => {
        throw new ValidationError(
          `Cannot resolve ${hostname}`,
          'We could not find that address on the internet.',
        );
      });

  if (addresses.length === 0) {
    throw new ValidationError('No addresses', 'We could not find that address on the internet.');
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new ValidationError(
        `Blocked private address ${address}`,
        'That address points inside a private network, so it cannot be imported.',
      );
    }
  }
  return url;
}

export interface FetchedUrl {
  url: string;
  finalUrl: string;
  title: string;
  mimeType: string;
  bytes: Uint8Array;
}

export async function fetchUrlSafely(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedUrl> {
  let current = await assertPublicUrl(rawUrl);
  let response: Response | null = null;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      response = await fetchImpl(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: ALLOWED_CONTENT_TYPES.join(', '), 'user-agent': 'CairnImporter/0.1' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) break;
    // Re-validate the redirect target: this is the check that stops a public host
    // from forwarding us to 169.254.169.254.
    current = await assertPublicUrl(new URL(location, current).toString());
    response = null;
  }

  if (!response) {
    throw new ValidationError('Too many redirects', 'That address redirected too many times.');
  }
  if (!response.ok) {
    throw new ValidationError(
      `Fetch failed with ${response.status}`,
      `That page could not be read (it returned ${response.status}).`,
    );
  }

  const contentType = (response.headers.get('content-type') ?? 'text/plain').split(';')[0]!.trim();
  if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
    throw new ValidationError(
      `Unsupported content type ${contentType}`,
      'That page is not a kind of document we can read yet.',
    );
  }

  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_BYTES) {
    throw new ValidationError('Too large', 'That page is too large to import.');
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new ValidationError('Too large', 'That page is too large to import.');
  }

  return {
    url: rawUrl,
    finalUrl: current.toString(),
    title: titleFor(buffer, contentType, current),
    mimeType: contentType,
    bytes: buffer,
  };
}

function titleFor(bytes: Uint8Array, mimeType: string, url: URL): string {
  if (mimeType === 'text/html') {
    const head = Buffer.from(bytes.subarray(0, 8000)).toString('utf8');
    const match = head.match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  const last = url.pathname.split('/').filter(Boolean).pop();
  return last ? decodeURIComponent(last) : url.hostname;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}
