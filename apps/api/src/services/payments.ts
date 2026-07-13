import type pg from 'pg';
import { createHash } from 'node:crypto';
import type { ExecutePaymentIntentRequest, Payment, PaymentExecutionPayload, PaymentListItem, RoutesRequest, RoutesResponse, SSEEvent } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import { setAppContext, withTx } from '@traibox/db';
import { capabilitiesFor, getPaymentAdapter, getTrueLayerPaymentConfig, selectPaymentRail } from './payment-adapters.js';
import {
  ProtectedExecutionError,
  authorizeProtectedExecution,
  consumeProtectedExecutionApproval,
  hashCanonicalPayload,
  idempotencyFingerprint,
  normalizePaymentExecutionPayload,
  type CanonicalPaymentExecutionPayload,
  type ProtectedExecutionBinding
} from '../domains/approvals/protected-execution.js';
import {
  getIdempotentResponseInTransaction,
  lockIdempotencyTransaction,
  putIdempotentResponseInTransaction
} from './idempotency.js';
export { selectPaymentRail } from './payment-adapters.js';

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
  const activeProvider = manualRecommended ? 'manual' : profile.payments.active_provider;
  const activeCapabilities = capabilitiesFor(activeProvider);

  const routes: RoutesResponse['routes'] = [
    {
      route_id: 'r_sepa_instant',
      scheme: 'SEPA_INSTANT',
      provider: activeProvider,
      capabilities: activeCapabilities,
      fee: profile.payments.defaults.sepa_instant_fee,
      eta_minutes: profile.payments.defaults.sepa_instant_eta_minutes,
      recommended: !manualRecommended && input.input.urgency === 'instant'
    },
    {
      route_id: 'r_sepa',
      scheme: 'SEPA',
      provider: activeProvider,
      capabilities: activeCapabilities,
      fee: profile.payments.defaults.sepa_fee,
      eta_minutes: profile.payments.defaults.sepa_eta_minutes,
      recommended: !manualRecommended && input.input.urgency !== 'instant'
    }
  ];

  if (profile.payments.manual.enabled) {
    routes.push({
      route_id: 'r_manual',
      scheme: 'MANUAL_TRANSFER',
      provider: 'manual',
      capabilities: capabilitiesFor('manual'),
      fee: 0,
      eta_minutes: input.input.urgency === 'instant' ? profile.payments.defaults.sepa_instant_eta_minutes : profile.payments.defaults.sepa_eta_minutes,
      recommended: manualRecommended,
      fallback: true
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
  input: {
    orgId: string;
    userId: string;
    traceId: string;
    profile: Profile;
    approvalId: string;
    paymentIntentId: string;
    execution: PaymentExecutionPayload | ExecutePaymentIntentRequest;
    idempotencyKey: string;
    idempotencyRoute: string;
  }
): Promise<Payment> {
  const { orgId, userId, traceId } = input;
  let attemptedPayloadHash = hashCanonicalPayload(input.execution);
  try {
    return await withTx(pool, async (client) => {
      await setAppContext(client, { userId, orgId });
      await assertProtectedInitiatorRole(client, { orgId, userId });

      const intentResult = await client.query<{ trade_id: string | null; payload_json: Record<string, unknown>; status: string }>(
        `SELECT trade_id, payload_json, status
           FROM alpha_objects
          WHERE object_id=$1 AND org_id=$2 AND type='payment_intent'
          FOR UPDATE`,
        [input.paymentIntentId, orgId]
      );
      const paymentIntent = intentResult.rows[0];
      if (!paymentIntent) throw protectedError('not_found', 'Payment intent not found', 404);

      const approvalResult = await client.query<{ payload_json: Record<string, unknown> }>(
        `SELECT payload_json
           FROM alpha_objects
          WHERE object_id=$1 AND org_id=$2
          FOR UPDATE`,
        [input.approvalId, orgId]
      );
      const approvalPayload = approvalResult.rows[0]?.payload_json;
      if (!approvalPayload) throw protectedError('not_found', 'Approval not found', 404);
      const binding = asPaymentBinding(approvalPayload.protected_execution_binding);
      const execution = mergePaymentExecution(input.execution, binding.payload);
      const canonicalPayload = normalizePaymentExecutionPayload({
        paymentIntentId: input.paymentIntentId,
        targetTradeId: paymentIntent.trade_id,
        execution
      });
      attemptedPayloadHash = hashCanonicalPayload(canonicalPayload);
      const requestHash = hashCanonicalPayload({
        approval_id: input.approvalId,
        action: 'send_payment',
        target: { type: 'payment_intent', id: input.paymentIntentId },
        payload: canonicalPayload
      });

      await lockIdempotencyTransaction(client, { orgId, route: input.idempotencyRoute, key: input.idempotencyKey });
      const idempotent = await getIdempotentResponseInTransaction(client, {
        orgId,
        route: input.idempotencyRoute,
        key: input.idempotencyKey,
        requestHash
      });
      if (idempotent) return idempotent.response_json as Payment;

      const authorization = await authorizeProtectedExecution(client, {
        orgId,
        approvalId: input.approvalId,
        action: 'send_payment',
        target: { type: 'payment_intent', id: input.paymentIntentId },
        payload: canonicalPayload
      });
      if (authorization.existingConsumption) {
        const original = await loadPaymentResult(client, authorization.existingConsumption.result_id);
        await putIdempotentResponseInTransaction(client, {
          orgId,
          route: input.idempotencyRoute,
          key: input.idempotencyKey,
          requestHash,
          statusCode: 200,
          responseJson: original
        });
        return original;
      }

      const existingExecution = objectRecord(paymentIntent.payload_json?.payment_execution);
      if (typeof existingExecution.payment_id === 'string' && existingExecution.payment_id) {
        throw protectedError('protected_action_not_approved', 'Payment intent already has an execution payment', 409, 'duplicate_payment_execution');
      }
      if (paymentIntent.status !== 'approved') {
        throw protectedError('validation_error', 'Payment intent is not in an executable approved state', 400, 'payment_intent_not_executable');
      }

      await assertTradeBinding(client, canonicalPayload.trade_id);
      const account = await loadUsableDebtorAccount(client, canonicalPayload);
      const tl = getTrueLayerPaymentConfig();
      const selectedRail = selectPaymentRail({
        profile: input.profile,
        routeId: canonicalPayload.route_id,
        fromProviderId: account.provider_id,
        trueLayerConfigured: Boolean(tl)
      });
      assertSelectedPaymentRail(input.profile, canonicalPayload.route_id, selectedRail.mode, selectedRail.capabilities, canonicalPayload.currency, account.currency);

      let scheme = canonicalPayload.route_id === 'r_sepa_instant' ? 'SEPA_INSTANT' : canonicalPayload.route_id === 'r_manual' ? 'MANUAL_TRANSFER' : 'SEPA';
      if (selectedRail.mode === 'manual') scheme = 'MANUAL_TRANSFER';
      const paymentId = deterministicExecutionId('payment', orgId, input.approvalId, authorization.payloadHash);
      const adapter = getPaymentAdapter(selectedRail, { trueLayerConfig: tl });
      let prepared;
      try {
        prepared = await adapter.prepareExecution({
          orgId,
          tradeId: canonicalPayload.trade_id,
          paymentId,
          scheme,
          profile: input.profile,
          input: toPaymentExecutionPayload(canonicalPayload),
          providerIdempotencyKey: `traibox-${input.approvalId}`
        });
      } catch (error) {
        throw protectedError(
          'external_provider_error',
          error instanceof Error ? error.message : 'Payment provider preparation failed',
          502,
          'provider_failure'
        );
      }

      await client.query(
        `INSERT INTO payments(payment_id, org_id, trade_id, scheme, debtor_account_id, creditor_name, creditor_iban, amount, currency, purpose, remittance, e2e_id, status, iso_status, provider_ref, trace_id, idempotency_key, redirect_url, provider_id, provider_mode, provider_capabilities, provider_fallback, provider_reason, adapter_id, adapter_metadata)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [
          paymentId,
          orgId,
          canonicalPayload.trade_id,
          scheme,
          canonicalPayload.from_account_id,
          canonicalPayload.creditor_name,
          canonicalPayload.creditor_iban,
          canonicalPayload.amount,
          canonicalPayload.currency,
          null,
          canonicalPayload.remittance,
          canonicalPayload.e2e_id,
          prepared.status,
          null,
          prepared.providerRef,
          traceId,
          input.idempotencyKey,
          prepared.redirectUrl,
          selectedRail.provider,
          selectedRail.mode,
          JSON.stringify(selectedRail.capabilities),
          selectedRail.fallback,
          selectedRail.reason,
          prepared.adapterId,
          JSON.stringify(prepared.adapterMetadata)
        ]
      );
      await client.query('INSERT INTO payment_attempts(org_id, payment_id, status, code, raw) VALUES($1,$2,$3,$4,$5)', [
        orgId,
        paymentId,
        prepared.status,
        null,
        JSON.stringify({ scheme, ...prepared.attemptRaw, fallback: selectedRail.fallback, reason: selectedRail.reason })
      ]);
      const executedAt = new Date().toISOString();
      await client.query(
        `UPDATE alpha_objects
            SET status=$1,
                payload_json=payload_json || $2::jsonb,
                permissions_json=permissions_json || $3::jsonb,
                trace_id=$4
          WHERE object_id=$5 AND org_id=$6`,
        [
          prepared.status === 'executed' ? 'completed' : 'in_progress',
          JSON.stringify({
            payment_id: paymentId,
            payment_execution: {
              payment_id: paymentId,
              payment_status: prepared.status,
              scheme,
              route_id: canonicalPayload.route_id,
              from_account_id: canonicalPayload.from_account_id,
              approval_object_id: input.approvalId,
              payload_hash: authorization.payloadHash,
              started_at: executedAt,
              protected_action: 'send_payment'
            }
          }),
          JSON.stringify({ protected_execution_started: true, payment_execution_approved: true }),
          traceId,
          input.paymentIntentId,
          orgId
        ]
      );
      const evidence = protectedExecutionEvidence({
        input,
        action: 'send_payment',
        targetType: 'payment_intent',
        targetId: input.paymentIntentId,
        payloadHash: authorization.payloadHash,
        resultType: 'payment',
        resultId: paymentId,
        classification: 'succeeded',
        at: executedAt
      });
      await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
        orgId,
        canonicalPayload.trade_id,
        `user:${userId}`,
        'protected_execution.succeeded',
        JSON.stringify(evidence)
      ]);
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        crypto.randomUUID(),
        orgId,
        canonicalPayload.trade_id,
        'payment.executing',
        traceId,
        `user:${userId}`,
        JSON.stringify({
          payment_id: paymentId,
          approval_id: input.approvalId,
          payload_hash: authorization.payloadHash,
          mode: selectedRail.mode === 'manual' ? 'manual' : 'provider',
          provider: selectedRail.provider,
          provider_mode: selectedRail.mode,
          adapter_id: prepared.adapterId,
          fallback: selectedRail.fallback,
          trace_id: traceId
        })
      ]);
      const memoryEventId = crypto.randomUUID();
      await client.query(
        `INSERT INTO alpha_memory_events(memory_event_id, org_id, level, trade_id, object_id, kind, signal, payload_json, trace_id)
         VALUES($1,$2,'L1',$3,$4,'payment.intent.execution','payment.created',$5,$6)`,
        [
          memoryEventId,
          orgId,
          canonicalPayload.trade_id,
          input.paymentIntentId,
          JSON.stringify({
            payment_id: paymentId,
            approval_id: input.approvalId,
            payload_hash: authorization.payloadHash,
            status: prepared.status,
            scheme,
            route_id: canonicalPayload.route_id
          }),
          traceId
        ]
      );
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        crypto.randomUUID(),
        orgId,
        canonicalPayload.trade_id,
        'memory.updated',
        traceId,
        `user:${userId}`,
        JSON.stringify({
          memory_event_id: memoryEventId,
          level: 'L1',
          kind: 'payment.intent.execution',
          signal: 'payment.created',
          trace_id: traceId
        })
      ]);
      await consumeProtectedExecutionApproval(client, authorization, {
        request_hash: requestHash,
        result_type: 'payment',
        result_id: paymentId,
        idempotency_fingerprint: idempotencyFingerprint(input.idempotencyKey),
        actor_id: userId,
        trace_id: traceId,
        consumed_at: executedAt
      });

      const response: Payment = {
        payment_id: paymentId,
        scheme,
        status: prepared.status,
        provider: selectedRail.provider,
        provider_mode: selectedRail.mode,
        adapter_id: prepared.adapterId,
        provider_fallback: selectedRail.fallback,
        provider_reason: selectedRail.reason,
        redirect_url: prepared.redirectUrl ?? undefined,
        trace_id: traceId
      };
      await putIdempotentResponseInTransaction(client, {
        orgId,
        route: input.idempotencyRoute,
        key: input.idempotencyKey,
        requestHash,
        statusCode: 200,
        responseJson: response
      });
      return response;
    });
  } catch (error) {
    await recordProtectedExecutionFailure(pool, input, error, attemptedPayloadHash);
    throw error;
  }
}

function asPaymentBinding(value: unknown): ProtectedExecutionBinding {
  const item = objectRecord(value);
  const target = objectRecord(item.target);
  const payload = objectRecord(item.payload);
  if (
    item.schema_version !== 'protected-execution-v1' ||
    item.action !== 'send_payment' ||
    target.type !== 'payment_intent' ||
    typeof target.id !== 'string' ||
    typeof item.payload_hash !== 'string' ||
    !Object.keys(payload).length
  ) {
    throw protectedError('protected_action_not_approved', 'Approval is missing a valid frozen payment binding', 409);
  }
  return item as unknown as ProtectedExecutionBinding;
}

function mergePaymentExecution(
  requestedValue: PaymentExecutionPayload | ExecutePaymentIntentRequest,
  frozenValue: Record<string, unknown>
): PaymentExecutionPayload {
  const requested = objectRecord(requestedValue);
  const frozen = objectRecord(frozenValue);
  return {
    trade_id: valueOrFrozen(requested, frozen, 'trade_id') as string | undefined,
    route_id: valueOrFrozen(requested, frozen, 'route_id') as string,
    from_account_id: valueOrFrozen(requested, frozen, 'from_account_id') as string,
    creditor_name: valueOrFrozen(requested, frozen, 'creditor_name') as string,
    creditor_iban: valueOrFrozen(requested, frozen, 'creditor_iban') as string,
    amount: valueOrFrozen(requested, frozen, 'amount') as number,
    currency: valueOrFrozen(requested, frozen, 'currency') as string,
    remittance: valueOrFrozen(requested, frozen, 'remittance') as string | undefined,
    e2e_id: valueOrFrozen(requested, frozen, 'e2e_id') as string
  };
}

function valueOrFrozen(requested: Record<string, unknown>, frozen: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(requested, key) ? requested[key] : frozen[key];
}

async function assertProtectedInitiatorRole(client: pg.PoolClient, input: { orgId: string; userId: string }): Promise<void> {
  const role = await client.query<{ role: string }>('SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2 LIMIT 1', [input.orgId, input.userId]);
  if (!role.rows[0] || !['owner', 'admin', 'finance'].includes(role.rows[0].role)) {
    throw protectedError('forbidden', 'Caller role cannot initiate protected payment execution', 403, 'unauthorized_initiator');
  }
}

async function assertTradeBinding(client: pg.PoolClient, tradeId: string | null): Promise<void> {
  if (!tradeId) return;
  const trade = await client.query('SELECT 1 FROM trades WHERE trade_id=$1 AND org_id=app.current_org() LIMIT 1', [tradeId]);
  if (!trade.rows[0]) throw protectedError('not_found', 'Payment trade binding not found', 404);
}

async function loadUsableDebtorAccount(
  client: pg.PoolClient,
  payment: CanonicalPaymentExecutionPayload
): Promise<{ provider_id: string; currency: string; status: string | null }> {
  const result = await client.query<{ provider_id: string; currency: string; status: string | null }>(
    `SELECT provider_id, currency, status
       FROM bank_accounts
      WHERE account_id=$1 AND org_id=app.current_org()
      FOR UPDATE`,
    [payment.from_account_id]
  );
  const account = result.rows[0];
  if (!account) throw protectedError('not_found', 'Debtor account not found in this organization', 404, 'debtor_account_not_found');
  if (account.status && ['blocked', 'closed', 'disabled', 'expired', 'revoked'].includes(account.status.toLowerCase())) {
    throw protectedError('validation_error', 'Debtor account is not usable', 400, 'debtor_account_unusable');
  }
  return { provider_id: account.provider_id, currency: account.currency.toUpperCase(), status: account.status };
}

function assertSelectedPaymentRail(
  profile: Profile,
  routeId: string,
  mode: string,
  capabilities: string[],
  paymentCurrency: string,
  accountCurrency: string
): void {
  if (!['r_sepa', 'r_sepa_instant', 'r_manual'].includes(routeId)) {
    throw protectedError('validation_error', 'Selected payment route is not supported', 400, 'invalid_payment_route');
  }
  if (routeId === 'r_manual' && !profile.payments.manual.enabled) {
    throw protectedError('unsafe_action_blocked', 'Manual payment execution is disabled by the deployment profile', 403, 'payment_mode_disabled');
  }
  if (mode === 'truelayer' && !profile.payments.truelayer.enabled) {
    throw protectedError('unsafe_action_blocked', 'TrueLayer payment execution is disabled by the deployment profile', 403, 'payment_mode_disabled');
  }
  if (accountCurrency !== paymentCurrency && !capabilities.includes('fx_conversion')) {
    throw protectedError('validation_error', 'Debtor account currency does not support the approved payment currency', 400, 'account_currency_mismatch');
  }
}

function toPaymentExecutionPayload(payload: CanonicalPaymentExecutionPayload): PaymentExecutionPayload {
  return {
    trade_id: payload.trade_id ?? undefined,
    route_id: payload.route_id,
    from_account_id: payload.from_account_id,
    creditor_name: payload.creditor_name,
    creditor_iban: payload.creditor_iban,
    amount: payload.amount,
    currency: payload.currency,
    remittance: payload.remittance ?? undefined,
    e2e_id: payload.e2e_id
  };
}

async function loadPaymentResult(client: pg.PoolClient, paymentId: string): Promise<Payment> {
  const result = await client.query(
    `SELECT payment_id, scheme, status, provider_id, provider_mode, adapter_id,
            provider_fallback, provider_reason, iso_status, return_reason, redirect_url, trace_id
       FROM payments
      WHERE payment_id=$1 AND org_id=app.current_org()
      LIMIT 1`,
    [paymentId]
  );
  const row = result.rows[0];
  if (!row) throw protectedError('unsafe_action_blocked', 'Consumed approval result is missing', 403, 'consumption_result_missing');
  return {
    payment_id: row.payment_id,
    scheme: row.scheme,
    status: row.status,
    provider: row.provider_id ?? undefined,
    provider_mode: row.provider_mode ?? undefined,
    adapter_id: row.adapter_id ?? undefined,
    provider_fallback: row.provider_fallback ?? undefined,
    provider_reason: row.provider_reason ?? undefined,
    iso_status: row.iso_status ?? undefined,
    return_reason: row.return_reason ?? undefined,
    redirect_url: row.redirect_url ?? undefined,
    trace_id: row.trace_id
  } as Payment;
}

function deterministicExecutionId(kind: string, orgId: string, approvalId: string, payloadHash: string): string {
  const hex = createHash('sha256').update(`${kind}\u0000${orgId}\u0000${approvalId}\u0000${payloadHash}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16]!, 16) % 4]!;
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function protectedExecutionEvidence(input: {
  input: { orgId: string; userId: string; traceId: string; approvalId: string; idempotencyKey: string };
  action: 'send_payment';
  targetType: 'payment_intent';
  targetId: string;
  payloadHash: string;
  resultType: 'payment';
  resultId: string;
  classification: string;
  at: string;
}): Record<string, unknown> {
  return {
    approval_id: input.input.approvalId,
    action: input.action,
    target: { type: input.targetType, id: input.targetId },
    payload_hash: input.payloadHash,
    actor_id: input.input.userId,
    org_id: input.input.orgId,
    idempotency_fingerprint: idempotencyFingerprint(input.input.idempotencyKey),
    result: { type: input.resultType, id: input.resultId },
    trace_id: input.input.traceId,
    classification: input.classification,
    at: input.at
  };
}

async function recordProtectedExecutionFailure(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; approvalId: string; paymentIntentId: string; idempotencyKey: string },
  error: unknown,
  payloadHash: string
): Promise<void> {
  const codedError = error as { code?: unknown };
  const code = typeof codedError?.code === 'string' ? codedError.code : 'internal_error';
  const classification = error instanceof ProtectedExecutionError ? error.classification : code;
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
      input.orgId,
      null,
      `user:${input.userId}`,
      'protected_execution.denied',
      JSON.stringify({
        approval_id: input.approvalId,
        action: 'send_payment',
        target: { type: 'payment_intent', id: input.paymentIntentId },
        payload_hash: payloadHash,
        payload_hash_scope: 'attempted_canonical_execution',
        actor_id: input.userId,
        org_id: input.orgId,
        idempotency_fingerprint: idempotencyFingerprint(input.idempotencyKey),
        trace_id: input.traceId,
        classification,
        error_code: code,
        at: new Date().toISOString()
      })
    ]);
  }).catch(() => undefined);
}

