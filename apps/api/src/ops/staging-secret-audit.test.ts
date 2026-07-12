import { describe, expect, it } from 'vitest';
import { parseProfileYaml } from '@traibox/profiles';
import { buildStagingSecretAuditReport, getStagingSecretRequirements } from './staging-secret-audit.js';

describe('staging secret audit', () => {
  it('passes fixture mode without printing secret values', () => {
    const report = buildStagingSecretAuditReport({
      env: { STAGING_SECRET_AUDIT_FIXTURE: 'true' },
      now: new Date('2026-05-28T10:00:00.000Z')
    });

    expect(report.status).toBe('pass');
    expect(report.fixture_mode).toBe(true);
    expect(JSON.stringify(report)).not.toContain('fixture-service-role-key');
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'DATABASE_URL', status: 'pass', sensitive: true })]));
  });

  it('fails when required staging runtime env is missing', () => {
    const report = buildStagingSecretAuditReport({
      env: {},
      now: new Date('2026-05-28T10:00:00.000Z')
    });

    expect(report.status).toBe('fail');
    expect(report.missing_required_env).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'TRADE_BRAIN_URL', 'TRADE_BRAIN_SERVICE_TOKEN', 'STAGING_API_BASE_URL', 'STAGING_WEB_BASE_URL'])
    );
  });

  it('rejects placeholder and local production-like targets in real audit mode', () => {
    const report = buildStagingSecretAuditReport({
      env: {
        DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/traibox',
        AUTH_MODE: 'dev',
        SUPABASE_JWT_SECRET: 'secret',
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_ANON_KEY: 'secret',
        SUPABASE_SERVICE_ROLE_KEY: 'secret',
        TRUELAYER_CLIENT_ID: 'secret',
        TRUELAYER_CLIENT_SECRET: 'secret',
        TRUELAYER_WEBHOOK_SECRET: 'secret',
        COMPLYADVANTAGE_API_KEY: 'secret',
        EVM_RPC_URL: 'http://rpc.invalid',
        EVM_ANCHOR_REGISTRY_ADDRESS: 'not-an-address',
        EVM_ANCHOR_WALLET_PRIVATE_KEY: 'secret',
        PARTNER_JWT_SECRET: 'secret',
        ALLOW_PRODUCTION_MIGRATIONS: 'maybe',
        MIGRATION_APPROVED_BY: 'cto@example.test',
        BACKUP_RESTORE_CHECKED_AT: 'not-a-date',
        BACKUP_RESTORE_DRILL_ID: 'restore-001',
        BACKUP_LOCATION: 'backup',
        STAGING_API_BASE_URL: 'http://example.test',
        STAGING_WEB_BASE_URL: 'https://app.invalid'
      },
      now: new Date('2026-05-28T10:00:00.000Z')
    });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'DATABASE_URL', status: 'fail' }),
        expect.objectContaining({ key: 'AUTH_MODE', status: 'fail' }),
        expect.objectContaining({ key: 'STAGING_API_BASE_URL', status: 'fail' })
      ])
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

    const keys = getStagingSecretRequirements(profile).map((requirement) => requirement.key);
    expect(keys).not.toEqual(expect.arrayContaining(['TRUELAYER_CLIENT_ID', 'IBANFIRST_API_KEY', 'EVM_RPC_URL']));
  });

  it('requires the selected provider secrets for iBanFirst profiles', () => {
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

    const keys = getStagingSecretRequirements(profile).map((requirement) => requirement.key);
    expect(keys).toEqual(expect.arrayContaining(['IBANFIRST_API_KEY', 'IBANFIRST_WEBHOOK_SECRET']));
    expect(keys).not.toEqual(expect.arrayContaining(['TRUELAYER_CLIENT_ID', 'EVM_RPC_URL']));
  });
});
