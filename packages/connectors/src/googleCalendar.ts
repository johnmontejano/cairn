import { getConfig } from '@cairn/config';
import { type FetchedSource, type SourceConnector, SetupRequiredError } from '@cairn/domain';
import { ValidationError } from '@cairn/domain';
import {
  type GoogleOAuthConfig,
  type GoogleTokens,
  freshAccessToken,
  googleOAuthConfig,
} from './google';
import { CALENDAR_FIXTURE_EVENTS } from './fixtures/googleCalendar';

/**
 * Google Calendar, read-only.
 *
 * Scope is `calendar.readonly`: this connector can never create, move, or
 * cancel an event. It shares its OAuth client with Drive and Gmail — see
 * ./google.
 *
 * Only events already in the past are listed. A future meeting is a plan, not
 * yet a fact about what was decided or who attended it — which is the thing
 * this connector exists to turn into memory — and re-reading the same
 * completed event on every sync is what makes a stable revision marker
 * possible: its content cannot change after it has happened.
 */

export const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

interface CalendarAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
}

interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  updated?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: CalendarAttendee[];
  organizer?: { email?: string; displayName?: string };
}

function who(a: CalendarAttendee): string {
  const name = a.displayName ?? a.email ?? 'unknown';
  return a.responseStatus ? `${name} (${a.responseStatus})` : name;
}

function eventText(event: CalendarEvent): string {
  const lines = [
    `# ${event.summary ?? '(untitled event)'}`,
    '',
    `When: ${event.start?.dateTime ?? event.start?.date ?? 'unknown'} to ${event.end?.dateTime ?? event.end?.date ?? 'unknown'}`,
  ];
  if (event.location) lines.push(`Where: ${event.location}`);
  if (event.organizer) {
    lines.push(`Organiser: ${event.organizer.displayName ?? event.organizer.email ?? 'unknown'}`);
  }
  if (event.attendees?.length) {
    lines.push(`Attendees: ${event.attendees.map(who).join(', ')}`);
  }
  if (event.description) lines.push('', event.description);
  return lines.join('\n');
}

export class GoogleCalendarConnector implements SourceConnector {
  readonly provider = 'google_calendar' as const;
  readonly displayName = 'Google Calendar';
  readonly readOnly = true as const;
  readonly permissionSummary =
    'Reads events on your calendar so what was decided and who attended can become memory. It never creates, moves, or cancels anything.';

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
    if (!input.credential) {
      throw new SetupRequiredError('Google Calendar', ['connection credential']);
    }
    const tokens = JSON.parse(input.credential) as GoogleTokens;
    const accessToken = await freshAccessToken(this.config, tokens, this.fetchImpl);

    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('maxResults', '25');
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('orderBy', 'startTime');
    // Only what has already happened; see the class comment for why.
    url.searchParams.set('timeMax', new Date().toISOString());
    url.searchParams.set('timeMin', new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString());
    if (input.cursor) url.searchParams.set('pageToken', input.cursor);

    const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new ValidationError(`Google Calendar list failed (${res.status})`);
    const body = (await res.json()) as { items?: CalendarEvent[]; nextPageToken?: string };

    const items: FetchedSource[] = [];
    for (const event of body.items ?? []) {
      // Cancelled events carry no content worth remembering, only the fact of
      // their absence, which this connector has no way to represent usefully.
      if (event.status === 'cancelled') continue;
      items.push({
        externalId: event.id,
        title: event.summary ?? '(untitled event)',
        mimeType: 'text/markdown',
        canonicalUri:
          event.htmlLink ?? `https://calendar.google.com/calendar/event?eid=${event.id}`,
        externalRevision: event.updated ?? event.id,
        bytes: new TextEncoder().encode(eventText(event)),
      });
    }

    return { items, nextCursor: body.nextPageToken ?? null };
  }
}

/**
 * Stands in when Google credentials are absent. Reports `setup-required`
 * honestly and returns sample events so the ingestion path is exercised
 * without an account.
 */
export class FixtureGoogleCalendarConnector implements SourceConnector {
  readonly provider = 'google_calendar' as const;
  readonly displayName = 'Google Calendar';
  readonly readOnly = true as const;
  readonly permissionSummary = new GoogleCalendarConnector({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
  } satisfies GoogleOAuthConfig).permissionSummary;

  status(): 'setup-required' {
    return 'setup-required';
  }

  async list(): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    return {
      items: CALENDAR_FIXTURE_EVENTS.map((e) => ({
        externalId: e.id,
        title: e.title,
        mimeType: 'text/markdown',
        canonicalUri: `https://calendar.google.com/calendar/event?eid=${e.id}`,
        externalRevision: e.id,
        bytes: new TextEncoder().encode(e.body),
      })),
      nextCursor: null,
    };
  }
}

export function createGoogleCalendarConnector(config = getConfig()): SourceConnector {
  const oauth = googleOAuthConfig(config);
  return oauth ? new GoogleCalendarConnector(oauth) : new FixtureGoogleCalendarConnector();
}
