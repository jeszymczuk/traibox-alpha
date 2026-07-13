import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import type { Profile } from '@traibox/profiles';
import type { SSEEvent } from '@traibox/contracts';
import { createHash, randomUUID } from 'node:crypto';
import {
  buildAuthorizeUrl,
  createPkcePair,
  decryptJson,
  encryptJson,
  exchangeAuthorizationCode,
  fetchAccounts,
  fetchBalance,
  fetchTransactions,
  getTrueLayerConfigFromEnv,
  refreshAccessToken,
  type EncryptedJson,
  type TrueLayerOAuthContext,
  type TrueLayerTokens
} from './truelayer.js';

export async function startBankConsent(
  pool: pg.Pool,
  input: {
    orgId: string;
    userId: string;
    traceId: string;
    profile: Profile;
    body: { type: 'AIS' | 'PIS'; provider?: string; redirect_url?: string; trade_id?: string };
  }
): Promise<{ consent_id: string; auth_url: string }> {
  const consentId = crypto.randomUUID();
  const providerId = input.body.provider ?? 'truelayer';
  const tl = getTrueLayerConfigFromEnv();
  const isReal = Boolean(input.profile.payments.truelayer.enabled && providerId === 'truelayer' && tl);

  const status = isReal ? 'pending' : 'granted';
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

  let encTokens: unknown = { mode: 'mock' };
  let authUrl = `${process.env.WEB_BASE_URL ?? 'http://localhost:3000'}/`;
  let scope: string | null = null;

  if (isReal) {
    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    const redirectUri = input.body.redirect_url ?? `${webBase}/banks/callback`;

    const scopes =
      input.body.type === 'AIS'
        ? ['info', 'accounts', 'balance', 'transactions', 'offline_access']
        : ['payments', 'offline_access'];
    scope = scopes.join(' ');
    const pkce = createPkcePair();
    // We keep redirect_uri stable (no dynamic query params) so OAuth redirect URI configuration is simple.
    // We encode consent_id and optional trade_id into `state` so the callback page can route correctly.
    const state = encodeOauthState({ consent_id: consentId, trade_id: input.body.trade_id ?? null, nonce: randomUUID() });

    const oauth: TrueLayerOAuthContext = {
      state,
      code_verifier: pkce.code_verifier,
      redirect_uri: redirectUri,
      scopes,
      created_at: new Date().toISOString()
    };

    encTokens = encryptJson({ mode: 'truelayer', oauth, tokens: null });
    authUrl = buildAuthorizeUrl({
      authBaseUrl: tl!.authBaseUrl,
      clientId: tl!.clientId,
      redirectUri,
      scopes,
      state,
      codeChallenge: pkce.code_challenge
    });
  }

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query(
      `INSERT INTO bank_consents(consent_id, org_id, provider_id, type, scope, status, expires_at, enc_tokens)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [consentId, input.orgId, providerId, input.body.type, scope, status, expiresAt, JSON.stringify(encTokens)]
    );

    // In mock mode, provision a demo account so users can immediately route/execute payments.
    if (!isReal) {
      const accountId = crypto.randomUUID();
      const digits = accountId.replace(/[^0-9]/g, '').slice(0, 21).padEnd(21, '0');
      const iban = `PT50${digits}`;
      await client.query(
        `INSERT INTO bank_accounts(account_id, org_id, provider_id, iban, currency, name, type, status, consent_id, meta_json)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
        [
          accountId,
          input.orgId,
          providerId,
          iban,
          'EUR',
          'Main EUR Account',
          'checking',
          'active',
          consentId,
          JSON.stringify({ bank_name: 'Mock Bank' })
        ]
      );
      await client.query(
        `INSERT INTO bank_balances(org_id, account_id, as_of, available, booked, credit_limit)
         VALUES($1,$2,now(),$3,$4,$5)`,
        [input.orgId, accountId, 50000, 50000, 0]
      );
    }
  });

  await emit(pool, {
    orgId: input.orgId,
    userId: input.userId,
    tradeId: input.body.trade_id,
    traceId: input.traceId,
    type: 'banks.consent.updated',
    data: { consent_id: consentId, status, trace_id: input.traceId }
  });

  return { consent_id: consentId, auth_url: authUrl };
}