function protectedError(code: string, message: string, statusCode: number, classification = code): ProtectedExecutionError {
  return new ProtectedExecutionError(code, message, statusCode, classification);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export async function getPaymentStatus(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; paymentId: string }
): Promise<Payment> {
  const row = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query('SELECT payment_id, scheme, status, provider_id, provider_mode, provider_fallback, provider_reason, adapter_id, iso_status, return_reason, redirect_url, trace_id FROM payments WHERE payment_id=$1 LIMIT 1', [
      input.paymentId
    ]);
    return res.rows[0] ?? null;
  });
  if (!row) throw new Error('payment not found');
  return {
    payment_id: row.payment_id,
    scheme: row.scheme,
    status: row.status,
    provider: row.provider_id ?? undefined,
    provider_mode: row.provider_mode ?? undefined,
    adapter_id: row.adapter_id ?? undefined,
    provider_fallback: row.provider_fallback ?? undefined,
    provider_reason: row.provider_reason ?? undefined,
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
  provider_id: string | null;
  provider_mode: string | null;
  provider_fallback: boolean | null;
  provider_reason: string | null;
  adapter_id: string | null;
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
      `SELECT payment_id, trade_id, scheme, status, provider_id, provider_mode, provider_fallback, provider_reason, adapter_id, creditor_name, creditor_iban, amount, currency, remittance, e2e_id, created_at
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

export async function listPayments(
  pool: pg.Pool,
  input: { orgId: string; userId: string; limit?: number }
): Promise<{ payments: PaymentListItem[] }> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const rows = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      `SELECT payment_id, trade_id, scheme, debtor_account_id, creditor_name, creditor_iban,
              amount, currency, purpose, remittance, status, iso_status, return_reason, created_at, updated_at
       FROM payments
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  });
  const payments = rows.map((r: any) => ({ ...r, amount: Number(r.amount) })) as PaymentListItem[];
  return { payments };
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
