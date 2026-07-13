import type { Payment, PaymentExecutionPayload, PaymentRailCapability, PaymentRailProvider } from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import { clientCredentialsToken, createPayment, getTrueLayerConfigFromEnv, type TrueLayerConfig } from './truelayer.js';
import {
  capabilitiesFor,
  type PaymentAdapterClass,
  type PaymentExecutionPolicySnapshot,
  type PaymentRailMode,
  type PaymentRailSelection
} from './payment-policy.js';
import {
  assertLivePaymentExecutionCapability,
  type LivePaymentExecutionCapability
} from './payment-provider-capability.js';
export { capabilitiesFor, resolvePaymentRail as selectPaymentRail } from './payment-policy.js';
export type { PaymentRailMode, PaymentRailSelection } from './payment-policy.js';

export interface PaymentExecutionContext {
  orgId: string;
  tradeId: string | null;
  paymentId: string;
  approvalId: string;
  paymentIntentId: string;
  payloadHash: string;
  scheme: string;
  profile: Profile;
  policy: PaymentExecutionPolicySnapshot;
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
  adapterClass: PaymentAdapterClass;
  capabilities: PaymentRailCapability[];
  canExecute(selection: PaymentRailSelection): boolean;
  prepareExecution(context: PaymentExecutionContext, capability?: LivePaymentExecutionCapability): Promise<PreparedPaymentExecution>;
}

export function getPaymentAdapter(
  selection: PaymentRailSelection,
  input: {
    trueLayerConfig?: TrueLayerConfig | null;
    liveClient?: { clientCredentialsToken: typeof clientCredentialsToken; createPayment: typeof createPayment };
  }
): PaymentProviderAdapter {
  const adapters: PaymentProviderAdapter[] = [
    manualPaymentAdapter,
    trueLayerPaymentAdapter(input.trueLayerConfig ?? null, input.liveClient),
    ibanFirstPaymentAdapter,
    mockPaymentAdapter
  ];
  const adapter = adapters.find((candidate) => candidate.canExecute(selection));
  if (!adapter || adapter.provider !== selection.provider || adapter.mode !== selection.mode || adapter.adapterClass !== selection.adapterClass) {
    throw new Error('No exact payment adapter exists for the approved provider policy');
  }
  return adapter;
}

export const manualPaymentAdapter: PaymentProviderAdapter = {
  provider: 'manual',
  mode: 'manual',
  adapterClass: 'manual_transfer',
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

function trueLayerPaymentAdapter(
  config: TrueLayerConfig | null,
  liveClient: { clientCredentialsToken: typeof clientCredentialsToken; createPayment: typeof createPayment } = {
    clientCredentialsToken,
    createPayment
  }
): PaymentProviderAdapter {
  return {
    provider: 'truelayer',
    mode: 'truelayer',
    adapterClass: 'truelayer_pis',
    capabilities: capabilitiesFor('truelayer'),
    canExecute: (selection) => selection.mode === 'truelayer' && Boolean(config),
    async prepareExecution(context, capability) {
      assertLivePaymentExecutionCapability(capability, {
        paymentId: context.paymentId,
        approvalId: context.approvalId,
        paymentIntentId: context.paymentIntentId,
        payloadHash: context.payloadHash,
        policy: context.policy
      });
      if (!config) throw new Error('TrueLayer adapter selected without configuration');
      const token = await liveClient.clientCredentialsToken({
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

      const created = await liveClient.createPayment({
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
  adapterClass: 'ibanfirst_planned',
  capabilities: capabilitiesFor('ibanfirst'),
  canExecute: (selection) => selection.mode === 'ibanfirst',
  async prepareExecution(context) {
    void context;
    throw new Error('The iBanFirst adapter is planned and cannot prepare a protected payment');
  }
};

export const mockPaymentAdapter: PaymentProviderAdapter = {
  provider: 'internal',
  mode: 'mock',
  adapterClass: 'internal_mock',
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
