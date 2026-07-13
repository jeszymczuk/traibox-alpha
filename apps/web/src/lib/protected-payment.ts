import type { AlphaObject, PaymentExecutionPayload } from '@traibox/contracts';

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

export function paymentExecutionFromIntent(object: AlphaObject): PaymentExecutionPayload {
  if (object.type !== 'payment_intent') throw new Error('Protected payment approval requires a payment intent.');
  const payload = record(object.payload_json);
  const routeId = text(payload.route_id) ?? text(payload.selected_route_id);
  const accountId = text(payload.from_account_id);
  const creditorName = text(payload.creditor_name) ?? text(payload.beneficiary) ?? text(payload.supplier_name);
  const creditorIban = text(payload.creditor_iban) ?? text(payload.beneficiary_iban) ?? text(payload.iban);
  const amount = Number(payload.amount);
  const currency = text(payload.currency);
  const remittance = text(payload.remittance) ?? text(payload.purpose);
  const e2eId = text(payload.e2e_id);
  const missing = [
    !routeId && 'route',
    !accountId && 'debtor account',
    !creditorName && 'beneficiary',
    !creditorIban && 'beneficiary IBAN',
    (!Number.isFinite(amount) || amount <= 0) && 'positive amount',
    !currency && 'currency',
    !remittance && 'remittance',
    !e2eId && 'end-to-end ID'
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Complete and explicitly confirm the payment intent before approval. Missing: ${missing.join(', ')}.`);
  }
  if (accountId === ZERO_UUID) throw new Error('Select a real debtor account; the zero UUID placeholder is forbidden.');
  return {
    trade_id: object.trade_id ?? undefined,
    route_id: routeId!,
    from_account_id: accountId!,
    creditor_name: creditorName!,
    creditor_iban: creditorIban!,
    amount,
    currency: currency!,
    remittance: remittance!,
    e2e_id: e2eId!
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
