import {
  ProtectedExecutionError,
  assertValidatedProtectedExecutionAuthorization,
  type ValidatedProtectedExecutionAuthorization
} from '../domains/approvals/protected-execution.js';
import type { PaymentExecutionPolicySnapshot } from './payment-policy.js';

const capabilityBrand: unique symbol = Symbol('validated-live-payment-execution');
const issuedCapabilities = new WeakSet<object>();

export interface LivePaymentExecutionCapability {
  readonly [capabilityBrand]: true;
  readonly approvalId: string;
  readonly paymentIntentId: string;
  readonly paymentId: string;
  readonly payloadHash: string;
  readonly policyDigest: string;
  readonly provider: string;
  readonly mode: string;
  readonly adapterClass: string;
}

export function issueLivePaymentExecutionCapability(input: {
  authorization: ValidatedProtectedExecutionAuthorization;
  policy: PaymentExecutionPolicySnapshot;
  paymentId: string;
}): LivePaymentExecutionCapability {
  assertValidatedProtectedExecutionAuthorization(input.authorization);
  if (
    input.authorization.action !== 'send_payment' ||
    input.authorization.target.type !== 'payment_intent' ||
    input.policy.intended_provider !== 'truelayer' ||
    input.policy.intended_mode !== 'truelayer' ||
    input.policy.intended_adapter_class !== 'truelayer_pis'
  ) {
    throw blocked('A live-payment capability requires an exact validated TrueLayer payment command');
  }
  const capability: LivePaymentExecutionCapability = Object.freeze({
    [capabilityBrand]: true as const,
    approvalId: input.authorization.approvalId,
    paymentIntentId: input.authorization.target.id,
    paymentId: input.paymentId,
    payloadHash: input.authorization.payloadHash,
    policyDigest: input.policy.deployment_policy_digest,
    provider: input.policy.intended_provider,
    mode: input.policy.intended_mode,
    adapterClass: input.policy.intended_adapter_class
  });
  issuedCapabilities.add(capability);
  return capability;
}

export function assertLivePaymentExecutionCapability(
  capability: LivePaymentExecutionCapability | undefined,
  expected: {
    paymentId: string;
    approvalId: string;
    paymentIntentId: string;
    payloadHash: string;
    policy: PaymentExecutionPolicySnapshot;
  }
): asserts capability is LivePaymentExecutionCapability {
  if (
    !capability ||
    typeof capability !== 'object' ||
    capability[capabilityBrand] !== true ||
    !issuedCapabilities.has(capability) ||
    capability.paymentId !== expected.paymentId ||
    capability.approvalId !== expected.approvalId ||
    capability.paymentIntentId !== expected.paymentIntentId ||
    capability.payloadHash !== expected.payloadHash ||
    capability.policyDigest !== expected.policy.deployment_policy_digest ||
    capability.provider !== expected.policy.intended_provider ||
    capability.mode !== expected.policy.intended_mode ||
    capability.adapterClass !== expected.policy.intended_adapter_class
  ) {
    throw blocked('Validated live-payment execution capability is required before provider access');
  }
}

function blocked(message: string): ProtectedExecutionError {
  return new ProtectedExecutionError('unsafe_action_blocked', message, 403, 'live_provider_capability_required');
}
