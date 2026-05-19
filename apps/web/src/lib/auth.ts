const FALLBACK_TOKEN = process.env.NEXT_PUBLIC_AUTH_TOKEN ?? 'dev';

export function isSupabaseEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export function getAuthToken(): string {
  if (typeof window === 'undefined') return FALLBACK_TOKEN;
  return localStorage.getItem('traibox_auth_token') || FALLBACK_TOKEN;
}

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('traibox_auth_token', token);
}

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('traibox_auth_token');
}

