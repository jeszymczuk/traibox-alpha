import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { AlphaObjectRef, PaymentExecutionPayload, ProtectedActionKind } from '@traibox/contracts';

export const PROTECTED_EXECUTION_BINDING_VERSION = 'protected-execution-v1' as const;

export type ProtectedExecutionTarget = Pick<AlphaObjectRef, 'type' | 'id'>;

export interface ProtectedExecutionBinding {
  schema_version: typeof PROTECTED_EXECUTION_BINDING_VERSION;
  action: Extract<ProtectedActionKind, 'send_payment' | 'accept_funding_offer'>;
  org_id: string;
  target: ProtectedExecutionTarget;
  payload: Record<string, unknown>;
  payload_hash: string;
  frozen_at: string;
}

export interface ProtectedExecutionConsumption {
  status: 'succeeded';
  action: ProtectedExecutionBinding['action'];
  target: ProtectedExecutionTarget;
  payload_hash: string;
  request_hash: string;
  result_type: 'payment' | 'reservation';
  result_id: string;
  idempotency_fingerprint: string;
  actor_id: string;
  trace_id: string;
  consumed_at: string;
}

export interface CanonicalPaymentExecutionPayload extends Record<string, unknown> {
  payment_intent_id: string;
  trade_id: string | null;
  route_id: string;
  from_account_id: string;
  creditor_name: string;
  creditor_iban: string;
  amount: number;
  currency: string;
  remittance: string | null;
  e2e_id: string;
}

export interface FundingOfferSnapshot extends Record<string, unknown> {
  offer_id: string;
  request_id: string | null;
  trade_id: string;
  financier: { id: string; name: string };
  request: {
    amount: number | null;
    currency: string | null;
    tenor_days: number | null;
    sustainable: unknown;
    status: string | null;
  };
  terms: {
    apr_bps: number;
    fees: number;
    tenor_days: number;
    currency: string;
    sustainability_tag: string;
    sustainability_grade: string;
    verification_level: string | null;
    sustainable_pricing_delta_bps: number | null;
    explanations: unknown;
    allocation: unknown;
    expires_at: string | null;
  };
  trade_status: string;
}

type ApprovalRow = {
  object_id: string;
  org_id: string;
  type: string;
  status: string;
  payload_json: Record<string, unknown>;
};

const authorizationBrand: unique symbol = Symbol('validated-protected-execution');

export interface ValidatedProtectedExecutionAuthorization {
  readonly [authorizationBrand]: true;
  approvalId: string;
  action: ProtectedExecutionBinding['action'];
  target: ProtectedExecutionTarget;
  payloadHash: string;
  binding: ProtectedExecutionBinding;
  existingConsumption: ProtectedExecutionConsumption | null;
}

export class ProtectedExecutionError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly classification: string;

  constructor(code: string, message: string, statusCode: number, classification = code) {
    super(message);
    this.name = 'ProtectedExecutionError';
    this.code = code;
    this.statusCode = statusCode;
    this.classification = classification;
  }
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export function hashCanonicalPayload(value: unknown): string {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

export function idempotencyFingerprint(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 24);
}

