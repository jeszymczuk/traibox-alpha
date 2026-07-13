import { parseKeyring, type Keyring } from './crypto';

export type BrowserSecurityConfig = {
  apiBaseUrl: URL;
  allowedOrigins: ReadonlySet<string>;
  authMode: 'supabase' | 'dev';
  sessionDatabaseUrl: string;
  devAuthEnabled: boolean;
  idleTtlMs: number;
  absoluteTtlMs: number;
  keyring: Keyring;
  production: boolean;
  requestTimeoutMs: number;
  maxRequestBytes: number;
  supabaseUrl?: URL;
  supabaseAnonKey?: string;
};

let cached: BrowserSecurityConfig | undefined;

function exactHttpUrl(value: string, name: string): URL {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(`${name} must be an absolute HTTP(S) origin/base URL without credentials, query, or fragment`);
  }
  return parsed;
}

function rootApiOrigin(value: string): URL {
  const parsed = exactHttpUrl(value, 'TRAIBOX_API_BASE_URL');
  if (parsed.pathname !== '/') throw new Error('TRAIBOX_API_BASE_URL must be a root origin without a pathname');
  return parsed;
}

function restrictedSessionDatabaseUrl(value: string): string {
  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('BROWSER_SESSION_DATABASE_URL must be a PostgreSQL connection string');
  }
  const role = decodeURIComponent(parsed.username).split('.')[0];
  if (role !== 'traibox_browser_session') {
    throw new Error('BROWSER_SESSION_DATABASE_URL must authenticate as the restricted traibox_browser_session role');
  }
  return value;
}

export function loadBrowserSecurityConfig(env: NodeJS.ProcessEnv = process.env): BrowserSecurityConfig {
  const production = env.NODE_ENV === 'production';
  const profilePath = env.DEPLOYMENT_PROFILE_PATH ?? '';
  const controlledProfile = !/(^|\/)dev\.yaml$/.test(profilePath);
  const authMode = (env.AUTH_MODE ?? '').toLowerCase();
  if (authMode !== 'supabase' && authMode !== 'dev') throw new Error('AUTH_MODE must be explicitly set to supabase or dev for the browser boundary');

  const devAuthEnabled = env.TRAIBOX_ENABLE_DEV_AUTH === 'true';
  if (authMode === 'dev' && (!devAuthEnabled || production || controlledProfile)) {
    throw new Error('Dev browser auth requires TRAIBOX_ENABLE_DEV_AUTH=true, NODE_ENV!=production, and the explicit dev deployment profile');
  }
  if (devAuthEnabled && authMode !== 'dev') throw new Error('TRAIBOX_ENABLE_DEV_AUTH may only be enabled with AUTH_MODE=dev');

  const sessionDatabaseValue = env.BROWSER_SESSION_DATABASE_URL;
  const apiBase = env.TRAIBOX_API_BASE_URL;
  const keyValue = env.BROWSER_SESSION_KEYS;
  if (!sessionDatabaseValue || !apiBase || !keyValue) {
    throw new Error('BROWSER_SESSION_DATABASE_URL, TRAIBOX_API_BASE_URL, and BROWSER_SESSION_KEYS are required for the browser security boundary');
  }

  const apiBaseUrl = rootApiOrigin(apiBase);
  const sessionDatabaseUrl = restrictedSessionDatabaseUrl(sessionDatabaseValue);
  const rawOrigins = (env.BROWSER_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!rawOrigins.length && !production && !controlledProfile) rawOrigins.push('http://localhost:3000');
  if (!rawOrigins.length) throw new Error('BROWSER_ALLOWED_ORIGINS must contain at least one exact origin');
  const allowedOrigins = new Set(rawOrigins.map((origin) => exactHttpUrl(origin, 'BROWSER_ALLOWED_ORIGINS').origin));
  if (allowedOrigins.size !== rawOrigins.length) throw new Error('BROWSER_ALLOWED_ORIGINS must not contain duplicates or URL paths');
  for (const raw of rawOrigins) {
    if (new URL(raw).origin !== raw.replace(/\/$/, '')) throw new Error('BROWSER_ALLOWED_ORIGINS entries must be origins without paths');
  }

  let supabaseUrl: URL | undefined;
  let supabaseAnonKey: string | undefined;
  if (authMode === 'supabase') {
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) throw new Error('Supabase browser auth requires server-only SUPABASE_URL and SUPABASE_ANON_KEY');
    supabaseUrl = exactHttpUrl(env.SUPABASE_URL, 'SUPABASE_URL');
    supabaseAnonKey = env.SUPABASE_ANON_KEY;
  }

  return {
    apiBaseUrl,
    allowedOrigins,
    authMode,
    sessionDatabaseUrl,
    devAuthEnabled,
    idleTtlMs: 30 * 60_000,
    absoluteTtlMs: 12 * 60 * 60_000,
    keyring: parseKeyring(keyValue),
    production,
    requestTimeoutMs: Number(env.BFF_REQUEST_TIMEOUT_MS ?? 30_000),
    maxRequestBytes: Number(env.BFF_MAX_REQUEST_BYTES ?? 21 * 1024 * 1024),
    supabaseUrl,
    supabaseAnonKey
  };
}

export function browserSecurityConfig(): BrowserSecurityConfig {
  cached ??= loadBrowserSecurityConfig();
  return cached;
}

export function resetBrowserSecurityConfigForTests(): void {
  cached = undefined;
}
