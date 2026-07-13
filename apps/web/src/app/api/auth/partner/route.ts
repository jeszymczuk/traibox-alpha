import { NextRequest, NextResponse } from 'next/server';

import { browserSecurityConfig } from '../../../../server/browser-security/config';
import { attachSessionCookie, noStore, requestSessionId, securityErrorResponse } from '../../../../server/browser-security/http';
import { assertSameOrigin, BrowserSecurityError } from '../../../../server/browser-security/origin';
import { browserSessionManager } from '../../../../server/browser-security/session';

export async function POST(request: NextRequest) {
  try {
    const config = browserSecurityConfig();
    assertSameOrigin(request, config.allowedOrigins);
    const manager = browserSessionManager();
    const previous = requestSessionId(request);
    if (previous) {
      const existing = await manager.authenticate(previous);
      manager.validateCsrf(existing, request.headers.get('x-csrf-token'));
    }
    const body = (await request.json()) as { api_key?: unknown };
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (apiKey.length < 10 || apiKey.length > 512) throw new BrowserSecurityError(400, 'invalid_partner_key', 'Partner sign-in key is invalid');
    const upstream = await fetch(new URL('/v1/partners/auth/token', config.apiBaseUrl.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });
    if (!upstream.ok) throw new BrowserSecurityError(401, 'partner_sign_in_failed', 'Partner sign-in failed');
    const result = (await upstream.json()) as { access_token?: string; partner_id?: string };
    if (!result.access_token || !result.partner_id) throw new BrowserSecurityError(502, 'partner_sign_in_failed', 'Partner sign-in failed');
    const session = await manager.create(
      { kind: 'partner', principalId: result.partner_id, display: { partner_id: result.partner_id }, credential: result.access_token },
      previous
    );
    const response = noStore(NextResponse.json({ partner_id: result.partner_id, csrf_token: session.csrfToken }));
    attachSessionCookie(response, session);
    return response;
  } catch (error) {
    return securityErrorResponse(error);
  }
}
