import crypto from 'node:crypto';

export interface TrueLayerConfig {
  apiBaseUrl: string;
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookSecret?: string;
}

export interface TrueLayerOAuthContext {
  state: string;
  code_verifier: string;
  redirect_uri: string;
  scopes: string[];
  created_at: string;
}

export interface TrueLayerTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  created_at: string;
  expires_at: string;
}

export type EncryptedJson =
  | { v: 0; alg: 'PLAINTEXT'; data: unknown }
  | { v: 1; alg: 'A256GCM'; iv: string; tag: string; ct: string };

export function getTrueLayerConfigFromEnv(): TrueLayerConfig | null {
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const apiBaseUrl = (process.env.TRUELAYER_BASE_URL ?? 'https://api.truelayer.com').replace(/\/+$/, '');
  const authBaseUrl = (process.env.TRUELAYER_AUTH_BASE_URL ?? 'https://auth.truelayer.com').replace(/\/+$/, '');
  const webhookSecret = process.env.TRUELAYER_WEBHOOK_SECRET || undefined;
  return { apiBaseUrl, authBaseUrl, clientId, clientSecret, webhookSecret };
}

export function createPkcePair(): { code_verifier: string; code_challenge: string } {
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { code_verifier: codeVerifier, code_challenge: codeChallenge };
}

export function buildAuthorizeUrl(input: {
  authBaseUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}): string {
  const u = new URL(`${input.authBaseUrl}/connect/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('scope', input.scopes.join(' '));
  u.searchParams.set('state', input.state);
  u.searchParams.set('code_challenge', input.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export async function exchangeAuthorizationCode(input: {
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TrueLayerTokens> {
  const url = `${input.authBaseUrl}/connect/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', input.clientId);
  body.set('client_secret', input.clientSecret);
  body.set('code', input.code);
  body.set('redirect_uri', input.redirectUri);
  body.set('code_verifier', input.codeVerifier);

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`TrueLayer token exchange failed: ${res.status}`);
  const json = (await res.json()) as any;
  return normalizeTokens(json);
}

export async function refreshAccessToken(input: {
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TrueLayerTokens> {
  const url = `${input.authBaseUrl}/connect/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('client_id', input.clientId);
  body.set('client_secret', input.clientSecret);
  body.set('refresh_token', input.refreshToken);

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`TrueLayer token refresh failed: ${res.status}`);
  const json = (await res.json()) as any;
  return normalizeTokens(json);
}

export async function clientCredentialsToken(input: {
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
}): Promise<TrueLayerTokens> {
  const url = `${input.authBaseUrl}/connect/token`;
  const body = new URLSearchParams();
  body.set('grant_type', 'client_credentials');
  body.set('client_id', input.clientId);
  body.set('client_secret', input.clientSecret);
  body.set('scope', input.scope);

  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error(`TrueLayer client_credentials failed: ${res.status}`);
  const json = (await res.json()) as any;
  return normalizeTokens(json);
}

export async function fetchAccounts(input: { apiBaseUrl: string; accessToken: string }): Promise<any[]> {
  const url = `${input.apiBaseUrl}/data/v1/accounts`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${input.accessToken}` } });
  if (!res.ok) throw new Error(`TrueLayer accounts fetch failed: ${res.status}`);
  const json = (await res.json()) as any;
  const results = Array.isArray(json?.results) ? json.results : Array.isArray(json?.accounts) ? json.accounts : [];
  return results;
}

export async function fetchBalance(input: { apiBaseUrl: string; accessToken: string; providerAccountId: string }): Promise<any> {
  const url = `${input.apiBaseUrl}/data/v1/accounts/${encodeURIComponent(input.providerAccountId)}/balance`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${input.accessToken}` } });
  if (!res.ok) throw new Error(`TrueLayer balance fetch failed: ${res.status}`);
  return (await res.json()) as any;
}

export async function fetchTransactions(input: {
  apiBaseUrl: string;
  accessToken: string;
  providerAccountId: string;
  from?: string;
  to?: string;
}): Promise<any[]> {
  const u = new URL(`${input.apiBaseUrl}/data/v1/accounts/${encodeURIComponent(input.providerAccountId)}/transactions`);
  if (input.from) u.searchParams.set('from', input.from);
  if (input.to) u.searchParams.set('to', input.to);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${input.accessToken}` } });
  if (!res.ok) throw new Error(`TrueLayer transactions fetch failed: ${res.status}`);
  const json = (await res.json()) as any;
  const results = Array.isArray(json?.results) ? json.results : Array.isArray(json?.transactions) ? json.transactions : [];
  return results;
}

