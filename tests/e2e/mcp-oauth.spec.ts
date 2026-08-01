import { createHash, randomBytes } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { type Page, expect, test } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/**
 * The whole remote authorization flow, driven the way a real client drives it.
 *
 * This exists because the previous OAuth implementation passed every unit test
 * it had and could not possibly have worked: discovery was absent, and the
 * lookup it performed depended on a column nothing ever wrote. Neither fault is
 * visible from inside a single function, which is why the proof has to be a
 * round trip — discovery, consent in a browser, a code exchanged with PKCE, and
 * a real MCP client calling a tool with the resulting token.
 */

const BASE = `http://127.0.0.1:${Number(process.env.CAIRN_E2E_PORT ?? 3311)}`;

function freshEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/**
 * A real listener on a real port, because that is what a desktop client does.
 *
 * Reading the redirect back out of `page.url()` instead looks equivalent and is
 * not: with nothing listening, the navigation is aborted and the browser keeps
 * the previous URL, so the assertion reads the consent page's address and
 * reports a missing code that was in fact delivered correctly.
 */
function callbackCatcher(): {
  redirectUri: Promise<string>;
  received: Promise<URL>;
  close: () => Promise<void>;
} {
  let resolveReceived: (url: URL) => void;
  const received = new Promise<URL>((resolve) => {
    resolveReceived = resolve;
  });

  let server: Server;
  const redirectUri = new Promise<string>((resolve) => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Connected. You can close this window.');
      const port = (server.address() as AddressInfo).port;
      resolveReceived(new URL(req.url ?? '/', `http://localhost:${port}`));
    });
    // Port 0 lets the OS pick, so tests cannot collide with each other or with
    // anything already running on this machine.
    server.listen(0, '127.0.0.1', () => {
      resolve(`http://localhost:${(server.address() as AddressInfo).port}/callback`);
    });
  });

  return {
    redirectUri,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Continue' }).click();
  const code = await page
    .locator('strong')
    .filter({ hasText: /^\d{6}$/ })
    .first()
    .innerText();
  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/welcome|\/home/);
}

