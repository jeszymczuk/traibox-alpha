import { NextRequest, NextResponse } from 'next/server';

import { browserSecurityConfig } from '../../../../server/browser-security/config';
import { attachSessionCookie, noStore, requestSessionId, securityErrorResponse } from '../../../../server/browser-security/http';
import { assertSameOrigin, BrowserSecurityError } from '../../../../server/browser-security/origin';
import { browserSessionManager } from '../../../../server/browser-security/session';

export async function POST(request: NextRequest) {
  try {
    const config = browserSecurityConfig();
    assertSameOrigin(request, config.allowedOrigins);
    if (config.authMode !== 'dev' || !config.devAuthEnabled) return noStore(NextResponse.json({ error: 'not_found' }, { status: 404 }));
    const userId = process.env.DEV_USER_ID;
    if (!userId) throw new BrowserSecurityError(503, 'dev_auth_misconfigured', 'Development authentication is not configured');
    const session = await browserSessionManager().create(
      { kind: 'dev', principalId: userId, display: { email: 'dev@local' }, credential: 'dev' },
      requestSessionId(request)
    );
    const response = noStore(NextResponse.json({ ok: true, csrf_token: session.csrfToken }));
    attachSessionCookie(response, session);
    return response;
  } catch (error) {
    return securityErrorResponse(error);
  }
}
