import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  BuildNetworkTrustResponse,
  FinanceFundingResponse,
  ListOrgMessagesResponse,
  ListPaymentsResponse,
  OfferResponse,
  Payment,
  PaymentExecutionPayload,
  RoutesResponse
} from '@traibox/contracts';
import { setAppContext, withTx } from '@traibox/db';
import { parseProfileYaml } from '@traibox/profiles';

import { buildServer } from '../server.js';
import {
  authorizeProtectedExecution,
  hashCanonicalPayload,
  type ProtectedExecutionBinding,
  type ProtectedExecutionConsumption
} from '../domains/approvals/protected-execution.js';
import { consumeProtectedExecutionApproval } from '../domains/approvals/protected-execution-consumption.js';
import { requestApprovalAlpha } from './alpha.js';
import { executePayment } from './payments.js';

// Money-moving rails end-to-end: payments (routes → execute → complete → list),
// funding (request → ranked offers → accept → reservation), network trust
// (evidence → trust context), and the org-wide message inbox. Same gating as
// alpha.scenario.test.ts: runs only when ALPHA_INTEGRATION_DATABASE_URL is set.
const TEST_DB_URL = process.env.ALPHA_INTEGRATION_DATABASE_URL;
const DEV_USER_ID = '00000000-0000-0000-0000-0000000000aa';

const run = TEST_DB_URL ? describe : describe.skip;

