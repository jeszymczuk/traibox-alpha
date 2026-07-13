import type { Payment, PaymentExecutionPayload, PaymentRailCapability, PaymentRailProvider } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import { clientCredentialsToken, createPayment, getTrueLayerConfigFromEnv, type TrueLayerConfig } from './truelayer.js';

export type PaymentRailMode = 'manual' | 'truelayer' | 'ibanfirst' | 'mock';

export interface PaymentRailSelection {
  provider: PaymentRailProvider;
  mode: PaymentRailMode;
  capabilities: PaymentRailCapability[];
  fallback: boolean;
  reason: string;
}

export interface PaymentExecutionContext {
  orgId: string;
  tradeId: string | null;
  paymentId: string;
  scheme: string;
  profile: Profile;
  input: PaymentExecutionPayload;
  providerIdempotencyKey: string;
}

export interface PreparedPaymentExecution {
  providerRef: string | null;
  redirectUrl: string | null;
  status: Payment['status'];
  adapterId: string;
  attemptRaw: Record<string, unknown>;
  adapterMetadata: Record<string, unknown>;
}

export interface PaymentProviderAdapter {
  provider: PaymentRailProvider;
  mode: PaymentRailMode;
  capabilities: PaymentRailCapability[];
  canExecute(selection: PaymentRailSelection): boolean;
  prepareExecution(context: PaymentExecutionContext): Promise<PreparedPaymentExecution>;
}

const PROVIDER_CAPABILITIES: Record<string, PaymentRailCapability[]> = {
  manual: ['manual_transfer', 'payment_tracking'],
  truelayer: ['open_banking_ais', 'open_banking_pis', 'pay_by_bank', 'webhook_reconciliation'],
  ibanfirst: ['cross_border_payment', 'fx_conversion', 'currency_account', 'beneficiary_management', 'payment_tracking', 'webhook_reconciliation'],
  internal: []
};

export function capabilitiesFor(provider: PaymentRailProvider): PaymentRailCapability[] {
  return PROVIDER_CAPABILITIES[provider] ?? [];
}

export function selectPaymentRail(input: {
  profile: Profile;
  routeId: string;
  fromProviderId: string | null;
  trueLayerConfigured: boolean;
}): PaymentRailSelection {
  const { profile, routeId, fromProviderId, trueLayerConfigured } = input;

  if (profile.payments.manual.enabled && (routeId === 'r_manual' || fromProviderId === 'manual')) {
    return { provider: 'manual', mode: 'manual', capabilities: capabilitiesFor('manual'), fallback: true, reason: 'manual_route_or_account' };
  }

  if (profile.payments.active_provider === 'manual' && profile.payments.manual.enabled) {
    return { provider: 'manual', mode: 'manual', capabilities: capabilitiesFor('manual'), fallback: true, reason: 'active_provider_manual' };
  }

  if (profile.payments.active_provider === 'ibanfirst') {
    if (profile.payments.manual.enabled) {
      return { provider: 'manual', mode: 'manual', capabilities: capabilitiesFor('manual'), fallback: true, reason: 'ibanfirst_adapter_planned_manual_fallback' };
    }
    return { provider: 'ibanfirst', mode: 'ibanfirst', capabilities: capabilitiesFor('ibanfirst'), fallback: false, reason: 'ibanfirst_adapter_planned' };
  }

  if (profile.payments.truelayer.enabled && trueLayerConfigured) {
    return { provider: 'truelayer', mode: 'truelayer', capabilities: capabilitiesFor('truelayer'), fallback: false, reason: 'active_provider_truelayer' };
  }

  if (profile.payments.manual.enabled) {
    return { provider: 'manual', mode: 'manual', capabilities: capabilitiesFor('manual'), fallback: true, reason: 'provider_unavailable_manual_fallback' };
  }

  return { provider: profile.payments.active_provider, mode: 'mock', capabilities: capabilitiesFor(profile.payments.active_provider), fallback: false, reason: 'no_live_provider_configured' };
}

export function getPaymentAdapter(selection: PaymentRailSelection, input: { trueLayerConfig?: TrueLayerConfig | null }): PaymentProviderAdapter {
  const adapters: PaymentProviderAdapter[] = [manualPaymentAdapter, trueLayerPaymentAdapter(input.trueLayerConfig ?? null), ibanFirstPaymentAdapter, mockPaymentAdapter];
  return adapters.find((adapter) => adapter.canExecute(selection)) ?? mockPaymentAdapter;
}

