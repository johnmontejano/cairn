import { describe, expect, it } from 'vitest';
import {
  CALENDAR_SCOPES,
  DRIVE_SCOPES,
  GMAIL_SCOPES,
  exchangeGoogleCode,
  googleAuthorizeUrl,
} from '@cairn/connectors';

/**
 * Drive, Gmail and Calendar share one OAuth client and one exchange function,
 * parameterized by which scopes to validate against. This is the test that
 * would have caught the original bug: exchangeGoogleCode used to hardcode
 * DRIVE_SCOPES, so calling it for Gmail or Calendar would have rejected every
 * real grant as "wider than requested."
 */

const config = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://app.example/cb' };

const tokenResponse = (scope: string) =>
  new Response(
    JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope }),
    { status: 200 },
  );

describe('googleAuthorizeUrl', () => {
  it('requests exactly the scopes given, not a fixed set', () => {
    const url = new URL(googleAuthorizeUrl(config, GMAIL_SCOPES, 'conn-1'));
    expect(url.searchParams.get('scope')).toBe(GMAIL_SCOPES.join(' '));
    expect(url.searchParams.get('state')).toBe('conn-1');
  });

  it('builds a different request per product from the same client', () => {
    const drive = new URL(googleAuthorizeUrl(config, DRIVE_SCOPES, 'x'));
    const calendar = new URL(googleAuthorizeUrl(config, CALENDAR_SCOPES, 'x'));
    expect(drive.searchParams.get('scope')).not.toBe(calendar.searchParams.get('scope'));
    expect(drive.searchParams.get('client_id')).toBe(calendar.searchParams.get('client_id'));
  });
});

describe('exchangeGoogleCode', () => {
  it('accepts a grant matching the scopes it was told to expect', async () => {
    const fetchImpl = (async () =>
      tokenResponse(GMAIL_SCOPES.join(' '))) as unknown as typeof fetch;
    const tokens = await exchangeGoogleCode(config, 'code', GMAIL_SCOPES, fetchImpl);
    expect(tokens.accessToken).toBe('at');
  });

  it('does not reject Gmail scopes just because they are not Drive scopes', async () => {
    // The actual bug this file exists to prevent: a shared function that
    // silently kept validating against one product's scopes.
    const fetchImpl = (async () =>
      tokenResponse(GMAIL_SCOPES.join(' '))) as unknown as typeof fetch;
    await expect(
      exchangeGoogleCode(config, 'code', GMAIL_SCOPES, fetchImpl),
    ).resolves.toBeDefined();
  });

  it('still refuses a grant wider than what this call expected', async () => {
    const fetchImpl = (async () =>
      tokenResponse([...GMAIL_SCOPES, ...DRIVE_SCOPES].join(' '))) as unknown as typeof fetch;
    await expect(exchangeGoogleCode(config, 'code', GMAIL_SCOPES, fetchImpl)).rejects.toThrow(
      /Unexpected Google scopes granted/,
    );
  });

  it('allows the userinfo scopes Google adds on its own', async () => {
    const fetchImpl = (async () =>
      tokenResponse(
        [...CALENDAR_SCOPES, 'https://www.googleapis.com/auth/userinfo.email'].join(' '),
      )) as unknown as typeof fetch;
    await expect(
      exchangeGoogleCode(config, 'code', CALENDAR_SCOPES, fetchImpl),
    ).resolves.toBeDefined();
  });
});
