import { NextRequest, NextResponse } from 'next/server';

import { completeSupabaseSignIn } from '../../../../server/browser-security/auth';
import { attachSessionCookie, noStore, requestSessionId } from '../../../../server/browser-security/http';

export async function GET(request: NextRequest) {
  try {
    const result = await completeSupabaseSignIn({
      state: request.nextUrl.searchParams.get('state') ?? '',
      code: request.nextUrl.searchParams.get('code') ?? '',
      previousSessionId: requestSessionId(request)
    });
    const response = noStore(NextResponse.redirect(new URL(result.returnPath, request.nextUrl.origin), 303));
    attachSessionCookie(response, result.session);
    return response;
  } catch {
    return noStore(NextResponse.redirect(new URL('/login?error=invalid_callback', request.nextUrl.origin), 303));
  }
}
