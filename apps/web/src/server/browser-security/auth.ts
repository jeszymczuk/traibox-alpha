import { createClient, type Session } from '@supabase/supabase-js';

import { browserSecurityConfig } from './config';
import { randomOpaqueToken } from './crypto';
import { BrowserSecurityError } from './origin';
import { browserSessionManager, type ActiveBrowserSession, type BrowserSessionManager, type CreatedBrowserSession } from './session';

type StorageValues = Record<string, string>;

function memoryStorage(initial: StorageValues = {}) {
  const values = { ...initial };
  return {
    values,
    adapter: {
      getItem(key: string) {
        return values[key] ?? null;
      },
      setItem(key: string, value: string) {
        values[key] = value;
      },
      removeItem(key: string) {
        delete values[key];
      }
    }
  };
}

function supabaseClient(storage: ReturnType<typeof memoryStorage>['adapter']) {
  const config = browserSecurityConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) throw new BrowserSecurityError(503, 'auth_unavailable', 'Supabase authentication is not configured');
  return createClient(config.supabaseUrl.origin, config.supabaseAnonKey, {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storage }
  });
}

export async function beginSupabaseSignIn(input: { email: string; origin: string; returnPath: string }): Promise<void> {
  const state = randomOpaqueToken();
  const storage = memoryStorage();
  const callback = new URL('/api/auth/callback', input.origin);
  callback.searchParams.set('state', state);
  const { error } = await supabaseClient(storage.adapter).auth.signInWithOtp({
    email: input.email,
    options: { emailRedirectTo: callback.toString() }
  });
  if (error) throw new BrowserSecurityError(502, 'sign_in_failed', 'Could not start sign-in');
  if (Object.keys(storage.values).length === 0) throw new BrowserSecurityError(502, 'pkce_state_missing', 'Could not establish a secure sign-in flow');
  await browserSessionManager().saveAuthFlow(state, storage.values, input.returnPath);
}

export type SupabaseCodeExchanger = (code: string, storage: StorageValues) => Promise<Session>;

async function exchangeSupabaseCode(code: string, values: StorageValues): Promise<Session> {
  const storage = memoryStorage(values);
  const { data, error } = await supabaseClient(storage.adapter).auth.exchangeCodeForSession(code);
  if (error || !data.session) throw new BrowserSecurityError(401, 'callback_exchange_failed', 'Sign-in link is invalid or expired');
  return data.session;
}

export async function completeSupabaseSignIn(
  input: { state: string; code: string; previousSessionId?: string | null },
  manager: BrowserSessionManager = browserSessionManager(),
  exchanger: SupabaseCodeExchanger = exchangeSupabaseCode
): Promise<{ session: CreatedBrowserSession; returnPath: string }> {
  if (!input.code || input.code.length > 2048) throw new BrowserSecurityError(400, 'invalid_callback_code', 'Sign-in code is invalid');
  const flow = await manager.consumeAuthFlow(input.state);
  const provider = await exchanger(input.code, flow.pkceStorage);
  if (!provider.access_token || !provider.refresh_token || !provider.user?.id) throw new BrowserSecurityError(401, 'callback_exchange_failed', 'Sign-in link is invalid or expired');
  const session = await manager.create(
    {
      kind: 'user',
      principalId: provider.user.id,
      display: { email: provider.user.email ?? null, name: provider.user.user_metadata?.name ?? provider.user.user_metadata?.full_name ?? null },
      credential: provider.access_token,
      refreshCredential: provider.refresh_token,
      credentialExpiresAt: provider.expires_at ? new Date(provider.expires_at * 1000) : null
    },
    input.previousSessionId
  );
  return { session, returnPath: flow.returnPath };
}

export async function refreshSupabaseSession(current: ActiveBrowserSession): Promise<CreatedBrowserSession> {
  const config = browserSecurityConfig();
  if (current.kind !== 'user' || !current.refreshCredential || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new BrowserSecurityError(401, 'refresh_unavailable', 'Session refresh is unavailable');
  }
  const endpoint = new URL('/auth/v1/token', config.supabaseUrl);
  endpoint.searchParams.set('grant_type', 'refresh_token');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: current.refreshCredential }),
    cache: 'no-store',
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });
  if (!response.ok) throw new BrowserSecurityError(401, 'refresh_failed', 'Session refresh failed');
  const refreshed = (await response.json()) as { access_token?: string; refresh_token?: string; expires_at?: number; expires_in?: number };
  if (!refreshed.access_token || !refreshed.refresh_token) throw new BrowserSecurityError(401, 'refresh_failed', 'Session refresh failed');
  const expiresAt = refreshed.expires_at
    ? new Date(refreshed.expires_at * 1000)
    : new Date(Date.now() + Math.max(60, refreshed.expires_in ?? 3600) * 1000);
  return browserSessionManager().rotate(current, {
    credential: refreshed.access_token,
    refreshCredential: refreshed.refresh_token,
    credentialExpiresAt: expiresAt
  });
}

export async function revokeProviderSession(
  session: ActiveBrowserSession,
  config = browserSecurityConfig(),
  transport: typeof fetch = fetch
): Promise<void> {
  if (session.kind !== 'user' || !config.supabaseUrl || !config.supabaseAnonKey) return;
  const endpoint = new URL('/auth/v1/logout', config.supabaseUrl);
  const response = await transport(endpoint, {
    method: 'POST',
    headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${session.credential}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(config.requestTimeoutMs)
  });
  if (!response.ok && response.status !== 401) throw new BrowserSecurityError(502, 'provider_logout_failed', 'Provider logout could not be confirmed');
}