run('TRAIBOX money rails against Postgres', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let orgId: string;
  let tradeId: string;
  let accountId: string;
  let otherOrgId: string;
  let otherTradeId: string;
  let otherAccountId: string;
  let testPool: pg.Pool;
  let fixtureSequence = 0;

  beforeAll(async () => {
    if (!TEST_DB_URL) return;
    assertLocalTestDatabase(TEST_DB_URL);
    await resetDatabase(TEST_DB_URL);
    await applyMigrations(TEST_DB_URL);
    testPool = new pg.Pool({ connectionString: TEST_DB_URL });
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.AUTH_MODE = 'dev';
    process.env.DEV_USER_ID = DEV_USER_ID;
    process.env.DEPLOYMENT_PROFILE_PATH =
      process.env.DEPLOYMENT_PROFILE_PATH ?? path.join(findRepoRoot(), 'packages/profiles/profiles/dev.yaml');

    app = await buildServer();

    const created = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeaders(),
      payload: { name: 'TRAIBOX Rails Test Org', country: 'PT' }
    });
    expect(created.statusCode).toBe(200);
    orgId = created.json<{ org_id: string }>().org_id;

    const demo = await app.inject({
      method: 'POST',
      url: '/v1/demo/internal-alpha',
      headers: authHeaders(orgId),
      payload: { messy_input: 'Sell industrial sensors from Portugal to a Spanish buyer; 40% advance; buyer acceptance proof required.' }
    });
    expect(demo.statusCode).toBe(200);
    tradeId = demo.json<{ trade_id: string }>().trade_id;

    const account = await app.inject({
      method: 'POST',
      url: '/v1/banks/manual/accounts',
      headers: authHeaders(orgId),
      payload: { iban: 'PT50001000001234567890144', currency: 'EUR', name: 'Operating', bank_name: 'Banco Teste' }
    });
    expect(account.statusCode).toBe(200);
    accountId = account.json<{ account_id: string }>().account_id;

    const otherOrg = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeaders(),
      payload: { name: 'TRAIBOX Cross-Tenant Test Org', country: 'ES' }
    });
    expect(otherOrg.statusCode).toBe(200);
    otherOrgId = otherOrg.json<{ org_id: string }>().org_id;
    const otherDemo = await app.inject({
      method: 'POST',
      url: '/v1/demo/internal-alpha',
      headers: authHeaders(otherOrgId),
      payload: { messy_input: 'Cross-tenant isolation fixture for protected execution.' }
    });
    expect(otherDemo.statusCode).toBe(200);
    otherTradeId = otherDemo.json<{ trade_id: string }>().trade_id;
    const otherAccount = await app.inject({
      method: 'POST',
      url: '/v1/banks/manual/accounts',
      headers: authHeaders(otherOrgId),
      payload: { iban: 'ES9121000418450200051332', currency: 'EUR', name: 'Other tenant', bank_name: 'Banco Aislado' }
    });
    expect(otherAccount.statusCode).toBe(200);
    otherAccountId = otherAccount.json<{ account_id: string }>().account_id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await testPool?.end();
  });

  async function createPaymentFixture(input: {
    orgId?: string;
    tradeId?: string;
    accountId?: string;
    overrides?: Partial<PaymentExecutionPayload>;
  } = {}) {
    const fixtureOrgId = input.orgId ?? orgId;
    const fixtureTradeId = input.tradeId ?? tradeId;
    const fixtureAccountId = input.accountId ?? accountId;
    const execution: PaymentExecutionPayload = {
      trade_id: fixtureTradeId,
      route_id: 'r_manual',
      from_account_id: fixtureAccountId,
      creditor_name: 'Protected Supplier',
      creditor_iban: 'PT50003300004555698522119',
      amount: 1000 + (fixtureSequence += 1),
      currency: 'EUR',
      remittance: `SEC-${randomUUID()}`,
      e2e_id: randomUUID(),
      ...input.overrides
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/objects/payment_intent',
      headers: authHeaders(fixtureOrgId),
      payload: {
        title: `Protected payment ${execution.e2e_id}`,
        status: 'approval_required',
        origin_workspace: 'finance',
        trade_id: fixtureTradeId,
        payload: {
          amount: execution.amount,
          currency: execution.currency,
          beneficiary: execution.creditor_name,
          beneficiary_iban: execution.creditor_iban,
          purpose: execution.remittance,
          e2e_id: execution.e2e_id,
          route_id: execution.route_id,
          from_account_id: execution.from_account_id
        }
      }
    });
    expect(response.statusCode).toBe(200);
    return {
      orgId: fixtureOrgId,
      intentId: response.json<{ object: { object_id: string } }>().object.object_id,
      execution
    };
  }

  async function createApproval(input: {
    orgId?: string;
    target: { type: string; id: string };
    action: string;
    execution?: PaymentExecutionPayload;
    decision?: 'pending' | 'approved' | 'rejected';
  }) {
    const fixtureOrgId = input.orgId ?? orgId;
    const response = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(fixtureOrgId),
      payload: {
        target: input.target,
        protected_action: input.action,
        proposed_action: `Security test for ${input.action}`,
        ...(input.execution ? { execution_payload: input.execution } : {}),
        step_up_required: true
      }
    });
    expect(response.statusCode).toBe(200);
    const approvalId = response.json<{ approval: { object_id: string } }>().approval.object_id;
    if (input.decision && input.decision !== 'pending') {
      const decision = await app.inject({
        method: 'POST',
        url: `/v1/approvals/${approvalId}/decision`,
        headers: authHeaders(fixtureOrgId),
        payload: {
          decision: input.decision,
          notes: `${input.decision} exact protected execution in the integration security matrix.`,
          step_up_verified: true,
          residual_risks_acknowledged: true
        }
      });
      expect(decision.statusCode).toBe(200);
    }
    return approvalId;
  }

  async function executeDirectPayment(input: {
    fixture: Awaited<ReturnType<typeof createPaymentFixture>>;
    approvalId?: string;
    idempotencyKey?: string;
    overrides?: Partial<PaymentExecutionPayload>;
    includeApproval?: boolean;
    includeIdempotency?: boolean;
  }) {
    return app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      headers: {
        ...authHeaders(input.fixture.orgId),
        ...(input.includeIdempotency === false ? {} : { 'x-idempotency-key': input.idempotencyKey ?? randomUUID() })
      },
      payload: {
        ...input.fixture.execution,
        ...input.overrides,
        ...(input.includeApproval === false ? {} : { approval_id: input.approvalId }),
        payment_intent_id: input.fixture.intentId
      }
    });
  }

  async function requestFundingFixture(input: { orgId?: string; tradeId?: string; amount?: number } = {}) {
    const fixtureOrgId = input.orgId ?? orgId;
    let fixtureTradeId = input.tradeId;
    if (!fixtureTradeId) {
      const trade = await app.inject({
        method: 'POST',
        url: '/v1/demo/internal-alpha',
        headers: authHeaders(fixtureOrgId),
        payload: { messy_input: `Isolated protected funding fixture ${randomUUID()}.` }
      });
      expect(trade.statusCode).toBe(200);
      fixtureTradeId = trade.json<{ trade_id: string }>().trade_id;
    }
    const response = await app.inject({
      method: 'POST',
      url: '/v1/finance/offers',
      headers: { ...authHeaders(fixtureOrgId), 'x-idempotency-key': randomUUID() },
      payload: { trade_id: fixtureTradeId, amount: input.amount ?? 200000 + (fixtureSequence += 1) * 100, tenor_days: 60, sustainable: { enabled: true } }
    });
    expect(response.statusCode).toBe(200);
    const offers = response.json<OfferResponse>().offers;
    expect(offers.length).toBeGreaterThan(1);
    return { orgId: fixtureOrgId, tradeId: fixtureTradeId, offers };
  }

  async function acceptFundingOffer(input: {
    orgId?: string;
    offerId: string;
    approvalId?: string;
    idempotencyKey?: string;
    includeApproval?: boolean;
    includeIdempotency?: boolean;
  }) {
    const fixtureOrgId = input.orgId ?? orgId;
    return app.inject({
      method: 'POST',
      url: `/v1/finance/offers/${input.offerId}/accept`,
      headers: {
        ...authHeaders(fixtureOrgId),
        ...(input.includeIdempotency === false ? {} : { 'x-idempotency-key': input.idempotencyKey ?? randomUUID() })
      },
      payload: input.includeApproval === false ? {} : { approval_id: input.approvalId }
    });
  }

  async function protectedDenialCount(action: 'send_payment' | 'accept_funding_offer'): Promise<number> {
    const result = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE org_id=$1 AND action='protected_execution.denied' AND payload_json->>'action'=$2",
      [orgId, action]
    );
    return Number(result.rows[0]!.count);
  }

  it('connects a manual account, routes, executes, completes, and lists the payment', async () => {
    const routes = await app.inject({
      method: 'POST',
      url: '/v1/payments/routes',
      headers: authHeaders(orgId),
      payload: { from_account_id: accountId, to_iban: 'PT50003300004555698522119', amount: 18420, currency: 'EUR', urgency: 'standard' }
    });
    expect(routes.statusCode).toBe(200);
    const routesBody = routes.json<RoutesResponse>();
    expect(routesBody.routes.length).toBeGreaterThan(0);
    const manualRoute = routesBody.routes.find((route) => route.route_id === 'r_manual');
    expect(manualRoute, 'dev profile exposes the manual rail for manual accounts').toBeDefined();
    expect(manualRoute!.recommended).toBe(true);

    const idemKey = randomUUID();
    const executeBody = {
      trade_id: tradeId,
      route_id: manualRoute!.route_id,
      from_account_id: accountId,
      creditor_name: 'Adega Atlantica',
      creditor_iban: 'PT50003300004555698522119',
      amount: 18420,
      currency: 'EUR',
      remittance: 'INV-TEST-0001',
      e2e_id: randomUUID()
    };
    const paymentIntent = await app.inject({
      method: 'POST',
      url: '/v1/objects/payment_intent',
      headers: authHeaders(orgId),
      payload: {
        title: 'Rails approved direct payment',
        status: 'approval_required',
        origin_workspace: 'finance',
        trade_id: tradeId,
        payload: {
          amount: executeBody.amount,
          currency: executeBody.currency,
          beneficiary: executeBody.creditor_name,
          beneficiary_iban: executeBody.creditor_iban,
          purpose: executeBody.remittance,
          e2e_id: executeBody.e2e_id,
          route_id: executeBody.route_id,
          from_account_id: executeBody.from_account_id
        }
      }
    });
    expect(paymentIntent.statusCode).toBe(200);
    const paymentIntentId = paymentIntent.json<{ object: { object_id: string } }>().object.object_id;
    const approvalRequest = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(orgId),
      payload: {
        target: { type: 'payment_intent', id: paymentIntentId },
        protected_action: 'send_payment',
        proposed_action: 'Approve the exact direct-payment command used by the rails integration scenario.',
        execution_payload: executeBody,
        step_up_required: true
      }
    });
    expect(approvalRequest.statusCode).toBe(200);
    const approvalId = approvalRequest.json<{ approval: { object_id: string } }>().approval.object_id;
    const approvalDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${approvalId}/decision`,
      headers: authHeaders(orgId),
      payload: {
        decision: 'approved',
        notes: 'Owner approves the exact payment payload for the integration scenario.',
        step_up_verified: true,
        residual_risks_acknowledged: true
      }
    });
    expect(approvalDecision.statusCode).toBe(200);
    const approvedExecuteBody = { ...executeBody, approval_id: approvalId, payment_intent_id: paymentIntentId };
    const execute = await app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': idemKey },
      payload: approvedExecuteBody
    });
    expect(execute.statusCode).toBe(200);
    const payment = execute.json<Payment>();
    expect(payment.payment_id).toBeTruthy();
    expect(payment.scheme).toBe('MANUAL_TRANSFER');

    // Same key + same body → the stored response replays; no duplicate payment.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': idemKey },
      payload: approvedExecuteBody
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<Payment>().payment_id).toBe(payment.payment_id);

    const list = await app.inject({ method: 'GET', url: '/v1/payments?limit=50', headers: authHeaders(orgId) });
    expect(list.statusCode).toBe(200);
    const listBody = list.json<ListPaymentsResponse>();
    const occurrences = listBody.payments.filter((p) => p.creditor_iban === executeBody.creditor_iban);
    expect(occurrences).toHaveLength(1);
    const listed = occurrences[0]!;
    expect(listed.payment_id).toBe(payment.payment_id);
    expect(listed.creditor_name).toBe('Adega Atlantica');
    expect(listed.amount).toBe(18420);
    expect(listed.trade_id).toBe(tradeId);
    expect(['created', 'pending_sca']).toContain(listed.status);

    const complete = await app.inject({
      method: 'POST',
      url: '/v1/payments/manual/complete',
      headers: authHeaders(orgId),
      payload: { payment_id: payment.payment_id, status: 'executed' }
    });
    expect(complete.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/v1/payments?limit=50', headers: authHeaders(orgId) });
    const executed = after.json<ListPaymentsResponse>().payments.find((p) => p.payment_id === payment.payment_id);
    expect(executed!.status).toBe('executed');

    const detail = await app.inject({ method: 'GET', url: `/v1/payments/${payment.payment_id}`, headers: authHeaders(orgId) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ status: string }>().status).toBe('executed');
  }, 60_000);

  it('rejects missing, invalid, cross-tenant, mismatched, or unauthorized direct-payment approvals without side effects', async () => {
    const fixture = await createPaymentFixture();
    let denialCount = await protectedDenialCount('send_payment');
    const eventCountBefore = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM trade_events WHERE org_id=$1 AND type='payment.executing'",
      [orgId]
    );

    const missingApproval = await executeDirectPayment({ fixture, includeApproval: false });
    expect(missingApproval.statusCode).toBe(409);
    expect(missingApproval.json<{ error: string }>().error).toBe('approval_required');
    expect(await protectedDenialCount('send_payment')).toBe(++denialCount);

    const missingIdempotencyApproval = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'approved'
    });
    const missingIdempotency = await executeDirectPayment({
      fixture,
      approvalId: missingIdempotencyApproval,
      includeIdempotency: false
    });
    expect(missingIdempotency.statusCode).toBe(400);
    expect(missingIdempotency.json<{ error: string }>().error).toBe('missing_idempotency');
    expect(await protectedDenialCount('send_payment')).toBe(++denialCount);

    const unknownApproval = await executeDirectPayment({ fixture, approvalId: randomUUID() });
    expect(unknownApproval.statusCode).toBe(404);
    expect(unknownApproval.json<{ error: string }>().error).toBe('not_found');
    expect(await protectedDenialCount('send_payment')).toBe(++denialCount);

    const pendingApproval = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'pending'
    });
    const pending = await executeDirectPayment({ fixture, approvalId: pendingApproval });
    expect(pending.statusCode).toBe(409);
    expect(pending.json<{ error: string }>().error).toBe('protected_action_not_approved');
    expect(await protectedDenialCount('send_payment')).toBe(++denialCount);

    const rejectedFixture = await createPaymentFixture();
    const rejectedApproval = await createApproval({
      target: { type: 'payment_intent', id: rejectedFixture.intentId },
      action: 'send_payment',
      execution: rejectedFixture.execution,
      decision: 'rejected'
    });
    const rejected = await executeDirectPayment({ fixture: rejectedFixture, approvalId: rejectedApproval });
    expect(rejected.statusCode).toBe(409);

    const wrongActionApproval = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'approved'
    });
    await testPool.query(
      `UPDATE alpha_objects
          SET payload_json=jsonb_set(
            jsonb_set(payload_json, '{protected_action}', $1::jsonb),
            '{protected_execution_binding,action}', $1::jsonb
          )
        WHERE object_id=$2 AND org_id=$3`,
      [JSON.stringify('accept_funding_offer'), wrongActionApproval, orgId]
    );
    const wrongAction = await executeDirectPayment({ fixture, approvalId: wrongActionApproval });
    expect(wrongAction.statusCode).toBe(409);

    const wrongTypeApproval = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'approved'
    });
    await testPool.query(
      `UPDATE alpha_objects
          SET payload_json=jsonb_set(
            jsonb_set(payload_json, '{target,type}', $1::jsonb),
            '{protected_execution_binding,target,type}', $1::jsonb
          )
        WHERE object_id=$2 AND org_id=$3`,
      [JSON.stringify('funding_offer'), wrongTypeApproval, orgId]
    );
    const wrongType = await executeDirectPayment({ fixture, approvalId: wrongTypeApproval });
    expect(wrongType.statusCode).toBe(409);

    const otherTarget = await createPaymentFixture({ overrides: { ...fixture.execution, e2e_id: randomUUID() } });
    const wrongTargetApproval = await createApproval({
      target: { type: 'payment_intent', id: otherTarget.intentId },
      action: 'send_payment',
      execution: otherTarget.execution,
      decision: 'approved'
    });
    const wrongTarget = await executeDirectPayment({ fixture, approvalId: wrongTargetApproval });
    expect(wrongTarget.statusCode).toBe(409);

    const exactApproval = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'approved'
    });
    for (const overrides of [
      { amount: fixture.execution.amount + 1 },
      { currency: 'USD' },
      { creditor_name: 'Different Supplier' },
      { creditor_iban: 'DE89370400440532013000' },
      { route_id: 'r_sepa' }
    ]) {
      const mismatch = await executeDirectPayment({ fixture, approvalId: exactApproval, overrides });
      expect(mismatch.statusCode).toBe(409);
      expect(mismatch.json<{ error: string }>().error).toBe('protected_action_not_approved');
    }
    await testPool.query('UPDATE alpha_objects SET status=$1 WHERE object_id=$2 AND org_id=$3', ['cancelled', fixture.intentId, orgId]);
    const terminalIntent = await executeDirectPayment({ fixture, approvalId: exactApproval });
    expect(terminalIntent.statusCode).toBe(400);
    expect(terminalIntent.json<{ error: string }>().error).toBe('validation_error');

    const otherFixture = await createPaymentFixture({ orgId: otherOrgId, tradeId: otherTradeId, accountId: otherAccountId });
    const otherApproval = await createApproval({
      orgId: otherOrgId,
      target: { type: 'payment_intent', id: otherFixture.intentId },
      action: 'send_payment',
      execution: otherFixture.execution,
      decision: 'approved'
    });
    const crossTenant = await executeDirectPayment({ fixture, approvalId: otherApproval });
    expect(crossTenant.statusCode).toBe(404);
    expect(crossTenant.json<{ error: string }>().error).toBe('not_found');

    const foreignAccountFixture = await createPaymentFixture({ accountId: otherAccountId });
    const foreignAccountApproval = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(orgId),
      payload: {
        target: { type: 'payment_intent', id: foreignAccountFixture.intentId },
        protected_action: 'send_payment',
        proposed_action: 'Attempt to bind an account from another tenant.',
        execution_payload: foreignAccountFixture.execution,
        step_up_required: true
      }
    });
    expect(foreignAccountApproval.statusCode).toBe(400);
    expect(foreignAccountApproval.json<{ error: string }>().error).toBe('bad_request');

    const unusableAccount = await app.inject({
      method: 'POST',
      url: '/v1/banks/manual/accounts',
      headers: authHeaders(orgId),
      payload: { iban: 'PT50888888888888888888888', currency: 'EUR', name: 'Blocked after approval', bank_name: 'Security Test Bank' }
    });
    expect(unusableAccount.statusCode).toBe(200);
    const unusableAccountId = unusableAccount.json<{ account_id: string }>().account_id;
    const unusableFixture = await createPaymentFixture({ accountId: unusableAccountId });
    const unusableApproval = await createApproval({
      target: { type: 'payment_intent', id: unusableFixture.intentId },
      action: 'send_payment',
      execution: unusableFixture.execution,
      decision: 'approved'
    });
    await testPool.query('UPDATE bank_accounts SET status=$1 WHERE account_id=$2 AND org_id=$3', ['blocked', unusableAccountId, orgId]);
    const unusableDenials = await protectedDenialCount('send_payment');
    const unusable = await executeDirectPayment({ fixture: unusableFixture, approvalId: unusableApproval });
    expect(unusable.statusCode).toBe(400);
    expect(await protectedDenialCount('send_payment')).toBe(unusableDenials + 1);
    const unusableApprovalState = await testPool.query<{ payload_json: Record<string, unknown> }>(
      'SELECT payload_json FROM alpha_objects WHERE object_id=$1 AND org_id=$2',
      [unusableApproval, orgId]
    );
    expect(unusableApprovalState.rows[0]!.payload_json.protected_execution_consumption).toBeUndefined();

    const roleFixture = await createPaymentFixture();
    const roleApproval = await createApproval({
      target: { type: 'payment_intent', id: roleFixture.intentId },
      action: 'send_payment',
      execution: roleFixture.execution,
      decision: 'approved'
    });
    denialCount = await protectedDenialCount('send_payment');
    await testPool.query('UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3', ['member', orgId, DEV_USER_ID]);
    try {
      const unauthorized = await executeDirectPayment({ fixture: roleFixture, approvalId: roleApproval });
      expect(unauthorized.statusCode).toBe(403);
      expect(unauthorized.json<{ error: string }>().error).toBe('forbidden');
      expect(await protectedDenialCount('send_payment')).toBe(++denialCount);
    } finally {
      await testPool.query('UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3', ['owner', orgId, DEV_USER_ID]);
    }

    const deniedPaymentRows = await testPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payments WHERE org_id=$1 AND e2e_id=$2',
      [orgId, fixture.execution.e2e_id]
    );
    expect(Number(deniedPaymentRows.rows[0]!.count)).toBe(0);
    const eventCountAfter = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM trade_events WHERE org_id=$1 AND type='payment.executing'",
      [orgId]
    );
    expect(eventCountAfter.rows[0]!.count).toBe(eventCountBefore.rows[0]!.count);
    const denialAudit = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE org_id=$1 AND action='protected_execution.denied' AND payload_json->>'action'='send_payment' AND length(payload_json->>'payload_hash')=64",
      [orgId]
    );
    expect(Number(denialAudit.rows[0]!.count)).toBeGreaterThan(0);
    const denialPayloads = await testPool.query<{ payload_json: Record<string, unknown> }>(
      "SELECT payload_json FROM audit_events WHERE org_id=$1 AND action='protected_execution.denied' AND payload_json->>'action'='send_payment'",
      [orgId]
    );
    const serializedDenials = JSON.stringify(denialPayloads.rows.map((row) => row.payload_json));
    expect(serializedDenials).not.toContain(fixture.execution.creditor_name);
    expect(serializedDenials).not.toContain(fixture.execution.creditor_iban);
    expect(serializedDenials).not.toContain(fixture.execution.remittance!);
  }, 60_000);

  it('audits each authenticated route-level malformed denial exactly once and never audits unauthenticated noise', async () => {
    const fixture = await createPaymentFixture();
    let paymentDenials = await protectedDenialCount('send_payment');
    const malformedApproval = await app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { ...fixture.execution, approval_id: 'not-a-uuid', payment_intent_id: fixture.intentId }
    });
    expect(malformedApproval.statusCode).toBe(400);
    expect(await protectedDenialCount('send_payment')).toBe(++paymentDenials);

    const malformedTarget = await app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { ...fixture.execution, approval_id: randomUUID(), payment_intent_id: 'not-a-uuid' }
    });
    expect(malformedTarget.statusCode).toBe(400);
    expect(await protectedDenialCount('send_payment')).toBe(++paymentDenials);

    const malformedIntentRoute = await app.inject({
      method: 'POST',
      url: '/v1/payments/intents/not-a-uuid/execute',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { approval_id: randomUUID() }
    });
    expect(malformedIntentRoute.statusCode).toBe(400);
    expect(await protectedDenialCount('send_payment')).toBe(++paymentDenials);

    const extraIntentMaterial = await app.inject({
      method: 'POST',
      url: `/v1/payments/intents/${fixture.intentId}/execute`,
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { approval_id: randomUUID(), route_id: 'r_manual' }
    });
    expect(extraIntentMaterial.statusCode).toBe(400);
    expect(await protectedDenialCount('send_payment')).toBe(++paymentDenials);

    let fundingDenials = await protectedDenialCount('accept_funding_offer');
    const malformedOffer = await app.inject({
      method: 'POST',
      url: '/v1/finance/offers/not-a-uuid/accept',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { approval_id: randomUUID() }
    });
    expect(malformedOffer.statusCode).toBe(400);
    expect(await protectedDenialCount('accept_funding_offer')).toBe(++fundingDenials);

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      payload: { ...fixture.execution, approval_id: randomUUID(), payment_intent_id: fixture.intentId }
    });
    expect(unauthenticated.statusCode).toBe(401);
    expect(await protectedDenialCount('send_payment')).toBe(paymentDenials);
  }, 60_000);

  it('serializes direct-payment idempotency, approval reuse, duplicate approval, and concurrency', async () => {
    const fixture = await createPaymentFixture();
    const firstApproval = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'approved'
    });
    const secondApproval = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'approved'
    });
    const key = randomUUID();
    const first = await executeDirectPayment({ fixture, approvalId: firstApproval, idempotencyKey: key });
    expect(first.statusCode).toBe(200);
    const firstPaymentId = first.json<Payment>().payment_id;

    const sameKeyDifferentApproval = await executeDirectPayment({ fixture, approvalId: secondApproval, idempotencyKey: key });
    expect(sameKeyDifferentApproval.statusCode).toBe(409);
    expect(sameKeyDifferentApproval.json<{ error: string }>().error).toBe('idempotency_conflict');

    const approvalReuse = await executeDirectPayment({ fixture, approvalId: firstApproval, idempotencyKey: randomUUID() });
    expect(approvalReuse.statusCode).toBe(200);
    expect(approvalReuse.json<Payment>().payment_id).toBe(firstPaymentId);

    const duplicateApproval = await executeDirectPayment({ fixture, approvalId: secondApproval, idempotencyKey: randomUUID() });
    expect(duplicateApproval.statusCode).toBe(409);
    expect(duplicateApproval.json<{ error: string }>().error).toBe('protected_action_not_approved');

    const concurrentFixture = await createPaymentFixture();
    const concurrentApproval = await createApproval({
      target: { type: 'payment_intent', id: concurrentFixture.intentId },
      action: 'send_payment',
      execution: concurrentFixture.execution,
      decision: 'approved'
    });
    const concurrent = await Promise.all([
      executeDirectPayment({ fixture: concurrentFixture, approvalId: concurrentApproval, idempotencyKey: randomUUID() }),
      executeDirectPayment({ fixture: concurrentFixture, approvalId: concurrentApproval, idempotencyKey: randomUUID() })
    ]);
    expect(concurrent.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(new Set(concurrent.map((response) => response.json<Payment>().payment_id)).size).toBe(1);
    const rows = await testPool.query<{ count: string }>('SELECT count(*)::text AS count FROM payments WHERE org_id=$1 AND e2e_id=$2', [
      orgId,
      concurrentFixture.execution.e2e_id
    ]);
    expect(Number(rows.rows[0]!.count)).toBe(1);
    const audit = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE org_id=$1 AND action='protected_execution.succeeded' AND payload_json->'target'->>'id'=$2",
      [orgId, concurrentFixture.intentId]
    );
    expect(Number(audit.rows[0]!.count)).toBe(1);
  }, 60_000);

  it('keeps first-writer approval consumption immutable across exact and materially different CAS replays', async () => {
    const fixture = await createPaymentFixture();
    const approvalId = await createApproval({
      target: { type: 'payment_intent', id: fixture.intentId },
      action: 'send_payment',
      execution: fixture.execution,
      decision: 'approved'
    });
    const first = await executeDirectPayment({ fixture, approvalId, idempotencyKey: randomUUID() });
    expect(first.statusCode).toBe(200);
    const stored = await testPool.query<{ payload_json: Record<string, unknown> }>(
      'SELECT payload_json FROM alpha_objects WHERE object_id=$1 AND org_id=$2',
      [approvalId, orgId]
    );
    const binding = stored.rows[0]!.payload_json.protected_execution_binding as ProtectedExecutionBinding;
    const original = stored.rows[0]!.payload_json.protected_execution_consumption as ProtectedExecutionConsumption;
    const originalHash = hashCanonicalPayload(original);
    const exact = await withTx(testPool, async (client) => {
      await setAppContext(client, { userId: DEV_USER_ID, orgId });
      const authorization = await authorizeProtectedExecution(client, {
        orgId,
        approvalId,
        action: 'send_payment',
        target: { type: 'payment_intent', id: fixture.intentId },
        payload: binding.payload
      });
      return consumeProtectedExecutionApproval(client, authorization, consumptionInput(original));
    });
    expect(exact).toEqual(original);

    await expect(
      withTx(testPool, async (client) => {
        await setAppContext(client, { userId: DEV_USER_ID, orgId });
        const authorization = await authorizeProtectedExecution(client, {
          orgId,
          approvalId,
          action: 'send_payment',
          target: { type: 'payment_intent', id: fixture.intentId },
          payload: binding.payload
        });
        return consumeProtectedExecutionApproval(client, authorization, {
          ...consumptionInput(original),
          request_hash: `${original.request_hash}-different`
        });
      })
    ).rejects.toEqual(expect.objectContaining({ code: 'approval_consumption_conflict', classification: 'approval_reuse_conflict' }));

    await expect(
      withTx(testPool, async (client) => {
        await setAppContext(client, { userId: DEV_USER_ID, orgId });
        const authorization = await authorizeProtectedExecution(client, {
          orgId,
          approvalId,
          action: 'send_payment',
          target: { type: 'payment_intent', id: fixture.intentId },
          payload: binding.payload
        });
        return consumeProtectedExecutionApproval(client, authorization, {
          ...consumptionInput(original),
          result_id: randomUUID()
        });
      })
    ).rejects.toEqual(expect.objectContaining({ code: 'approval_consumption_conflict', classification: 'approval_reuse_conflict' }));

    const after = await testPool.query<{ payload_json: Record<string, unknown> }>(
      'SELECT payload_json FROM alpha_objects WHERE object_id=$1 AND org_id=$2',
      [approvalId, orgId]
    );
    const immutable = after.rows[0]!.payload_json.protected_execution_consumption as ProtectedExecutionConsumption;
    expect(hashCanonicalPayload(immutable)).toBe(originalHash);
    expect(immutable.request_hash).toBe(original.request_hash);
    expect(immutable.payload_hash).toBe(original.payload_hash);
    expect(immutable.result_id).toBe(original.result_id);
  }, 60_000);

  it('keeps the provider behind the shared guard and rolls a provider failure back for safe retry', async () => {
    const providerAccount = await app.inject({
      method: 'POST',
      url: '/v1/banks/manual/accounts',
      headers: authHeaders(orgId),
      payload: { iban: 'PT50001000000000000000017', currency: 'EUR', name: 'Provider test', bank_name: 'Provider Test Bank' }
    });
    expect(providerAccount.statusCode).toBe(200);
    const providerAccountId = providerAccount.json<{ account_id: string }>().account_id;
    await testPool.query('UPDATE bank_accounts SET provider_id=$1 WHERE account_id=$2 AND org_id=$3', ['truelayer', providerAccountId, orgId]);
    const fixture = await createPaymentFixture({ accountId: providerAccountId, overrides: { route_id: 'r_sepa' } });
    const profile = parseProfileYaml(`
