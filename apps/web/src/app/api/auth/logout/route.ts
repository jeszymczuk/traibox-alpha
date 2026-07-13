import { NextRequest, NextResponse } from 'next/server';

import { revokeProviderSession } from '../../../../server/browser-security/auth';
import { browserSecurityConfig } from '../../../../server/browser-security/config';
import { clearSessionCookies, noStore, requestSessionId, securityErrorResponse } from '../../../../server/browser-security/http';
import { assertSameOrigin } from '../../../../server/browser-security/origin';
import { browserSessionManager } from '../../../../server/browser-security/session';

export async function POST(request: NextRequest) {
  const rawSessionId = requestSessionId(request);
  try {
    const config = browserSecurityConfig();
    assertSameOrigin(request, config.allowedOrigins);
    const manager = browserSessionManager();
    const session = await manager.authenticate(rawSessionId);
    manager.validateCsrf(session, request.headers.get('x-csrf-token'));
    let providerError: unknown;
    try {
      await revokeProviderSession(session);
    } catch (error) {
      providerError = error;
    }
    await manager.revoke(rawSessionId);
    const response = noStore(NextResponse.json({ ok: true, provider_logout_confirmed: !providerError }));
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return securityErrorResponse(error);
  }
}
