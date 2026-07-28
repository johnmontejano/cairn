import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Next reads `.env` files from the app directory, but this is a workspace and the
 * developer's file lives at the repository root. This runs in the server process
 * at start-up, before any route is loaded, and assigns into `process.env` rather
 * than Next's `env` option so nothing can be inlined into a browser bundle.
 * Values already in the environment always win.
 */
function loadRootEnv(): void {
  const root = path.resolve(process.cwd(), '..', '..');
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (key in process.env) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

loadRootEnv();

/**
 * Workspace packages are consumed as TypeScript source rather than as built
 * artifacts, so there is no build step to keep in sync while developing. Next
 * compiles them alongside the app.
 */
const config: NextConfig = {
  transpilePackages: [
    '@cairn/config',
    '@cairn/connectors',
    '@cairn/crypto',
    '@cairn/db',
    '@cairn/domain',
    '@cairn/ingestion',
    '@cairn/mcp',
    '@cairn/search',
    '@cairn/ui',
    '@cairn/vault',
  ],
  serverExternalPackages: ['@electric-sql/pglite', 'postgres', 'unpdf', 'mammoth'],
  experimental: {
    serverActions: { bodySizeLimit: '12mb' },
  },
  poweredByHeader: false,
  // Browser tests and local tooling reach the dev server by address rather than
  // by name; without this the dev server refuses their server-action requests.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default config;
