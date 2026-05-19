import type pg from 'pg';
import type { ExecutePaymentRequest, Payment, RoutesRequest, RoutesResponse, SSEEvent } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import { setAppContext, withTx } from '@traibox/db';
import { clientCredentialsToken, createPayment, getTrueLayerConfigFromEnv } from './truelayer.js';

export async function computeRoutes(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; profile: Profile; input: RoutesRequest }
): Promise<RoutesResponse> {
  const { orgId, userId, traceId, profile } = input;
  const tradeId = input.input.trade_id;

  const fromProviderId = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const res = await client.query('SELECT provider_id FROM bank_accounts WHERE account_id=$1 LIMIT 1', [input.input.from_account_id]);
    return (res.rows[0]?.provider_id as string | undefined) ?? null;
  });

  const manualRecommended = profile.payments.manual.enabled && fromProviderId === 'manual';

  const routes = [
    {
      route_id: 'r_sepa_instant',
      scheme: 'SEPA_INSTANT',
      fee: profile.payments.defaults.sepa_instant_fee,
      eta_minutes: profile.payments.defaults.sepa_instant_eta_minutes,
      recommended: !manualRecommended && input.input.urgency === 'instant'
    },
    {
      route_id: 'r_sepa',
      scheme: 'SEPA',
      fee: profile.payments.defaults.sepa_fee,
      eta_minutes: profile.payments.defaults.sepa_eta_minutes,
      recommended: !manualRecommended && input.input.urgency !== 'instant'
    }
  ];

  if (profile.payments.manual.enabled) {
    routes.push({
      route_id: 'r_manual',
      scheme: 'MANUAL_TRANSFER',
      fee: 0,
      eta_minutes: input.input.urgency === 'instant' ? profile.payments.defaults.sepa_instant_eta_minutes : profile.payments.defaults.sepa_eta_minutes,
      recommended: manualRecommended
    });
  }

  const ev: SSEEvent = {
    event_id: crypto.randomUUID(),
    type: 'payments.routes_ready',
    ts: new Date().toISOString(),
    org_id: orgId,
    trade_id: tradeId,
    trace_id: traceId,
    actor: `user:${userId}`,
    data: { trade_id: tradeId, count: routes.length, trace_id: traceId }
  };
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      ev.event_id,
      ev.org_id,
      ev.trade_id ?? null,
      ev.type,
      traceId,
      ev.actor,
      JSON.stringify(ev.data)
    ]);
  });

  return { routes };
}

