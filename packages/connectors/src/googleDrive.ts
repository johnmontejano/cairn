import { getConfig } from '@cairn/config';
import {
  type FetchedSource,
  type SourceConnector,
  SetupRequiredError,
  ValidationError,
} from '@cairn/domain';
import { DRIVE_FIXTURE_FILES } from './fixtures/googleDrive';

/**
 * Google Drive, read-only.
 *
 * Scope is `drive.readonly` and nothing else: this product never writes to a
 * person's Drive, and asking for a write scope would make that promise
 * unverifiable. Google Docs are exported as plain text rather than downloaded,
 * because their native format is not a document we could cite offsets into.
 */

export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

const EXPORTABLE: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.presentation': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
};

const DOWNLOADABLE = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleDriveConfig(config = getConfig()): GoogleDriveConfig | null {
  const { env } = config;
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) return null;
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_REDIRECT_URI,
  };
}

export function googleAuthorizeUrl(config: GoogleDriveConfig, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', DRIVE_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'false');
  url.searchParams.set('state', state);
  return url.toString();
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  accountLabel: string | null;
}

export async function exchangeGoogleCode(
  config: GoogleDriveConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new ValidationError(`Google token exchange failed (${res.status})`);
  const body = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  };
  // Refuse a grant that is broader than what we asked for.
  const granted = (body.scope ?? '').split(' ').filter(Boolean);
  if (
    granted.some(
      (s) => !DRIVE_SCOPES.includes(s) && !s.startsWith('https://www.googleapis.com/auth/userinfo'),
    )
  ) {
    throw new ValidationError(
      `Unexpected Google scopes granted: ${granted.join(' ')}`,
      'The permissions granted were wider than requested, so the connection was refused.',
    );
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: Date.now() + body.expires_in * 1000,
    accountLabel: null,
  };
}

export async function refreshGoogleToken(
  config: GoogleDriveConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleTokens> {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new ValidationError(`Google token refresh failed (${res.status})`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: body.access_token,
    refreshToken,
    expiresAt: Date.now() + body.expires_in * 1000,
    accountLabel: null,
  };
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  version?: string;
  webViewLink?: string;
  size?: string;
}

export class GoogleDriveConnector implements SourceConnector {
  readonly provider = 'google_drive' as const;
  readonly displayName = 'Google Drive';
  readonly readOnly = true as const;
  readonly permissionSummary =
    'Reads the documents in your Google Drive so their contents can be turned into memory. It never edits, moves, or deletes anything in your Drive, and it never posts anything on your behalf.';

  constructor(
    private readonly config: GoogleDriveConfig,
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
    if (!input.credential) throw new SetupRequiredError('Google Drive', ['connection credential']);
    const tokens = JSON.parse(input.credential) as GoogleTokens;
    const accessToken =
      tokens.expiresAt > Date.now() + 30_000
        ? tokens.accessToken
        : (await refreshGoogleToken(this.config, tokens.refreshToken ?? '', this.fetchImpl))
            .accessToken;

    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('pageSize', '25');
    url.searchParams.set(
      'fields',
      'nextPageToken, files(id,name,mimeType,modifiedTime,version,webViewLink,size)',
    );
    url.searchParams.set(
      'q',
      "trashed = false and mimeType != 'application/vnd.google-apps.folder'",
    );
    url.searchParams.set('orderBy', 'modifiedTime desc');
    if (input.cursor) url.searchParams.set('pageToken', input.cursor);

    const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) throw new ValidationError(`Google Drive list failed (${res.status})`);
    const body = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };

    const items: FetchedSource[] = [];
    for (const file of body.files) {
      const exportType = EXPORTABLE[file.mimeType];
      if (!exportType && !DOWNLOADABLE.includes(file.mimeType)) continue;
      const bytes = await this.download(file, accessToken, exportType);
      if (!bytes) continue;
      items.push({
        externalId: file.id,
        title: file.name,
        mimeType: exportType ?? file.mimeType,
        canonicalUri: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
        externalRevision: file.version ?? file.modifiedTime,
        bytes,
      });
    }
    return { items, nextCursor: body.nextPageToken ?? null };
  }

  private async download(
    file: DriveFile,
    accessToken: string,
    exportType: string | undefined,
  ): Promise<Uint8Array | null> {
    const url = exportType
      ? `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(exportType)}`
      : `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
    const res = await this.fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }
}

/**
 * Stands in when Google credentials are absent.
 *
 * It reports `setup-required` so the UI can say so honestly, and still returns
 * sample documents when explicitly asked, so the ingestion path is exercised end
 * to end without an external account.
 */
export class FixtureGoogleDriveConnector implements SourceConnector {
  readonly provider = 'google_drive' as const;
  readonly displayName = 'Google Drive';
  readonly readOnly = true as const;
  readonly permissionSummary = new GoogleDriveConnector({
    clientId: '',
    clientSecret: '',
    redirectUri: '',
  }).permissionSummary;

  status(): 'setup-required' {
    return 'setup-required';
  }

  async list(): Promise<{ items: FetchedSource[]; nextCursor: string | null }> {
    return {
      items: DRIVE_FIXTURE_FILES.map((file) => ({
        externalId: file.id,
        title: file.name,
        mimeType: 'text/markdown',
        canonicalUri: `https://drive.google.com/file/d/${file.id}/view`,
        externalRevision: file.version,
        bytes: new TextEncoder().encode(file.body),
      })),
      nextCursor: null,
    };
  }
}

export function createGoogleDriveConnector(config = getConfig()): SourceConnector {
  const driveConfig = googleDriveConfig(config);
  return driveConfig ? new GoogleDriveConnector(driveConfig) : new FixtureGoogleDriveConnector();
}
