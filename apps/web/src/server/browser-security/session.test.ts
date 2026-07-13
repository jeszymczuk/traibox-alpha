import type { Session } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { completeSupabaseSignIn, revokeProviderSession } from './auth';
import type { BrowserSecurityConfig } from './config';
import { parseKeyring, randomOpaqueToken } from './crypto';
import { BrowserSecurityError } from './origin';
import { BrowserSessionManager } from './session';
import type { BrowserSessionStore, StoredAuthFlow, StoredBrowserSession } from './store';

class MemoryStore implements BrowserSessionStore {
  sessions = new Map<string, StoredBrowserSession>();
  flows = new Map<string, StoredAuthFlow & { consumed?: boolean }>();
  exchanges = new Set<string>();

  constructor(private readonly clock: () => Date) {}

  async persistSession(row: StoredBrowserSession, replacement?: { previousHash: string; required: boolean }): Promise<boolean> {
    if (replacement) {
      const previous = this.sessions.get(replacement.previousHash);
      if (replacement.required && (!previous || previous.revokedAt)) return false;
      if (previous && !previous.revokedAt) this.sessions.set(replacement.previousHash, { ...previous, revokedAt: row.createdAt, replacedByHash: row.sessionIdHash });
    }
    this.sessions.set(row.sessionIdHash, row);
    return true;
  }
  async authenticateSession(hash: string, idleTtlMs: number) {
    const row = this.sessions.get(hash);
    const now = this.clock();
    if (!row || row.revokedAt || row.idleExpiresAt <= now || row.absoluteExpiresAt <= now) return null;
    const active = {
      ...row,
      lastSeenAt: now,
      idleExpiresAt: new Date(Math.min(row.absoluteExpiresAt.getTime(), now.getTime() + idleTtlMs))
    };
    this.sessions.set(hash, active);
    return active;
  }
  async revokeSession(hash: string, at: Date) {
    const row = this.sessions.get(hash);
    if (row) this.sessions.set(hash, { ...row, revokedAt: row.revokedAt ?? at });
  }
  async saveAuthFlow(flow: StoredAuthFlow) {
    this.flows.set(flow.stateHash, flow);
  }
  async consumeAuthFlow(hash: string, now: Date) {
    const flow = this.flows.get(hash);
    if (!flow || flow.consumed || flow.expiresAt <= now) return null;
    flow.consumed = true;
    return flow;
  }
  async consumeExternalExchange(hash: string) {
    if (this.exchanges.has(hash)) return false;
    this.exchanges.add(hash);
    return true;
  }
}

const config: BrowserSecurityConfig = {
  apiBaseUrl: new URL('http://localhost:3001'),
  allowedOrigins: new Set(['http://localhost:3000']),
  authMode: 'dev',
  sessionDatabaseUrl: 'postgres://traibox_browser_session:test@localhost/traibox',
  devAuthEnabled: true,
  idleTtlMs: 30 * 60_000,
  absoluteTtlMs: 12 * 60 * 60_000,
  keyring: parseKeyring(`test:${Buffer.alloc(32, 7).toString('base64')}`),
  production: false,
  requestTimeoutMs: 30_000,
  maxRequestBytes: 1024
};

