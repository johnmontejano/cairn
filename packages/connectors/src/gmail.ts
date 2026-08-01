import { getConfig } from '@cairn/config';
import { type FetchedSource, type SourceConnector, SetupRequiredError } from '@cairn/domain';
import {
  type GoogleOAuthConfig,
  type GoogleTokens,
  freshAccessToken,
  googleOAuthConfig,
} from './google';
import { ValidationError } from '@cairn/domain';
import { GMAIL_FIXTURE_MESSAGES } from './fixtures/gmail';

/**
 * Gmail, read-only.
 *
 * Scope is `gmail.readonly`: this connector can never send, delete, label, or
 * modify a message, and asking for a broader scope would make that promise
 * unverifiable. It shares its OAuth client with Drive and Calendar — see
 * ./google — so a person authorizing Gmail is not creating a second Google
 * Cloud integration, only requesting a second set of scopes from the same one.
 *
 * Gmail's list API returns ids only; each message body is a separate fetch,
 * and `format=full` is requested so the payload includes headers and body
 * parts rather than only the id Gmail's list endpoint gives you.
 */

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

interface GmailListEntry {
  id: string;
  threadId: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  historyId?: string;
  internalDate?: string;
  payload?: {
    headers?: GmailHeader[];
  } & GmailPart;
}

function header(message: GmailMessage, name: string): string {
  return (
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  );
}

/**
 * Gmail bodies arrive as base64url, and a multipart message nests plain-text
 * inside a tree of parts rather than at the top level. This walks the tree
 * depth-first and takes the first `text/plain` part it finds, because that is
 * the representation worth extracting memory from — the `text/html` sibling is
 * the same content with markup this product has no use for.
 */
function extractPlainText(part: GmailPart | undefined): string {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const child of part.parts ?? []) {
    const found = extractPlainText(child);
    if (found) return found;
  }
  return '';
}

export class GmailConnector implements SourceConnector {
  readonly provider = 'gmail' as const;
  readonly displayName = 'Gmail';
  readonly readOnly = true as const;
  readonly permissionSummary =
    'Reads messages in your Gmail so their contents can become memory. It never sends, replies to, deletes, labels, or files anything, and it never writes on your behalf.';

  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  status(): 'ready' {
    return 'ready';
  }

  async list(input: {
    connectionId: string;
    cursor: string | null;
    credential: string | null;
  }): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    if (!input.credential) throw new SetupRequiredError('Gmail', ['connection credential']);
    const tokens = JSON.parse(input.credential) as GoogleTokens;
    const accessToken = await freshAccessToken(this.config, tokens, this.fetchImpl);

    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('maxResults', '25');
    // Only the inbox and sent mail: memory worth keeping is mail a person read
    // or wrote, not everything Gmail happens to store, and excluding spam and
    // trash keeps a deleted message from resurrecting itself as memory.
    url.searchParams.set('q', 'in:inbox OR in:sent -in:spam -in:trash');
    if (input.cursor) url.searchParams.set('pageToken', input.cursor);

    const listRes = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) throw new ValidationError(`Gmail list failed (${listRes.status})`);
    const listBody = (await listRes.json()) as {
      messages?: GmailListEntry[];
      nextPageToken?: string;
    };

    const items: FetchedSource[] = [];
    for (const entry of listBody.messages ?? []) {
      const message = await this.fetchMessage(entry.id, accessToken);
      if (!message) continue;
      const subject = header(message, 'Subject') || '(no subject)';
      const from = header(message, 'From');
      const to = header(message, 'To');
      const date = header(message, 'Date');
      const body = extractPlainText(message.payload) || '(no plain-text body)';
      const text = [
        `Subject: ${subject}`,
        `From: ${from}`,
        `To: ${to}`,
        `Date: ${date}`,
        '',
        body,
      ].join('\n');

      items.push({
        externalId: message.id,
        title: subject,
        mimeType: 'text/plain',
        canonicalUri: `https://mail.google.com/mail/u/0/#all/${message.id}`,
        // Gmail messages are immutable once sent; historyId tracks mailbox-level
        // changes like labels, not content, so there is nothing more specific
        // to a message's content than its own id to use as a revision marker.
        externalRevision: message.id,
        bytes: new TextEncoder().encode(text),
      });
    }

    return { items, nextCursor: listBody.nextPageToken ?? null };
  }

  private async fetchMessage(id: string, accessToken: string): Promise<GmailMessage | null> {
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
    url.searchParams.set('format', 'full');
    const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return (await res.json()) as GmailMessage;
  }
}

/**
 * Stands in when Google credentials are absent. Reports `setup-required`
 * honestly and returns sample messages so the ingestion path is exercised
 * without an account.
 */
export class FixtureGmailConnector implements SourceConnector {
  readonly provider = 'gmail' as const;
  readonly displayName = 'Gmail';
  readonly readOnly = true as const;
  readonly permissionSummary = new GmailConnector({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
  } satisfies GoogleOAuthConfig).permissionSummary;

  status(): 'setup-required' {
    return 'setup-required';
  }

  async list(): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    return {
      items: GMAIL_FIXTURE_MESSAGES.map((m) => ({
        externalId: m.id,
        title: m.subject,
        mimeType: 'text/plain',
        canonicalUri: `https://mail.google.com/mail/u/0/#all/${m.id}`,
        externalRevision: m.id,
        bytes: new TextEncoder().encode(m.body),
      })),
      nextCursor: null,
    };
  }
}

export function createGmailConnector(config = getConfig()): SourceConnector {
  const oauth = googleOAuthConfig(config);
  return oauth ? new GmailConnector(oauth) : new FixtureGmailConnector();
}
