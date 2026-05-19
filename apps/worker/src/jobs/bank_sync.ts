import type pg from 'pg';
import crypto from 'node:crypto';

import type { Profile } from '@traibox/profiles';
import { setAppContext, withTx } from '@traibox/db';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

type EncryptedJson =
  | { v: 0; alg: 'PLAINTEXT'; data: unknown }
  | { v: 1; alg: 'A256GCM'; iv: string; tag: string; ct: string };

type TrueLayerTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
  created_at: string;
  expires_at: string;
};

function getTrueLayerConfigFromEnv(): { apiBaseUrl: string; authBaseUrl: string; clientId: string; clientSecret: string } | null {
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  const clientSecret = process.env.TRUELAYER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const apiBaseUrl = (process.env.TRUELAYER_BASE_URL ?? 'https://api.truelayer.com').replace(/\/+$/, '');
  const authBaseUrl = (process.env.TRUELAYER_AUTH_BASE_URL ?? 'https://auth.truelayer.com').replace(/\/+$/, '');
  return { apiBaseUrl, authBaseUrl, clientId, clientSecret };
}

export async function runBankSyncLoop(input: { pool: pg.Pool; profile: Profile }): Promise<void> {
  const intervalMs = Number(process.env.BANK_SYNC_INTERVAL_MS ?? 10 * 60_000);
  // eslint-disable-next-line no-console
  console.log(`Bank sync loop every ${Math.round(intervalMs / 1000)}s (truelayer=${input.profile.payments.truelayer.enabled}).`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (input.profile.payments.truelayer.enabled) {
        await tick(input);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('bank sync tick error', err);
    }
    await sleep(intervalMs);
  }
}

async function tick(input: { pool: pg.Pool; profile: Profile }): Promise<void> {
  const tl = getTrueLayerConfigFromEnv();
  if (!tl) return;
  const apiBaseUrl = input.profile.payments.truelayer.base_url ?? tl.apiBaseUrl;

  const consents = await withTx(input.pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: null });
    const res = await client.query(
      `SELECT consent_id, org_id, enc_tokens
       FROM bank_consents
       WHERE provider_id='truelayer' AND type='AIS' AND status='granted'
       ORDER BY updated_at DESC
       LIMIT 200`
    );
    return res.rows as Array<{ consent_id: string; org_id: string; enc_tokens: any }>;
  });

  for (const c of consents) {
    try {
      await syncConsent(input.pool, {
        orgId: c.org_id,
        consentId: c.consent_id,
        encTokens: c.enc_tokens,
        tl: { ...tl, apiBaseUrl }
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`bank sync consent error (org=${c.org_id} consent=${c.consent_id})`, err);
    }
  }
}

