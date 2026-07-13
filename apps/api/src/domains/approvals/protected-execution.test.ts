import { describe, expect, it, vi } from 'vitest';
import {
  ProtectedExecutionError,
  authorizeProtectedExecution,
  canonicalize,
  hashCanonicalPayload,
  normalizePaymentExecutionPayload
} from './protected-execution';
import { consumeProtectedExecutionApproval } from './protected-execution-consumption';

const orgId = '00000000-0000-0000-0000-000000000001';
const approvalId = '00000000-0000-0000-0000-000000000002';
const paymentIntentId = '00000000-0000-0000-0000-000000000003';
const actorId = '00000000-0000-0000-0000-000000000004';

const payment = {
  payment_intent_id: paymentIntentId,
  trade_id: null,
  route_id: 'r_manual',
  from_account_id: '00000000-0000-0000-0000-000000000005',
  creditor_name: 'Supplier Name',
  creditor_iban: 'PT50002700000001234567833',
  amount: 1250,
  currency: 'EUR',
  remittance: 'INV-1',
  e2e_id: 'E2E-1'
};

describe('protected execution canonicalization', () => {
  it('hashes semantically identical objects identically across key orderings', () => {
    const left = { z: 2, nested: { beta: true, alpha: 'x' }, list: [{ b: 2, a: 1 }] };
    const right = { list: [{ a: 1, b: 2 }], nested: { alpha: 'x', beta: true }, z: 2 };
    expect(canonicalize(left)).toBe(canonicalize(right));
    expect(hashCanonicalPayload(left)).toBe(hashCanonicalPayload(right));
  });

  it('preserves array ordering as material', () => {
    expect(hashCanonicalPayload({ conditions: ['a', 'b'] })).not.toBe(hashCanonicalPayload({ conditions: ['b', 'a'] }));
  });

  it('normalizes payment presentation fields before binding', () => {
    const normalized = normalizePaymentExecutionPayload({
      paymentIntentId,
      targetTradeId: null,
      execution: {
        route_id: ' r_manual ',
        from_account_id: payment.from_account_id,
        creditor_name: ' Supplier   Name ',
        creditor_iban: 'pt50 0027 0000 0001 2345 6783 3',
        amount: 1250,
        currency: 'eur',
        remittance: ' INV-1 ',
        e2e_id: ' E2E-1 '
      }
    });
    expect(normalized).toEqual(payment);
  });

  it('rejects a payment trade different from the target payment intent', () => {
    expect(() =>
      normalizePaymentExecutionPayload({
        paymentIntentId,
        targetTradeId: null,
        execution: { ...payment, trade_id: '00000000-0000-0000-0000-000000000099' }
      })
    ).toThrowError(expect.objectContaining({ code: 'validation_error' }));
  });
});

