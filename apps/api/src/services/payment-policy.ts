import { createHash } from 'node:crypto';
import type { PaymentRailCapability, PaymentRailProvider } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';

export const PAYMENT_EXECUTION_POLICY_VERSION = 'payment-execution-policy-v1' as const;

export type PaymentRailMode = 'manual' | 'truelayer' | 'ibanfirst' | 'mock';
export type PaymentAdapterClass = 'manual_transfer' | 'truelayer_pis' | 'ibanfirst_planned' | 'internal_mock';

export interface PaymentRailSelection {
  provider: PaymentRailProvider;
  mode: PaymentRailMode;
  adapterClass: PaymentAdapterClass;
  capabilities: PaymentRailCapability[];
  fallback: false;
  reason: string;
}

export interface PaymentExecutionPolicySnapshot extends Record<string, unknown> {
  policy_version: typeof PAYMENT_EXECUTION_POLICY_VERSION;
  deployment_profile_id: string;
  deployment_policy_digest: string;
  provider_configuration_digest: string;
  route_id: string;
  scheme: 'MANUAL_TRANSFER' | 'SEPA' | 'SEPA_INSTANT';
  intended_provider: PaymentRailProvider;
  intended_mode: PaymentRailMode;
  intended_adapter_class: PaymentAdapterClass;
  capabilities: PaymentRailCapability[];
  debtor_account_provider: string;
  debtor_account_currency: string;
  provider_available: true;
}

const PROVIDER_CAPABILITIES: Record<string, PaymentRailCapability[]> = {
  manual: ['manual_transfer', 'payment_tracking'],
  truelayer: ['open_banking_ais', 'open_banking_pis', 'pay_by_bank', 'webhook_reconciliation'],
  ibanfirst: ['cross_border_payment', 'fx_conversion', 'currency_account', 'beneficiary_management', 'payment_tracking', 'webhook_reconciliation'],
  internal: []
};

export class PaymentPolicyError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly classification: string;

  constructor(code: string, message: string, statusCode: number, classification = code) {
    super(message);
    this.name = 'PaymentPolicyError';
    this.code = code;
    this.statusCode = statusCode;
    this.classification = classification;
  }
}

export function capabilitiesFor(provider: PaymentRailProvider): PaymentRailCapability[] {
  return [...(PROVIDER_CAPABILITIES[provider] ?? [])];
}

export function resolvePaymentRail(input: {
  profile: Profile;
  routeId: string;
  fromProviderId: string | null;
  trueLayerConfigured: boolean;
}): PaymentRailSelection {
  const routeId = input.routeId.trim();
  if (!['r_manual', 'r_sepa', 'r_sepa_instant'].includes(routeId)) {
    throw policyError('validation_error', 'Selected payment route is not supported', 400, 'invalid_payment_route');
  }

  if (routeId === 'r_manual') {
    if (!input.profile.payments.manual.enabled) {
      throw policyError('unsafe_action_blocked', 'Manual payment execution is disabled by the deployment profile', 403, 'payment_mode_disabled');
    }
    if (input.fromProviderId !== 'manual') {
      throw policyError(
        'protected_action_not_approved',
        'The approved manual route requires an explicitly selected manual debtor account',
        409,
        'account_provider_mismatch'
      );
    }
    return {
      provider: 'manual',
      mode: 'manual',
      adapterClass: 'manual_transfer',
      capabilities: capabilitiesFor('manual'),
      fallback: false,
      reason: 'explicit_manual_route'
    };
  }

  const activeProvider = input.profile.payments.active_provider;
  if (activeProvider === 'manual') {
    throw policyError(
      'unsafe_action_blocked',
      'A non-manual route cannot be executed by the manual provider; select and approve the manual route explicitly',
      403,
      'payment_semantics_substitution'
    );
  }
  if (activeProvider === 'ibanfirst') {
    throw policyError(
      'unsafe_action_blocked',
      'The iBanFirst payment adapter is planned and cannot execute protected payments',
      403,
      'planned_payment_adapter'
    );
  }
  if (input.fromProviderId !== activeProvider) {
    throw policyError(
      'protected_action_not_approved',
      'The debtor-account provider does not match the configured payment provider',
      409,
      'account_provider_mismatch'
    );
  }
  if (!input.profile.payments.truelayer.enabled || !input.trueLayerConfigured) {
    throw policyError(
      'unsafe_action_blocked',
      'The approved live payment provider is unavailable; a new execution policy and approval are required',
      403,
      'payment_provider_unavailable'
    );
  }
  const capabilities = capabilitiesFor('truelayer');
  if (!capabilities.includes('open_banking_pis')) {
    throw policyError('unsafe_action_blocked', 'The configured provider lacks payment-initiation capability', 403, 'payment_capability_mismatch');
  }
  return {
    provider: 'truelayer',
    mode: 'truelayer',
    adapterClass: 'truelayer_pis',
    capabilities,
    fallback: false,
    reason: 'exact_active_provider'
  };
}