export async function exchangeBankConsent(
  pool: pg.Pool,
  input: {
    orgId: string;
    userId: string;
    traceId: string;
    profile: Profile;
    body: { consent_id: string; code: string; state?: string };
  }
): Promise<{ consent_id: string; status: string }> {
  const tl = getTrueLayerConfigFromEnv();
  if (!tl) throw new Error('TrueLayer is not configured (TRUELAYER_CLIENT_ID/SECRET)');
  const tlApiBaseUrl = input.profile.payments.truelayer.base_url ?? tl.apiBaseUrl;

  const consent = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT consent_id, provider_id, type, enc_tokens FROM bank_consents WHERE consent_id=$1 LIMIT 1', [input.body.consent_id]);
    return res.rows[0] as { consent_id: string; provider_id: string; type: string; enc_tokens: any } | null;
  });
  if (!consent) throw new Error('consent not found');
  if (consent.provider_id !== 'truelayer') throw new Error('consent is not a TrueLayer consent');

  const decoded = decodeTokens(consent.enc_tokens);
  if (decoded.mode !== 'truelayer') throw new Error('invalid consent token payload');

  const oauth = decoded.oauth as TrueLayerOAuthContext | undefined;
  if (!oauth) throw new Error('missing oauth context');
  if (input.body.state && oauth.state !== input.body.state) {
    const err = new Error('state mismatch');
    (err as any).statusCode = 400;
    (err as any).code = 'invalid_state';
    throw err;
  }

  const tokens = await exchangeAuthorizationCode({
    authBaseUrl: tl.authBaseUrl,
    clientId: tl.clientId,
    clientSecret: tl.clientSecret,
    code: input.body.code,
    redirectUri: oauth.redirect_uri,
    codeVerifier: oauth.code_verifier
  });

  const nextEnc = encryptJson({ mode: 'truelayer', oauth: { ...oauth, code_verifier: '' }, tokens });

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('UPDATE bank_consents SET status=$1, expires_at=$2, enc_tokens=$3 WHERE consent_id=$4', [
      'granted',
      tokens.expires_at,
      JSON.stringify(nextEnc),
      consent.consent_id
    ]);
  });

  if (consent.type === 'AIS') {
    await syncAccounts(pool, {
      orgId: input.orgId,
      userId: input.userId,
      consentId: consent.consent_id,
      tl: { apiBaseUrl: tlApiBaseUrl },
      accessToken: tokens.access_token
    });
  }

  await emit(pool, {
    orgId: input.orgId,
    userId: input.userId,
    tradeId: undefined,
    traceId: input.traceId,
    type: 'banks.consent.updated',
    data: { consent_id: consent.consent_id, status: 'granted', trace_id: input.traceId }
  });

  return { consent_id: consent.consent_id, status: 'granted' };
}

export async function listConsents(pool: pg.Pool, input: { orgId: string; userId: string }) {
  const rows = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      'SELECT consent_id, provider_id as provider, type, status, expires_at FROM bank_consents ORDER BY created_at DESC LIMIT 100'
    );
    return res.rows;
  });
  return { consents: rows };
}

export async function revokeConsent(pool: pg.Pool, input: { orgId: string; userId: string; traceId: string; consentId: string }) {
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('UPDATE bank_consents SET status=$1 WHERE consent_id=$2', ['revoked', input.consentId]);
  });
  await emit(pool, {
    orgId: input.orgId,
    userId: input.userId,
    tradeId: undefined,
    traceId: input.traceId,
    type: 'banks.consent.updated',
    data: { consent_id: input.consentId, status: 'revoked', trace_id: input.traceId }
  });
}

export async function listAccounts(pool: pg.Pool, input: { orgId: string; userId: string }) {
  const rows = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      `SELECT account_id, provider_id, iban, currency, name, type, status, consent_id, meta_json
       FROM bank_accounts
       ORDER BY created_at DESC
       LIMIT 100`
    );
    return res.rows;
  });
  const accounts = rows.map((r: any) => ({
    account_id: r.account_id,
    provider_id: r.provider_id,
    iban: r.iban,
    currency: r.currency,
    name: r.name,
    type: r.type,
    status: r.status,
    bank_name: r.meta_json?.bank_name
  }));
  return { accounts };
}

