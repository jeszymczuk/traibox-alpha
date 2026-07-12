import { describe, expect, it } from 'vitest';
import { parseProfileYaml } from '@traibox/profiles';
import {
  getRequiredStagingGitHubSecrets,
  buildGitHubStagingReadinessReport
} from './github-staging-readiness.js';

describe('GitHub staging readiness', () => {
  it('fails without required staging GitHub secrets', () => {
    const report = buildGitHubStagingReadinessReport({
      repository: 'jeszymczuk/traibox-alpha',
      secretNames: [],
      now: new Date('2026-07-07T10:00:00.000Z')
    });

    expect(report.status).toBe('fail');
    expect(report.missing_secrets).toEqual(expect.arrayContaining(['STAGING_DATABASE_URL', 'STAGING_PARTNER_JWT_SECRET']));
    expect(report.provider_readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rail_id: 'payment:manual',
          status: 'ready',
          active: true
        }),
        expect.objectContaining({
          rail_id: 'payment:truelayer',
          status: 'disabled',
          active: false
        }),
        expect.objectContaining({
          rail_id: 'ledger:evm_event',
          status: 'disabled',
          active: false
        })
      ])
    );
    expect(JSON.stringify(report)).not.toContain('DATABASE_URL=');
  });

  it('passes when all required staging GitHub secrets are present', () => {
    const profile = parseProfileYaml(`
profile_id: staging
region: eu
payments:
  active_provider: truelayer
  manual:
    enabled: true
  truelayer:
    enabled: true
ledger:
  anchoring:
    enabled: true
    adapter: evm_event
`);
    const requiredSecrets = getRequiredStagingGitHubSecrets(profile);
    const report = buildGitHubStagingReadinessReport({
      repository: 'jeszymczuk/traibox-alpha',
      secretNames: requiredSecrets,
      variableNames: ['STAGING_API_BASE_URL', 'STAGING_WEB_BASE_URL', 'STAGING_TRADE_BRAIN_URL'],
      profile,
      now: new Date('2026-07-07T10:00:00.000Z')
    });

    expect(report.status).toBe('pass');
    expect(report.missing_secrets).toEqual([]);
    expect(report.missing_variables).toEqual([]);
    expect(report.provider_readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rail_id: 'payment:truelayer', status: 'ready', active: true }),
        expect.objectContaining({ rail_id: 'payment:manual', status: 'ready', enabled: true }),
        expect.objectContaining({ rail_id: 'ledger:evm_event', status: 'ready', active: true })
      ])
    );
    expect(report.required_workflow_inputs).toEqual(
      expect.arrayContaining(['api_base_url', 'web_base_url', 'backup_restore_checked_at'])
    );
  });

  it('does not require payment provider or ledger secrets for manual-only non-anchored profiles', () => {
    const profile = parseProfileYaml(`
profile_id: staging
region: eu
payments:
  active_provider: manual
  manual:
    enabled: true
  truelayer:
    enabled: false
ledger:
  anchoring:
    enabled: false
`);

    const requiredSecrets = getRequiredStagingGitHubSecrets(profile);
    expect(requiredSecrets).not.toEqual(expect.arrayContaining(['STAGING_TRUELAYER_CLIENT_ID', 'STAGING_IBANFIRST_API_KEY', 'STAGING_EVM_RPC_URL']));
  });

  it('requires iBanFirst secrets only when iBanFirst is the active enabled payment rail', () => {
    const profile = parseProfileYaml(`
profile_id: staging
region: eu
payments:
  active_provider: ibanfirst
  manual:
    enabled: true
  ibanfirst:
    enabled: true
ledger:
  anchoring:
    enabled: false
`);

    expect(getRequiredStagingGitHubSecrets(profile)).toEqual(expect.arrayContaining(['STAGING_IBANFIRST_API_KEY', 'STAGING_IBANFIRST_WEBHOOK_SECRET']));
    expect(getRequiredStagingGitHubSecrets(profile)).not.toEqual(expect.arrayContaining(['STAGING_TRUELAYER_CLIENT_ID', 'STAGING_EVM_RPC_URL']));

    const report = buildGitHubStagingReadinessReport({
      repository: 'jeszymczuk/traibox-alpha',
      secretNames: ['STAGING_DATABASE_URL', 'STAGING_SUPABASE_JWT_SECRET', 'STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_SUPABASE_SERVICE_ROLE_KEY', 'STAGING_PARTNER_JWT_SECRET'],
      profile,
      now: new Date('2026-07-07T10:00:00.000Z')
    });
    expect(report.provider_readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rail_id: 'payment:ibanfirst',
          status: 'fallback_ready',
          missing_secrets: expect.arrayContaining(['STAGING_IBANFIRST_API_KEY'])
        })
      ])
    );
  });
});
