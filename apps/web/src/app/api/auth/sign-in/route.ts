import { NextRequest, NextResponse } from 'next/server';

import { beginSupabaseSignIn } from '../../../../server/browser-security/auth';
import { browserSecurityConfig } from '../../../../server/browser-security/config';
import { noStore, securityErrorResponse } from '../../../../server/browser-security/http';
import { assertSameOrigin, requestOrigin, safeReturnPath } from '../../../../server/browser-security/origin';

export async function POST(request: NextRequest) {
  try {
    const config = browserSecurityConfig();
    if (config.authMode !== 'supabase') return noStore(NextResponse.json({ error: 'auth_mode_disabled' }, { status: 404 }));
    assertSameOrigin(request, config.allowedOrigins);
    const body = (await request.json()) as { email?: unknown; return_to?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return noStore(NextResponse.json({ error: 'invalid_email' }, { status: 400 }));
    await beginSupabaseSignIn({ email, origin: requestOrigin(request)!, returnPath: safeReturnPath(body.return_to) });
    return noStore(NextResponse.json({ ok: true }));
  } catch (error) {
    return securityErrorResponse(error);
  }
}