export async function createManualAccount(
  pool: pg.Pool,
  input: {
    orgId: string;
    userId: string;
    body: { iban: string; currency: string; name?: string; bank_name?: string; type?: string };
    internalDemo?: { scenario: string };
  }
): Promise<{ account_id: string }> {
  const iban = input.body.iban.replace(/\s+/g, '').toUpperCase();
  const currency = String(input.body.currency ?? 'EUR').toUpperCase();
  const name = input.body.name?.trim() || 'Manual account';
  const type = input.body.type?.trim() || 'manual';
  const bankName = input.body.bank_name?.trim() || 'Manual';

  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });

    const existing = await client.query(
      `SELECT account_id
       FROM bank_accounts
       WHERE org_id=$1 AND provider_id='manual' AND iban=$2
       LIMIT 1`,
      [input.orgId, iban]
    );
    if (existing.rows[0]?.account_id) return { account_id: existing.rows[0].account_id as string };

    const accountId = randomUUID();
    await client.query(
      `INSERT INTO bank_accounts(account_id, org_id, provider_id, iban, currency, name, type, status, consent_id, meta_json)
       VALUES($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9)`,
      [
        accountId,
        input.orgId,
        iban,
        currency,
        name,
        type,
        'active',
        null,
        JSON.stringify({
          bank_name: bankName,
          manual: true,
          ...(input.internalDemo
            ? {
                demo_only: true,
                demo_scenario: input.internalDemo.scenario,
                environment: 'internal-alpha',
                production_use_forbidden: true
              }
            : {})
        })
      ]
    );
    return { account_id: accountId };
  });

  return row;
}

export async function getBalances(pool: pg.Pool, input: { orgId: string; userId: string; profile: Profile; accountId: string }) {
  const tl = getTrueLayerConfigFromEnv();
  const tlApiBaseUrl = tl ? (input.profile.payments.truelayer.base_url ?? tl.apiBaseUrl) : null;
  const account = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT account_id, provider_id, consent_id, meta_json FROM bank_accounts WHERE account_id=$1 LIMIT 1', [input.accountId]);
    return res.rows[0] as any | null;
  });
  if (!account) throw new Error('account not found');

  if (account.provider_id === 'truelayer' && tl && account.consent_id) {
    const { accessToken } = await getValidAccessToken(pool, {
      orgId: input.orgId,
      userId: input.userId,
      consentId: account.consent_id,
      tl
    });
    const providerAccountId = account.meta_json?.tl_account_id ?? account.meta_json?.provider_account_id;
    if (providerAccountId) {
      const raw = await fetchBalance({ apiBaseUrl: tlApiBaseUrl!, accessToken, providerAccountId: String(providerAccountId) });
      const first = Array.isArray(raw?.results) ? raw.results[0] : raw?.balance ?? raw;
      const available = Number(first?.available ?? first?.available_amount ?? first?.available_balance ?? null);
      const booked = Number(first?.current ?? first?.booked ?? first?.current_balance ?? null);
      const creditLimit = Number(first?.overdraft ?? first?.credit_limit ?? 0);
      const saved = await withTx(pool, async (client) => {
        await setAppContext(client, { userId: input.userId, orgId: input.orgId });
        const res = await client.query(
          `INSERT INTO bank_balances(org_id, account_id, as_of, available, booked, credit_limit)
           VALUES($1,$2,now(),$3,$4,$5)
           RETURNING account_id, as_of, available, booked, credit_limit`,
          [input.orgId, input.accountId, Number.isFinite(available) ? available : null, Number.isFinite(booked) ? booked : null, Number.isFinite(creditLimit) ? creditLimit : null]
        );
        return res.rows[0] ?? null;
      });
      return saved;
    }
  }

  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      `SELECT account_id, as_of, available, booked, credit_limit
       FROM bank_balances
       WHERE account_id=$1
       ORDER BY as_of DESC
       LIMIT 1`,
      [input.accountId]
    );
    return res.rows[0] ?? null;
  });
  return row;
}

