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
import { classifyMail, trimMailBody } from './mailFilter';

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
 *
 * Not every message becomes memory. A mailbox is mostly not correspondence, and
 * mail addressed to a list rather than to a person — newsletters, marketing,
 * automated notifications — is turned away twice: once by the query below,
 * which never asks Gmail for it, and once per message by the header checks in
 * ./mailFilter, which catch the newsletter Gmail filed under Primary because
 * the person replied to it once years ago. Mail the person sent is exempt from
 * both; their own words are the last thing this should discard.
 *
 * Every message this connector drops is counted and returned as `filtered`, so
 * a sync run records it as seen-and-skipped rather than quietly shrinking. What
 * the query never asked for is not in that number and cannot be — Gmail reports
 * what it matched, not what it withheld.
 */

export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

/**
 * What is worth asking Gmail for in the first place.
 *
 * Inbox and sent mail only — memory worth keeping is mail a person read or
 * wrote, not everything Gmail happens to store. Spam and trash are not excluded
 * by name because Gmail search already skips both unless explicitly asked for
 * them; the list call states `includeSpamTrash=false` instead, which is the
 * documented control and says plainly what a trailing `-in:trash` only implies.
 *
 * The category exclusions are the cheapest noise reduction available: Gmail has
 * already sorted promotions, social notifications, and forum mail out of a
 * person's real correspondence, and asking for them back only to discard them
 * later would mean fetching, decrypting, storing and reviewing thousands of
 * messages nobody wants remembered. Gmail appears to apply these labels whether
 * or not a person keeps the inbox tabs switched on, but Google does not document
 * that, so this is a cost saving rather than the guarantee — the per-message
 * header checks in `mailFilter` are what the promise actually rests on.
 *
 * They are scoped to the inbox arm deliberately. Spanning the whole query, they
 * would also drop sent mail that Gmail happened to categorise — server-side,
 * before this connector ever saw the message, so `classifyMail`'s rule that a
 * person's own words are never discarded would never get the chance to run.
 * Anyone who mails their own newsletter would lose every message they wrote.
 * Past the `OR`, `in:sent` carries no conditions at all.
 *
 * `Updates` is deliberately *not* excluded: it holds receipts, bookings and
 * confirmations alongside the noise, and the header checks are a better judge
 * of those one message at a time.
 *
 * One top-level `OR` over one parenthesised operand, because Google documents
 * `( )` for grouping but never says how `OR` binds against the implicit `AND`
 * joining adjacent terms. Rather than bet on a reading of a precedence nobody
 * specified, this leaves nothing for the reading to change.
 */
export const GMAIL_QUERY =
  '(in:inbox -category:promotions -category:social -category:forums) OR in:sent';

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
  labelIds?: string[];
  payload?: {
    headers?: GmailHeader[];
  } & GmailPart;
}

function header(message: Pick<GmailMessage, 'payload'>, name: string): string {
  return (
    message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  );
}

/**
 * Whether a fetched message is bulk mail rather than correspondence.
 *
 * Takes the message rather than only its headers because the one rule that must
 * never be overruled — a person's own sent mail is always kept — is carried on
 * Gmail's labels, not in a header. A predicate given only headers could not
 * honour it, and would discard the mail of anyone who writes a newsletter.
 *
 * The judgement itself lives in ./mailFilter so a second mail provider can
 * reuse it unchanged; this only hands Gmail's header array over in the shape it
 * expects, and exists as its own export so the connector's actual filtering
 * decision can be tested against a real Gmail payload.
 */
export function isBulkMail(message: Pick<GmailMessage, 'labelIds' | 'payload'>): boolean {
  return !classifyMail({
    labelIds: message.labelIds ?? [],
    header: (name) => header(message, name),
  }).keep;
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
  }): Promise<{ items: FetchedSource[]; nextCursor: string | null; filtered: number }> {
    if (!input.credential) throw new SetupRequiredError('Gmail', ['connection credential']);
    const tokens = JSON.parse(input.credential) as GoogleTokens;
    const accessToken = await freshAccessToken(this.config, tokens, this.fetchImpl);

    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('maxResults', '25');
    url.searchParams.set('q', GMAIL_QUERY);
    // Its default, stated outright: a message someone deleted must not come
    // back as memory, and that is too important to leave to a default.
    url.searchParams.set('includeSpamTrash', 'false');
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
    let filtered = 0;
    for (const entry of listBody.messages ?? []) {
      const message = await this.fetchMessage(entry.id, accessToken);
      if (!message) continue;

      // The category exclusions in the query above cannot see a newsletter that
      // Gmail filed under Primary, which is where anything a person has ever
      // replied to ends up. The headers can. Counted, not silently dropped —
      // `filtered` is what the sync run reports as seen-and-skipped.
      if (isBulkMail(message)) {
        filtered += 1;
        continue;
      }

      const subject = header(message, 'Subject') || '(no subject)';
      const from = header(message, 'From');
      const to = header(message, 'To');
      const date = header(message, 'Date');
      const body = trimMailBody(extractPlainText(message.payload)) || '(no plain-text body)';
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

    return { items, nextCursor: listBody.nextPageToken ?? null, filtered };
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

  async list(): Promise<{ items: FetchedSource[]; nextCursor: string | null; filtered: number }> {
    return {
      filtered: 0,
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
