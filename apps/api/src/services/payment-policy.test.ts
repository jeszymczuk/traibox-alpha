import { describe, expect, it } from 'vitest';
import { parseProfileYaml } from '@traibox/profiles';
import { assertPaymentPolicyUnchanged, paymentExecutionPolicySnapshot } from './payment-policy';

const manualProfile = profile('manual-policy', 'manual');
const liveProfile = profile('live-policy', 'truelayer');

describe('immutable payment execution policy', () => {
  it('accepts an exact current resolution and keeps explicit manual execution manual', () => {
    const approved = manualSnapshot(manualProfile);
    const current = manualSnapshot(manualProfile);
    expect(() => assertPaymentPolicyUnchanged(approved, current)).not.toThrow();
    expect(current).toEqual(expect.objectContaining({ intended_provider: 'manual', intended_mode: 'manual', intended_adapter_class: 'manual_transfer' }));
  });

  it('requires a new approval when deployment provider policy changes', () => {
    const approved = manualSnapshot(manualProfile);
    const changed = manualSnapshot(liveProfile);
    expect(() => assertPaymentPolicyUnchanged(approved, changed)).toThrowError(
      expect.objectContaining({ classification: 'payment_policy_changed' })
    );
    expect(() => assertPaymentPolicyUnchanged(changed, manualSnapshot(liveProfile))).not.toThrow();
  });

  it('binds non-secret effective provider endpoints into the immutable policy digest', () => {
    const approvedProfile = profileWithApiBase('same-policy-id', 'https://provider-a.test');
    const changedProfile = profileWithApiBase('same-policy-id', 'https://provider-b.test');
    const approved = liveSnapshot(approvedProfile);
    const changed = liveSnapshot(changedProfile);
    expect(changed.provider_configuration_digest).not.toBe(approved.provider_configuration_digest);
    expect(() => assertPaymentPolicyUnchanged(approved, changed)).toThrowError(
      expect.objectContaining({ classification: 'payment_policy_changed' })
    );
  });

  it('detects route, account-provider, adapter, capability, and policy-digest tampering', () => {
    const approved = manualSnapshot(manualProfile);
    for (const changed of [
      { ...approved, route_id: 'r_sepa' },
      { ...approved, debtor_account_provider: 'truelayer' },
      { ...approved, intended_adapter_class: 'internal_mock' },
      { ...approved, capabilities: [] },
      { ...approved, deployment_policy_digest: 'forged' }
    ]) {
      expect(() => assertPaymentPolicyUnchanged(approved, changed as typeof approved)).toThrowError(
        expect.objectContaining({ classification: 'payment_policy_changed' })
      );
    }
  });

  it('blocks provider availability loss instead of falling back after approval', () => {
    const approved = paymentExecutionPolicySnapshot({
      profile: liveProfile,
      routeId: 'r_sepa',
      accountProvider: 'truelayer',
      accountCurrency: 'EUR',
      paymentCurrency: 'EUR',
      trueLayerConfigured: true
    });
    expect(approved.intended_provider).toBe('truelayer');
    expect(() =>
      paymentExecutionPolicySnapshot({
        profile: liveProfile,
        routeId: 'r_sepa',
        accountProvider: 'truelayer',
        accountCurrency: 'EUR',
        paymentCurrency: 'EUR',
        trueLayerConfigured: false
      })
    ).toThrowError(expect.objectContaining({ classification: 'payment_provider_unavailable' }));
  });

  it('blocks currency mismatch when the exact approved rail has no FX capability', () => {
    expect(() =>
      paymentExecutionPolicySnapshot({
        profile: manualProfile,
        routeId: 'r_manual',
        accountProvider: 'manual',
        accountCurrency: 'EUR',
        paymentCurrency: 'USD',
        trueLayerConfigured: false
      })
    ).toThrowError(expect.objectContaining({ classification: 'account_currency_mismatch' }));
  });
});

function manualSnapshot(deploymentProfile: ReturnType<typeof profile>) {
  return paymentExecutionPolicySnapshot({
    profile: deploymentProfile,
    routeId: 'r_manual',
    accountProvider: 'manual',
    accountCurrency: 'EUR',
    paymentCurrency: 'EUR',
    trueLayerConfigured: deploymentProfile.payments.active_provider === 'truelayer'
  });
}

function profile(profileId: string, activeProvider: 'manual' | 'truelayer') {
  return parseProfileYaml(`
profile_id: ${profileId}
region: eu
payments:
  active_provider: ${activeProvider}
  manual:
    enabled: true
  truelayer:
    enabled: true
`);
}

function profileWithApiBase(profileId: string, baseUrl: string) {
  return parseProfileYaml(`
profile_id: ${profileId}
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
    base_url: ${baseUrl}
`);
}

function liveSnapshot(deploymentProfile: ReturnType<typeof profileWithApiBase>) {
  return paymentExecutionPolicySnapshot({
    profile: deploymentProfile,
    routeId: 'r_sepa',
    accountProvider: 'truelayer',
    accountCurrency: 'EUR',
    paymentCurrency: 'EUR',
    trueLayerConfigured: true,
    trueLayerApiBaseUrl: 'https://environment-provider.test',
    trueLayerAuthBaseUrl: 'https://auth.provider.test'
  });
}