export function normalizePaymentExecutionPayload(input: {
  paymentIntentId: string;
  targetTradeId: string | null;
  execution: PaymentExecutionPayload;
}): CanonicalPaymentExecutionPayload {
  const amount = Number(input.execution.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw validationError('Payment amount must be positive');
  const currency = requiredString(input.execution.currency, 'Payment currency').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw validationError('Payment currency must be a three-letter code');
  const tradeId = input.execution.trade_id ?? null;
  if (tradeId !== input.targetTradeId) throw validationError('Payment trade binding does not match the payment intent');

  return {
    payment_intent_id: input.paymentIntentId,
    trade_id: tradeId,
    route_id: requiredString(input.execution.route_id, 'Payment route'),
    from_account_id: requiredString(input.execution.from_account_id, 'Debtor account'),
    creditor_name: normalizeHumanName(input.execution.creditor_name),
    creditor_iban: normalizeIban(input.execution.creditor_iban),
    amount,
    currency,
    remittance: optionalString(input.execution.remittance),
    e2e_id: requiredString(input.execution.e2e_id, 'Payment end-to-end ID')
  };
}

export async function createProtectedExecutionBinding(
  client: pg.PoolClient,
  input: {
    orgId: string;
    action: ProtectedActionKind;
    target: ProtectedExecutionTarget;
    paymentExecution?: PaymentExecutionPayload;
  }
): Promise<ProtectedExecutionBinding | null> {
  if (input.action === 'send_payment') {
    if (input.target.type !== 'payment_intent') {
      await assertTargetVisible(client, input.orgId, input.target);
      throw validationError('send_payment approval must target a payment_intent');
    }
    if (!input.paymentExecution) throw approvalRequired('send_payment approval requires a complete frozen execution payload');
    const target = await client.query<{ trade_id: string | null; payload_json: Record<string, unknown> }>(
      `SELECT trade_id, payload_json
       FROM alpha_objects
       WHERE object_id=$1 AND org_id=$2 AND type='payment_intent'
       LIMIT 1`,
      [input.target.id, input.orgId]
    );
    const paymentIntent = target.rows[0];
    if (!paymentIntent) throw notFound('Payment intent approval target not found');
    const payload = normalizePaymentExecutionPayload({
      paymentIntentId: input.target.id,
      targetTradeId: paymentIntent.trade_id,
      execution: input.paymentExecution
    });
    assertPaymentIntentMaterialMatches(paymentIntent.payload_json ?? {}, payload);
    return binding(input, payload);
  }

  if (input.action === 'accept_funding_offer') {
    if (input.target.type !== 'funding_offer') {
      await assertTargetVisible(client, input.orgId, input.target);
      throw validationError('accept_funding_offer approval must target a funding_offer');
    }
    const payload = await loadFundingOfferSnapshot(client, { orgId: input.orgId, offerId: input.target.id, lock: false });
    return binding(input, payload);
  }

  return null;
}

async function assertTargetVisible(client: pg.PoolClient, orgId: string, target: ProtectedExecutionTarget): Promise<void> {
  const result =
    target.type === 'trade' || target.type === 'trade_room'
      ? await client.query('SELECT 1 FROM trades WHERE trade_id=$1 AND org_id=$2 LIMIT 1', [target.id, orgId])
      : await client.query('SELECT 1 FROM alpha_objects WHERE object_id=$1 AND org_id=$2 LIMIT 1', [target.id, orgId]);
  if (!result.rows[0]) throw notFound('Approval target not found');
}

export async function loadFundingOfferSnapshot(
  client: pg.PoolClient,
  input: { orgId: string; offerId: string; lock: boolean }
): Promise<FundingOfferSnapshot> {
  const lockClause = input.lock ? 'FOR UPDATE OF offer_row' : '';
  const result = await client.query(
    `SELECT offer_row.offer_id, offer_row.request_id, offer_row.trade_id,
            offer_row.financier_id, offer_row.financier_name, offer_row.apr_bps,
            offer_row.fees, offer_row.tenor_days, offer_row.currency,
            offer_row.sustainability_tag, offer_row.sustainability_grade,
            offer_row.verification_level, offer_row.sustainable_pricing_delta_bps,
            offer_row.explanations, offer_row.allocation_json, offer_row.expires_at,
            request_row.amount AS request_amount, request_row.currency AS request_currency,
            request_row.tenor_days AS request_tenor_days, request_row.sustainable AS request_sustainable,
            request_row.status AS request_status, trade_row.status AS trade_status
       FROM finance_offers offer_row
       JOIN trades trade_row ON trade_row.trade_id=offer_row.trade_id AND trade_row.org_id=offer_row.org_id
       LEFT JOIN offer_requests request_row ON request_row.request_id=offer_row.request_id AND request_row.org_id=offer_row.org_id
      WHERE offer_row.offer_id=$1 AND offer_row.org_id=$2
      LIMIT 1
      ${lockClause}`,
    [input.offerId, input.orgId]
  );
  const row = result.rows[0];
  if (!row) throw notFound('Funding offer not found');
  return {
    offer_id: String(row.offer_id),
    request_id: nullableString(row.request_id),
    trade_id: String(row.trade_id),
    financier: { id: String(row.financier_id), name: String(row.financier_name) },
    request: {
      amount: nullableNumber(row.request_amount),
      currency: nullableString(row.request_currency)?.toUpperCase() ?? null,
      tenor_days: nullableNumber(row.request_tenor_days),
      sustainable: row.request_sustainable ?? null,
      status: nullableString(row.request_status)
    },
    terms: {
      apr_bps: requiredNumber(row.apr_bps, 'Offer APR'),
      fees: requiredNumber(row.fees, 'Offer fees'),
      tenor_days: requiredNumber(row.tenor_days, 'Offer tenor'),
      currency: requiredString(row.currency, 'Offer currency').toUpperCase(),
      sustainability_tag: requiredString(row.sustainability_tag, 'Offer sustainability tag'),
      sustainability_grade: requiredString(row.sustainability_grade, 'Offer sustainability grade'),
      verification_level: nullableString(row.verification_level),
      sustainable_pricing_delta_bps: nullableNumber(row.sustainable_pricing_delta_bps),
      explanations: row.explanations ?? null,
      allocation: row.allocation_json ?? null,
      expires_at: dateString(row.expires_at)
    },
    trade_status: requiredString(row.trade_status, 'Trade status')
  };
}

export async function authorizeProtectedExecution(
  client: pg.PoolClient,
  input: {
    orgId: string;
    approvalId: string;
    action: ProtectedExecutionBinding['action'];
    target: ProtectedExecutionTarget;
    payload: Record<string, unknown>;
  }
): Promise<ValidatedProtectedExecutionAuthorization> {
  const result = await client.query<ApprovalRow>(
    `SELECT object_id, org_id, type, status, payload_json
       FROM alpha_objects
      WHERE object_id=$1 AND org_id=$2
      FOR UPDATE`,
    [input.approvalId, input.orgId]
  );
  const approval = result.rows[0];
  if (!approval) throw notFound('Approval not found');
  if (approval.type !== 'approval') throw protectedNotApproved('Approval reference is not an approval object');
  if (approval.status !== 'approved') throw protectedNotApproved(`Approval is ${approval.status || 'not approved'}`);

  const storedAction = optionalString(approval.payload_json?.protected_action);
  if (storedAction !== input.action) throw protectedNotApproved('Approval protected action does not match execution');
  const storedTarget = record(approval.payload_json?.target);
  if (storedTarget.type !== input.target.type || storedTarget.id !== input.target.id) {
    throw protectedNotApproved('Approval target does not match execution');
  }
  if (approval.payload_json?.approval_chain_completed !== true || approval.payload_json?.protected_action_released !== true) {
    throw protectedNotApproved('Approval chain has not fully released this action');
  }
  assertApprovalChainEvidence(approval.payload_json);

  const storedBinding = record(approval.payload_json?.protected_execution_binding) as unknown as ProtectedExecutionBinding;
  if (
    storedBinding.schema_version !== PROTECTED_EXECUTION_BINDING_VERSION ||
    storedBinding.org_id !== input.orgId ||
    storedBinding.action !== input.action ||
    storedBinding.target?.type !== input.target.type ||
    storedBinding.target?.id !== input.target.id
  ) {
    throw protectedNotApproved('Approval is missing the exact protected-execution binding');
  }
  const storedPayloadHash = hashCanonicalPayload(storedBinding.payload);
  if (storedPayloadHash !== storedBinding.payload_hash) throw unsafeBlocked('Stored approval payload binding failed integrity validation');
  const payloadHash = hashCanonicalPayload(input.payload);
  if (payloadHash !== storedBinding.payload_hash) throw protectedNotApproved('Execution payload does not match the approved frozen payload');

  const consumptionValue = approval.payload_json?.protected_execution_consumption;
  const existingConsumption = isConsumption(consumptionValue) ? consumptionValue : null;
  if (existingConsumption && (existingConsumption.action !== input.action || existingConsumption.target.type !== input.target.type || existingConsumption.target.id !== input.target.id)) {
    throw unsafeBlocked('Approval was already consumed for a different execution');
  }
  if (existingConsumption && existingConsumption.payload_hash !== payloadHash) {
    throw protectedNotApproved('Approval was already consumed with a different payload');
  }

  return {
    [authorizationBrand]: true,
    approvalId: approval.object_id,
    action: input.action,
    target: input.target,
    payloadHash,
    binding: storedBinding,
    existingConsumption
  };
}

export async function consumeProtectedExecutionApproval(
  client: pg.PoolClient,
  authorization: ValidatedProtectedExecutionAuthorization,
  input: Omit<ProtectedExecutionConsumption, 'status' | 'action' | 'target' | 'payload_hash'>
): Promise<ProtectedExecutionConsumption> {
  if (authorization[authorizationBrand] !== true) throw unsafeBlocked('Validated protected-execution authorization is required');
  const consumption: ProtectedExecutionConsumption = {
    status: 'succeeded',
    action: authorization.action,
    target: authorization.target,
    payload_hash: authorization.payloadHash,
    ...input
  };
  await client.query(
    `UPDATE alpha_objects
        SET payload_json=jsonb_set(payload_json, '{protected_execution_consumption}', $1::jsonb, true),
            trace_id=$2
      WHERE object_id=$3 AND org_id=$4`,
    [JSON.stringify(consumption), input.trace_id, authorization.approvalId, authorization.binding.org_id]
  );
  return consumption;
}

function binding(
  input: { orgId: string; action: ProtectedActionKind; target: ProtectedExecutionTarget },
  payload: Record<string, unknown>
): ProtectedExecutionBinding {
  return {
    schema_version: PROTECTED_EXECUTION_BINDING_VERSION,
    action: input.action as ProtectedExecutionBinding['action'],
    org_id: input.orgId,
    target: input.target,
    payload,
    payload_hash: hashCanonicalPayload(payload),
    frozen_at: new Date().toISOString()
  };
}

function assertPaymentIntentMaterialMatches(intent: Record<string, unknown>, payment: CanonicalPaymentExecutionPayload): void {
  const comparisons: Array<[string, unknown, unknown]> = [
    ['amount', intent.amount, payment.amount],
    ['currency', intent.currency, payment.currency],
    ['route', intent.route_id ?? intent.selected_route_id, payment.route_id],
    ['debtor account', intent.from_account_id, payment.from_account_id],
    ['beneficiary', intent.creditor_name ?? intent.beneficiary ?? intent.supplier_name, payment.creditor_name],
    ['beneficiary IBAN', intent.creditor_iban ?? intent.beneficiary_iban ?? intent.iban, payment.creditor_iban],
    ['remittance', intent.remittance ?? intent.purpose, payment.remittance],
    ['end-to-end ID', intent.e2e_id, payment.e2e_id]
  ];
  for (const [label, expectedRaw, actualRaw] of comparisons) {
    if (expectedRaw === undefined || expectedRaw === null || expectedRaw === '') continue;
    let expected: unknown = expectedRaw;
    let actual: unknown = actualRaw;
    if (label === 'currency') {
      expected = String(expectedRaw).trim().toUpperCase();
      actual = String(actualRaw).trim().toUpperCase();
    } else if (label === 'beneficiary IBAN') {
      expected = normalizeIban(String(expectedRaw));
      actual = normalizeIban(String(actualRaw));
    } else if (label === 'beneficiary') {
      expected = normalizeHumanName(String(expectedRaw));
      actual = normalizeHumanName(String(actualRaw));
    } else if (label === 'amount') {
      expected = Number(expectedRaw);
      actual = Number(actualRaw);
    } else {
      expected = optionalString(expectedRaw);
      actual = optionalString(actualRaw);
    }
    if (expected !== actual) throw validationError(`Frozen payment ${label} does not match the payment intent`);
  }
}

function assertApprovalChainEvidence(payload: Record<string, unknown>): void {
  const chain = Array.isArray(payload.approval_chain) ? payload.approval_chain : [];
  if (!chain.length) throw protectedNotApproved('Approval chain evidence is missing');
  for (const stepValue of chain) {
    const step = record(stepValue);
    if (step.status !== 'approved' || !optionalString(step.actor_id) || !optionalString(step.decided_at) || !optionalString(step.notes)) {
      throw protectedNotApproved('Approval chain evidence is incomplete');
    }
  }
  const decision = record(payload.human_decision);
  if (payload.step_up_required !== false && decision.step_up_verified !== true) {
    throw protectedNotApproved('Approval step-up evidence is missing');
  }
  if (decision.residual_risks_acknowledged !== true) {
    throw protectedNotApproved('Approval residual-risk acknowledgement is missing');
  }
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw validationError('Canonical payload contains a non-finite number');
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)])
    );
  }
  throw validationError('Canonical payload contains an unsupported value');
}