export async function createPayment(input: {
  apiBaseUrl: string;
  paymentsPath?: string;
  accessToken: string;
  amountInMinor: number;
  currency: string;
  creditorName: string;
  creditorIban: string;
  reference?: string;
  redirectUri: string;
  webhookUri: string;
  metadata?: Record<string, string>;
  idempotencyKey: string;
}): Promise<{ providerPaymentId: string; authorizationUri: string }> {
  const path = (input.paymentsPath ?? '/payments').startsWith('/') ? (input.paymentsPath ?? '/payments') : `/${input.paymentsPath}`;
  const url = `${input.apiBaseUrl}${path}`;
  const body = {
    amount_in_minor: input.amountInMinor,
    currency: input.currency,
    redirect_uri: input.redirectUri,
    webhook_uri: input.webhookUri,
    beneficiary: {
      type: 'external_account',
      account_holder_name: input.creditorName,
      reference: input.reference ?? 'TRAIBOX',
      account_identifiers: [{ type: 'iban', iban: input.creditorIban }]
    },
    metadata: input.metadata ?? {}
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json', 'Idempotency-Key': input.idempotencyKey },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`TrueLayer create payment failed: ${res.status}`);
  const json = (await res.json()) as any;

  const providerPaymentId = json?.id ?? json?.payment_id;
  const authorizationUri = json?.authorization_uri ?? json?.auth_uri ?? json?.user?.authorization_uri ?? json?.redirect_uri;
  if (!providerPaymentId || !authorizationUri) throw new Error('TrueLayer create payment response missing id/authorization uri');

  return { providerPaymentId: String(providerPaymentId), authorizationUri: String(authorizationUri) };
}

export function verifyWebhookSignature(input: { rawBody: Buffer; secret: string; headerValue: string | undefined }): boolean {
  if (!input.headerValue) return false;
  const parsed = parseSignatureHeader(input.headerValue);
  if (!parsed || parsed.signatures.length === 0) return false;

  const expectedBodies: Buffer[] = [];
  // Candidate A: HMAC(rawBody)
  expectedBodies.push(crypto.createHmac('sha256', input.secret).update(input.rawBody).digest());

  // Candidate B: Stripe-style HMAC(`${t}.${rawBody}`) when a timestamp is provided.
  if (parsed.timestamp) {
    expectedBodies.push(
      crypto
        .createHmac('sha256', input.secret)
        .update(`${parsed.timestamp}.`)
        .update(input.rawBody)
        .digest()
    );
  }

  for (const sig of parsed.signatures) {
    const providedBytes = decodeSignature(sig);
    if (!providedBytes) continue;
    for (const exp of expectedBodies) {
      if (timingSafeEqual(providedBytes, exp)) return true;
    }
  }

  return false;
}

export function encryptJson(value: unknown): EncryptedJson {
  const key = getEncryptionKey();
  if (!key) return { v: 0, alg: 'PLAINTEXT', data: value };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 1, alg: 'A256GCM', iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') };
}

export function decryptJson(value: EncryptedJson): unknown {
  if (value.v === 0 && value.alg === 'PLAINTEXT') return value.data;
  if (value.v !== 1 || value.alg !== 'A256GCM') throw new Error('Unsupported encrypted payload');
  const key = getEncryptionKey();
  if (!key) throw new Error('TOKENS_ENCRYPTION_KEY is required to decrypt tokens');
  const iv = Buffer.from(value.iv, 'base64');
  const tag = Buffer.from(value.tag, 'base64');
  const ct = Buffer.from(value.ct, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

function normalizeTokens(json: any): TrueLayerTokens {
  const createdAt = new Date().toISOString();
  const expiresIn = typeof json?.expires_in === 'number' ? json.expires_in : Number(json?.expires_in ?? 0);
  const expiresAt = new Date(Date.now() + Math.max(0, expiresIn) * 1000).toISOString();
  return {
    access_token: String(json.access_token),
    refresh_token: json.refresh_token ? String(json.refresh_token) : undefined,
    expires_in: expiresIn,
    token_type: String(json.token_type ?? 'Bearer'),
    scope: typeof json.scope === 'string' ? json.scope : undefined,
    created_at: createdAt,
    expires_at: expiresAt
  };
}

function getEncryptionKey(): Buffer | null {
  const raw = process.env.TOKENS_ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function parseSignatureHeader(v: string): { timestamp?: string; signatures: string[] } | null {
  const trimmed = v.trim();
  if (!trimmed) return null;

  // Accept bare signature (hex or base64)
  if (!trimmed.includes('=')) return { signatures: [trimmed] };

  // Accept "k=v" comma-separated values; keep any signature-ish values we see.
  const signatures: string[] = [];
  let timestamp: string | undefined;
  for (const part of trimmed.split(',')) {
    const [kRaw, valRaw] = part.split('=');
    const k = kRaw?.trim();
    const val = valRaw?.trim();
    if (!k || !val) continue;
    if (k === 't' || k === 'timestamp') timestamp = val;
    if (k === 'sha256' || k === 'v1' || k === 'sig' || k === 'signature') signatures.push(val);
  }
  if (signatures.length === 0) {
    // Some providers may send "sha256=<sig>" only; fall back to anything after the first '='.
    const idx = trimmed.indexOf('=');
    if (idx >= 0 && idx + 1 < trimmed.length) signatures.push(trimmed.slice(idx + 1).trim());
  }
  return { timestamp, signatures };
}

function decodeSignature(sig: string): Buffer | null {
  const s = sig.trim();
  if (!s) return null;

  // Hex
  if (/^[a-f0-9]{64}$/i.test(s)) {
    return Buffer.from(s, 'hex');
  }

  // Base64 or base64url
  const normalized = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');
  try {
    const b = Buffer.from(padded, 'base64');
    if (b.length === 32) return b;
  } catch {
    // ignore
  }
  return null;
}

function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
