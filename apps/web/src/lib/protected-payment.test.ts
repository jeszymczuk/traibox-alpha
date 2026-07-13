import { describe, expect, it } from 'vitest';
import type { AlphaObject } from '@traibox/contracts';
import { paymentExecutionFromIntent } from './protected-payment';

const completePayload = {
  route_id: 'r_manual',
  from_account_id: '00000000-0000-0000-0000-000000000005',
  creditor_name: 'Exact Supplier',
  creditor_iban: 'PT50002700000001234567833',
  amount: 1250,
  currency: 'EUR',
  remittance: 'INV-EXACT-1',
  e2e_id: 'E2E-EXACT-1'
};

describe('protected payment intent material', () => {
  it('returns only exact material persisted on the selected payment intent', () => {
    expect(paymentExecutionFromIntent(intent(completePayload))).toEqual({ trade_id: undefined, ...completePayload });
  });

  it.each([
    ['route_id', 'route'],
    ['from_account_id', 'debtor account'],
    ['creditor_name', 'beneficiary'],
    ['creditor_iban', 'beneficiary IBAN'],
    ['amount', 'positive amount'],
    ['currency', 'currency'],
    ['remittance', 'remittance'],
    ['e2e_id', 'end-to-end ID']
  ] as const)('blocks approval when %s is absent instead of inventing a fallback', (key, label) => {
    const payload: Record<string, unknown> = { ...completePayload };
    delete payload[key];
    expect(() => paymentExecutionFromIntent(intent(payload))).toThrow(label);
  });

  it('rejects the zero-UUID debtor account placeholder', () => {
    expect(() =>
      paymentExecutionFromIntent(intent({ ...completePayload, from_account_id: '00000000-0000-0000-0000-000000000000' }))
    ).toThrow('zero UUID placeholder is forbidden');
  });

  it('rejects non-payment objects', () => {
    expect(() => paymentExecutionFromIntent({ ...intent(completePayload), type: 'trade_plan' })).toThrow(
      'Protected payment approval requires a payment intent'
    );
  });
});

function intent(payload: Record<string, unknown>): AlphaObject {
  return {
    object_id: '00000000-0000-0000-0000-000000000003',
    org_id: '00000000-0000-0000-0000-000000000001',
    type: 'payment_intent',
    title: 'Exact protected payment intent',
    status: 'approval_required',
    origin_workspace: 'finance',
    owner_id: '00000000-0000-0000-0000-000000000004',
    payload_json: payload,
    permissions_json: {},
    evidence_refs_json: [],
    audit_refs_json: [],
    trace_id: 'trace-test',
    created_at: '2026-07-13T10:00:00.000Z',
    updated_at: '2026-07-13T10:00:00.000Z'
  };
}
