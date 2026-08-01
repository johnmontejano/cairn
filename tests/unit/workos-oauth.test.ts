import { describe, expect, it } from 'vitest';
import {
  WorkOsAuthProvider,
  signSessionToken,
  validOAuthState,
  verifySessionToken,
} from '../../apps/web/src/server/auth';

/**
 * Turning on public sign-up meant the WorkOS OAuth round trip needed the same
 * rigor Google's connector callback already has. These are the two gaps that
 * were open before this: the `state` query param was never checked against
 * anything, and `CAIRN_SESSION_SECRET` was required by config but never used.
 */

describe('validOAuthState', () => {
  it('accepts a state that matches the stashed cookie exactly', () => {
    expect(validOAuthState('nonce-abc', 'nonce-abc')).toBe(true);
  });

  it('rejects a mismatched state', () => {
    expect(validOAuthState('nonce-abc', 'nonce-different')).toBe(false);
  });

  it('rejects when the cookie is missing (state cannot be forged from nothing)', () => {
    expect(validOAuthState(undefined, 'nonce-abc')).toBe(false);
  });

  it('rejects when the query param is missing', () => {
    expect(validOAuthState('nonce-abc', null)).toBe(false);
  });

  it('rejects when both are empty', () => {
    expect(validOAuthState(undefined, null)).toBe(false);
  });
});

describe('WorkOsAuthProvider.startEmailSignIn', () => {
  const provider = new WorkOsAuthProvider({
    apiKey: 'sk_test',
    clientId: 'client_test',
    redirectUri: 'https://app.example/api/oauth/workos/callback',
  });

  it('does not derive state from the email (the original bug)', async () => {
    const started = await provider.startEmailSignIn('person@example.com');
    expect(started.url).toBeDefined();
    const state = new URL(started.url!).searchParams.get('state');
    expect(state).not.toContain('person');
    expect(state).not.toBe(Buffer.from('person@example.com').toString('base64url'));
  });

  it('returns a state the caller can stash, matching the URL exactly', async () => {
    const started = await provider.startEmailSignIn('person@example.com');
    const state = new URL(started.url!).searchParams.get('state');
    expect(started.challengeId).toBe(state);
  });

  it('generates a fresh nonce on every call', async () => {
    const a = await provider.startEmailSignIn('person@example.com');
    const b = await provider.startEmailSignIn('person@example.com');
    expect(a.challengeId).not.toBe(b.challengeId);
  });
});

describe('session token signing', () => {
  const secret = 'a-long-enough-test-secret-value';

  it('round-trips a token through sign and verify', () => {
    const signed = signSessionToken('raw-token', secret);
    expect(verifySessionToken(signed, secret)).toBe('raw-token');
  });

  it('stays unsigned when no secret is configured, and verifies unsigned', () => {
    const signed = signSessionToken('raw-token', undefined);
    expect(signed).toBe('raw-token');
    expect(verifySessionToken(signed, undefined)).toBe('raw-token');
  });

  it('rejects a tampered signature', () => {
    const signed = signSessionToken('raw-token', secret);
    const tampered = `${signed.slice(0, -1)}x`;
    expect(verifySessionToken(tampered, secret)).toBeNull();
  });

  it('rejects a signature produced with a different secret', () => {
    const signed = signSessionToken('raw-token', 'secret-one');
    expect(verifySessionToken(signed, 'secret-two')).toBeNull();
  });

  it('rejects an unsigned cookie once a secret is configured (forces re-login rather than trusting it)', () => {
    expect(verifySessionToken('raw-token', secret)).toBeNull();
  });

  it('rejects a missing cookie', () => {
    expect(verifySessionToken(undefined, secret)).toBeNull();
  });
});