export async function getTransactions(
  pool: pg.Pool,
  input: { orgId: string; userId: string; profile: Profile; accountId: string; from?: string; to?: string; cursor?: string }
) {
  const tl = getTrueLayerConfigFromEnv();
  const tlApiBaseUrl = tl ? (input.profile.payments.truelayer.base_url ?? tl.apiBaseUrl) : null;
  const account = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT account_id, provider_id, consent_id, meta_json FROM bank_accounts WHERE account_id=$1 LIMIT 1', [input.accountId]);
    return res.rows[0] as any | null;
  });
  if (!account) throw new Error('account not found');

  if (account.provider_id === 'truelayer' && tl && account.consent_id) {
    const { accessToken } = await getValidAccessToken(pool, {
      orgId: input.orgId,
      userId: input.userId,
      consentId: account.consent_id,
      tl
    });
    const providerAccountId = account.meta_json?.tl_account_id ?? account.meta_json?.provider_account_id;
    if (providerAccountId) {
      const raw = await fetchTransactions({
        apiBaseUrl: tlApiBaseUrl!,
        accessToken,
        providerAccountId: String(providerAccountId),
        from: input.from,
        to: input.to
      });
      await withTx(pool, async (client) => {
        await setAppContext(client, { userId: input.userId, orgId: input.orgId });
        for (const t of raw) {
          const bankTxId = String(t.transaction_id ?? t.id ?? sha1(`${t.timestamp ?? t.date}:${t.amount}:${t.description ?? ''}`));
          const postedAt = t.timestamp ?? t.posted_at ?? t.created_at ?? new Date().toISOString();
          const valueDate = t.value_date ?? t.date ?? null;
          const amount =
            typeof t.amount === 'number'
              ? t.amount
              : typeof t.amount_in_minor === 'number'
                ? t.amount_in_minor / 100
                : Number(t.amount ?? 0);
          const currency = t.currency ?? 'EUR';
          const counterpartyName = t.merchant_name ?? t.counterparty_name ?? t.description ?? null;
          const counterpartyIban = t.counterparty_iban ?? t.iban ?? null;
          const remittance = t.description ?? t.reference ?? null;
          const e2e = t.end_to_end_id ?? t.e2e_id ?? null;
          const status = t.status ?? 'booked';
          await client.query(
            `INSERT INTO bank_transactions(org_id, account_id, posted_at, value_date, amount, currency, counterparty_name, counterparty_iban, remittance, e2e_id, bank_tx_id, status, iso_reason_code, category, payment_id, meta_json)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (account_id, bank_tx_id) DO NOTHING`,
            [
              input.orgId,
              input.accountId,
              postedAt,
              valueDate,
              Number.isFinite(amount) ? amount : 0,
              currency,
              counterpartyName,
              counterpartyIban,
              remittance,
              e2e,
              bankTxId,
              status,
              t.iso_reason_code ?? null,
              t.category ?? null,
              null,
              JSON.stringify(t)
            ]
          );
        }

        // Best-effort reconciliation: link bank transactions to payments by EndToEndId + amount.
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
          [input.orgId, input.accountId]
        );
      });
    }
  }

  const limit = 50;
  const cursor = input.cursor ? Number(input.cursor) : 0;
  const rows = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      `SELECT txn_id, posted_at, value_date, amount, currency, counterparty_name, counterparty_iban, remittance, e2e_id, bank_tx_id, status, iso_reason_code, category, payment_id
       FROM bank_transactions
       WHERE account_id=$1
       ORDER BY posted_at DESC
       OFFSET $2
       LIMIT $3`,
      [input.accountId, cursor, limit]
    );
    return res.rows;
  });
  const nextCursor = rows.length === limit ? String(cursor + limit) : null;
  return { items: rows, next_cursor: nextCursor };
}

