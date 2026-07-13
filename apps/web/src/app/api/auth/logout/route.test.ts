import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserSecurityError } from '../../../../server/browser-security/origin';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  validateCsrf: vi.fn(),
  revoke: vi.fn(),
  revokeProvider: vi.fn(),
  order: [] as string[]
}));

vi.mock('../../../../server/browser-security/config', () => ({
  browserSecurityConfig: () => ({ allowedOrigins: new Set(['https://app.example']) })
}));

vi.mock('../../../../server/browser-security/session', () => ({
  browserSessionManager: () => ({
    authenticate: mocks.authenticate,
    validateCsrf: mocks.validateCsrf,
    revoke: mocks.revoke
  })
}));

vi.mock('../../../../server/browser-security/auth', () => ({
  revokeProviderSession: mocks.revokeProvider
}));

import { POST } from './route';

const rawSessionId = 'session-id-with-at-least-thirty-two-random-characters';
const session = {
  rawSessionId,
  kind: 'user',
  principalId: 'user-id',
  credential: 'server-held-provider-credential',
  csrfToken: 'csrf-token'
};

function request(csrfToken: string | null = session.csrfToken) {
  const headers: Record<string, string> = {
    Origin: 'https://app.example',
    Cookie: `__Host-traibox_session=${rawSessionId}`
  };
  if (csrfToken !== null) headers['x-csrf-token'] = csrfToken;
  return new NextRequest('https://app.example/api/auth/logout', { method: 'POST', headers });
}

function expectCookiesCleared(response: Response) {
  const cookies = response.headers.get('set-cookie') ?? '';
  expect(cookies).toContain('__Host-traibox_session=');
  expect(cookies).toContain('traibox_session=');
  expect(cookies).toMatch(/max-age=0/i);
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.authenticate.mockResolvedValue(session);
    mocks.validateCsrf.mockReturnValue(undefined);
    mocks.revoke.mockImplementation(async () => {
      mocks.order.push('local-revoke');
    });
    mocks.revokeProvider.mockImplementation(async () => {
      mocks.order.push('provider-logout');
    });
  });

  it('revokes locally and prepares cookie clearing before a delayed provider request resolves', async () => {
    let releaseLocalRevoke!: () => void;
    const localRevokePending = new Promise<void>((resolve) => {
      releaseLocalRevoke = resolve;
    });
    let releaseProvider!: () => void;
    const providerPending = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    mocks.revoke.mockImplementation(async () => {
      mocks.order.push('local-revoke');
      await localRevokePending;
    });
    mocks.revokeProvider.mockImplementation(async () => {
      mocks.order.push('provider-logout');
      await providerPending;
    });

    const responsePending = POST(request());
    await vi.waitFor(() => expect(mocks.revoke).toHaveBeenCalledOnce());
    expect(mocks.revokeProvider).not.toHaveBeenCalled();

    releaseLocalRevoke();
    await vi.waitFor(() => expect(mocks.revokeProvider).toHaveBeenCalledOnce());

    expect(mocks.order).toEqual(['local-revoke', 'provider-logout']);
    expect(mocks.revoke).toHaveBeenCalledWith(rawSessionId);

    releaseProvider();
    const response = await responsePending;
    expect(await response.json()).toEqual({ ok: true, local_logout_completed: true, provider_logout_confirmed: true });
    expectCookiesCleared(response);
  });

  it.each([
    ['provider timeout', new DOMException('Provider request timed out', 'TimeoutError'), false],
    ['provider 5xx', new BrowserSecurityError(502, 'provider_logout_failed', 'Provider logout failed'), false],
    ['provider success', null, true]
  ])('keeps the local session revoked after %s', async (_label, providerError, providerConfirmed) => {
    mocks.revokeProvider.mockImplementation(async () => {
      mocks.order.push('provider-logout');
      if (providerError) throw providerError;
    });

    const response = await POST(request());

    expect(mocks.order).toEqual(['local-revoke', 'provider-logout']);
    expect(mocks.revoke).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({ ok: true, local_logout_completed: true, provider_logout_confirmed: providerConfirmed });
    expectCookiesCleared(response);
  });

  it.each([
    ['missing', null, 'missing_csrf'],
    ['invalid', 'wrong-token', 'invalid_csrf']
  ])('fails closed for %s CSRF without revoking or clearing cookies', async (_label, csrfToken, code) => {
    mocks.validateCsrf.mockImplementation(() => {
      throw new BrowserSecurityError(403, code, 'CSRF validation failed');
    });

    const response = await POST(request(csrfToken));

    expect(response.status).toBe(403);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.revokeProvider).not.toHaveBeenCalled();
    expect(response.headers.has('set-cookie')).toBe(false);
  });

  it('clears a stale local session cookie after same-origin authentication fails', async () => {
    mocks.authenticate.mockRejectedValue(new BrowserSecurityError(401, 'invalid_session', 'Authentication required'));

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.revokeProvider).not.toHaveBeenCalled();
    expectCookiesCleared(response);
  });
});