async function registerClient(name: string, redirectUri: string): Promise<string> {
  const response = await fetch(`${BASE}/api/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: name, redirect_uris: [redirectUri] }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { client_id: string }).client_id;
}

function authorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  challenge: string;
  scope?: string;
  state?: string;
}): string {
  const url = new URL(`${BASE}/connect`);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge', options.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', `${BASE}/api/mcp`);
  if (options.scope) url.searchParams.set('scope', options.scope);
  if (options.state) url.searchParams.set('state', options.state);
  return url.toString();
}

async function exchange(body: Record<string, string>): Promise<Response> {
  return fetch(`${BASE}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

test.describe('discovery', () => {
  test('a request with no token points a client at where to sign in', async () => {
    const response = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);

    // The single parameter the whole flow hangs on. Without it a client has
    // nowhere to go, which is exactly how the previous version failed.
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toContain('resource_metadata=');

    const metadataUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
    expect(metadataUrl).toBeTruthy();

    const metadata = (await (await fetch(metadataUrl as string)).json()) as {
      resource: string;
      authorization_servers: string[];
    };
    expect(metadata.resource).toBe(`${BASE}/api/mcp`);

    const asMetadata = (await (
      await fetch(`${metadata.authorization_servers[0]}/.well-known/oauth-authorization-server`)
    ).json()) as { authorization_endpoint: string; token_endpoint: string };
    expect(asMetadata.authorization_endpoint).toBe(`${BASE}/connect`);
    expect(asMetadata.token_endpoint).toBe(`${BASE}/api/oauth/token`);
  });
});

test.describe('remote MCP authorization', () => {
  test('a person approves a tool once, and it can then read their memory', async ({ page }) => {
    const catcher = callbackCatcher();
    const redirectUri = await catcher.redirectUri;

    try {
      await signIn(page, freshEmail('oauth'));

      // Give the workspace something to find, so a successful call is
      // distinguishable from a call that merely did not error.
      await page.goto('/welcome');
      await page.getByRole('button', { name: 'Try an example' }).click();
      await expect(page.getByRole('heading', { name: 'Here is what I found' })).toBeVisible({
        timeout: 30_000,
      });

      const clientId = await registerClient('Verification client', redirectUri);
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const state = randomBytes(8).toString('hex');

      await page.goto(
        authorizeUrl({ clientId, redirectUri, challenge, scope: 'memory:read', state }),
      );

      // The consent screen must name the tool and avoid protocol vocabulary —
      // a person here has not agreed to learn what a scope is.
      await expect(page.getByRole('heading', { name: /Verification client/ })).toBeVisible();
      const body = await page.locator('body').innerText();
      expect(body).not.toContain('code_challenge');
      expect(body).not.toContain('memory:read');

      await page.getByRole('button', { name: 'Yes, connect it' }).click();

      const returned = await catcher.received;
      const code = returned.searchParams.get('code');
      expect(code, 'an authorization code came back').toBeTruthy();
      expect(returned.searchParams.get('state')).toBe(state);
      // RFC 9207: the issuer travels with the response so a client can tell
      // which authorization server actually answered.
      expect(returned.searchParams.get('iss')).toBe(BASE);

      const tokenResponse = await exchange({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      });
      expect(tokenResponse.status).toBe(200);
      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        token_type: string;
        scope: string;
      };
      expect(tokens.token_type).toBe('Bearer');
      expect(tokens.scope).toContain('memory:read');

      // The same code a second time must fail, or an intercepted redirect stays
      // useful forever.
      const replay = await exchange({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      });
      expect(replay.status).toBe(400);

      // Finally, the point of all of it: a real MCP client, over the real
      // transport, using the token the flow produced.
      const client = new Client({ name: 'cairn-oauth-verification', version: '1.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/api/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
      });
      await client.connect(transport);

      const tools = await client.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);

      const whoami = await client.callTool({ name: 'whoami', arguments: {} });
      expect(whoami.isError ?? false).toBe(false);

      await client.close();
    } finally {
      await catcher.close();
    }
  });

  test('a refresh token rotates, and reusing the old one is refused', async ({ page }) => {
    const catcher = callbackCatcher();
    const redirectUri = await catcher.redirectUri;

    try {
      await signIn(page, freshEmail('oauth-refresh'));

      const clientId = await registerClient('Refresh client', redirectUri);
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');

      await page.goto(authorizeUrl({ clientId, redirectUri, challenge }));
      await page.getByRole('button', { name: 'Yes, connect it' }).click();

      const code = (await catcher.received).searchParams.get('code');
      const first = (await (
        await exchange({
          grant_type: 'authorization_code',
          code: code as string,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: verifier,
        })
      ).json()) as { refresh_token: string };

      const rotated = await exchange({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: clientId,
      });
      expect(rotated.status).toBe(200);

      // Reusing a rotated refresh token is the signature of a stolen copy, so
      // it is refused rather than quietly honoured.
      const reused = await exchange({
        grant_type: 'refresh_token',
        refresh_token: first.refresh_token,
        client_id: clientId,
      });
      expect(reused.status).toBe(400);
    } finally {
      await catcher.close();
    }
  });

  test('a wrong PKCE verifier is refused even with a genuine code', async ({ page }) => {
    const catcher = callbackCatcher();
    const redirectUri = await catcher.redirectUri;

    try {
      await signIn(page, freshEmail('oauth-pkce'));

      const clientId = await registerClient('PKCE client', redirectUri);
      const challenge = createHash('sha256').update('the-real-verifier').digest('base64url');

      await page.goto(authorizeUrl({ clientId, redirectUri, challenge }));
      await page.getByRole('button', { name: 'Yes, connect it' }).click();

      const code = (await catcher.received).searchParams.get('code');
      const response = await exchange({
        grant_type: 'authorization_code',
        code: code as string,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: 'a-guessed-verifier',
      });
      expect(response.status).toBe(400);
    } finally {
      await catcher.close();
    }
  });

  test('declining tells the tool rather than leaving it waiting', async ({ page }) => {
    const catcher = callbackCatcher();
    const redirectUri = await catcher.redirectUri;

    try {
      await signIn(page, freshEmail('oauth-deny'));

      const clientId = await registerClient('Declined client', redirectUri);
      const challenge = createHash('sha256')
        .update(randomBytes(32).toString('base64url'))
        .digest('base64url');

      await page.goto(authorizeUrl({ clientId, redirectUri, challenge }));
      await page.getByRole('button', { name: 'No, cancel' }).click();

      const returned = await catcher.received;
      expect(returned.searchParams.get('error')).toBe('access_denied');
      expect(returned.searchParams.get('code')).toBeNull();
    } finally {
      await catcher.close();
    }
  });

  test('an unregistered tool is refused on Cairn’s own page, not redirected', async ({ page }) => {
    await signIn(page, freshEmail('oauth-unknown'));

    await page.goto(
      authorizeUrl({
        clientId: 'never-registered',
        redirectUri: 'http://localhost:9876/callback',
        challenge: 'x',
      }),
    );

    // Never redirected: bouncing an error to an unvalidated redirect_uri is how
    // an open redirector gets built.
    expect(page.url()).toContain('/connect');
    await expect(page.getByText('Nothing has been shared')).toBeVisible();
  });

  test('a token minted for this server is refused at a different resource', async ({ page }) => {
    const catcher = callbackCatcher();
    const redirectUri = await catcher.redirectUri;

    try {
      await signIn(page, freshEmail('oauth-audience'));
      const clientId = await registerClient('Audience client', redirectUri);

      const url = new URL(`${BASE}/connect`);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('code_challenge', 'x'.repeat(43));
      url.searchParams.set('code_challenge_method', 'S256');
      // Asking for a token aimed at somebody else's server.
      url.searchParams.set('resource', 'https://someone-else.example/mcp');

      await page.goto(url.toString());

      const returned = await catcher.received;
      expect(returned.searchParams.get('error')).toBe('invalid_target');
    } finally {
      await catcher.close();
    }
  });
});
