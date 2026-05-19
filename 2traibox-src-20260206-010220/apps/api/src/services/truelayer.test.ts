import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';

import { buildAuthorizeUrl, createPkcePair, decryptJson, encryptJson, verifyWebhookSignature } from './truelayer.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('truelayer helpers', () => {
  it('builds authorize url under /connect/authorize', () => {
    const url = buildAuthorizeUrl({
      authBaseUrl: 'https://auth.truelayer.com',
      clientId: 'client',
      redirectUri: 'https://example.com/cb',
      scopes: ['info', 'accounts'],
      state: 'state-1',
      codeChallenge: 'challenge'
    });
    expect(url).toContain('https://auth.truelayer.com/connect/authorize');
    expect(url).toContain('response_type=code');
    expect(url).toContain('client_id=client');
    expect(url).toContain('redirect_uri=');
  });

  it('generates a valid PKCE pair', () => {
    const { code_verifier, code_challenge } = createPkcePair();
    expect(code_verifier.length).toBeGreaterThan(10);
    expect(code_challenge.length).toBeGreaterThan(10);
    // base64url charset
    expect(code_verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code_challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encryptJson/decryptJson roundtrips when key set', () => {
    process.env.TOKENS_ENCRYPTION_KEY = 'test-key';
    const payload = { a: 1, b: 'two' };
    const enc = encryptJson(payload);
    expect(enc.v).toBe(1);
    const dec = decryptJson(enc as any);
    expect(dec).toEqual(payload);
  });

  it('encryptJson falls back to plaintext when key not set', () => {
    delete process.env.TOKENS_ENCRYPTION_KEY;
    const payload = { ok: true };
    const enc = encryptJson(payload);
    expect(enc).toEqual({ v: 0, alg: 'PLAINTEXT', data: payload });
    const dec = decryptJson(enc as any);
    expect(dec).toEqual(payload);
  });

  it('verifies webhook signature (HMAC SHA-256 of raw body)', () => {
    const secret = 'shh';
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(verifyWebhookSignature({ rawBody, secret, headerValue: expected })).toBe(true);
    expect(verifyWebhookSignature({ rawBody, secret, headerValue: `sha256=${expected}` })).toBe(true);
    expect(verifyWebhookSignature({ rawBody, secret, headerValue: `v1=${expected}` })).toBe(true);
    expect(verifyWebhookSignature({ rawBody, secret, headerValue: `t=123,v1=${expected}` })).toBe(true);
    expect(verifyWebhookSignature({ rawBody, secret, headerValue: 'bad' })).toBe(false);
  });
});