async function syncConsent(
  pool: pg.Pool,
  input: {
    orgId: string;
    consentId: string;
    encTokens: any;
    tl: { apiBaseUrl: string; authBaseUrl: string; clientId: string; clientSecret: string };
  }
): Promise<void> {
  const decoded = decodeTokens(input.encTokens) as any;
  const tokens = decoded?.tokens as TrueLayerTokens | null | undefined;
  if (!tokens?.access_token) return;

  const { accessToken, refreshed } = await getValidAccessToken(pool, {
    orgId: input.orgId,
    consentId: input.consentId,
    tl: input.tl,
    decoded
  });

  const accounts = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: input.orgId });
    const res = await client.query(
      `SELECT account_id, meta_json
       FROM bank_accounts
       WHERE provider_id='truelayer' AND consent_id=$1
       ORDER BY created_at DESC
       LIMIT 100`,
      [input.consentId]
    );
    return res.rows as Array<{ account_id: string; meta_json: any }>;
  });

  const lookbackDays = Number(process.env.BANK_SYNC_LOOKBACK_DAYS ?? 7);
  const from = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  for (const a of accounts) {
    const providerAccountId = a.meta_json?.tl_account_id ?? a.meta_json?.provider_account_id;
    if (!providerAccountId) continue;

    const [balanceRaw, txnsRaw] = await Promise.all([
      fetchBalance({ apiBaseUrl: input.tl.apiBaseUrl, accessToken, providerAccountId: String(providerAccountId) }).catch(() => null),
      fetchTransactions({ apiBaseUrl: input.tl.apiBaseUrl, accessToken, providerAccountId: String(providerAccountId), from, to }).catch(() => [])
    ]);

    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: input.orgId });

      if (balanceRaw) {
        const first = Array.isArray((balanceRaw as any)?.results) ? (balanceRaw as any).results[0] : (balanceRaw as any)?.balance ?? balanceRaw;
        const available = Number(first?.available ?? first?.available_amount ?? first?.available_balance ?? null);
        const booked = Number(first?.current ?? first?.booked ?? first?.current_balance ?? null);
        const creditLimit = Number(first?.overdraft ?? first?.credit_limit ?? 0);
        await client.query(
          `INSERT INTO bank_balances(org_id, account_id, as_of, available, booked, credit_limit)
           VALUES($1,$2,now(),$3,$4,$5)`,
          [
            input.orgId,
            a.account_id,
            Number.isFinite(available) ? available : null,
            Number.isFinite(booked) ? booked : null,
            Number.isFinite(creditLimit) ? creditLimit : null
          ]
        );
      }

      for (const t of txnsRaw) {
        const bankTxId = String((t as any)?.transaction_id ?? (t as any)?.id ?? '');
        if (!bankTxId) continue;
        const postedAt = coerceDate((t as any)?.timestamp ?? (t as any)?.posted_at ?? (t as any)?.date) ?? new Date().toISOString();
        const valueDate = coerceDateOnly((t as any)?.value_date ?? (t as any)?.valueDate) ?? null;
        const amountMajor = coerceAmount((t as any)?.amount);
        const amountMinorRaw = (t as any)?.amount_in_minor ?? (t as any)?.amountInMinor;
        const amountMinor = coerceAmount(amountMinorRaw);
        const amount = amountMajor ?? (amountMinor !== null ? amountMinor / 100 : null);
        if (amount === null) continue;
        const currency = String((t as any)?.currency ?? 'EUR');
        const counterpartyName = coerceString((t as any)?.counterparty_name ?? (t as any)?.merchant_name ?? (t as any)?.description);
        const counterpartyIban = coerceString((t as any)?.counterparty_iban ?? (t as any)?.counterparty?.iban);
        const remittance = coerceString((t as any)?.remittance ?? (t as any)?.reference ?? (t as any)?.transaction_reference);
        const e2eId = coerceString((t as any)?.end_to_end_id ?? (t as any)?.endToEndId ?? (t as any)?.e2e_id);
        const status = coerceString((t as any)?.status) ?? 'booked';
        const isoReason = coerceString((t as any)?.iso_reason_code ?? (t as any)?.reason_code);
        const category = coerceString((t as any)?.category);

        await client.query(
          `INSERT INTO bank_transactions(org_id, account_id, posted_at, value_date, amount, currency, counterparty_name, counterparty_iban, remittance, e2e_id, bank_tx_id, status, iso_reason_code, category, payment_id, meta_json)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           ON CONFLICT (account_id, bank_tx_id) DO NOTHING`,
          [
            input.orgId,
            a.account_id,
            postedAt,
            valueDate,
            amount,
            currency,
            counterpartyName,
            counterpartyIban,
            remittance,
            e2eId,
            bankTxId,
            status,
            isoReason,
            category,
            null,
            JSON.stringify({ raw: t })
          ]
        );
      }

      // Reconcile: link txns to payments by (e2e_id, amount, time window)
      await client.query(
        `UPDATE bank_transactions bt
         SET payment_id = p.payment_id
         FROM payments p
         WHERE bt.org_id = $1
           AND p.org_id = $1
           AND bt.account_id = $2
           AND bt.payment_id IS NULL
           AND bt.e2e_id IS NOT NULL
           AND p.e2e_id IS NOT NULL
           AND bt.e2e_id = p.e2e_id
           AND abs(abs(bt.amount) - p.amount) < 0.01
           AND bt.posted_at BETWEEN (p.created_at - interval '2 days') AND (p.created_at + interval '14 days')`,
        [input.orgId, a.account_id]
      );

      // If a booked transaction matches a payment, mark it executed (fallback if webhook was missed).
      const traceId = `trc_recon_${crypto.randomUUID().slice(0, 8)}`;
      const updated = await client.query(
        `UPDATE payments p
         SET status='executed',
             iso_status=COALESCE(p.iso_status,'ACSC'),
             updated_at=now()
         FROM bank_transactions bt
         WHERE bt.org_id = $1
           AND p.org_id = $1
           AND bt.account_id = $2
           AND bt.payment_id = p.payment_id
           AND COALESCE(bt.status,'') = 'booked'
           AND p.status IN ('created','pending_sca','authorized','executing')
         RETURNING p.payment_id, p.trade_id, p.iso_status`,
        [input.orgId, a.account_id]
      );

      for (const r of updated.rows as Array<{ payment_id: string; trade_id: string | null; iso_status: string | null }>) {
        await client.query(
          `INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            crypto.randomUUID(),
            input.orgId,
            r.trade_id,
            'payment.completed',
            traceId,
            'system:reconciliation',
            JSON.stringify({ payment_id: r.payment_id, iso_status: r.iso_status ?? 'ACSC', trace_id: traceId })
          ]
        );
      }
    });
  }

  if (refreshed) {
    // eslint-disable-next-line no-console
    console.log(`Refreshed TrueLayer token (org=${input.orgId} consent=${input.consentId}).`);
  }
}

async function getValidAccessToken(
  pool: pg.Pool,
  input: {
    orgId: string;
    consentId: string;
    tl: { authBaseUrl: string; clientId: string; clientSecret: string };
    decoded: any;
  }
): Promise<{ accessToken: string; refreshed: boolean }> {
  const tokens = input.decoded?.tokens as TrueLayerTokens | null | undefined;
  if (!tokens?.access_token) throw new Error('consent has no tokens');

  const expiresAt = new Date(tokens.expires_at).getTime();
  const now = Date.now();
  const shouldRefresh = expiresAt > 0 && now + 60_000 >= expiresAt;
  if (!shouldRefresh) return { accessToken: tokens.access_token, refreshed: false };
  if (!tokens.refresh_token) throw new Error('refresh_token missing');

  const refreshed = await refreshAccessToken({
    authBaseUrl: input.tl.authBaseUrl,
    clientId: input.tl.clientId,
    clientSecret: input.tl.clientSecret,
    refreshToken: tokens.refresh_token
  });

  const nextEnc = encryptJson({ ...input.decoded, tokens: refreshed });

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: input.orgId });
    await client.query('UPDATE bank_consents SET expires_at=$1, enc_tokens=$2 WHERE consent_id=$3', [refreshed.expires_at, JSON.stringify(nextEnc), input.consentId]);
  });

  return { accessToken: refreshed.access_token, refreshed: true };
}

async function refreshAccessToken(input: {
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

async function fetchBalance(input: { apiBaseUrl: string; accessToken: string; providerAccountId: string }): Promise<any> {
  const url = `${input.apiBaseUrl}/data/v1/accounts/${encodeURIComponent(input.providerAccountId)}/balance`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${input.accessToken}` } });
  if (!res.ok) throw new Error(`TrueLayer balance fetch failed: ${res.status}`);
  return (await res.json()) as any;
}

async function fetchTransactions(input: {
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

function encryptJson(value: unknown): EncryptedJson {
  const key = getEncryptionKey();
  if (!key) return { v: 0, alg: 'PLAINTEXT', data: value };
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { v: 1, alg: 'A256GCM', iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') };
}

function decryptJson(value: EncryptedJson): unknown {
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

function getEncryptionKey(): Buffer | null {
  const raw = process.env.TOKENS_ENCRYPTION_KEY;
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw).digest();
}

function decodeTokens(encTokens: any): any {
  if (!encTokens) return { mode: 'unknown' };
  if (typeof encTokens === 'string') {
    try {
      encTokens = JSON.parse(encTokens);
    } catch {
      return { mode: 'unknown' };
    }
  }
  const maybe = encTokens as EncryptedJson;
  if (maybe && typeof maybe === 'object' && 'v' in maybe && 'alg' in maybe) {
    return decryptJson(maybe);
  }
  return encTokens;
}

function coerceString(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function coerceDate(v: unknown): string | null {
  const s = coerceString(v);
  if (!s) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function coerceDateOnly(v: unknown): string | null {
  const s = coerceString(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

function coerceAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = coerceString(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