async function emit(
  pool: pg.Pool,
  input: { orgId: string; userId: string; tradeId?: string; traceId: string; type: string; data: any }
): Promise<void> {
  const ev: SSEEvent = {
    event_id: crypto.randomUUID(),
    type: input.type,
    ts: new Date().toISOString(),
    org_id: input.orgId,
    trade_id: input.tradeId,
    trace_id: input.traceId,
    actor: `user:${input.userId}`,
    data: input.data
  };
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      ev.event_id,
      ev.org_id,
      ev.trade_id ?? null,
      ev.type,
      ev.trace_id,
      ev.actor ?? null,
      JSON.stringify(ev.data ?? {})
    ]);
  });
}

function encodeOauthState(input: { consent_id: string; trade_id: string | null; nonce: string }): string {
  return base64url(Buffer.from(JSON.stringify({ v: 1, ...input }), 'utf8'));
}

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
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

async function getValidAccessToken(
  pool: pg.Pool,
  input: { orgId: string; userId: string; consentId: string; tl: { apiBaseUrl: string; authBaseUrl: string; clientId: string; clientSecret: string } }
): Promise<{ accessToken: string }> {
  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT enc_tokens FROM bank_consents WHERE consent_id=$1 LIMIT 1', [input.consentId]);
    return res.rows[0] as { enc_tokens: any } | null;
  });
  if (!row) throw new Error('consent not found');

  const decoded = decodeTokens(row.enc_tokens) as any;
  const tokens = decoded.tokens as TrueLayerTokens | null | undefined;
  if (!tokens?.access_token) throw new Error('consent has no tokens');

  const expiresAt = new Date(tokens.expires_at).getTime();
  const now = Date.now();
  const shouldRefresh = expiresAt > 0 && now + 60_000 >= expiresAt;
  if (!shouldRefresh) return { accessToken: tokens.access_token };

  if (!tokens.refresh_token) throw new Error('refresh_token missing');

  const refreshed = await refreshAccessToken({
    authBaseUrl: input.tl.authBaseUrl,
    clientId: input.tl.clientId,
    clientSecret: input.tl.clientSecret,
    refreshToken: tokens.refresh_token
  });

  const nextEnc = encryptJson({ ...(decoded as any), tokens: refreshed });
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('UPDATE bank_consents SET expires_at=$1, enc_tokens=$2 WHERE consent_id=$3', [refreshed.expires_at, JSON.stringify(nextEnc), input.consentId]);
  });
  return { accessToken: refreshed.access_token };
}

async function syncAccounts(
  pool: pg.Pool,
  input: {
    orgId: string;
    userId: string;
    consentId: string;
    tl: { apiBaseUrl: string };
    accessToken: string;
  }
): Promise<void> {
  const accounts = await fetchAccounts({ apiBaseUrl: input.tl.apiBaseUrl, accessToken: input.accessToken });
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    for (const a of accounts) {
      const providerAccountId = String(a.account_id ?? a.id ?? '');
      if (!providerAccountId) continue;
      const bankName = String(a?.provider?.display_name ?? a?.provider?.name ?? a?.provider?.provider_id ?? a?.provider_id ?? 'Bank');
      const currency = String(a.currency ?? 'EUR');
      const name = String(a.display_name ?? a.name ?? 'Bank account');
      const type = String(a.account_type ?? a.type ?? 'account');
      const iban = String(a?.account_number?.iban ?? a?.iban ?? `TL${providerAccountId.replace(/[^0-9A-Za-z]/g, '').slice(0, 28)}`);
      const accountId = crypto.randomUUID();

      await client.query(
        `INSERT INTO bank_accounts(account_id, org_id, provider_id, iban, currency, name, type, status, consent_id, meta_json)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (provider_id, iban) DO UPDATE SET currency=excluded.currency, name=excluded.name, type=excluded.type, status=excluded.status, consent_id=excluded.consent_id, meta_json=excluded.meta_json, updated_at=now()`,
        [
          accountId,
          input.orgId,
          'truelayer',
          iban,
          currency,
          name,
          type,
          'active',
          input.consentId,
          JSON.stringify({ tl_account_id: providerAccountId, bank_name: bankName, raw: a })
        ]
      );
    }
  });
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}
