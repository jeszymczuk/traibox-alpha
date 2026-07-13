import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

import { refreshSupabaseSession } from './auth';
import { browserSecurityConfig, type BrowserSecurityConfig } from './config';
import { attachSessionCookie, noStore, requestSessionId, securityErrorResponse } from './http';
import { assertSameOrigin, BrowserSecurityError } from './origin';
import { resolveBffRoute, sanitizedQuery, type BffPrincipal } from './registry';
import { browserSessionManager, type ActiveBrowserSession, type BrowserSessionManager, type CreatedBrowserSession } from './session';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

type ProxyDependencies = {
  config?: BrowserSecurityConfig;
  manager?: Pick<BrowserSessionManager, 'authenticate' | 'validateCsrf'>;
  refreshSession?: (session: ActiveBrowserSession) => Promise<CreatedBrowserSession>;
  transport?: typeof fetch;
};

function principalAllowed(principal: BffPrincipal, session: ActiveBrowserSession | null): boolean {
  if (principal === 'public') return true;
  if (!session) return false;
  if (principal === 'user') return session.kind === 'user' || session.kind === 'dev';
  return session.kind === principal;
}

export function buildUpstreamHeaders(input: {
  browserHeaders: Headers;
  credential?: string;
  organization?: string | null;
  traceId: string;
}): Headers {
  const headers = new Headers({ Accept: input.browserHeaders.get('accept') ?? '*/*', 'X-Trace-Id': input.traceId });
  if (input.credential) headers.set('Authorization', `Bearer ${input.credential}`);
  if (input.organization) headers.set('X-Org-Id', input.organization);
  const contentType = input.browserHeaders.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  for (const name of ['x-idempotency-key', 'x-locale', 'last-event-id']) {
    const value = input.browserHeaders.get(name);
    if (value && value.length <= 256 && !/[\r\n\0]/.test(value)) headers.set(name, value);
  }
  return headers;
}

async function requestBody(request: NextRequest, limit: number): Promise<Uint8Array | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return undefined;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > limit) throw new BrowserSecurityError(413, 'request_too_large', 'Request body is too large');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BrowserSecurityError(413, 'request_too_large', 'Request body is too large');
    }
    chunks.push(next.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function safeFilenameDisposition(value: string | null): string {
  const fallback = 'attachment; filename="download"';
  if (!value || /[\r\n\0]/.test(value)) return fallback;
  const match = /filename\*?=(?:UTF-8''|"?)([^";]+)/i.exec(value);
  if (!match?.[1]) return fallback;
  let filename: string;
  try {
    filename = decodeURIComponent(match[1]);
  } catch {
    filename = match[1];
  }
  filename = filename.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 160) || 'download';
  return `attachment; filename="${filename}"`;
}

export function normalizedUpstreamError(status: number, traceId: string): { status: number; body: Record<string, string> } {
  const normalized = status === 401 ? 401 : status === 403 ? 403 : status === 404 ? 404 : status === 409 ? 409 : status >= 500 ? 502 : 400;
  return { status: normalized, body: { error: 'upstream_request_rejected', message: 'The application API rejected the request', trace_id: traceId } };
}

function safeUpstreamError(status: number, traceId: string): NextResponse {
  const safe = normalizedUpstreamError(status, traceId);
  return noStore(NextResponse.json(safe.body, { status: safe.status }));
}

function attachRotation(response: NextResponse, session: CreatedBrowserSession | null, config: BrowserSecurityConfig | undefined): NextResponse {
  if (!session || !config) return response;
  attachSessionCookie(response, session, config);
  response.headers.set('X-CSRF-Token', session.csrfToken);
  return response;
}

export async function proxyBrowserRequest(
  request: NextRequest,
  rawSegments: readonly string[],
  dependencies: ProxyDependencies = {}
): Promise<NextResponse> {
  let rotatedSession: CreatedBrowserSession | null = null;
  let responseConfig: BrowserSecurityConfig | undefined;
  const finalize = (response: NextResponse) => attachRotation(response, rotatedSession, responseConfig);
  try {
    const { route, path } = resolveBffRoute(request.method, rawSegments);
    const config = dependencies.config ?? browserSecurityConfig();
    responseConfig = config;
    const manager = dependencies.manager ?? browserSessionManager();
    const refreshSession = dependencies.refreshSession ?? refreshSupabaseSession;
    const transport = dependencies.transport ?? globalThis.fetch;
    let session: ActiveBrowserSession | null = null;
    if (route.principal !== 'public') session = await manager.authenticate(requestSessionId(request));
    if (!principalAllowed(route.principal, session)) throw new BrowserSecurityError(403, 'session_scope_mismatch', 'Session is not valid for this route');
    if (session && UNSAFE_METHODS.has(request.method)) {
      assertSameOrigin(request, config.allowedOrigins);
      manager.validateCsrf(session, request.headers.get('x-csrf-token'));
    }

    if (session?.kind === 'user' && session.credentialExpiresAt && session.credentialExpiresAt.getTime() <= Date.now() + 60_000) {
      session = await refreshSession(session);
      rotatedSession = session;
    }

    const query = sanitizedQuery(route, request.nextUrl.searchParams);
    const orgSelector = request.headers.get('x-org-id') ?? query.get('org_id');
    query.delete('org_id');
    if (orgSelector && (!/^[0-9a-f-]{36}$/i.test(orgSelector) || /[\r\n]/.test(orgSelector))) {
      throw new BrowserSecurityError(400, 'invalid_organization', 'Organization selector is invalid');
    }

    const target = new URL(path, config.apiBaseUrl);
    target.search = query.toString();
    const traceId = request.headers.get('x-trace-id')?.match(/^[A-Za-z0-9_-]{8,80}$/)?.[0] ?? `trc_${randomUUID()}`;
    const headers = buildUpstreamHeaders({ browserHeaders: request.headers, credential: session?.credential, organization: orgSelector, traceId });

    const body = await requestBody(request, config.maxRequestBytes);
    const timeout = route.response === 'sse' ? 6 * 60 * 60_000 : config.requestTimeoutMs;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(timeout)]);
    const upstream = await transport(target, { method: request.method, headers, body: body ? Buffer.from(body) : undefined, cache: 'no-store', redirect: 'error', signal });
    if (!upstream.ok) return finalize(safeUpstreamError(upstream.status, traceId));

    const responseHeaders = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Trace-Id': upstream.headers.get('x-trace-id') ?? traceId
    });
    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) responseHeaders.set('Content-Type', upstreamContentType);
    if (route.response === 'sse') {
      responseHeaders.set('Content-Type', 'text/event-stream');
      responseHeaders.set('Connection', 'keep-alive');
      responseHeaders.set('X-Accel-Buffering', 'no');
    }
    if (route.response === 'file') responseHeaders.set('Content-Disposition', safeFilenameDisposition(upstream.headers.get('content-disposition')));
    const response = new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
    return finalize(response);
  } catch (error) {
    if (error instanceof Error && ['invalid_bff_path', 'unregistered_bff_route'].includes(error.message)) {
      return finalize(noStore(NextResponse.json({ error: error.message }, { status: 404 })));
    }
    if (error instanceof Error && ['credential_query_rejected', 'unregistered_bff_query', 'invalid_bff_query'].includes(error.message)) {
      return finalize(noStore(NextResponse.json({ error: error.message }, { status: 400 })));
    }
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return finalize(noStore(NextResponse.json({ error: 'upstream_timeout' }, { status: 504 })));
    }
    return finalize(securityErrorResponse(error));
  }
}
