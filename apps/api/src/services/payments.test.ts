import { describe, expect, it, vi } from 'vitest';
import { parseProfileYaml } from '@traibox/profiles';

import { getPaymentAdapter, selectPaymentRail, type PaymentRailSelection } from './payment-adapters.js';
import { paymentExecutionPolicySnapshot } from './payment-policy.js';
import {
  issueLivePaymentExecutionCapability,
  type LivePaymentExecutionCapability
} from './payment-provider-capability.js';
import { authorizeProtectedExecution, hashCanonicalPayload } from '../domains/approvals/protected-execution.js';

const liveProfile = parseProfileYaml(`
profile_id: test-live
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
`);

const manualProfile = parseProfileYaml(`
profile_id: test-manual
region: eu
payments:
  active_provider: manual
  manual:
    enabled: true
`);

describe('payment rail selection', () => {
  it('selects only the exact configured TrueLayer rail', () => {
    expect(selectPaymentRail({ profile: liveProfile, routeId: 'r_sepa', fromProviderId: 'truelayer', trueLayerConfigured: true })).toEqual(
      expect.objectContaining({
        provider: 'truelayer',
        mode: 'truelayer',
        adapterClass: 'truelayer_pis',
        fallback: false,
        reason: 'exact_active_provider'
      })
    );
  });

  it('honors manual execution only when route and debtor account are explicitly manual', () => {
    expect(selectPaymentRail({ profile: liveProfile, routeId: 'r_manual', fromProviderId: 'manual', trueLayerConfigured: true })).toEqual(
      expect.objectContaining({
        provider: 'manual',
        mode: 'manual',
        adapterClass: 'manual_transfer',
        fallback: false,
        reason: 'explicit_manual_route'
      })
    );
    expect(() => selectPaymentRail({ profile: liveProfile, routeId: 'r_manual', fromProviderId: 'truelayer', trueLayerConfigured: true })).toThrowError(
      expect.objectContaining({ classification: 'account_provider_mismatch' })
    );
  });

  it('blocks provider unavailability instead of silently substituting manual or mock execution', () => {
    expect(() => selectPaymentRail({ profile: liveProfile, routeId: 'r_sepa', fromProviderId: 'truelayer', trueLayerConfigured: false })).toThrowError(
      expect.objectContaining({ classification: 'payment_provider_unavailable' })
    );
    expect(() => selectPaymentRail({ profile: manualProfile, routeId: 'r_sepa', fromProviderId: 'manual', trueLayerConfigured: false })).toThrowError(
      expect.objectContaining({ classification: 'payment_semantics_substitution' })
    );
  });

  it('blocks planned iBanFirst execution instead of falling back', () => {
    const profile = parseProfileYaml(`
profile_id: test-planned
region: eu
payments:
  active_provider: ibanfirst
  manual:
    enabled: true
  ibanfirst:
    enabled: true
`);
    expect(() => selectPaymentRail({ profile, routeId: 'r_sepa', fromProviderId: 'ibanfirst', trueLayerConfigured: false })).toThrowError(
      expect.objectContaining({ classification: 'planned_payment_adapter' })
    );
  });

  it('rejects an account whose provider differs from the active payment provider', () => {
    expect(() => selectPaymentRail({ profile: liveProfile, routeId: 'r_sepa', fromProviderId: 'manual', trueLayerConfigured: true })).toThrowError(
      expect.objectContaining({ classification: 'account_provider_mismatch' })
    );
  });
});

