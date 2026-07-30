import { getConfig } from '@cairn/config';
import {
  type FetchedSource,
  type SourceConnector,
  SetupRequiredError,
  ValidationError,
} from '@cairn/domain';
import { NOTION_FIXTURE_PAGES } from './fixtures/notion';

/**
 * Notion, read-only.
 *
 * Two things differ from the Drive connector and are worth knowing before
 * changing anything here:
 *
 *   1. Notion access tokens do not expire, so there is no refresh path. The
 *      stored credential is the token itself plus the workspace label.
 *   2. A Notion integration only sees pages a person has explicitly shared with
 *      it. That is a property of Notion's permission model, not something this
 *      code enforces — which is why the permission summary says "the pages you
 *      share" rather than "your Notion".
 *
 * Page bodies arrive as a block tree rather than a document, so blocks are
 * flattened to Markdown. Character offsets for citations are therefore offsets
 * into that flattened text, which is exactly what gets stored and cited.
 */

/** Pinned deliberately: Notion breaks response shapes between versions. */
const NOTION_VERSION = '2022-06-28';
const API = 'https://api.notion.com/v1';

export interface NotionConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function notionConfig(config = getConfig()): NotionConfig | null {
  const { env } = config;
  if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET || !env.NOTION_REDIRECT_URI) return null;
  return {
    clientId: env.NOTION_CLIENT_ID,
    clientSecret: env.NOTION_CLIENT_SECRET,
    redirectUri: env.NOTION_REDIRECT_URI,
  };
}

export function notionAuthorizeUrl(config: NotionConfig, state: string): string {
  const url = new URL(`${API}/oauth/authorize`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  // `user` keeps the grant to the person's own selection rather than installing
  // across a whole workspace.
  url.searchParams.set('owner', 'user');
  url.searchParams.set('state', state);
  return url.toString();
}

export interface NotionCredential {
  accessToken: string;
  workspaceName: string | null;
  workspaceId: string | null;
}

export async function exchangeNotionCode(
  config: NotionConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<NotionCredential> {
  // Notion requires HTTP Basic with the client credentials, not a body field.
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
  const res = await fetchImpl(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!res.ok) throw new ValidationError(`Notion token exchange failed (${res.status})`);
  const body = (await res.json()) as {
    access_token: string;
    workspace_id?: string;
    workspace_name?: string;
  };
  return {
    accessToken: body.access_token,
    workspaceName: body.workspace_name ?? null,
    workspaceId: body.workspace_id ?? null,
  };
}

interface RichText {
  plain_text?: string;
}

interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  properties?: Record<string, { type?: string; title?: RichText[] }>;
}

/** Block types that carry prose, mapped to their Markdown prefix. */
const BLOCK_PREFIX: Record<string, string> = {
  paragraph: '',
  heading_1: '# ',
  heading_2: '## ',
  heading_3: '### ',
  bulleted_list_item: '- ',
  numbered_list_item: '1. ',
  to_do: '- [ ] ',
  toggle: '',
  quote: '> ',
  callout: '> ',
  code: '',
};

function plainText(rich: RichText[] | undefined): string {
  if (!Array.isArray(rich)) return '';
  return rich.map((r) => r.plain_text ?? '').join('');
}

/** Pulls the page title out of whichever property holds it. */
function pageTitle(page: NotionPage): string {
  for (const value of Object.values(page.properties ?? {})) {
    if (value?.type === 'title') {
      const text = plainText(value.title);
      if (text.trim().length > 0) return text;
    }
  }
  return 'Untitled';
}

export class NotionConnector implements SourceConnector {
  readonly provider = 'notion' as const;
  readonly displayName = 'Notion';
  readonly readOnly = true as const;
  readonly permissionSummary =
    'Reads the Notion pages you choose to share with this connection, so their contents can be turned into memory. It cannot see anything you have not shared, and it never edits, moves, or deletes anything in Notion.';

  constructor(
    private readonly config: NotionConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): 'ready' {
    return 'ready';
  }

  private headers(token: string): Record<string, string> {
    return {
      authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
    };
  }

  async list(input: {
    connectionId: string;
    cursor: string | null;
    credential: string | null;
  }): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    if (!input.credential) throw new SetupRequiredError('Notion', ['connection credential']);
    const { accessToken } = JSON.parse(input.credential) as NotionCredential;

    const res = await this.fetchImpl(`${API}/search`, {
      method: 'POST',
      headers: this.headers(accessToken),
      body: JSON.stringify({
        filter: { value: 'page', property: 'object' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 25,
        ...(input.cursor ? { start_cursor: input.cursor } : {}),
      }),
    });
    if (!res.ok) throw new ValidationError(`Notion search failed (${res.status})`);
    const body = (await res.json()) as {
      results: NotionPage[];
      next_cursor?: string | null;
      has_more?: boolean;
    };

    const items: FetchedSource[] = [];
    for (const page of body.results) {
      const markdown = await this.readPage(page, accessToken);
      // A page with no prose adds nothing to memory and would only produce an
      // empty source the person has to look at and dismiss.
      if (markdown.trim().length === 0) continue;
      items.push({
        externalId: page.id,
        title: pageTitle(page),
        mimeType: 'text/markdown',
        canonicalUri: page.url ?? `https://www.notion.so/${page.id.replace(/-/g, '')}`,
        externalRevision: page.last_edited_time ?? null,
        bytes: new TextEncoder().encode(markdown),
      });
    }

    return { items, nextCursor: body.has_more ? (body.next_cursor ?? null) : null };
  }

  /** Flattens a page's top-level blocks into Markdown. */
  private async readPage(page: NotionPage, token: string): Promise<string> {
    const url = new URL(`${API}/blocks/${page.id}/children`);
    url.searchParams.set('page_size', '100');
    const res = await this.fetchImpl(url, { headers: this.headers(token) });
    // A single unreadable page should not fail the whole sync.
    if (!res.ok) return '';
    const body = (await res.json()) as { results: NotionBlock[] };

    const lines: string[] = [`# ${pageTitle(page)}`, ''];
    for (const block of body.results) {
      const prefix = BLOCK_PREFIX[block.type];
      if (prefix === undefined) continue;
      const payload = block[block.type] as { rich_text?: RichText[] } | undefined;
      const text = plainText(payload?.rich_text);
      if (text.trim().length === 0) continue;
      lines.push(`${prefix}${text}`, '');
    }
    return lines.join('\n').trimEnd();
  }
}

/**
 * Stands in when Notion credentials are absent.
 *
 * Reports `setup-required` so the interface can say so plainly, and still
 * returns sample pages when asked, so ingestion works without an account.
 */
export class FixtureNotionConnector implements SourceConnector {
  readonly provider = 'notion' as const;
  readonly displayName = 'Notion';
  readonly readOnly = true as const;
  readonly permissionSummary = new NotionConnector({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
  }).permissionSummary;

  status(): 'setup-required' {
    return 'setup-required';
  }

  async list(): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    return {
      items: NOTION_FIXTURE_PAGES.map((page) => ({
        externalId: page.id,
        title: page.title,
        mimeType: 'text/markdown',
        canonicalUri: `https://www.notion.so/${page.id.replace(/-/g, '')}`,
        externalRevision: page.version,
        bytes: new TextEncoder().encode(page.body),
      })),
      nextCursor: null,
    };
  }
}

export function createNotionConnector(config = getConfig()): SourceConnector {
  const cfg = notionConfig(config);
  return cfg ? new NotionConnector(cfg) : new FixtureNotionConnector();
}
