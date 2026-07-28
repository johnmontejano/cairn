import { createHmac, createPrivateKey, createSign, timingSafeEqual } from 'node:crypto';
import { getConfig } from '@cairn/config';
import {
  type FetchedSource,
  type SourceConnector,
  SetupRequiredError,
  ValidationError,
} from '@cairn/domain';
import { GITHUB_FIXTURE_FILES } from './fixtures/github';

/**
 * GitHub, optional and read-first.
 *
 * A GitHub App rather than a personal access token: installation-scoped, narrow
 * permissions, short-lived credentials, and revocable by the user without
 * touching their account password. Nothing in the ordinary product journey
 * depends on this connector existing.
 */

export interface GitHubAppConfig {
  appId: string;
  privateKeyPem: string;
  webhookSecret: string;
}

export function githubAppConfig(config = getConfig()): GitHubAppConfig | null {
  const { env } = config;
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY || !env.GITHUB_WEBHOOK_SECRET) return null;
  return {
    appId: env.GITHUB_APP_ID,
    // Env vars cannot hold real newlines conveniently, so `\n` is accepted.
    privateKeyPem: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
  };
}

/**
 * Verifies an `X-Hub-Signature-256` header.
 *
 * Compared in constant time, and length-checked first because `timingSafeEqual`
 * throws on mismatched lengths — which would itself be an oracle.
 */
export function verifyGitHubSignature(
  secret: string,
  rawBody: string | Uint8Array,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', secret)
    .update(Buffer.from(rawBody as never))
    .digest('hex')}`;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** App JWT, signed RS256, short-lived per GitHub's guidance. */
export function createAppJwt(config: GitHubAppConfig, now = Date.now()): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const issuedAt = Math.floor(now / 1000) - 60;
  const payload = { iat: issuedAt, exp: issuedAt + 540, iss: config.appId };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const signature = signer.sign(createPrivateKey(config.privateKeyPem)).toString('base64url');
  return `${signingInput}.${signature}`;
}

export async function createInstallationToken(
  config: GitHubAppConfig,
  installationId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ token: string; expiresAt: string }> {
  const res = await fetchImpl(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${createAppJwt(config)}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    },
  );
  if (!res.ok) throw new ValidationError(`GitHub installation token failed (${res.status})`);
  const body = (await res.json()) as { token: string; expires_at: string };
  return { token: body.token, expiresAt: body.expires_at };
}

interface GitHubCredential {
  installationId: string;
  owner: string;
  repo: string;
  branch?: string;
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
}

const READABLE_EXTENSIONS = ['.md', '.markdown', '.txt', '.mdx'];

export class GitHubConnector implements SourceConnector {
  readonly provider = 'github' as const;
  readonly displayName = 'GitHub';
  readonly readOnly = true as const;
  readonly permissionSummary =
    'Reads the text and Markdown files in the repositories you choose, so their contents can become memory. It does not read your code history, does not push commits, and never changes a repository unless you separately turn on the optional mirror.';

  constructor(
    private readonly config: GitHubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): 'ready' {
    return 'ready';
  }

  async list(input: {
    connectionId: string;
    cursor: string | null;
    credential: string | null;
  }): Promise<{
    items: FetchedSource[];
    nextCursor: string | null;
  }> {
    if (!input.credential) throw new SetupRequiredError('GitHub', ['connection credential']);
    const credential = JSON.parse(input.credential) as GitHubCredential;
    const { token } = await createInstallationToken(
      this.config,
      credential.installationId,
      this.fetchImpl,
    );
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    };
    const branch = credential.branch ?? 'main';

    const treeRes = await this.fetchImpl(
      `https://api.github.com/repos/${credential.owner}/${credential.repo}/git/trees/${branch}?recursive=1`,
      { headers },
    );
    if (!treeRes.ok) throw new ValidationError(`GitHub tree read failed (${treeRes.status})`);
    const tree = (await treeRes.json()) as { tree: TreeEntry[]; truncated?: boolean };

    const items: FetchedSource[] = [];
    for (const entry of tree.tree) {
      if (entry.type !== 'blob') continue;
      if (!READABLE_EXTENSIONS.some((ext) => entry.path.toLowerCase().endsWith(ext))) continue;
      if ((entry.size ?? 0) > 512 * 1024) continue;

      const blobRes = await this.fetchImpl(
        `https://api.github.com/repos/${credential.owner}/${credential.repo}/git/blobs/${entry.sha}`,
        { headers },
      );
      if (!blobRes.ok) continue;
      const blob = (await blobRes.json()) as { content: string; encoding: string };
      const bytes =
        blob.encoding === 'base64'
          ? new Uint8Array(Buffer.from(blob.content, 'base64'))
          : new TextEncoder().encode(blob.content);
      items.push({
        externalId: `${credential.owner}/${credential.repo}:${entry.path}`,
        title: entry.path,
        mimeType: 'text/markdown',
        canonicalUri: `https://github.com/${credential.owner}/${credential.repo}/blob/${branch}/${entry.path}`,
        // The blob SHA *is* the content revision, so re-syncing an unchanged file
        // is recognised without downloading it twice.
        externalRevision: entry.sha,
        bytes,
      });
    }
    return { items, nextCursor: null };
  }
}

