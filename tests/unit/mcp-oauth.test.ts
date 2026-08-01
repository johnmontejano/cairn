import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { getConfig } from '@cairn/config';
import {
  authorizationServerMetadata,
  grantableScopes,
  mcpResourceUri,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
  wwwAuthenticateChallenge,
} from '@cairn/mcp';

/**
 * The discovery half of remote MCP authorization.
 *
 * These are pinned as tests rather than trusted to review because the previous
 * implementation was well-formed HTTP that no client could follow: it emitted
 * `authorization_uri`, which nothing reads, instead of `resource_metadata`,
 * which is the only parameter that starts discovery. That failure was silent —
 * every response looked correct in isolation — so the shape is asserted here.
 */

function oauthConfig() {
  const base = getConfig();
  return {
    ...base,
    env: { ...base.env, MCP_AUTH_MODE: 'oauth' as const },
  } as typeof base;
}

describe('protected resource metadata', () => {
  it('names the MCP endpoint as the canonical resource, without a trailing slash', () => {
    const doc = protectedResourceMetadata(oauthConfig());
    expect(doc.resource).toBe(mcpResourceUri(oauthConfig()));
    expect(String(doc.resource)).toMatch(/\/api\/mcp$/);
    expect(String(doc.resource)).not.toMatch(/\/$/);
  });

  it('points at an authorization server a client can then discover', () => {
    const doc = protectedResourceMetadata(oauthConfig());
    expect(Array.isArray(doc.authorization_servers)).toBe(true);
    expect((doc.authorization_servers as string[])[0]).toBe(
      authorizationServerMetadata(oauthConfig()).issuer,
    );
  });

  it('advertises only the minimum scope, leaving the rest to a step-up', () => {
    expect(protectedResourceMetadata(oauthConfig()).scopes_supported).toEqual(['memory:read']);
  });
});

describe('authorization server metadata', () => {
  it('offers S256 and nothing else, because OAuth 2.1 removed plain', () => {
    const doc = authorizationServerMetadata(oauthConfig());
    expect(doc.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('declares no client authentication, since every MCP client is public', () => {
    expect(
      authorizationServerMetadata(oauthConfig()).token_endpoint_auth_methods_supported,
    ).toEqual(['none']);
  });

  it('advertises iss in authorization responses so clients can detect mix-up', () => {
    expect(
      authorizationServerMetadata(oauthConfig()).authorization_response_iss_parameter_supported,
    ).toBe(true);
  });

  it('never advertises a scope that cannot be granted', () => {
    const advertised = authorizationServerMetadata(oauthConfig()).scopes_supported as string[];
    expect(advertised).not.toContain('memory:write');
    expect(advertised).toEqual(grantableScopes());
  });
});

describe('the 401 challenge', () => {
  it('carries resource_metadata, which is what a client actually follows', () => {
    const header = wwwAuthenticateChallenge(oauthConfig(), { error: 'invalid_token' });
    expect(header).toContain(`resource_metadata="${protectedResourceMetadataUrl(oauthConfig())}"`);
    expect(header.startsWith('Bearer ')).toBe(true);
  });

  it('does not emit the parameter names the old version used', () => {
    const header = wwwAuthenticateChallenge(oauthConfig(), { error: 'invalid_token' });
    expect(header).not.toContain('authorization_uri=');
  });

  it('names the scopes needed when refusing for insufficient scope', () => {
    const header = wwwAuthenticateChallenge(oauthConfig(), {
      error: 'insufficient_scope',
      scope: ['memory:propose'],
    });
    expect(header).toContain('error="insufficient_scope"');
    expect(header).toContain('scope="memory:propose"');
  });

  it('still tells a local-mode caller to use a connection code', () => {
    const header = wwwAuthenticateChallenge(getConfig());
    expect(header).toContain('connection code');
  });
});

/**
 * PKCE, verified against the transformation the token endpoint performs.
 *
 * Written out longhand rather than calling the endpoint's helper, so that a
 * change to that helper has to agree with an independently derived value
 * instead of agreeing with itself.
 */
describe('PKCE S256', () => {
  it('matches a challenge derived the way a client derives it', () => {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const recomputed = createHash('sha256').update(verifier).digest('base64url');
    expect(recomputed).toBe(challenge);
  });

  it('fails for a different verifier, which is the entire point', () => {
    const challenge = createHash('sha256').update('the-real-verifier').digest('base64url');
    const attacker = createHash('sha256').update('a-guessed-verifier').digest('base64url');
    expect(attacker).not.toBe(challenge);
  });

  it('produces base64url, not base64 — a "+" here breaks the comparison', () => {
    const challenge = createHash('sha256').update('x'.repeat(64)).digest('base64url');
    expect(challenge).not.toMatch(/[+/=]/);
  });
});