export function paymentExecutionPolicySnapshot(input: {
  profile: Profile;
  routeId: string;
  accountProvider: string;
  accountCurrency: string;
  paymentCurrency: string;
  trueLayerConfigured: boolean;
  trueLayerApiBaseUrl?: string | null;
  trueLayerAuthBaseUrl?: string | null;
}): PaymentExecutionPolicySnapshot {
  const selection = resolvePaymentRail({
    profile: input.profile,
    routeId: input.routeId,
    fromProviderId: input.accountProvider,
    trueLayerConfigured: input.trueLayerConfigured
  });
  const accountCurrency = input.accountCurrency.trim().toUpperCase();
  const paymentCurrency = input.paymentCurrency.trim().toUpperCase();
  if (accountCurrency !== paymentCurrency && !selection.capabilities.includes('fx_conversion')) {
    throw policyError(
      'validation_error',
      'Debtor account currency does not support the approved payment currency',
      400,
      'account_currency_mismatch'
    );
  }
  const scheme = input.routeId === 'r_manual' ? 'MANUAL_TRANSFER' : input.routeId === 'r_sepa_instant' ? 'SEPA_INSTANT' : 'SEPA';
  const providerConfiguration =
    selection.provider === 'truelayer'
      ? {
          api_base_url: input.profile.payments.truelayer.base_url ?? input.trueLayerApiBaseUrl ?? null,
          auth_base_url: input.trueLayerAuthBaseUrl ?? null,
          payments_path: input.profile.payments.truelayer.payments_path
        }
      : { mode: selection.mode, adapter_class: selection.adapterClass };
  const providerConfigurationDigest = hashPolicy(providerConfiguration);
  const policyMaterial = {
    policy_version: PAYMENT_EXECUTION_POLICY_VERSION,
    deployment_profile_id: input.profile.profile_id,
    profile_payment_policy: {
      active_provider: input.profile.payments.active_provider,
      rails_preference: [...input.profile.payments.rails_preference],
      manual_enabled: input.profile.payments.manual.enabled,
      truelayer_enabled: input.profile.payments.truelayer.enabled,
      ibanfirst_enabled: input.profile.payments.ibanfirst.enabled,
      provider_configuration_digest: providerConfigurationDigest
    },
    route_id: input.routeId,
    scheme,
    intended_provider: selection.provider,
    intended_mode: selection.mode,
    intended_adapter_class: selection.adapterClass,
    capabilities: [...selection.capabilities].sort(),
    debtor_account_provider: input.accountProvider,
    debtor_account_currency: accountCurrency,
    provider_available: true
  };
  return {
    policy_version: PAYMENT_EXECUTION_POLICY_VERSION,
    deployment_profile_id: input.profile.profile_id,
    deployment_policy_digest: hashPolicy(policyMaterial),
    provider_configuration_digest: providerConfigurationDigest,
    route_id: input.routeId,
    scheme,
    intended_provider: selection.provider,
    intended_mode: selection.mode,
    intended_adapter_class: selection.adapterClass,
    capabilities: [...selection.capabilities].sort(),
    debtor_account_provider: input.accountProvider,
    debtor_account_currency: accountCurrency,
    provider_available: true
  };
}

export function assertPaymentPolicyUnchanged(
  approved: PaymentExecutionPolicySnapshot,
  resolved: PaymentExecutionPolicySnapshot
): void {
  if (hashPolicy(approved) !== hashPolicy(resolved)) {
    throw policyError(
      'protected_action_not_approved',
      'Payment route, provider, mode, adapter, capability, account, or deployment policy changed after approval',
      409,
      'payment_policy_changed'
    );
  }
}

function hashPolicy(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalValue(item)])
    );
  }
  return String(value);
}

function policyError(code: string, message: string, statusCode: number, classification: string): PaymentPolicyError {
  return new PaymentPolicyError(code, message, statusCode, classification);
}
