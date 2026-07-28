/**
 * Product identity.
 *
 * "Cairn" is a WORKING NAME chosen so implementation could proceed; it is not an
 * approved brand decision. Every user-visible name flows from this file, so
 * renaming the product means editing these constants and the marketing copy in
 * `apps/web/src/content`.
 */
export const PRODUCT = {
  /** Short product name shown in the UI. */
  name: 'Cairn',
  /** One-line promise, in ordinary language. */
  tagline: 'One private memory, shared by the AI tools you choose.',
  /** Longer plain-language description used on the sign-in and home screens. */
  description:
    'Cairn keeps the background you keep repeating — your projects, decisions, and preferences — in one private place you control, and lets the AI tools you authorize look up only the parts they need.',
  /** Reverse-DNS style identifier used for URIs, cookies and MCP resource URIs. */
  slug: 'cairn',
  /** URI scheme used by MCP resources. */
  resourceScheme: 'cairn',
  /** Canonical folder inside a workspace vault holding the five unified-memory docs. */
  canonicalVaultRoot: 'memory',
  /** Export/backup archive format version. Bump only with a documented migration. */
  backupFormatVersion: 1,
  /** Vault manifest format version. */
  vaultManifestVersion: 1,
} as const;

/** Fixed embedding width. Every embedder must produce exactly this many dimensions. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * MCP protocol revision this server targets.
 *
 * Deliberately the latest *stable* revision. Do not move this to a release
 * candidate; see docs/MCP_GUIDE.md.
 */
export const MCP_PROTOCOL_REVISION = '2025-11-25';
