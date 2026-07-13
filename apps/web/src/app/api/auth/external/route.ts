import { NextRequest, NextResponse } from 'next/server';

import { browserSecurityConfig } from '../../../../server/browser-security/config';
import { attachSessionCookie, noStore, requestSessionId } from '../../../../server/browser-security/http';
import { BrowserSecurityError } from '../../../../server/browser-security/origin';
import { browserSessionManager } from '../../../../server/browser-security/session';

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token') ?? '';
    if (token.length < 20 || token.length > 512) throw new BrowserSecurityError(401, 'invalid_exchange', 'External access exchange is invalid');
    const config = browserSecurityConfig();
    const upstream = await fetch(new URL('/v1/external-participants/exchange', config.apiBaseUrl.origin), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });
    if (!upstream.ok) throw new BrowserSecurityError(401, 'invalid_exchange', 'External access exchange is invalid or expired');
    const result = (await upstream.json()) as {
      access_token?: string;
      expires_at?: string | null;
      session?: {
        participant?: Record<string, unknown>;
        allowed_actions?: unknown[];
        scopes?: unknown[];
        grant?: { object_id?: string };
      };
    };
    if (!result.access_token || !result.session) throw new BrowserSecurityError(502, 'invalid_exchange', 'External access exchange failed closed');
    const providerExpiry = result.expires_at ? new Date(result.expires_at) : new Date(Date.now() + 24 * 60 * 60_000);
    const absoluteExpiry = new Date(Math.min(providerExpiry.getTime(), Date.now() + 24 * 60 * 60_000));
    if (!Number.isFinite(absoluteExpiry.getTime()) || absoluteExpiry.getTime() <= Date.now()) throw new BrowserSecurityError(401, 'invalid_exchange', 'External access exchange is invalid or expired');
    const manager = browserSessionManager();
    await manager.consumeExternalExchange(token, absoluteExpiry);
    const session = await manager.create(
      {
        kind: 'external',
        principalId: result.session.grant?.object_id ?? 'external-participant',
        display: result.session.participant ?? {},
        scope: { actions: result.session.allowed_actions ?? [], scopes: result.session.scopes ?? [] },
        credential: result.access_token,
        absoluteExpiresAt: absoluteExpiry
      },
      requestSessionId(request)
    );
    const response = noStore(NextResponse.redirect(new URL('/external-access', request.nextUrl.origin), 303));
    attachSessionCookie(response, session);
    return response;
  } catch {
    return noStore(NextResponse.redirect(new URL('/external-access?error=invalid_or_used', request.nextUrl.origin), 303));
  }
}
