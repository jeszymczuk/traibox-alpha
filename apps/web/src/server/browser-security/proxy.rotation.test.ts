import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

import type { BrowserSecurityConfig } from './config';
import { proxyBrowserRequest } from './proxy';
import type { ActiveBrowserSession, CreatedBrowserSession } from './session';

const config: BrowserSecurityConfig = {
  apiBaseUrl: new URL('https://api.internal.example'),
  allowedOrigins: new Set(['https://app.example']),
  authMode: 'supabase',
  sessionDatabaseUrl: 'postgres://traibox_browser_session:test@localhost/traibox',
  devAuthEnabled: false,
  idleTtlMs: 30 * 60_000,
  absoluteTtlMs: 12 * 60 * 60_000,
  keyring: [{ id: 'test', key: Buffer.alloc(32) }],
  production: true,
  requestTimeoutMs: 1000,
  maxRequestBytes: 1024,
  supabaseUrl: new URL('https://project.supabase.co'),
  supabaseAnonKey: 'anon'
};

const baseStoredSession = {
  sessionIdHash: 'a'.repeat(64),
  kind: 'user' as const,
  principalId: 'user-1',
  display: {},
  scope: {},
  credentialCiphertext: 'sealed-old',
  refreshCiphertext: 'sealed-refresh',
  credentialExpiresAt: new Date(0),
  csrfTokenHash: 'b'.repeat(64),
  csrfCiphertext: 'sealed-csrf',
  createdAt: new Date(),
  lastSeenAt: new Date(),
  idleExpiresAt: new Date(Date.now() + 60_000),
  absoluteExpiresAt: new Date(Date.now() + 10 * 60_000),
  revokedAt: null,
  replacedByHash: null
};

const previous: ActiveBrowserSession = {
  ...baseStoredSession,
  rawSessionId: 'previous-session-id-that-is-long-enough-for-authentication',
  credential: 'old-access',
  refreshCredential: 'old-refresh',
  csrfToken: 'old-csrf'
};

const replacement: CreatedBrowserSession = {
  ...baseStoredSession,
  sessionIdHash: 'c'.repeat(64),
  credentialCiphertext: 'sealed-new',
  csrfTokenHash: 'd'.repeat(64),
  rawSessionId: 'replacement-session-id-that-must-reach-the-browser',
  credential: 'new-access',
  refreshCredential: 'new-refresh',
  csrfToken: 'replacement-csrf-token'
};

const manager = {
  authenticate: vi.fn(async () => previous),
  validateCsrf: vi.fn()
};

function browserRequest(path = 'v1/orgs'): NextRequest {
  return new NextRequest(`https://app.example/api/bff/${path}`, {
    headers: { Cookie: `__Host-traibox_session=${previous.rawSessionId}` }
  });
}

async function runWithTransport(transport: typeof fetch, path = 'v1/orgs') {
  const segments = path.split('?')[0]!.split('/');
  return proxyBrowserRequest(browserRequest(path), segments, {
    config,
    manager,
    refreshSession: async () => replacement,
    transport
  });
}

function expectReplacementCredentials(response: Response): void {
  expect(response.headers.get('set-cookie')).toContain(replacement.rawSessionId);
  expect(response.headers.get('x-csrf-token')).toBe(replacement.csrfToken);
}

describe('rotated browser session response safety', () => {
  it('returns the replacement cookie and CSRF token on upstream success', async () => {
    const response = await runWithTransport(vi.fn(async () => new Response('{}', { status: 200 })) as typeof fetch);
    expect(response.status).toBe(200);
    expectReplacementCredentials(response);
  });

  it.each([
    [400, 400],
    [401, 401],
    [403, 403],
    [409, 409],
    [500, 502]
  ])('returns the replacement credentials for upstream %i', async (upstreamStatus, browserStatus) => {
    const response = await runWithTransport(vi.fn(async () => new Response('rejected', { status: upstreamStatus })) as typeof fetch);
    expect(response.status).toBe(browserStatus);
    expectReplacementCredentials(response);
  });

  it('returns the replacement credentials on timeout', async () => {
    const response = await runWithTransport(
      vi.fn(async () => {
        throw new DOMException('timed out', 'TimeoutError');
      }) as typeof fetch
    );
    expect(response.status).toBe(504);
    expectReplacementCredentials(response);
  });

  it('returns the replacement credentials on a network exception', async () => {
    const response = await runWithTransport(
      vi.fn(async () => {
        throw new Error('network unavailable');
      }) as typeof fetch
    );
    expect(response.status).toBe(500);
    expectReplacementCredentials(response);
  });

  it('returns the replacement credentials when SSE setup fails', async () => {
    const response = await runWithTransport(
      vi.fn(async () => {
        throw new Error('SSE connection failed before headers');
      }) as typeof fetch,
      'v1/events?org_id=00000000-0000-0000-0000-000000000001'
    );
    expect(response.status).toBe(500);
    expectReplacementCredentials(response);
  });
});
