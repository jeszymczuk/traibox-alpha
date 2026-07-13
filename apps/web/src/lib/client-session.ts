'use client';

export type BrowserSessionState =
  | { authenticated: true; kind: 'user' | 'dev' | 'partner' | 'external'; user: Record<string, unknown>; csrf_token: string; expires_at: string }
  | { authenticated: false; dev_auth_available?: boolean };

let csrfToken: string | null = null;

export function rememberCsrfToken(value: string | null | undefined): void {
  csrfToken = value || null;
}

export function clearClientSessionState(): void {
  csrfToken = null;
}

export async function loadBrowserSession(): Promise<BrowserSessionState> {
  const response = await globalThis.fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  const state = (await response.json()) as BrowserSessionState;
  rememberCsrfToken(state.authenticated ? state.csrf_token : null);
  return state;
}

export async function csrfTokenForRequest(): Promise<string> {
  if (csrfToken) return csrfToken;
  const state = await loadBrowserSession();
  if (!state.authenticated) throw new Error('Authentication required');
  return state.csrf_token;
}

function isSensitiveLegacyKey(key: string): boolean {
  return (
    key === 'traibox_auth_token' ||
    key === 'traibox_partner_token' ||
    key === 'traibox_partner_id' ||
    key.startsWith('traibox.intel.stream.') ||
    /^sb-.+-auth-token$/i.test(key) ||
    /(?:access|refresh)[_-]?token/i.test(key)
  );
}

export function clearLegacySensitiveBrowserState(): void {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    try {
      const storage = globalThis[name];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
      for (const key of keys) if (isSensitiveLegacyKey(key)) storage.removeItem(key);
    } catch {
      // Storage may be disabled by browser privacy controls; cleanup remains fail-safe and idempotent.
    }
  }
}
