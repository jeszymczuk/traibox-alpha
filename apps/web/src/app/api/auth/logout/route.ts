import { NextRequest, NextResponse } from 'next/server';

import { revokeProviderSession } from '../../../../server/browser-security/auth';
import { browserSecurityConfig } from '../../../../server/browser-security/config';
import { clearSessionCookies, noStore, requestSessionId, securityErrorResponse } from '../../../../server/browser-security/http';
import { assertSameOrigin, BrowserSecurityError } from '../../../../server/browser-security/origin';
import { browserSessionManager } from '../../../../server/browser-security/session';

export async function POST(request: NextRequest) {
  const rawSessionId = requestSessionId(request);
  let originValidated = false;
  try {
    const config = browserSecurityConfig();
    assertSameOrigin(request, config.allowedOrigins);
    originValidated = true;
    const manager = browserSessionManager();
    const session = await manager.authenticate(rawSessionId);
    manager.validateCsrf(session, request.headers.get('x-csrf-token'));

    await manager.revoke(session.rawSessionId);
    const preparedResponse = new NextResponse(null);
    clearSessionCookies(preparedResponse);

    let providerLogoutConfirmed = true;
    try {
      await revokeProviderSession(session);
    } catch {
      providerLogoutConfirmed = false;
    }
    return noStore(
      NextResponse.json(
        { ok: true, local_logout_completed: true, provider_logout_confirmed: providerLogoutConfirmed },
        { headers: preparedResponse.headers }
      )
    );
  } catch (error) {
    const response = securityErrorResponse(error);
    if (originValidated && error instanceof BrowserSecurityError && error.status === 401) clearSessionCookies(response);
    return response;
  }
}
