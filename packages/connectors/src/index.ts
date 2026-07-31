import { getConfig } from '@cairn/config';
import type { SourceConnector, SourceProvider } from '@cairn/domain';
import { createGoogleDriveConnector } from './googleDrive';
import { createGitHubConnector } from './github';
import { createNotionConnector } from './notion';
import { createPipedreamConnector } from './pipedream';

export * from './url';
export * from './googleDrive';
export * from './github';
export * from './notion';
export * from './pipedream';
export * from './fixtures/sample';
export { DRIVE_FIXTURE_FILES } from './fixtures/googleDrive';
export { GITHUB_FIXTURE_FILES } from './fixtures/github';
export { NOTION_FIXTURE_PAGES } from './fixtures/notion';

/**
 * What the user is told before connecting anything.
 *
 * Kept next to the connectors so a change in what a connector reads and a change
 * in what the user is promised cannot drift apart.
 */
export interface ConnectorDescription {
  provider: SourceProvider;
  displayName: string;
  /** One ordinary sentence: what this is, in the user's words. */
  summary: string;
  permissionSummary: string;
  /** What disconnecting does, stated before they connect. */
  disconnectSummary: string;
  readOnly: boolean;
  needsAccount: boolean;
}

export const CONNECTOR_DESCRIPTIONS: Record<SourceProvider, ConnectorDescription> = {
  paste: {
    provider: 'paste',
    displayName: 'Paste text',
    summary: 'Paste or type anything you want remembered.',
    permissionSummary: 'Only reads what you paste into the box.',
    disconnectSummary: 'Nothing to disconnect. You can remove what you pasted at any time.',
    readOnly: true,
    needsAccount: false,
  },
  upload: {
    provider: 'upload',
    displayName: 'Upload a file',
    summary: 'Add a document from your computer.',
    permissionSummary:
      'Only reads the files you choose. It cannot see anything else on your computer.',
    disconnectSummary: 'Nothing to disconnect. You can remove an uploaded file at any time.',
    readOnly: true,
    needsAccount: false,
  },
  url: {
    provider: 'url',
    displayName: 'Add a web page',
    summary: 'Save what a public page says.',
    permissionSummary:
      'Reads the page at the address you give, exactly once. It only follows public web addresses.',
    disconnectSummary: 'Nothing to disconnect. You can remove a saved page at any time.',
    readOnly: true,
    needsAccount: false,
  },
  google_drive: {
    provider: 'google_drive',
    displayName: 'Google Drive',
    summary: 'Keep memory up to date from documents you already keep in Drive.',
    permissionSummary:
      'Reads your Drive documents so their contents can become memory. It never edits, moves, or deletes anything in your Drive.',
    disconnectSummary:
      'Disconnecting stops future reading and deletes the stored permission immediately. Memory already saved stays until you remove it.',
    readOnly: true,
    needsAccount: true,
  },
  github: {
    provider: 'github',
    displayName: 'GitHub',
    summary: 'For people who already keep project notes on GitHub. Entirely optional.',
    permissionSummary:
      'Reads text and Markdown files in the repositories you pick. It does not push commits unless you separately turn on the optional mirror.',
    disconnectSummary:
      'Disconnecting stops future reading and deletes the stored permission immediately. Memory already saved stays until you remove it.',
    readOnly: true,
    needsAccount: true,
  },
  gmail: {
    provider: 'gmail',
    displayName: 'Gmail',
    summary: 'Keep memory up to date from what you already discuss over email.',
    permissionSummary:
      'Reads messages in your Gmail so their contents can become memory. It never sends, replies to, deletes, or files anything, and it never writes on your behalf.',
    disconnectSummary:
      'Disconnecting stops future reading and deletes the stored permission immediately. Memory already saved stays until you remove it.',
    readOnly: true,
    needsAccount: true,
  },
  google_calendar: {
    provider: 'google_calendar',
    displayName: 'Google Calendar',
    summary: 'Remember what was decided in meetings, and who was there.',
    permissionSummary:
      'Reads events on your calendar so what was decided and who attended can become memory. It never creates, moves, or cancels anything.',
    disconnectSummary:
      'Disconnecting stops future reading and deletes the stored permission immediately. Memory already saved stays until you remove it.',
    readOnly: true,
    needsAccount: true,
  },
  notion: {
    provider: 'notion',
    displayName: 'Notion',
    summary: 'Keep memory up to date from the Notion pages you already write in.',
    permissionSummary:
      'Reads only the Notion pages you choose to share with this connection. It cannot see anything you have not shared, and it never edits, moves, or deletes anything in Notion.',
    disconnectSummary:
      'Disconnecting stops future reading and deletes the stored permission immediately. Memory already saved stays until you remove it.',
    readOnly: true,
    needsAccount: true,
  },
};

export function connectorStatus(
  provider: SourceProvider,
  config = getConfig(),
): 'ready' | 'demo' | 'setup-required' {
  switch (provider) {
    case 'paste':
    case 'upload':
    case 'url':
      return 'ready';
    case 'google_drive':
      return config.providers.googleDrive.state;
    case 'github':
      return config.providers.github.state;
    case 'notion':
      return config.providers.notion.state;
    // Reached through Pipedream, so one credential decides them all.
    case 'gmail':
    case 'google_calendar':
      return config.providers.pipedream.state;
  }
}

export function createConnector(
  provider: SourceProvider,
  config = getConfig(),
): SourceConnector | null {
  if (provider === 'google_drive') return createGoogleDriveConnector(config);
  if (provider === 'github') return createGitHubConnector(config);
  if (provider === 'notion') return createNotionConnector(config);
  if (provider === 'gmail' || provider === 'google_calendar') {
    return createPipedreamConnector(provider, config);
  }
  // Paste, upload and URL arrive as a direct request rather than by polling a
  // provider, so they have no lister.
  return null;
}