describe('payment adapters', () => {
  it('resolves deterministic manual and isolated mock selections to exact adapters', async () => {
    const manual = getPaymentAdapter(selection('manual', 'manual', 'manual_transfer'), { trueLayerConfig: null });
    const mock = getPaymentAdapter(selection('internal', 'mock', 'internal_mock'), { trueLayerConfig: null });
    expect(manual.adapterClass).toBe('manual_transfer');
    expect(mock.adapterClass).toBe('internal_mock');
    await expect(manual.prepareExecution(manualContext())).resolves.toEqual(expect.objectContaining({ adapterId: 'manual_transfer', status: 'created' }));
    await expect(mock.prepareExecution(manualContext())).resolves.toEqual(expect.objectContaining({ adapterId: 'internal_mock', status: 'created' }));
  });

  it('blocks direct live-adapter calls before credentials or network access', async () => {
    const clientCredentialsToken = vi.fn();
    const createPayment = vi.fn();
    const adapter = getPaymentAdapter(selection('truelayer', 'truelayer', 'truelayer_pis'), {
      trueLayerConfig: liveConfig(),
      liveClient: { clientCredentialsToken, createPayment }
    });
    await expect(adapter.prepareExecution(liveContext())).rejects.toEqual(
      expect.objectContaining({ code: 'unsafe_action_blocked', classification: 'live_provider_capability_required' })
    );
    expect(clientCredentialsToken).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('rejects a JSON-shaped forged live capability before credentials or network access', async () => {
    const clientCredentialsToken = vi.fn();
    const createPayment = vi.fn();
    const adapter = getPaymentAdapter(selection('truelayer', 'truelayer', 'truelayer_pis'), {
      trueLayerConfig: liveConfig(),
      liveClient: { clientCredentialsToken, createPayment }
    });
    const forged = JSON.parse(JSON.stringify({ paymentId: 'payment-1', provider: 'truelayer', mode: 'truelayer' })) as LivePaymentExecutionCapability;
    await expect(adapter.prepareExecution(liveContext(), forged)).rejects.toEqual(
      expect.objectContaining({ code: 'unsafe_action_blocked', classification: 'live_provider_capability_required' })
    );
    expect(clientCredentialsToken).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('does not return a live adapter when provider configuration is absent', () => {
    expect(() => getPaymentAdapter(selection('truelayer', 'truelayer', 'truelayer_pis'), { trueLayerConfig: null })).toThrow(
      'No exact payment adapter exists for the approved provider policy'
    );
  });

  it('accepts a genuine exact capability and rejects a genuine capability bound to another payment before network access', async () => {
    const context = liveContext();
    const authorization = await liveAuthorization(context.policy);
    const clientCredentialsToken = vi.fn().mockResolvedValue({ access_token: 'token', expires_in: 3600, token_type: 'Bearer' });
    const createPayment = vi.fn().mockResolvedValue({ providerPaymentId: 'provider-payment', authorizationUri: 'https://provider.test/authorize' });
    const adapter = getPaymentAdapter(selection('truelayer', 'truelayer', 'truelayer_pis'), {
      trueLayerConfig: liveConfig(),
      liveClient: { clientCredentialsToken, createPayment }
    });
    const mismatched = issueLivePaymentExecutionCapability({ authorization, policy: context.policy, paymentId: 'different-payment' });
    await expect(adapter.prepareExecution(context, mismatched)).rejects.toEqual(
      expect.objectContaining({ classification: 'live_provider_capability_required' })
    );
    expect(clientCredentialsToken).not.toHaveBeenCalled();
    expect(createPayment).not.toHaveBeenCalled();

    const exact = issueLivePaymentExecutionCapability({ authorization, policy: context.policy, paymentId: context.paymentId });
    await expect(adapter.prepareExecution(context, exact)).resolves.toEqual(
      expect.objectContaining({ adapterId: 'truelayer_pis', providerRef: 'provider-payment', status: 'pending_sca' })
    );
    expect(clientCredentialsToken).toHaveBeenCalledTimes(1);
    expect(createPayment).toHaveBeenCalledTimes(1);
  });
});

function selection(
  provider: PaymentRailSelection['provider'],
  mode: PaymentRailSelection['mode'],
  adapterClass: PaymentRailSelection['adapterClass']
): PaymentRailSelection {
  return { provider, mode, adapterClass, capabilities: [], fallback: false, reason: 'test_exact_selection' };
}

function liveConfig() {
  return { apiBaseUrl: 'https://api.truelayer.com', authBaseUrl: 'https://auth.truelayer.com', clientId: 'id', clientSecret: 'secret' };
}

function liveContext() {
  const policy = paymentExecutionPolicySnapshot({
    profile: liveProfile,
    routeId: 'r_sepa',
    accountProvider: 'truelayer',
    accountCurrency: 'EUR',
    paymentCurrency: 'EUR',
    trueLayerConfigured: true
  });
  const input = {
    route_id: 'r_sepa',
    from_account_id: '00000000-0000-0000-0000-000000000005',
    creditor_name: 'Supplier',
    creditor_iban: 'PT50002700000001234567833',
    amount: 1250,
    currency: 'EUR',
    remittance: 'INV-1',
    e2e_id: 'E2E-1'
  };
  const paymentIntentId = '00000000-0000-0000-0000-000000000003';
  const payloadHash = hashCanonicalPayload({ payment_intent_id: paymentIntentId, trade_id: null, ...input, execution_policy: policy });
  return {
    orgId: '00000000-0000-0000-0000-000000000001',
    tradeId: null,
    paymentId: 'payment-1',
    approvalId: '00000000-0000-0000-0000-000000000002',
    paymentIntentId,
    payloadHash,
    scheme: 'SEPA',
    profile: liveProfile,
    policy,
    input,
    providerIdempotencyKey: 'provider-idempotency'
  };
}

function manualContext() {
  const policy = paymentExecutionPolicySnapshot({
    profile: manualProfile,
    routeId: 'r_manual',
    accountProvider: 'manual',
    accountCurrency: 'EUR',
    paymentCurrency: 'EUR',
    trueLayerConfigured: false
  });
  return { ...liveContext(), profile: manualProfile, policy, scheme: 'MANUAL_TRANSFER', input: { ...liveContext().input, route_id: 'r_manual' } };
}

async function liveAuthorization(policy: ReturnType<typeof paymentExecutionPolicySnapshot>) {
  const payload = {
    payment_intent_id: '00000000-0000-0000-0000-000000000003',
    trade_id: null,
    route_id: 'r_sepa',
    from_account_id: '00000000-0000-0000-0000-000000000005',
    creditor_name: 'Supplier',
    creditor_iban: 'PT50002700000001234567833',
    amount: 1250,
    currency: 'EUR',
    remittance: 'INV-1',
    e2e_id: 'E2E-1',
    execution_policy: policy
  };
  const client = {
    query: vi.fn().mockResolvedValue({
      rows: [
        {
          object_id: '00000000-0000-0000-0000-000000000002',
          org_id: '00000000-0000-0000-0000-000000000001',
          type: 'approval',
          status: 'approved',
          payload_json: {
            protected_action: 'send_payment',
            target: { type: 'payment_intent', id: payload.payment_intent_id },
            approval_chain_completed: true,
            protected_action_released: true,
            step_up_required: true,
            human_decision: { step_up_verified: true, residual_risks_acknowledged: true },
            approval_chain: [
              {
                key: 'finance_approval',
                required_role: 'finance',
                status: 'approved',
                actor_id: '00000000-0000-0000-0000-000000000004',
                decided_at: '2026-07-13T09:59:00.000Z',
                notes: 'Approved exact live payment.'
              }
            ],
            protected_execution_binding: {
              schema_version: 'protected-execution-v1',
              action: 'send_payment',
              org_id: '00000000-0000-0000-0000-000000000001',
              target: { type: 'payment_intent', id: payload.payment_intent_id },
              payload,
              payload_hash: hashCanonicalPayload(payload),
              frozen_at: '2026-07-13T09:58:00.000Z'
            }
          }
        }
      ]
    })
  } as unknown as Parameters<typeof authorizeProtectedExecution>[0];
  return authorizeProtectedExecution(client, {
    orgId: '00000000-0000-0000-0000-000000000001',
    approvalId: '00000000-0000-0000-0000-000000000002',
    action: 'send_payment',
    target: { type: 'payment_intent', id: payload.payment_intent_id },
    payload
  });
}