export async function executePayment(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; profile: Profile; input: ExecutePaymentRequest; idempotencyKey: string }
): Promise<Payment> {
  const { orgId, userId, traceId } = input;
  const tradeId = input.input.trade_id ?? null;
  let scheme = input.input.route_id === 'r_sepa_instant' ? 'SEPA_INSTANT' : input.input.route_id === 'r_manual' ? 'MANUAL_TRANSFER' : 'SEPA';
  const paymentId = crypto.randomUUID();

  const tl = getTrueLayerConfigFromEnv();
  const shouldUseTrueLayer = Boolean(input.profile.payments.truelayer.enabled && tl);

  const fromProviderId = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const res = await client.query('SELECT provider_id FROM bank_accounts WHERE account_id=$1 LIMIT 1', [input.input.from_account_id]);
    return (res.rows[0]?.provider_id as string | undefined) ?? null;
  });

  const useManual =
    input.profile.payments.manual.enabled &&
    (input.input.route_id === 'r_manual' || fromProviderId === 'manual' || !shouldUseTrueLayer);

  if (useManual) scheme = 'MANUAL_TRANSFER';

  let providerRef: string | null = null;
  let redirectUrl: string | null = null;
  let status: Payment['status'] = 'pending_sca';

  if (useManual) {
    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    const u = new URL(`${webBase}/payments/manual`);
    u.searchParams.set('payment_id', paymentId);
    u.searchParams.set('org_id', orgId);
    if (tradeId) u.searchParams.set('trade_id', tradeId);
    redirectUrl = u.toString();
    status = 'created';
  } else if (shouldUseTrueLayer) {
    const token = await clientCredentialsToken({
      authBaseUrl: tl!.authBaseUrl,
      clientId: tl!.clientId,
      clientSecret: tl!.clientSecret,
      scope: 'payments'
    });

    const apiBaseUrl = input.profile.payments.truelayer.base_url ?? tl!.apiBaseUrl;
    const webhookUri = `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/webhooks/payments`;
    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    const redirectUri = tradeId ? `${webBase}/trade/${tradeId}` : webBase;
    const amountInMinor = Math.round(Number(input.input.amount) * 100);

    const created = await createPayment({
      apiBaseUrl,
      paymentsPath: input.profile.payments.truelayer.payments_path,
      accessToken: token.access_token,
      amountInMinor,
      currency: input.input.currency,
      creditorName: input.input.creditor_name,
      creditorIban: input.input.creditor_iban,
      reference: input.input.remittance ?? 'TRAIBOX',
      redirectUri,
      webhookUri,
      metadata: { internal_payment_id: paymentId, ...(tradeId ? { trade_id: tradeId } : {}), scheme }
    });
    providerRef = created.providerPaymentId;
    redirectUrl = created.authorizationUri;
    status = 'pending_sca';
  } else {
    // Dev-only fallback when no provider is configured and manual payments are disabled.
    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    const u = new URL(`${webBase}/payments/manual`);
    u.searchParams.set('payment_id', paymentId);
    u.searchParams.set('org_id', orgId);
    if (tradeId) u.searchParams.set('trade_id', tradeId);
    u.searchParams.set('mode', 'mock');
    redirectUrl = u.toString();
    status = 'created';
  }

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    await client.query(
      `INSERT INTO payments(payment_id, org_id, trade_id, scheme, debtor_account_id, creditor_name, creditor_iban, amount, currency, purpose, remittance, e2e_id, status, iso_status, provider_ref, trace_id, idempotency_key, redirect_url)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        paymentId,
        orgId,
        tradeId,
        scheme,
        input.input.from_account_id,
        input.input.creditor_name,
        input.input.creditor_iban,
        input.input.amount,
        input.input.currency,
        null,
        input.input.remittance ?? null,
        input.input.e2e_id,
        status,
        null,
        providerRef,
        traceId,
        input.idempotencyKey,
        redirectUrl
      ]
    );
    await client.query('INSERT INTO payment_attempts(org_id, payment_id, status, code, raw) VALUES($1,$2,$3,$4,$5)', [
      orgId,
      paymentId,
      status,
      null,
      JSON.stringify({ scheme, mode: useManual ? 'manual' : shouldUseTrueLayer ? 'truelayer' : 'mock' })
    ]);
  });

  const ev: SSEEvent = {
    event_id: crypto.randomUUID(),
    type: 'payment.executing',
    ts: new Date().toISOString(),
    org_id: orgId,
    trade_id: tradeId ?? undefined,
    trace_id: traceId,
    actor: `user:${userId}`,
    data: { payment_id: paymentId, mode: useManual ? 'manual' : 'provider', trace_id: traceId }
  };
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
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

  return { payment_id: paymentId, scheme, status, redirect_url: redirectUrl ?? undefined, trace_id: traceId };
}

export async function getPaymentStatus(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; paymentId: string }
): Promise<Payment> {
  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT payment_id, scheme, status, iso_status, return_reason, redirect_url, trace_id FROM payments WHERE payment_id=$1 LIMIT 1', [
      input.paymentId
    ]);
    return res.rows[0] ?? null;
  });
  if (!row) throw new Error('payment not found');
  return {
    payment_id: row.payment_id,
    scheme: row.scheme,
    status: row.status,
    iso_status: row.iso_status ?? undefined,
    return_reason: row.return_reason ?? undefined,
    redirect_url: row.redirect_url ?? undefined,
    trace_id: row.trace_id ?? input.traceId
  };
}

export async function getPaymentDetails(
  pool: pg.Pool,
  input: { orgId: string; userId: string; paymentId: string }
): Promise<{
  payment_id: string;
  trade_id: string | null;
  scheme: string;
  status: string;
  creditor_name: string;
  creditor_iban: string;
  amount: number;
  currency: string;
  remittance: string | null;
  e2e_id: string | null;
  created_at: string;
}> {
  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      `SELECT payment_id, trade_id, scheme, status, creditor_name, creditor_iban, amount, currency, remittance, e2e_id, created_at
       FROM payments
       WHERE payment_id=$1
       LIMIT 1`,
      [input.paymentId]
    );
    return (res.rows[0] as any) ?? null;
  });
  if (!row) throw new Error('payment not found');
  return row;
}

export async function completeManualPayment(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; paymentId: string; status: 'executed' | 'failed' }
): Promise<Payment> {
  const iso = input.status === 'executed' ? 'ACSC' : 'RJCT';

  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT trade_id, scheme FROM payments WHERE payment_id=$1 LIMIT 1', [input.paymentId]);
    if (!res.rows[0]) throw new Error('payment not found');
    const scheme = String(res.rows[0].scheme ?? '');
    if (!scheme.startsWith('MANUAL')) {
      const e: any = new Error('Only manual payments can be completed via this endpoint');
      e.statusCode = 409;
      e.code = 'conflict';
      throw e;
    }
    await client.query('UPDATE payments SET status=$1, iso_status=$2 WHERE payment_id=$3', [input.status, iso, input.paymentId]);
    await client.query('INSERT INTO payment_attempts(org_id, payment_id, status, code, raw) VALUES($1,$2,$3,$4,$5)', [
      input.orgId,
      input.paymentId,
      input.status,
      null,
      JSON.stringify({ iso, mode: 'manual' })
    ]);
    return res.rows[0] as { trade_id: string | null; scheme: string };
  });

  const type = input.status === 'executed' ? 'payment.completed' : 'payment.failed';
  const ev: SSEEvent = {
    event_id: crypto.randomUUID(),
    type,
    ts: new Date().toISOString(),
    org_id: input.orgId,
    trade_id: row.trade_id ?? undefined,
    trace_id: input.traceId,
    actor: `user:${input.userId}`,
    data: { payment_id: input.paymentId, iso_status: iso, trace_id: input.traceId }
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

  return { payment_id: input.paymentId as any, scheme: row.scheme, status: input.status, iso_status: iso, trace_id: input.traceId };
}

export async function mockScaComplete(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; paymentId: string; status: 'executed' | 'failed' }
): Promise<Payment> {
  const iso = input.status === 'executed' ? 'ACSC' : 'RJCT';

  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT trade_id, scheme FROM payments WHERE payment_id=$1 LIMIT 1', [input.paymentId]);
    if (!res.rows[0]) throw new Error('payment not found');
    await client.query('UPDATE payments SET status=$1, iso_status=$2 WHERE payment_id=$3', [input.status, iso, input.paymentId]);
    await client.query('INSERT INTO payment_attempts(org_id, payment_id, status, code, raw) VALUES($1,$2,$3,$4,$5)', [
      input.orgId,
      input.paymentId,
      input.status,
      null,
      JSON.stringify({ iso })
    ]);
    return res.rows[0] as { trade_id: string | null; scheme: string };
  });

  const type = input.status === 'executed' ? 'payment.completed' : 'payment.failed';
  const ev: SSEEvent = {
    event_id: crypto.randomUUID(),
    type,
    ts: new Date().toISOString(),
    org_id: input.orgId,
    trade_id: row.trade_id ?? undefined,
    trace_id: input.traceId,
    actor: `user:${input.userId}`,
    data: { payment_id: input.paymentId, iso_status: iso, trace_id: input.traceId }
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

  return { payment_id: input.paymentId, scheme: row.scheme, status: input.status, iso_status: iso, trace_id: input.traceId };
}
