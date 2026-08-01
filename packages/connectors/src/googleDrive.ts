import { getConfig } from '@cairn/config';
import {
  type FetchedSource,
  type SourceConnector,
  SetupRequiredError,
  ValidationError,
} from '@cairn/domain';
import { type GoogleOAuthConfig, freshAccessToken, googleOAuthConfig } from './google';
import { DRIVE_FIXTURE_FILES } from './fixtures/googleDrive';

/**
 * Google Drive, read-only.
 *
 * Scope is `drive.readonly` and nothing else: this product never writes to a
 * person's Drive, and asking for a write scope would make that promise
 * unverifiable. Google Docs are exported as plain text rather than downloaded,
 * because their native format is not a document we could cite offsets into.
 *
 * The OAuth plumbing lives in ./google and is shared with Gmail and Calendar,
 * which sit behind the same Google Cloud client. This file keeps only what is
 * actually specific to Drive: its scope, and its list-and-download API shape.
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

/** Kept as the name this connector's own config used to have, now a re-export. */
export const googleDriveConfig = googleOAuthConfig;

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
  }): Promise<{
    items: FetchedSource[];
    nextCursor: string | null;
  }> {
    if (!input.credential) throw new SetupRequiredError('Google Drive', ['connection credential']);
    const tokens = JSON.parse(input.credential) as import('./google').GoogleTokens;
    const accessToken = await freshAccessToken(this.config, tokens, this.fetchImpl);

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
  } satisfies GoogleOAuthConfig).permissionSummary;

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