profile_id: protected-execution-test
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
    base_url: http://provider.test
`);
    const previousEnv = {
      clientId: process.env.TRUELAYER_CLIENT_ID,
      clientSecret: process.env.TRUELAYER_CLIENT_SECRET,
      baseUrl: process.env.TRUELAYER_BASE_URL,
      authBaseUrl: process.env.TRUELAYER_AUTH_BASE_URL
    };
    process.env.TRUELAYER_CLIENT_ID = 'test-client';
    process.env.TRUELAYER_CLIENT_SECRET = 'test-secret';
    process.env.TRUELAYER_BASE_URL = 'http://provider.test';
    process.env.TRUELAYER_AUTH_BASE_URL = 'http://auth.test';
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const approval = await requestApprovalAlpha(testPool, {
        orgId,
        userId: DEV_USER_ID,
        traceId: `trc_${randomUUID()}`,
        profile,
        body: {
          target: { type: 'payment_intent', id: fixture.intentId },
          protected_action: 'send_payment',
          proposed_action: 'Security test for exact live-provider execution.',
          execution_payload: fixture.execution,
          step_up_required: true
        }
      });
      const approvalId = approval.approval.object_id;
      const directInput = {
        orgId,
        userId: DEV_USER_ID,
        traceId: `trc_${randomUUID()}`,
        profile,
        approvalId,
        paymentIntentId: fixture.intentId,
        execution: fixture.execution,
        idempotencyKey: randomUUID(),
        idempotencyRoute: 'POST /v1/payments/execute'
      };
      await expect(executePayment(testPool, directInput)).rejects.toEqual(expect.objectContaining({ code: 'protected_action_not_approved' }));
      expect(fetchSpy).not.toHaveBeenCalled();

      const decision = await app.inject({
        method: 'POST',
        url: `/v1/approvals/${approvalId}/decision`,
        headers: authHeaders(orgId),
        payload: {
          decision: 'approved',
          notes: 'Approve the provider rollback security test.',
          step_up_verified: true,
          residual_risks_acknowledged: true
        }
      });
      expect(decision.statusCode).toBe(200);

      const changedProfile = parseProfileYaml(`
