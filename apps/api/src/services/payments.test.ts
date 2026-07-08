import { describe, expect, it } from 'vitest';
import { parseProfileYaml } from '@traibox/profiles';

import { selectPaymentRail } from './payments.js';

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
