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
  /**
   * Discovery documents live at fixed `.well-known` paths the specification
   * fixes, but a route folder whose name begins with a dot is not something to
   * rely on across Next versions. Serving them from ordinary route handlers and
   * rewriting keeps the public URLs exactly right without depending on that.
   *
   * The `:path*` variants matter: RFC 9728 lets a client append the resource's
   * own path to the well-known prefix, so a client asking about `/api/mcp`
   * requests `/.well-known/oauth-protected-resource/api/mcp`. Serving only the
   * bare path answers 404 to a correct client.
   */
  async rewrites() {
    return [
      {
        source: '/.well-known/oauth-protected-resource',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: '/api/oauth/protected-resource',
      },
      {
        source: '/.well-known/oauth-authorization-server',
        destination: '/api/oauth/authorization-server',
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: '/api/oauth/authorization-server',
      },
    ];
  },
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