function isConsumption(value: unknown): value is ProtectedExecutionConsumption {
  const item = record(value);
  const target = record(item.target);
  return (
    item.status === 'succeeded' &&
    (item.action === 'send_payment' || item.action === 'accept_funding_offer') &&
    typeof target.type === 'string' &&
    typeof target.id === 'string' &&
    typeof item.payload_hash === 'string' &&
    typeof item.result_id === 'string'
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requiredString(value: unknown, label: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw validationError(`${label} is required`);
  return normalized;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function normalizeHumanName(value: string): string {
  return requiredString(value, 'Creditor name').replace(/\s+/g, ' ');
}

function normalizeIban(value: string): string {
  const normalized = requiredString(value, 'Creditor IBAN').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{6,32}$/.test(normalized)) throw validationError('Creditor IBAN is invalid');
  return normalized;
}

function requiredNumber(value: unknown, label: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw validationError(`${label} is invalid`);
  return normalized;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) throw validationError('Protected execution snapshot contains an invalid number');
  return normalized;
}

function dateString(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw validationError('Protected execution snapshot contains an invalid date');
  return date.toISOString();
}

function validationError(message: string): ProtectedExecutionError {
  return new ProtectedExecutionError('validation_error', message, 400);
}

function approvalRequired(message: string): ProtectedExecutionError {
  return new ProtectedExecutionError('approval_required', message, 409);
}

function protectedNotApproved(message: string): ProtectedExecutionError {
  return new ProtectedExecutionError('protected_action_not_approved', message, 409);
}

function unsafeBlocked(message: string): ProtectedExecutionError {
  return new ProtectedExecutionError('unsafe_action_blocked', message, 403);
}

function notFound(message: string): ProtectedExecutionError {
  return new ProtectedExecutionError('not_found', message, 404);
}