profile_id: changed-after-approval
region: eu
payments:
  active_provider: manual
  manual:
    enabled: true
`);
      await expect(executePayment(testPool, { ...directInput, profile: changedProfile, traceId: `trc_${randomUUID()}` })).rejects.toEqual(
        expect.objectContaining({ classification: 'payment_semantics_substitution' })
      );
      expect(fetchSpy).not.toHaveBeenCalled();

      const changedPolicyIdentity = parseProfileYaml(`
profile_id: changed-policy-identity
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
    base_url: http://provider.test
`);
      await expect(
        executePayment(testPool, { ...directInput, profile: changedPolicyIdentity, traceId: `trc_${randomUUID()}` })
      ).rejects.toEqual(expect.objectContaining({ classification: 'payment_policy_changed' }));
      expect(fetchSpy).not.toHaveBeenCalled();

      delete process.env.TRUELAYER_CLIENT_SECRET;
      await expect(executePayment(testPool, { ...directInput, traceId: `trc_${randomUUID()}` })).rejects.toEqual(
        expect.objectContaining({ classification: 'payment_provider_unavailable' })
      );
      process.env.TRUELAYER_CLIENT_SECRET = 'test-secret';
      expect(fetchSpy).not.toHaveBeenCalled();

      fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 503 }));
      await expect(executePayment(testPool, directInput)).rejects.toEqual(expect.objectContaining({ code: 'external_provider_error' }));
      const afterFailure = await testPool.query<{ count: string }>('SELECT count(*)::text AS count FROM payments WHERE org_id=$1 AND e2e_id=$2', [
        orgId,
        fixture.execution.e2e_id
      ]);
      expect(Number(afterFailure.rows[0]!.count)).toBe(0);
      const approvalAfterFailure = await testPool.query<{ payload_json: Record<string, unknown> }>(
        'SELECT payload_json FROM alpha_objects WHERE object_id=$1 AND org_id=$2',
        [approvalId, orgId]
      );
      expect(approvalAfterFailure.rows[0]!.payload_json.protected_execution_consumption).toBeUndefined();

      fetchSpy
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: 'provider-token', expires_in: 3600, token_type: 'Bearer' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: 'provider-payment-1', authorization_uri: 'http://provider.test/authorize' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
        );
      const retried = await executePayment(testPool, { ...directInput, traceId: `trc_${randomUUID()}` });
      expect(retried.payment_id).toBeTruthy();
      expect(retried.provider).toBe('truelayer');
      const providerHeaders = fetchSpy.mock.calls[2]?.[1]?.headers as Record<string, string>;
      expect(providerHeaders['Idempotency-Key']).toBe(`traibox-${approvalId}`);
    } finally {
      fetchSpy.mockRestore();
      restoreEnv('TRUELAYER_CLIENT_ID', previousEnv.clientId);
      restoreEnv('TRUELAYER_CLIENT_SECRET', previousEnv.clientSecret);
      restoreEnv('TRUELAYER_BASE_URL', previousEnv.baseUrl);
      restoreEnv('TRUELAYER_AUTH_BASE_URL', previousEnv.authBaseUrl);
    }
  }, 60_000);

  it('requests funding, ranks offers, accepts one, and shows the reservation', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/v1/finance/offers',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { trade_id: tradeId, amount: 312400, tenor_days: 60, sustainable: { enabled: true } }
    });
    expect(request.statusCode).toBe(200);
    const offerBody = request.json<OfferResponse>();
    expect(offerBody.offers.length).toBeGreaterThan(0);

    const funding = await app.inject({ method: 'GET', url: '/v1/finance/funding', headers: authHeaders(orgId) });
    expect(funding.statusCode).toBe(200);
    const fundingBody = funding.json<FinanceFundingResponse>();
    const req = fundingBody.requests.find((r) => r.trade_id === tradeId && r.amount === 312400);
    expect(req).toBeDefined();
    expect(req!.offers.length).toBeGreaterThan(0);
    // Ranked ascending by all-in APR.
    const aprs = req!.offers.map((offer) => offer.apr_bps);
    expect([...aprs].sort((a, b) => a - b)).toEqual(aprs);

    const best = req!.offers[0]!;
    const offerApprovalRequest = await app.inject({
      method: 'POST',
      url: '/v1/approvals',
      headers: authHeaders(orgId),
      payload: {
        target: { type: 'funding_offer', id: best.offer_id },
        protected_action: 'accept_funding_offer',
        proposed_action: 'Accept the exact best funding offer and its frozen terms.',
        step_up_required: true
      }
    });
    expect(offerApprovalRequest.statusCode).toBe(200);
    const offerApprovalId = offerApprovalRequest.json<{ approval: { object_id: string } }>().approval.object_id;
    const offerApprovalDecision = await app.inject({
      method: 'POST',
      url: `/v1/approvals/${offerApprovalId}/decision`,
      headers: authHeaders(orgId),
      payload: {
        decision: 'approved',
        notes: 'Owner approves the exact funding offer terms for reservation.',
        step_up_verified: true,
        residual_risks_acknowledged: true
      }
    });
    expect(offerApprovalDecision.statusCode).toBe(200);
    const accept = await app.inject({
      method: 'POST',
      url: `/v1/finance/offers/${best.offer_id}/accept`,
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { approval_id: offerApprovalId }
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json<{ reservation: { offer_id: string } }>().reservation.offer_id).toBe(best.offer_id);

    const after = await app.inject({ method: 'GET', url: '/v1/finance/funding', headers: authHeaders(orgId) });
    const reservation = after.json<FinanceFundingResponse>().reservations.find((r) => r.offer_id === best.offer_id);
    expect(reservation).toBeDefined();
    expect(reservation!.status).toBe('active');
    expect(reservation!.financier_name).toBe(best.financier_name);
    expect(reservation!.amount).toBe(312400);
  }, 60_000);

  it('rejects missing, invalid, cross-tenant, mismatched, or unauthorized funding approvals without reservations or success events', async () => {
    const fixture = await requestFundingFixture();
    const offerId = fixture.offers[0]!.offer_id;
    let denialCount = await protectedDenialCount('accept_funding_offer');
    const eventCountBefore = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM trade_events WHERE org_id=$1 AND type='offer.accepted'",
      [orgId]
    );

    const missingApproval = await acceptFundingOffer({ offerId, includeApproval: false });
    expect(missingApproval.statusCode).toBe(409);
    expect(missingApproval.json<{ error: string }>().error).toBe('approval_required');
    expect(await protectedDenialCount('accept_funding_offer')).toBe(++denialCount);

    const exactApproval = await createApproval({
      target: { type: 'funding_offer', id: offerId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const missingIdempotency = await acceptFundingOffer({
      offerId,
      approvalId: exactApproval,
      includeIdempotency: false
    });
    expect(missingIdempotency.statusCode).toBe(400);
    expect(missingIdempotency.json<{ error: string }>().error).toBe('missing_idempotency');
    expect(await protectedDenialCount('accept_funding_offer')).toBe(++denialCount);

    const unknownApproval = await acceptFundingOffer({ offerId, approvalId: randomUUID() });
    expect(unknownApproval.statusCode).toBe(404);
    expect(unknownApproval.json<{ error: string }>().error).toBe('not_found');
    expect(await protectedDenialCount('accept_funding_offer')).toBe(++denialCount);

    const pendingApproval = await createApproval({
      target: { type: 'funding_offer', id: offerId },
      action: 'accept_funding_offer',
      decision: 'pending'
    });
    const pending = await acceptFundingOffer({ offerId, approvalId: pendingApproval });
    expect(pending.statusCode).toBe(409);
    expect(pending.json<{ error: string }>().error).toBe('protected_action_not_approved');
    expect(await protectedDenialCount('accept_funding_offer')).toBe(++denialCount);

    const rejectedApproval = await createApproval({
      target: { type: 'funding_offer', id: offerId },
      action: 'accept_funding_offer',
      decision: 'rejected'
    });
    const rejected = await acceptFundingOffer({ offerId, approvalId: rejectedApproval });
    expect(rejected.statusCode).toBe(409);

    const wrongActionApproval = await createApproval({
      target: { type: 'funding_offer', id: offerId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    await testPool.query(
      `UPDATE alpha_objects
          SET payload_json=jsonb_set(
            jsonb_set(payload_json, '{protected_action}', $1::jsonb),
            '{protected_execution_binding,action}', $1::jsonb
          )
        WHERE object_id=$2 AND org_id=$3`,
      [JSON.stringify('send_payment'), wrongActionApproval, orgId]
    );
    const wrongAction = await acceptFundingOffer({ offerId, approvalId: wrongActionApproval });
    expect(wrongAction.statusCode).toBe(409);

    const wrongTypeApproval = await createApproval({
      target: { type: 'funding_offer', id: offerId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    await testPool.query(
      `UPDATE alpha_objects
          SET payload_json=jsonb_set(
            jsonb_set(payload_json, '{target,type}', $1::jsonb),
            '{protected_execution_binding,target,type}', $1::jsonb
          )
        WHERE object_id=$2 AND org_id=$3`,
      [JSON.stringify('payment_intent'), wrongTypeApproval, orgId]
    );
    const wrongType = await acceptFundingOffer({ offerId, approvalId: wrongTypeApproval });
    expect(wrongType.statusCode).toBe(409);

    const otherOfferId = fixture.offers[1]!.offer_id;
    const wrongTargetApproval = await createApproval({
      target: { type: 'funding_offer', id: otherOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const wrongTarget = await acceptFundingOffer({ offerId, approvalId: wrongTargetApproval });
    expect(wrongTarget.statusCode).toBe(409);

    const otherFixture = await requestFundingFixture({ orgId: otherOrgId, tradeId: otherTradeId });
    const otherApproval = await createApproval({
      orgId: otherOrgId,
      target: { type: 'funding_offer', id: otherFixture.offers[0]!.offer_id },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const crossTenant = await acceptFundingOffer({ offerId, approvalId: otherApproval });
    expect(crossTenant.statusCode).toBe(404);
    expect(crossTenant.json<{ error: string }>().error).toBe('not_found');

    const roleFixture = await requestFundingFixture();
    const roleOfferId = roleFixture.offers[0]!.offer_id;
    const roleApproval = await createApproval({
      target: { type: 'funding_offer', id: roleOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    denialCount = await protectedDenialCount('accept_funding_offer');
    await testPool.query('UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3', ['member', orgId, DEV_USER_ID]);
    try {
      const unauthorized = await acceptFundingOffer({ offerId: roleOfferId, approvalId: roleApproval });
      expect(unauthorized.statusCode).toBe(403);
      expect(unauthorized.json<{ error: string }>().error).toBe('forbidden');
      expect(await protectedDenialCount('accept_funding_offer')).toBe(++denialCount);
    } finally {
      await testPool.query('UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3', ['owner', orgId, DEV_USER_ID]);
    }

    const reservationRows = await testPool.query<{ count: string }>('SELECT count(*)::text AS count FROM reservations WHERE org_id=$1 AND offer_id=$2', [
      orgId,
      offerId
    ]);
    expect(Number(reservationRows.rows[0]!.count)).toBe(0);
    const eventCountAfter = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM trade_events WHERE org_id=$1 AND type='offer.accepted'",
      [orgId]
    );
    expect(eventCountAfter.rows[0]!.count).toBe(eventCountBefore.rows[0]!.count);
    const denialAudit = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE org_id=$1 AND action='protected_execution.denied' AND payload_json->>'action'='accept_funding_offer' AND length(payload_json->>'payload_hash')=64",
      [orgId]
    );
    expect(Number(denialAudit.rows[0]!.count)).toBeGreaterThan(0);
  }, 60_000);

  it('rejects changed or expired offer terms after approval and leaves no partial funding state', async () => {
    const mutations: Array<{ column: 'apr_bps' | 'fees' | 'tenor_days' | 'currency'; sql: string }> = [
      { column: 'apr_bps', sql: 'apr_bps=apr_bps+1' },
      { column: 'fees', sql: 'fees=fees+1' },
      { column: 'tenor_days', sql: 'tenor_days=tenor_days+1' },
      { column: 'currency', sql: "currency='USD'" }
    ];
    for (const mutation of mutations) {
      const fixture = await requestFundingFixture();
      const offerId = fixture.offers[0]!.offer_id;
      const approvalId = await createApproval({
        target: { type: 'funding_offer', id: offerId },
        action: 'accept_funding_offer',
        decision: 'approved'
      });
      await testPool.query(`UPDATE finance_offers SET ${mutation.sql} WHERE offer_id=$1 AND org_id=$2`, [offerId, orgId]);
      const response = await acceptFundingOffer({ offerId, approvalId });
      expect(response.statusCode, mutation.column).toBe(409);
      expect(response.json<{ error: string }>().error).toBe('protected_action_not_approved');
      const reservations = await testPool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM reservations WHERE org_id=$1 AND offer_id=$2',
        [orgId, offerId]
      );
      expect(Number(reservations.rows[0]!.count)).toBe(0);
    }

    const expiredFixture = await requestFundingFixture();
    const expiredOfferId = expiredFixture.offers[0]!.offer_id;
    await testPool.query("UPDATE finance_offers SET expires_at=now()-interval '1 minute' WHERE offer_id=$1 AND org_id=$2", [expiredOfferId, orgId]);
    const expiredApproval = await createApproval({
      target: { type: 'funding_offer', id: expiredOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const expired = await acceptFundingOffer({ offerId: expiredOfferId, approvalId: expiredApproval });
    expect(expired.statusCode).toBe(400);
    expect(expired.json<{ error: string }>().error).toBe('validation_error');
    const expiredEvents = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM trade_events WHERE org_id=$1 AND type='offer.accepted' AND data->>'offer_id'=$2",
      [orgId, expiredOfferId]
    );
    expect(Number(expiredEvents.rows[0]!.count)).toBe(0);
  }, 60_000);

  it('expires elapsed active reservations atomically, permits a new approved offer, and preserves original replay', async () => {
    const fixture = await requestFundingFixture();
    const firstOfferId = fixture.offers[0]!.offer_id;
    const secondOfferId = fixture.offers[1]!.offer_id;
    const firstApproval = await createApproval({
      target: { type: 'funding_offer', id: firstOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const secondApproval = await createApproval({
      target: { type: 'funding_offer', id: secondOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const concurrentFixture = await requestFundingFixture({ tradeId: fixture.tradeId });
    const concurrentOfferId = concurrentFixture.offers[0]!.offer_id;
    const concurrentApproval = await createApproval({
      target: { type: 'funding_offer', id: concurrentOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const first = await acceptFundingOffer({ offerId: firstOfferId, approvalId: firstApproval, idempotencyKey: randomUUID() });
    expect(first.statusCode).toBe(200);
    const firstReservation = await testPool.query<{ reservation_id: string }>(
      'SELECT reservation_id FROM reservations WHERE offer_id=$1 AND org_id=$2',
      [firstOfferId, orgId]
    );
    const firstReservationId = firstReservation.rows[0]!.reservation_id;

    await testPool.query(
      "UPDATE reservations SET expires_at=now()-interval '1 minute' WHERE reservation_id=$1 AND org_id=$2 AND status='active'",
      [firstReservationId, orgId]
    );
    const concurrentAcceptances = await Promise.all([
      acceptFundingOffer({ offerId: secondOfferId, approvalId: secondApproval, idempotencyKey: randomUUID() }),
      acceptFundingOffer({ offerId: concurrentOfferId, approvalId: concurrentApproval, idempotencyKey: randomUUID() })
    ]);
    expect(concurrentAcceptances.map((response) => response.statusCode).sort()).toEqual([200, 409]);

    const states = await testPool.query<{ reservation_id: string; status: string }>(
      'SELECT reservation_id, status FROM reservations WHERE org_id=$1 AND trade_id=$2 ORDER BY created_at',
      [orgId, fixture.tradeId]
    );
    expect(states.rows.find((row) => row.reservation_id === firstReservationId)?.status).toBe('expired');
    expect(states.rows.filter((row) => row.status === 'active')).toHaveLength(1);

    const replay = await acceptFundingOffer({ offerId: firstOfferId, approvalId: firstApproval, idempotencyKey: randomUUID() });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<{ reservation: { offer_id: string } }>().reservation.offer_id).toBe(firstOfferId);
    const stateAfterReplay = await testPool.query<{ status: string }>(
      'SELECT status FROM reservations WHERE reservation_id=$1 AND org_id=$2',
      [firstReservationId, orgId]
    );
    expect(stateAfterReplay.rows[0]!.status).toBe('expired');
    const expiryAudit = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE org_id=$1 AND action='finance.reservation.expired' AND payload_json->>'reservation_id'=$2",
      [orgId, firstReservationId]
    );
    expect(Number(expiryAudit.rows[0]!.count)).toBe(1);
  }, 60_000);

  it('serializes funding idempotency, approval reuse, conflicting offers, and concurrency', async () => {
    const fixture = await requestFundingFixture();
    const offerId = fixture.offers[0]!.offer_id;
    const firstApproval = await createApproval({
      target: { type: 'funding_offer', id: offerId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const secondApproval = await createApproval({
      target: { type: 'funding_offer', id: offerId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const otherOfferId = fixture.offers[1]!.offer_id;
    const otherOfferApproval = await createApproval({
      target: { type: 'funding_offer', id: otherOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const key = randomUUID();
    const first = await acceptFundingOffer({ offerId, approvalId: firstApproval, idempotencyKey: key });
    expect(first.statusCode).toBe(200);
    const firstTraceId = first.json<{ trace_id: string }>().trace_id;
    const firstReference = first.json<{ reservation: { financier_ref?: string } }>().reservation.financier_ref;

    const sameKeyDifferentApproval = await acceptFundingOffer({ offerId, approvalId: secondApproval, idempotencyKey: key });
    expect(sameKeyDifferentApproval.statusCode).toBe(409);
    expect(sameKeyDifferentApproval.json<{ error: string }>().error).toBe('idempotency_conflict');

    const approvalReuse = await acceptFundingOffer({ offerId, approvalId: firstApproval, idempotencyKey: randomUUID() });
    expect(approvalReuse.statusCode).toBe(200);
    expect(approvalReuse.json<{ reservation: { financier_ref?: string } }>().reservation.financier_ref).toBe(firstReference);
    expect(approvalReuse.json<{ trace_id: string }>().trace_id).toBe(firstTraceId);

    const duplicateApproval = await acceptFundingOffer({ offerId, approvalId: secondApproval, idempotencyKey: randomUUID() });
    expect(duplicateApproval.statusCode).toBe(409);
    const conflictingOffer = await acceptFundingOffer({ offerId: otherOfferId, approvalId: otherOfferApproval, idempotencyKey: randomUUID() });
    expect(conflictingOffer.statusCode).toBe(409);

    const concurrentFixture = await requestFundingFixture();
    const concurrentOfferId = concurrentFixture.offers[0]!.offer_id;
    const concurrentApproval = await createApproval({
      target: { type: 'funding_offer', id: concurrentOfferId },
      action: 'accept_funding_offer',
      decision: 'approved'
    });
    const concurrent = await Promise.all([
      acceptFundingOffer({ offerId: concurrentOfferId, approvalId: concurrentApproval, idempotencyKey: randomUUID() }),
      acceptFundingOffer({ offerId: concurrentOfferId, approvalId: concurrentApproval, idempotencyKey: randomUUID() })
    ]);
    expect(concurrent.map((response) => response.statusCode)).toEqual([200, 200]);
    const concurrentReferences = concurrent.map(
      (response) => response.json<{ reservation: { financier_ref?: string } }>().reservation.financier_ref
    );
    expect(new Set(concurrentReferences).size).toBe(1);
    const rows = await testPool.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM reservations WHERE org_id=$1 AND offer_id=$2 AND status=$3',
      [orgId, concurrentOfferId, 'active']
    );
    expect(Number(rows.rows[0]!.count)).toBe(1);
    const audit = await testPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM audit_events WHERE org_id=$1 AND action='protected_execution.succeeded' AND payload_json->'target'->>'id'=$2",
      [orgId, concurrentOfferId]
    );
    expect(Number(audit.rows[0]!.count)).toBe(1);
  }, 60_000);

  it('builds a network trust context from counterparty evidence', async () => {
    const counterparty = await app.inject({
      method: 'POST',
      url: '/v1/objects/counterparty',
      headers: authHeaders(orgId),
      payload: {
        title: 'Bauwerk Test GmbH',
        summary: 'German construction buyer',
        origin_workspace: 'network',
        payload: { role: 'Buyer', country: 'Germany' }
      }
    });
    expect(counterparty.statusCode).toBe(200);
    const counterpartyId = counterparty.json<{ object: { object_id: string } }>().object.object_id;

    const screening = await app.inject({
      method: 'POST',
      url: '/v1/objects/screening_result',
      headers: authHeaders(orgId),
      payload: {
        title: 'Sanctions screen — Bauwerk Test',
        origin_workspace: 'network',
        status: 'completed',
        payload: { counterparty_id: counterpartyId, sanctions: 'clear', pep: 'clear', adverse_media: 'clear' }
      }
    });
    expect(screening.statusCode).toBe(200);
    const screeningId = screening.json<{ object: { object_id: string } }>().object.object_id;

    const trust = await app.inject({
      method: 'POST',
      url: `/v1/network/counterparties/${counterpartyId}/trust-context`,
      headers: authHeaders(orgId),
      payload: { screening_result_id: screeningId, passport_visibility: 'internal' }
    });
    expect(trust.statusCode).toBe(200);
    const trustBody = trust.json<BuildNetworkTrustResponse>();
    expect(trustBody.trust_context.score).toBeGreaterThan(0);
    expect(['pending_evidence', 'ready_for_review', 'blocked']).toContain(trustBody.trust_context.status);
    expect(trustBody.trade_passport.type).toBe('trade_passport');
    expect((trustBody.counterparty.payload_json as { trust_score?: number }).trust_score).toBe(trustBody.trust_context.score);

    // Recompute is allowed and stays consistent.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/network/counterparties/${counterpartyId}/trust-context`,
      headers: authHeaders(orgId),
      payload: { screening_result_id: screeningId }
    });
    expect(again.statusCode).toBe(200);
  }, 60_000);

  it('threads trade messages into the org-wide inbox with trade titles', async () => {
    const post = await app.inject({
      method: 'POST',
      url: `/v1/trades/${tradeId}/messages`,
      headers: authHeaders(orgId),
      payload: { text: 'Buyer confirmed the acceptance window.' }
    });
    expect(post.statusCode).toBe(200);

    const inbox = await app.inject({ method: 'GET', url: '/v1/messages?limit=50', headers: authHeaders(orgId) });
    expect(inbox.statusCode).toBe(200);
    const inboxBody = inbox.json<ListOrgMessagesResponse>();
    const message = inboxBody.messages.find((m) => m.text === 'Buyer confirmed the acceptance window.');
    expect(message).toBeDefined();
    expect(message!.trade_id).toBe(tradeId);
    expect(message!.trade_title).toBeTruthy();
    expect(message!.role).toBe('user');
  }, 30_000);
});

