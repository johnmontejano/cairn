import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { resetConfig } from '@cairn/config';
import {
  CONNECTOR_DESCRIPTIONS,
  FixtureGoogleDriveConnector,
  FixtureMemoryMirror,
  assertPublicUrl,
  createAppJwt,
  isPrivateAddress,
  verifyGitHubSignature,
} from '@cairn/connectors';

afterEach(() => {
  delete process.env.CAIRN_ALLOW_INSECURE_URL_IMPORT;
  resetConfig();
});

describe('URL import refuses to be a request-forgery tool', () => {
  it('recognises private and reserved addresses', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it('allows ordinary public addresses', () => {
    for (const address of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  async function refusal(url: string): Promise<{ message: string; userMessage: string }> {
    try {
      await assertPublicUrl(url);
      throw new Error(`expected ${url} to be refused`);
    } catch (error) {
      const domain = error as { message: string; userMessage?: string };
      expect(domain.userMessage, `${url} needs a plain-language reason`).toBeTruthy();
      return { message: domain.message, userMessage: domain.userMessage! };
    }
  }

  it('rejects non-http schemes', async () => {
    expect((await refusal('file:///etc/passwd')).message).toMatch(/blocked protocol/i);
    expect((await refusal('gopher://example.com')).userMessage).toMatch(/only web addresses/i);
  });

  it('rejects plain http by default', async () => {
    expect((await refusal('http://example.com')).userMessage).toMatch(/secure addresses/i);
  });

  it('rejects a URL that resolves to a private address', async () => {
    expect((await refusal('https://localhost/secrets')).message).toMatch(
      /blocked private address/i,
    );
    expect((await refusal('https://127.0.0.1/secrets')).userMessage).toMatch(/private network/i);
  });

  it('rejects ports used by internal services', async () => {
    expect((await refusal('https://example.com:5432/')).message).toMatch(/blocked port/i);
  });
});

describe('GitHub webhook signatures', () => {
  const secret = 'a-webhook-secret';
  const body = JSON.stringify({ action: 'push', repository: { full_name: 'demo/demo' } });
  // Computed independently of the implementation.
  const validSignature = `sha256=${require('node:crypto')
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')}`;

  it('accepts a correct signature', () => {
    expect(verifyGitHubSignature(secret, body, validSignature)).toBe(true);
  });

  it('rejects a wrong signature, a wrong secret, and a tampered body', () => {
    expect(verifyGitHubSignature(secret, body, `sha256=${'0'.repeat(64)}`)).toBe(false);
    expect(verifyGitHubSignature('other-secret', body, validSignature)).toBe(false);
    expect(verifyGitHubSignature(secret, `${body} `, validSignature)).toBe(false);
  });

  it('rejects a missing or malformed header rather than throwing', () => {
    expect(verifyGitHubSignature(secret, body, null)).toBe(false);
    expect(verifyGitHubSignature(secret, body, 'sha1=abc')).toBe(false);
    expect(verifyGitHubSignature(secret, body, 'sha256=short')).toBe(false);
  });
});

describe('GitHub app authentication', () => {
  it('signs a short-lived RS256 JWT', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const token = createAppJwt(
      { appId: '12345', privateKeyPem: pem, webhookSecret: 'x' },
      1_700_000_000_000,
    );

    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toMatchObject({
      alg: 'RS256',
    });
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    expect(claims.iss).toBe('12345');
    expect(claims.exp - claims.iat).toBe(540);
    expect(signature!.length).toBeGreaterThan(100);
  });
});

describe('connectors without credentials', () => {
  it('report setup-required rather than pretending to work', () => {
    expect(new FixtureGoogleDriveConnector().status()).toBe('setup-required');
  });

  it('still return usable sample documents so the pipeline can be exercised', async () => {
    const { items } = await new FixtureGoogleDriveConnector().list();
    expect(items.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(items[0]!.bytes)).toContain('#');
  });

  it('describe what they read in ordinary language, and promise read-only', () => {
    for (const description of Object.values(CONNECTOR_DESCRIPTIONS)) {
      expect(description.readOnly).toBe(true);
      expect(description.permissionSummary.length).toBeGreaterThan(20);
      expect(description.disconnectSummary.length).toBeGreaterThan(20);
      // No jargon in what a person reads before connecting.
      expect(description.summary.toLowerCase()).not.toMatch(/oauth|scope|token|api|webhook/);
    }
  });

  it('record what a mirror would have pushed, without pushing', async () => {
    const mirror = new FixtureMemoryMirror();
    const result = await mirror.push({
      target: { installationId: '1', owner: 'o', repo: 'r', branch: 'main' },
      files: [{ path: 'memory/DECISIONS.md', content: '# Decisions' }],
      message: 'Update memory',
    });
    expect(result.pushed).toBe(1);
    expect(mirror.pushes).toHaveLength(1);
  });
});
