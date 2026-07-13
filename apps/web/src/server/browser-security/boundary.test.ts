import { describe, expect, it } from 'vitest';

import type { BrowserSecurityConfig } from './config';
import { loadBrowserSecurityConfig } from './config';
import { cookieContract } from './http';
import { assertSameOrigin, safeReturnPath } from './origin';
import { buildUpstreamHeaders, normalizedUpstreamError } from './proxy';
import { resolveBffRoute, sanitizedQuery } from './registry';
import { api } from '../../lib/api';

const config = (production: boolean): BrowserSecurityConfig => ({
  apiBaseUrl: new URL('https://api.internal.example'),
  allowedOrigins: new Set(['https://app.example']),
  authMode: 'supabase',
  databaseUrl: 'postgres://test',
  devAuthEnabled: false,
  idleTtlMs: 1000,
  absoluteTtlMs: 2000,
  keyring: [{ id: 'test', key: Buffer.alloc(32) }],
  production,
  requestTimeoutMs: 1000,
  maxRequestBytes: 1024,
  supabaseUrl: new URL('https://project.supabase.co'),
  supabaseAnonKey: 'anon'
});

describe('browser boundary controls', () => {
  it('rejects unsafe return paths and preserves safe same-origin paths', () => {
    expect(safeReturnPath('/trades?tab=open')).toBe('/trades?tab=open');
    expect(safeReturnPath('https://evil.example/steal')).toBe('/');
    expect(safeReturnPath('//evil.example/steal')).toBe('/');
    expect(safeReturnPath('/api/auth/logout')).toBe('/');
  });

  it('requires exact same-origin unsafe requests with Referer as a bounded fallback', () => {
    expect(() => assertSameOrigin(new Request('https://app.example/api', { headers: { Origin: 'https://app.example' } }), config(true).allowedOrigins)).not.toThrow();
    expect(() => assertSameOrigin(new Request('https://app.example/api', { headers: { Referer: 'https://app.example/form' } }), config(true).allowedOrigins)).not.toThrow();
    expect(() => assertSameOrigin(new Request('https://app.example/api', { headers: { Origin: 'https://evil.example' } }), config(true).allowedOrigins)).toThrow();
  });

  it('uses host-only HttpOnly secure cookies in production and bounded local cookies in development', () => {
    const secure = cookieContract(config(true), null);
    expect(secure).toMatchObject({ name: '__Host-traibox_session', options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } });
    expect(secure.options).not.toHaveProperty('domain');
    const local = cookieContract(config(false), null);
    expect(local).toMatchObject({ name: 'traibox_session', options: { httpOnly: true, secure: false, path: '/' } });
  });

  it('strips browser-supplied authorization, role, and internal service headers', () => {
    const browserHeaders = new Headers({ Authorization: 'Bearer browser-token', 'X-Role': 'owner', 'X-Internal-Service': 'admin', 'Content-Type': 'application/json' });
    const forwarded = buildUpstreamHeaders({ browserHeaders, credential: 'server-token', organization: '00000000-0000-0000-0000-000000000001', traceId: 'trc_safe123' });
    expect(forwarded.get('authorization')).toBe('Bearer server-token');
    expect(forwarded.get('x-role')).toBeNull();
    expect(forwarded.get('x-internal-service')).toBeNull();
  });

  it('rejects arbitrary upstream URLs, traversal, unregistered routes, and credential queries', () => {
    expect(() => resolveBffRoute('GET', ['https:', '', 'evil.example'])).toThrow('invalid_bff_path');
    expect(() => resolveBffRoute('GET', ['v1', '..', 'metrics'])).toThrow('invalid_bff_path');
    expect(() => resolveBffRoute('GET', ['v1', 'admin', 'partners'])).toThrow('unregistered_bff_route');
    const events = resolveBffRoute('GET', ['v1', 'events']).route;
    expect(() => sanitizedQuery(events, new URLSearchParams('token=secret'))).toThrow('credential_query_rejected');
  });

  it('registers authenticated SSE and file transports without token query keys', () => {
    for (const path of ['events', 'files']) {
      const route = resolveBffRoute('GET', ['v1', path]).route;
      expect(route.principal).toBe('user');
      expect(route.queryKeys).not.toContain('token');
    }
    const eventsUrl = api.eventsUrl({ orgId: '00000000-0000-0000-0000-000000000001' });
    const fileUrl = api.downloadUrl('00000000-0000-0000-0000-000000000001', 'local://documents/report.pdf');
    expect(eventsUrl).toContain('/api/bff/v1/events');
    expect(fileUrl).toContain('/api/bff/v1/files');
    expect(eventsUrl).not.toMatch(/[?&]token=/);
    expect(fileUrl).not.toMatch(/[?&]token=/);
  });

  it('redacts upstream hosts, provider bodies, and stacks from client errors', () => {
    const error = normalizedUpstreamError(500, 'trc_safe123');
    expect(error.status).toBe(502);
    expect(JSON.stringify(error.body)).not.toMatch(/internal|supabase|stack|token/i);
  });

  it('rejects the local-development bypass under a production profile', () => {
    expect(() =>
      loadBrowserSecurityConfig({
        NODE_ENV: 'production',
        AUTH_MODE: 'dev',
        TRAIBOX_ENABLE_DEV_AUTH: 'true',
        DEPLOYMENT_PROFILE_PATH: 'packages/profiles/profiles/staging.yaml'
      })
    ).toThrow(/Dev browser auth/);
  });
});
