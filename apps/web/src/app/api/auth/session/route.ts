import { NextRequest, NextResponse } from 'next/server';

import { refreshSupabaseSession } from '../../../../server/browser-security/auth';
import { browserSecurityConfig } from '../../../../server/browser-security/config';
import { attachSessionCookie, noStore, requestSessionId } from '../../../../server/browser-security/http';
import { browserSessionManager } from '../../../../server/browser-security/session';

export async function GET(request: NextRequest) {
  const config = browserSecurityConfig();
  try {
    let session = await browserSessionManager().authenticate(requestSessionId(request));
    let rotated = false;
    if (session.kind === 'user' && session.credentialExpiresAt && session.credentialExpiresAt.getTime() <= Date.now() + 60_000) {
      session = await refreshSupabaseSession(session);
      rotated = true;
    }
    const response = noStore(
      NextResponse.json({
        authenticated: true,
        kind: session.kind,
        user: session.display,
        csrf_token: session.csrfToken,
        expires_at: session.absoluteExpiresAt.toISOString()
      })
    );
    if (rotated) attachSessionCookie(response, session);
    return response;
  } catch {
    return noStore(NextResponse.json({ authenticated: false, dev_auth_available: config.authMode === 'dev' && config.devAuthEnabled }, { status: 401 }));
  }
}