function authHeaders(orgId?: string) {
  return {
    Authorization: 'Bearer dev',
    ...(orgId ? { 'X-Org-Id': orgId } : {})
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function consumptionInput(consumption: ProtectedExecutionConsumption) {
  return {
    request_hash: consumption.request_hash,
    result_type: consumption.result_type,
    result_id: consumption.result_id,
    idempotency_fingerprint: consumption.idempotency_fingerprint,
    actor_id: consumption.actor_id,
    trace_id: consumption.trace_id,
    consumed_at: consumption.consumed_at
  };
}

function assertLocalTestDatabase(connectionString: string) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Refusing to reset non-local integration database: ${url.hostname}`);
  }
  if (!/test|traibox/i.test(url.pathname)) {
    throw new Error(`Refusing to reset database without test/traibox in name: ${url.pathname}`);
  }
}

async function resetDatabase(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

async function applyMigrations(connectionString: string) {
  const client = new pg.Client({ connectionString });
  const migrationsDir = path.join(findRepoRoot(), 'packages/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, sql: readFileSync(path.join(migrationsDir, name), 'utf8') }));

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(current, 'packages/db/migrations');
    try {
      if (readdirSync(candidate).some((file) => file.endsWith('.sql'))) return current;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to locate repo root from ${process.cwd()}`);
}
