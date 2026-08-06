import { describe, expect, it } from 'vitest';
import { redirectUriAllowed } from '../../apps/web/src/server/oauth-request';

/**
 * Redirect URI matching.
 *
 * The loopback exemption exists for one concrete reason: a command-line tool
 * binds whatever port is free, so the port it registers and the port it comes
 * back on need not be the same. Codex does exactly this. Everything else about
 * the URI still has to match, because the moment path matching goes loose, an
 * authorization code can be delivered somewhere the real client does not own.
 */
describe('redirect URI matching', () => {
  it('accepts an exact match', () => {
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/callback'], 'http://127.0.0.1:1455/callback'),
    ).toBe(true);
  });

  it('accepts a different port on loopback, as RFC 8252 requires', () => {
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/callback'], 'http://127.0.0.1:52341/callback'),
    ).toBe(true);
  });

  it('accepts the per-server callback path Codex appends, when it was registered', () => {
    expect(
      redirectUriAllowed(
        ['http://127.0.0.1:1455/callback/abc123'],
        'http://127.0.0.1:60999/callback/abc123',
      ),
    ).toBe(true);
  });

  it('refuses a different path, however loopback it is', () => {
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/callback'], 'http://127.0.0.1:1455/stolen'),
    ).toBe(false);
    // The exact smuggling case the exemption must not open up.
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/callback'], 'http://127.0.0.1:1455/callback/evil'),
    ).toBe(false);
  });

  it('refuses a different loopback host spelling it never registered', () => {
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/callback'], 'http://localhost:1455/callback'),
    ).toBe(false);
  });

  it('gives no port leniency to a non-loopback address', () => {
    expect(redirectUriAllowed(['https://example.com:443/cb'], 'https://example.com:8443/cb')).toBe(
      false,
    );
  });

  it('refuses a public host that merely looks loopback-ish', () => {
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/callback'], 'http://127.0.0.1.evil.com/callback'),
    ).toBe(false);
  });

  it('refuses an unparseable or empty request', () => {
    expect(redirectUriAllowed(['http://127.0.0.1:1455/callback'], 'not a url')).toBe(false);
    expect(redirectUriAllowed([], 'http://127.0.0.1:1455/callback')).toBe(false);
  });

  it('keeps query strings significant', () => {
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/cb?a=1'], 'http://127.0.0.1:9999/cb?a=2'),
    ).toBe(false);
    expect(
      redirectUriAllowed(['http://127.0.0.1:1455/cb?a=1'], 'http://127.0.0.1:9999/cb?a=1'),
    ).toBe(true);
  });
});
