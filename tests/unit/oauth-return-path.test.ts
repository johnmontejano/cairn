import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../../apps/web/src/server/auth';

/**
 * The return path after sign-in.
 *
 * A redirect target read out of a query parameter is an open redirector unless
 * something refuses everything that is not a plain rooted path on this site.
 * This exists because the consent screen introduced the first such parameter in
 * the product, and the failure mode is a phishing page hosted under Cairn's own
 * sign-in link rather than anything that looks like a bug.
 */
describe('narrowing a post-sign-in return path', () => {
  it('accepts an ordinary path on this site', () => {
    expect(safeReturnPath('/connect?client_id=abc')).toBe('/connect?client_id=abc');
    expect(safeReturnPath('/home')).toBe('/home');
  });

  it('refuses an absolute URL somewhere else', () => {
    expect(safeReturnPath('https://evil.example/steal')).toBeNull();
    expect(safeReturnPath('http://evil.example')).toBeNull();
  });

  it('refuses a protocol-relative URL, which a leading-slash test would allow', () => {
    // `//evil.example` is read by browsers as https://evil.example, and it
    // starts with "/" — this is the case a naive check gets wrong.
    expect(safeReturnPath('//evil.example')).toBeNull();
  });

  it('refuses a backslash-smuggled URL, which some parsers normalize', () => {
    expect(safeReturnPath('/\\evil.example')).toBeNull();
  });

  it('refuses a relative path with no leading slash', () => {
    expect(safeReturnPath('connect')).toBeNull();
    expect(safeReturnPath('../admin')).toBeNull();
  });

  it('treats absent or empty as no preference rather than as an error', () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath('')).toBeNull();
  });

  it('refuses an absurdly long value rather than storing it in a cookie', () => {
    expect(safeReturnPath(`/${'a'.repeat(600)}`)).toBeNull();
  });
});
