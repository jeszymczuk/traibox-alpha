import { describe, expect, it } from 'vitest';
import { parseProfileYaml } from '@traibox/profiles';

import { getPaymentAdapter, selectPaymentRail } from './payment-adapters.js';

describe('payment rail selection', () => {
  it('selects TrueLayer when it is the active configured rail', () => {
    const profile = parseProfileYaml(`
profile_id: test
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
`);

    expect(selectPaymentRail({ profile, routeId: 'r_sepa', fromProviderId: 'truelayer', trueLayerConfigured: true })).toEqual(
      expect.objectContaining({ provider: 'truelayer', mode: 'truelayer', fallback: false })
    );
  });

  it('resolves selected rails to explicit adapters', () => {
    const manual = getPaymentAdapter(
      { provider: 'manual', mode: 'manual', capabilities: ['manual_transfer'], fallback: true, reason: 'test' },
      { trueLayerConfig: null }
    );
    const truelayer = getPaymentAdapter(
      { provider: 'truelayer', mode: 'truelayer', capabilities: ['pay_by_bank'], fallback: false, reason: 'test' },
      { trueLayerConfig: { apiBaseUrl: 'https://api.truelayer.com', authBaseUrl: 'https://auth.truelayer.com', clientId: 'id', clientSecret: 'secret' } }
    );
    const ibanfirst = getPaymentAdapter(
      { provider: 'ibanfirst', mode: 'ibanfirst', capabilities: ['cross_border_payment'], fallback: false, reason: 'test' },
      { trueLayerConfig: null }
    );

    expect(manual.provider).toBe('manual');
    expect(truelayer.provider).toBe('truelayer');
    expect(ibanfirst.provider).toBe('ibanfirst');
  });

  it('keeps manual transfer as fallback when the selected live rail is unavailable', () => {
    const profile = parseProfileYaml(`
profile_id: test
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
`);

    expect(selectPaymentRail({ profile, routeId: 'r_sepa', fromProviderId: 'truelayer', trueLayerConfigured: false })).toEqual(
      expect.objectContaining({ provider: 'manual', mode: 'manual', fallback: true, reason: 'provider_unavailable_manual_fallback' })
    );
  });

  it('treats iBanFirst as planned without blocking pilot execution', () => {
    const profile = parseProfileYaml(`
profile_id: test
region: eu
payments:
  active_provider: ibanfirst
  manual:
    enabled: true
  ibanfirst:
    enabled: true
`);

    expect(selectPaymentRail({ profile, routeId: 'r_sepa', fromProviderId: 'ibanfirst', trueLayerConfigured: false })).toEqual(
      expect.objectContaining({ provider: 'manual', mode: 'manual', fallback: true, reason: 'ibanfirst_adapter_planned_manual_fallback' })
    );
  });

  it('honors an explicit manual route regardless of active provider', () => {
    const profile = parseProfileYaml(`
profile_id: test
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
`);

    expect(selectPaymentRail({ profile, routeId: 'r_manual', fromProviderId: 'truelayer', trueLayerConfigured: true })).toEqual(
      expect.objectContaining({ provider: 'manual', mode: 'manual', fallback: true, reason: 'manual_route_or_account' })
    );
  });
});