describe('protected execution approval guard', () => {
  it('authorizes a fully approved exact action, target and payload', async () => {
    const guard = await authorizeProtectedExecution(clientFor(), {
      orgId,
      approvalId,
      action: 'send_payment',
      target: { type: 'payment_intent', id: paymentIntentId },
      payload: payment
    });
    expect(guard).toEqual(expect.objectContaining({ approvalId, action: 'send_payment', payloadHash: hashCanonicalPayload(payment) }));
    expect(guard.existingConsumption).toBeNull();
  });

  it('deep-freezes issued authorization material so a valid capability cannot be retargeted', async () => {
    const guard = await authorizeProtectedExecution(clientFor(), {
      orgId,
      approvalId,
      action: 'send_payment',
      target: { type: 'payment_intent', id: paymentIntentId },
      payload: payment
    });
    expect(() => {
      (guard.target as { id: string }).id = '00000000-0000-0000-0000-000000000099';
    }).toThrow(TypeError);
    expect(() => {
      (guard.binding.payload as Record<string, unknown>).amount = 999999;
    }).toThrow(TypeError);
    expect(guard.target.id).toBe(paymentIntentId);
    expect(guard.binding.payload.amount).toBe(payment.amount);
  });

  it.each([
    ['pending approval', { status: 'approval_required' }, 'protected_action_not_approved'],
    ['rejected approval', { status: 'rejected' }, 'protected_action_not_approved'],
    ['wrong action', { protected_action: 'accept_funding_offer' }, 'protected_action_not_approved'],
    ['wrong target type', { target: { type: 'funding_offer', id: paymentIntentId } }, 'protected_action_not_approved'],
    ['wrong target ID', { target: { type: 'payment_intent', id: '00000000-0000-0000-0000-000000000099' } }, 'protected_action_not_approved'],
    ['incomplete chain', { approval_chain_completed: false }, 'protected_action_not_approved'],
    ['missing step-up', { human_decision: { step_up_verified: false, residual_risks_acknowledged: true } }, 'protected_action_not_approved']
  ])('rejects %s', async (_label, override, expectedCode) => {
    await expect(
      authorizeProtectedExecution(clientFor(override), {
        orgId,
        approvalId,
        action: 'send_payment',
        target: { type: 'payment_intent', id: paymentIntentId },
        payload: payment
      })
    ).rejects.toEqual(expect.objectContaining({ code: expectedCode }));
  });

  it('rejects a different frozen payload', async () => {
    await expect(
      authorizeProtectedExecution(clientFor(), {
        orgId,
        approvalId,
        action: 'send_payment',
        target: { type: 'payment_intent', id: paymentIntentId },
        payload: { ...payment, amount: 1251 }
      })
    ).rejects.toEqual(expect.objectContaining({ code: 'protected_action_not_approved' }));
  });

  it('returns existing single-use consumption only for the exact execution', async () => {
    const consumption = {
      status: 'succeeded',
      action: 'send_payment',
      target: { type: 'payment_intent', id: paymentIntentId },
      payload_hash: hashCanonicalPayload(payment),
      request_hash: 'request-hash',
      result_type: 'payment',
      result_id: '00000000-0000-0000-0000-000000000006',
      idempotency_fingerprint: 'fingerprint',
      actor_id: actorId,
      trace_id: 'trace',
      consumed_at: '2026-07-13T10:00:00.000Z'
    };
    const guard = await authorizeProtectedExecution(clientFor({ protected_execution_consumption: consumption }), {
      orgId,
      approvalId,
      action: 'send_payment',
      target: { type: 'payment_intent', id: paymentIntentId },
      payload: payment
    });
    expect(guard.existingConsumption).toEqual(consumption);
  });

  it('uses typed expected failures instead of generic errors', async () => {
    try {
      await authorizeProtectedExecution(clientFor({ status: 'approval_required' }), {
        orgId,
        approvalId,
        action: 'send_payment',
        target: { type: 'payment_intent', id: paymentIntentId },
        payload: payment
      });
      throw new Error('expected guard rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtectedExecutionError);
      expect(error).toEqual(expect.objectContaining({ statusCode: 409, code: 'protected_action_not_approved' }));
    }
  });

  it('does not allow callers to forge approval consumption authorization', async () => {
    const forged = {} as Parameters<typeof consumeProtectedExecutionApproval>[1];
    await expect(
      consumeProtectedExecutionApproval(clientFor(), forged, {
        request_hash: 'request-hash',
        result_type: 'payment',
        result_id: '00000000-0000-0000-0000-000000000006',
        idempotency_fingerprint: 'fingerprint',
        actor_id: actorId,
        trace_id: 'trace',
        consumed_at: '2026-07-13T10:00:00.000Z'
      })
    ).rejects.toEqual(expect.objectContaining({ code: 'unsafe_action_blocked' }));
  });
});

function clientFor(override: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {
    protected_action: 'send_payment',
    target: { type: 'payment_intent', id: paymentIntentId },
    approval_chain_completed: true,
    protected_action_released: true,
    step_up_required: true,
    human_decision: { step_up_verified: true, residual_risks_acknowledged: true },
    approval_chain: [
      {
        key: 'finance_approval',
        required_role: 'finance',
        status: 'approved',
        actor_id: actorId,
        decided_at: '2026-07-13T09:59:00.000Z',
        notes: 'Approved exact payment payload.'
      }
    ],
    protected_execution_binding: {
      schema_version: 'protected-execution-v1',
      action: 'send_payment',
      org_id: orgId,
      target: { type: 'payment_intent', id: paymentIntentId },
      payload: payment,
      payload_hash: hashCanonicalPayload(payment),
      frozen_at: '2026-07-13T09:58:00.000Z'
    },
    ...override
  };
  const status = typeof override.status === 'string' ? override.status : 'approved';
  const payloadOverride = { ...payload };
  delete payloadOverride.status;
  return {
    query: vi.fn().mockResolvedValue({
      rows: [{ object_id: approvalId, org_id: orgId, type: 'approval', status, payload_json: payloadOverride }]
    })
  } as unknown as Parameters<typeof authorizeProtectedExecution>[0];
}
