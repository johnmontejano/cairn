import { describe, expect, it } from 'vitest';
import {
  createPipedreamConnectLink,
  parseRpcBody,
  readOnlyTools,
  resetPipedreamToken,
} from '@cairn/connectors';

/**
 * Shapes here are copied from a live call made on 2026-07-31, not invented.
 * The endpoint answers `text/event-stream` even for one request-response
 * exchange, which is the thing these tests exist to stop regressing.
 */

describe('parseRpcBody', () => {
  it('reads the result out of an event-stream frame', () => {
    const raw = 'event: message\ndata: {"result":{"tools":[{"name":"notion-search"}]}}\n\n';
    expect(parseRpcBody(raw).result?.tools?.[0]?.name).toBe('notion-search');
  });

  it('still accepts a plain JSON body', () => {
    expect(parseRpcBody('{"result":{"tools":[]}}').result?.tools).toEqual([]);
  });

  it('takes the last frame when a stream carries several', () => {
    const raw = [
      'data: {"result":{"tools":[]}}',
      'data: {"result":{"tools":[{"name":"x-get"}]}}',
    ].join('\n');
    expect(parseRpcBody(raw).result?.tools?.[0]?.name).toBe('x-get');
  });

  it('refuses a body with no frame rather than returning nothing useful', () => {
    expect(() => parseRpcBody('event: ping\n\n')).toThrow();
  });
});

describe('readOnlyTools', () => {
  // The real Notion surface. Half of it writes.
  const NOTION = [
    'notion-update-page',
    'notion-update-database',
    'notion-search',
    'notion-retrieve-page',
    'notion-retrieve-database-schema',
    'notion-query-database',
    'notion-create-page',
    'notion-create-database',
    'notion-create-comment',
    'notion-append-block',
    'notion-get-current-user',
  ].map((name) => ({ name }));

  it('keeps the reads', () => {
    const kept = readOnlyTools(NOTION).map((t) => t.name);
    expect(kept).toContain('notion-search');
    expect(kept).toContain('notion-retrieve-page');
    expect(kept).toContain('notion-query-database');
    expect(kept).toContain('notion-get-current-user');
  });

  it('drops every write', () => {
    const kept = readOnlyTools(NOTION).map((t) => t.name);
    for (const write of [
      'notion-update-page',
      'notion-update-database',
      'notion-create-page',
      'notion-create-database',
      'notion-create-comment',
      'notion-append-block',
    ]) {
      expect(kept).not.toContain(write);
    }
  });

  it('fails closed on a verb it does not recognise', () => {
    // A connector that declares readOnly must not surface a new mutation
    // simply because nobody taught it that verb yet.
    expect(readOnlyTools([{ name: 'notion-obliterate-everything' }])).toEqual([]);
  });
});

describe('createPipedreamConnectLink', () => {
  const config = {
    projectId: 'proj_test',
    environment: 'production',
    clientId: 'id',
    clientSecret: 'secret',
  };

  // Response shape copied from a live call on 2026-07-31.
  const stub = (): typeof fetch =>
    (async (url: string | URL) =>
      String(url).includes('/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 })
        : new Response(
            JSON.stringify({
              token: 'ctok_abc',
              connect_link_url:
                'https://pipedream.com/_static/connect.html?token=ctok_abc&connectLink=true',
              expires_at: '2026-08-01T06:54:19Z',
            }),
            { status: 200 },
          )) as unknown as typeof fetch;

  it('uses the URL the API returns rather than rebuilding it', async () => {
    resetPipedreamToken();
    const link = await createPipedreamConnectLink(config, { externalUserId: 'cairn:ws-1' }, stub());
    // A URL this system reconstructs is one it can get subtly wrong.
    expect(link.url).toContain('token=ctok_abc');
    expect(link.url).toContain('connectLink=true');
    expect(link.token).toBe('ctok_abc');
  });

  it('pre-selects the app so the person lands on the right consent screen', async () => {
    resetPipedreamToken();
    const link = await createPipedreamConnectLink(
      config,
      { externalUserId: 'cairn:ws-1', app: 'gmail' },
      stub(),
    );
    expect(link.url).toContain('app=gmail');
  });

  it('refuses rather than returning a half-made link', async () => {
    resetPipedreamToken();
    const failing = (async (url: string | URL) =>
      String(url).includes('/oauth/token')
        ? new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 })
        : new Response('nope', { status: 500 })) as unknown as typeof fetch;

    await expect(
      createPipedreamConnectLink(config, { externalUserId: 'cairn:ws-1' }, failing),
    ).rejects.toThrow(/connect token failed/i);
  });
});
