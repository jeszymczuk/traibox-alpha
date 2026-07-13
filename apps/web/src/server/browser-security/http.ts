import { NextRequest, NextResponse } from 'next/server';

import { browserSecurityConfig } from './config';
import type { BrowserSecurityConfig } from './config';
import { BrowserSecurityError } from './origin';
import type { CreatedBrowserSession } from './session';

const DEV_COOKIE = 'traibox_session';
const SECURE_COOKIE = '__Host-traibox_session';

export function sessionCookieName(): string {
  return cookieContract(browserSecurityConfig(), null).name;
}

export function cookieContract(config: BrowserSecurityConfig, session: CreatedBrowserSession | null) {
  return {
    name: config.production ? SECURE_COOKIE : DEV_COOKIE,
    options: {
      httpOnly: true as const,
      secure: config.production,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: session ? Math.max(1, Math.floor((session.absoluteExpiresAt.getTime() - Date.now()) / 1000)) : 0
    }
  };
}

export function requestSessionId(request: NextRequest): string | null {
  return request.cookies.get(SECURE_COOKIE)?.value ?? request.cookies.get(DEV_COOKIE)?.value ?? null;
}

export function attachSessionCookie(
  response: NextResponse,
  session: CreatedBrowserSession,
  config: BrowserSecurityConfig = browserSecurityConfig()
): void {
  const contract = cookieContract(config, session);
  response.cookies.set(contract.name, session.rawSessionId, contract.options);
}

export function clearSessionCookies(response: NextResponse): void {
  for (const name of [SECURE_COOKIE, DEV_COOKIE]) {
    response.cookies.set(name, '', { httpOnly: true, secure: name === SECURE_COOKIE, sameSite: 'lax', path: '/', maxAge: 0 });
  }
}

export function noStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

export function securityErrorResponse(error: unknown): NextResponse {
  const status = error instanceof BrowserSecurityError ? error.status : 500;
  const code = error instanceof BrowserSecurityError ? error.code : 'browser_boundary_error';
  const message = status >= 500 ? 'The secure browser boundary could not complete the request' : error instanceof Error ? error.message : 'Request rejected';
  return noStore(NextResponse.json({ error: code, message }, { status }));
}