export const manualPaymentAdapter: PaymentProviderAdapter = {
  provider: 'manual',
  mode: 'manual',
  capabilities: capabilitiesFor('manual'),
  canExecute: (selection) => selection.mode === 'manual',
  async prepareExecution(context) {
    return {
      providerRef: null,
      redirectUrl: manualPaymentUrl(context),
      status: 'created',
      adapterId: 'manual_transfer',
      attemptRaw: { mode: 'manual', provider: 'manual' },
      adapterMetadata: { redirect_kind: 'manual_instruction' }
    };
  }
};

export function trueLayerPaymentAdapter(config: TrueLayerConfig | null): PaymentProviderAdapter {
  return {
    provider: 'truelayer',
    mode: 'truelayer',
    capabilities: capabilitiesFor('truelayer'),
    canExecute: (selection) => selection.mode === 'truelayer' && Boolean(config),
    async prepareExecution(context) {
      if (!config) throw new Error('TrueLayer adapter selected without configuration');
      const token = await clientCredentialsToken({
        authBaseUrl: config.authBaseUrl,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        scope: 'payments'
      });

      const apiBaseUrl = context.profile.payments.truelayer.base_url ?? config.apiBaseUrl;
      const webhookUri = `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/webhooks/payments`;
      const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
      const redirectUri = context.tradeId ? `${webBase}/trade/${context.tradeId}` : webBase;
      const amountInMinor = Math.round(Number(context.input.amount) * 100);

      const created = await createPayment({
        apiBaseUrl,
        paymentsPath: context.profile.payments.truelayer.payments_path,
        accessToken: token.access_token,
        amountInMinor,
        currency: context.input.currency,
        creditorName: context.input.creditor_name,
        creditorIban: context.input.creditor_iban,
        reference: context.input.remittance ?? 'TRAIBOX',
        redirectUri,
        webhookUri,
        metadata: { internal_payment_id: context.paymentId, ...(context.tradeId ? { trade_id: context.tradeId } : {}), scheme: context.scheme },
        idempotencyKey: context.providerIdempotencyKey
      });

      return {
        providerRef: created.providerPaymentId,
        redirectUrl: created.authorizationUri,
        status: 'pending_sca',
        adapterId: 'truelayer_pis',
        attemptRaw: { mode: 'truelayer', provider: 'truelayer' },
        adapterMetadata: { redirect_kind: 'provider_authorization', webhook_expected: true }
      };
    }
  };
}

export const ibanFirstPaymentAdapter: PaymentProviderAdapter = {
  provider: 'ibanfirst',
  mode: 'ibanfirst',
  capabilities: capabilitiesFor('ibanfirst'),
  canExecute: (selection) => selection.mode === 'ibanfirst',
  async prepareExecution(context) {
    return {
      providerRef: null,
      redirectUrl: mockPaymentUrl(context, 'ibanfirst-planned'),
      status: 'created',
      adapterId: 'ibanfirst_planned',
      attemptRaw: { mode: 'ibanfirst', provider: 'ibanfirst', planned: true },
      adapterMetadata: { redirect_kind: 'planned_adapter_placeholder', live_execution_enabled: false }
    };
  }
};

export const mockPaymentAdapter: PaymentProviderAdapter = {
  provider: 'internal',
  mode: 'mock',
  capabilities: [],
  canExecute: (selection) => selection.mode === 'mock',
  async prepareExecution(context) {
    return {
      providerRef: null,
      redirectUrl: mockPaymentUrl(context, 'mock'),
      status: 'created',
      adapterId: 'internal_mock',
      attemptRaw: { mode: 'mock', provider: 'internal' },
      adapterMetadata: { redirect_kind: 'mock_instruction' }
    };
  }
};

export function getTrueLayerPaymentConfig(): TrueLayerConfig | null {
  return getTrueLayerConfigFromEnv();
}

function manualPaymentUrl(context: PaymentExecutionContext): string {
  const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
  const u = new URL(`${webBase}/payments/manual`);
  u.searchParams.set('payment_id', context.paymentId);
  u.searchParams.set('org_id', context.orgId);
  if (context.tradeId) u.searchParams.set('trade_id', context.tradeId);
  return u.toString();
}

function mockPaymentUrl(context: PaymentExecutionContext, mode: string): string {
  const u = new URL(manualPaymentUrl(context));
  u.searchParams.set('mode', mode);
  return u.toString();
}
