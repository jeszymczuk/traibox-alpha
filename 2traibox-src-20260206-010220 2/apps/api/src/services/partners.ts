import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function adminBootstrapPartner(
  pool: pg.Pool,
  input: {
    orgId: string;
    userId: string;
    traceId: string;
    body: {
      display_name: string;
      domains?: string[];
      corridors?: string[];
      rails?: string[];
      stf_ready?: boolean;
      webhook_url?: string;
      push_mode?: boolean;
      key_label?: string;
    };
  }
) {
  const apiKey = generateApiKey();
  const keyHash = sha256(apiKey);

  const row = await withTx(pool, async (client) => {
    // Require an org context so the caller is audited under their org (even though partners are global in MVP).
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });

    const partner = await client.query(
      `INSERT INTO partners(display_name, domains, corridors, rails, stf_ready, webhook_url, push_mode)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       RETURNING partner_id`,
      [
        input.body.display_name,
        input.body.domains ?? [],
        input.body.corridors ?? null,
        input.body.rails ?? null,
        input.body.stf_ready ?? false,
        input.body.webhook_url ?? null,
        input.body.push_mode ?? false
      ]
    );
    const partnerId = partner.rows[0]!.partner_id as string;

    await client.query('INSERT INTO partner_api_keys(partner_id, key_hash, label) VALUES($1,$2,$3)', [
      partnerId,
      keyHash,
      input.body.key_label ?? null
    ]);

    return { partner_id: partnerId };
  });

  return { ...row, api_key: apiKey, trace_id: input.traceId };
}

export async function partnerAuthToken(pool: pg.Pool, input: { apiKey: string; jwtSecret: string; traceId: string }) {
  const keyHash = sha256(input.apiKey);
  const row = await withTx(pool, async (client) => {
    // partners are global; no app context required
    const res = await client.query('SELECT partner_id FROM partner_api_keys WHERE key_hash=$1 AND revoked_at IS NULL LIMIT 1', [keyHash]);
    return res.rows[0] ?? null;
  });
  if (!row) throw new Error('invalid partner api key');

  const token = await new SignJWT({ partner_id: row.partner_id })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(input.jwtSecret));

  return { access_token: token, partner_id: row.partner_id, trace_id: input.traceId };
}

export async function partnerGetProfile(pool: pg.Pool, input: { req: any; jwtSecret: string }) {
  const authz = input.req.headers.authorization as string | undefined;
  if (!authz?.startsWith('Bearer ')) throw new Error('missing partner token');
  const token = authz.slice('Bearer '.length);
  const { payload } = await jwtVerify(token, new TextEncoder().encode(input.jwtSecret));
  const partnerId = payload.partner_id as string;
  if (!partnerId) throw new Error('invalid partner token');

  const row = await withTx(pool, async (client) => {
    const res = await client.query('SELECT partner_id, display_name, domains, corridors, rails, stf_ready, webhook_url, push_mode FROM partners WHERE partner_id=$1 LIMIT 1', [partnerId]);
    return res.rows[0] ?? null;
  });
  if (!row) throw new Error('partner not found');
  return row;
}

export async function partnerListOfferRequests(pool: pg.Pool, input: { partnerId: string; status: string }) {
  const rows = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: null });
    const res = await client.query('SELECT request_id, trade_id, amount, currency, tenor_days, sustainable, status, created_at FROM offer_requests WHERE status=$1 ORDER BY created_at DESC LIMIT 100', [
      input.status
    ]);
    return res.rows;
  });
  return { items: rows };
}

export async function partnerSubmitOffers(
  pool: pg.Pool,
  input: { partner: any; requestId: string; body: any; traceId: string }
) {
  const offers = (input.body.offers as any[]) ?? [];
  if (offers.length === 0) throw new Error('offers required');

  const { tradeId, orgId } = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: null });
    const req = await client.query('SELECT trade_id, org_id FROM offer_requests WHERE request_id=$1 LIMIT 1', [input.requestId]);
    if (!req.rows[0]) throw new Error('offer request not found');
    return { tradeId: req.rows[0]!.trade_id as string, orgId: req.rows[0]!.org_id as string };
  });

  await withTx(pool, async (client) => {
    // Partner writes are global; but finance_offers is org-scoped RLS, so we must set app context.
    await setAppContext(client, { userId: '00000000-0000-0000-0000-000000000000', orgId });
    for (const o of offers) {
      await client.query(
        `INSERT INTO finance_offers(offer_id, request_id, trade_id, org_id, financier_id, financier_name, apr_bps, fees, tenor_days, currency, sustainability_tag, sustainability_grade, verification_level, sustainable_pricing_delta_bps, explanations, expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          o.offer_id ?? crypto.randomUUID(),
          input.requestId,
          tradeId,
          orgId,
          input.partner.partner_id,
          input.partner.display_name,
          o.apr_bps,
          o.fees ?? 0,
          o.tenor_days,
          o.currency ?? 'EUR',
          o.sustainability_tag ?? 'none',
          o.sustainability_grade ?? 'insufficient_data',
          o.verification_level ?? null,
          o.sustainable_pricing_delta_bps ?? null,
          JSON.stringify(o.explanations ?? []),
          o.expires_at ?? null
        ]
      );
    }
    await client.query('UPDATE offer_requests SET status=$1 WHERE request_id=$2', ['ready', input.requestId]);
  });

  const ev: any = {
    event_id: crypto.randomUUID(),
    type: 'offers.ready',
    ts: new Date().toISOString(),
    org_id: orgId,
    trade_id: tradeId,
    trace_id: input.traceId,
    actor: `partner:${input.partner.partner_id}`,
    data: { trade_id: tradeId, trace_id: input.traceId, count: offers.length }
  };

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: '00000000-0000-0000-0000-000000000000', orgId });
    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      ev.event_id,
      ev.org_id,
      ev.trade_id,
      ev.type,
      ev.trace_id,
      ev.actor,
      JSON.stringify(ev.data)
    ]);
  });

  return { ok: true };
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function generateApiKey(): string {
  // Human copy/paste friendly; still high entropy.
  return `pk_${randomBytes(24).toString('base64url')}`;
}