describe('server-managed browser sessions', () => {
  let now: Date;
  let store: MemoryStore;
  let manager: BrowserSessionManager;

  beforeEach(() => {
    now = new Date('2026-07-13T12:00:00.000Z');
    store = new MemoryStore(() => now);
    manager = new BrowserSessionManager(store, config, () => now);
  });

  it('completes a server-side callback and fixes a pre-existing session', async () => {
    const prior = await manager.create({ kind: 'dev', principalId: 'dev-user', credential: 'dev' });
    const state = randomOpaqueToken();
    await manager.saveAuthFlow(state, { verifier: 'pkce-verifier' }, '/trades');
    const provider = {
      access_token: 'server-access',
      refresh_token: 'server-refresh',
      expires_at: Math.floor(now.getTime() / 1000) + 3600,
      user: { id: 'user-id', email: 'user@example.com', user_metadata: {} }
    } as Session;
    const result = await completeSupabaseSignIn({ state, code: 'authorization-code', previousSessionId: prior.rawSessionId }, manager, async () => provider);
    expect(result.returnPath).toBe('/trades');
    expect(result.session.rawSessionId).not.toBe(prior.rawSessionId);
    await expect(manager.authenticate(prior.rawSessionId)).rejects.toMatchObject({ code: 'invalid_session' });
    await expect(manager.authenticate(result.session.rawSessionId)).resolves.toMatchObject({ credential: 'server-access' });
  });

  it('rejects invalid and replayed callback state', async () => {
    await expect(manager.consumeAuthFlow(randomOpaqueToken())).rejects.toMatchObject({ code: 'invalid_callback_state' });
    const state = randomOpaqueToken();
    await manager.saveAuthFlow(state, { verifier: 'one-time' }, '/');
    await manager.consumeAuthFlow(state);
    await expect(manager.consumeAuthFlow(state)).rejects.toMatchObject({ code: 'invalid_callback_state' });
  });

  it('rotates both the session and CSRF token', async () => {
    const initial = await manager.create({ kind: 'user', principalId: 'user', credential: 'access', refreshCredential: 'refresh' });
    const rotated = await manager.rotate(initial, { credential: 'access-2', refreshCredential: 'refresh-2' });
    expect(rotated.rawSessionId).not.toBe(initial.rawSessionId);
    expect(rotated.csrfToken).not.toBe(initial.csrfToken);
    await expect(manager.authenticate(initial.rawSessionId)).rejects.toMatchObject({ code: 'invalid_session' });
  });

  it('fails closed for expired and revoked sessions', async () => {
    const expired = await manager.create({ kind: 'dev', principalId: 'user', credential: 'dev', absoluteExpiresAt: new Date(now.getTime() + 1000) });
    now = new Date(now.getTime() + 1001);
    await expect(manager.authenticate(expired.rawSessionId)).rejects.toMatchObject({ code: 'invalid_session' });
    now = new Date('2026-07-13T12:00:00.000Z');
    const revoked = await manager.create({ kind: 'dev', principalId: 'user', credential: 'dev' });
    await manager.revoke(revoked.rawSessionId);
    await expect(manager.authenticate(revoked.rawSessionId)).rejects.toMatchObject({ code: 'invalid_session' });
  });

  it('rejects missing, stale, and mismatched CSRF tokens', async () => {
    const session = await manager.create({ kind: 'dev', principalId: 'user', credential: 'dev' });
    expect(() => manager.validateCsrf(session, null)).toThrowError(BrowserSecurityError);
    expect(() => manager.validateCsrf(session, 'wrong-token')).toThrowError(BrowserSecurityError);
    expect(() => manager.validateCsrf(session, session.csrfToken)).not.toThrow();
    const rotated = await manager.rotate(session);
    expect(() => manager.validateCsrf(rotated, session.csrfToken)).toThrowError(BrowserSecurityError);
  });

  it('rejects replay of a one-time external participant exchange', async () => {
    const exchange = 'txp_external-participant-exchange-token';
    await manager.consumeExternalExchange(exchange, new Date(now.getTime() + 60_000));
    await expect(manager.consumeExternalExchange(exchange, new Date(now.getTime() + 60_000))).rejects.toMatchObject({ code: 'replayed_exchange' });
  });

  it('revokes the provider credential during user logout', async () => {
    const session = await manager.create({ kind: 'user', principalId: 'user', credential: 'provider-access', refreshCredential: 'provider-refresh' });
    const providerConfig = {
      ...config,
      authMode: 'supabase' as const,
      supabaseUrl: new URL('https://project.supabase.co'),
      supabaseAnonKey: 'anon'
    };
    const transport = vi.fn(async () => new Response(null, { status: 204 }));
    await revokeProviderSession(session, providerConfig, transport as typeof fetch);
    expect(transport).toHaveBeenCalledWith(
      new URL('https://project.supabase.co/auth/v1/logout'),
      expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer provider-access' }) })
    );
    await manager.revoke(session.rawSessionId);
    await expect(manager.authenticate(session.rawSessionId)).rejects.toMatchObject({ code: 'invalid_session' });
  });
});