export class FixtureGitHubConnector implements SourceConnector {
  readonly provider = 'github' as const;
  readonly displayName = 'GitHub';
  readonly readOnly = true as const;
  readonly permissionSummary = new GitHubConnector({
    appId: '',
    privateKeyPem: '',
    webhookSecret: '',
  }).permissionSummary;

  status(): 'setup-required' {
    return 'setup-required';
  }

  async list(): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    return {
      items: GITHUB_FIXTURE_FILES.map((file) => ({
        externalId: `demo/demo-repo:${file.path}`,
        title: file.path,
        mimeType: 'text/markdown',
        canonicalUri: `https://github.com/demo/demo-repo/blob/main/${file.path}`,
        externalRevision: file.sha,
        bytes: new TextEncoder().encode(file.body),
      })),
      nextCursor: null,
    };
  }
}

export function createGitHubConnector(config = getConfig()): SourceConnector {
  const appConfig = githubAppConfig(config);
  return appConfig ? new GitHubConnector(appConfig) : new FixtureGitHubConnector();
}

/* ------------------------------------------------------------------ *
 * Optional mirror
 * ------------------------------------------------------------------ */

export interface MirrorTarget {
  installationId: string;
  owner: string;
  repo: string;
  branch: string;
}

export interface MemoryMirror {
  readonly kind: 'github' | 'fixture';
  push(input: {
    target: MirrorTarget;
    files: Array<{ path: string; content: string }>;
    message: string;
  }): Promise<{ pushed: number; commitUrl: string | null }>;
}

/**
 * Writes canonical Markdown to a repository the user explicitly opted into.
 *
 * Deliberately a plain contents-API upsert per file rather than a merge: a mirror
 * is a copy, and treating it as a second writable source of truth is how sync
 * loops start.
 */
export class GitHubMemoryMirror implements MemoryMirror {
  readonly kind = 'github' as const;

  constructor(
    private readonly config: GitHubAppConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async push(input: {
    target: MirrorTarget;
    files: Array<{ path: string; content: string }>;
    message: string;
  }): Promise<{ pushed: number; commitUrl: string | null }> {
    const { token } = await createInstallationToken(
      this.config,
      input.target.installationId,
      this.fetchImpl,
    );
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    };
    let pushed = 0;
    let commitUrl: string | null = null;

    for (const file of input.files) {
      const base = `https://api.github.com/repos/${input.target.owner}/${input.target.repo}/contents/${file.path}`;
      const existing = await this.fetchImpl(`${base}?ref=${input.target.branch}`, { headers });
      const sha = existing.ok ? ((await existing.json()) as { sha: string }).sha : undefined;
      const res = await this.fetchImpl(base, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: input.message,
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          branch: input.target.branch,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!res.ok)
        throw new ValidationError(`GitHub mirror write failed (${res.status}) for ${file.path}`);
      const body = (await res.json()) as { commit?: { html_url?: string } };
      commitUrl = body.commit?.html_url ?? commitUrl;
      pushed += 1;
    }
    return { pushed, commitUrl };
  }
}

/** Records what would have been pushed. Lets the mirror path be tested offline. */
export class FixtureMemoryMirror implements MemoryMirror {
  readonly kind = 'fixture' as const;
  readonly pushes: Array<{
    target: MirrorTarget;
    files: Array<{ path: string; content: string }>;
    message: string;
  }> = [];

  async push(input: {
    target: MirrorTarget;
    files: Array<{ path: string; content: string }>;
    message: string;
  }): Promise<{ pushed: number; commitUrl: string | null }> {
    this.pushes.push(input);
    return { pushed: input.files.length, commitUrl: null };
  }
}

export function createMemoryMirror(config = getConfig()): MemoryMirror {
  const appConfig = githubAppConfig(config);
  return appConfig ? new GitHubMemoryMirror(appConfig) : new FixtureMemoryMirror();
}
