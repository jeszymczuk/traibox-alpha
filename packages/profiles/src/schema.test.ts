import { describe, expect, it } from 'vitest';

import { parseProfileYaml } from './index.js';
import { ProfileSchema } from './schema.js';
import { validateRuntimeEnvironment } from './runtime.js';

describe('ProfileSchema', () => {
  it('defaults finance.demo_offers_enabled to true', () => {
    const p = ProfileSchema.parse({ profile_id: 'dev', region: 'eu-iberia' });
    expect(p.finance.demo_offers_enabled).toBe(true);
  });

  it('defaults tradebrain.llm to off with an Opus model', () => {
    const p = ProfileSchema.parse({ profile_id: 'dev', region: 'eu-iberia' });
    expect(p.tradebrain.llm.enabled).toBe(false);
    expect(p.tradebrain.llm.model).toBe('claude-opus-4-8');
    expect(p.tradebrain.llm.max_tokens).toBe(1024);
  });

  it('accepts an explicit tradebrain.llm override', () => {
    const p = ProfileSchema.parse({
      profile_id: 'dev',
      region: 'eu-iberia',
      tradebrain: { llm: { enabled: true, model: 'claude-sonnet-5', max_tokens: 512 } }
    });
    expect(p.tradebrain.llm.enabled).toBe(true);
    expect(p.tradebrain.llm.model).toBe('claude-sonnet-5');
    expect(p.tradebrain.llm.max_tokens).toBe(512);
  });

  it('keeps pilot policy explicit in profiles', () => {
    const profile = ProfileSchema.parse({
      profile_id: 'eu-pilot',
      region: 'eu',
      finance: { demo_offers_enabled: false },
      payments: { manual: { enabled: true }, truelayer: { enabled: true } },
      pilot: { controlled_rollout: true, target_smes: 20, required_smoke_scenarios: ['full_trade_room_loop', 'standalone_payment'] }
    });

    expect(profile.pilot.controlled_rollout).toBe(true);
    expect(profile.pilot.target_smes).toBe(20);
    expect(profile.pilot.required_smoke_scenarios).toEqual(expect.arrayContaining(['standalone_payment']));
    expect(profile.privacy.pii_on_chain).toBe(false);
    expect(profile.privacy.retention.audit_days).toBeGreaterThanOrEqual(365);
  });

  it('flags controlled-pilot runtime misconfiguration before startup', () => {
    const profile = ProfileSchema.parse({
      profile_id: 'eu-pilot',
      region: 'eu',
      compliance: { complyadvantage: { enabled: true } },
      finance: { demo_offers_enabled: false },
      payments: { manual: { enabled: true }, truelayer: { enabled: true, webhooks: { verify_signatures: true } } },
      ledger: { anchoring: { enabled: true } },
      pilot: { controlled_rollout: true, target_smes: 20 }
    });

    const report = validateRuntimeEnvironment({
      profile,
      target: 'api',
      env: { DATABASE_URL: 'postgres://example', AUTH_MODE: 'dev', DEV_USER_ID: '00000000-0000-0000-0000-0000000000aa' },
      generatedAt: '2026-05-27T10:00:00.000Z'
    });

    expect(report.status).toBe('fail');
    expect(report.missing_required_env).toEqual(
      expect.arrayContaining([
        'TRUELAYER_CLIENT_ID',
        'TRUELAYER_CLIENT_SECRET',
        'TRUELAYER_WEBHOOK_SECRET',
        'COMPLYADVANTAGE_API_KEY',
        'EVM_RPC_URL',
        'PARTNER_JWT_SECRET',
        'SUPABASE_SERVICE_ROLE_KEY'
      ])
    );
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'auth.mode', severity: 'fail' })]));
  });

  it('blocks controlled pilot profiles that would place PII on-chain or outside EU residency', () => {
    const profile = ProfileSchema.parse({
      profile_id: 'bad-pilot',
      region: 'us',
      privacy: { data_region: 'us-east', pii_on_chain: true, retention: { audit_days: 90 } },
      pilot: { controlled_rollout: true }
    });

    const report = validateRuntimeEnvironment({
      profile,
      target: 'api',
      env: { DATABASE_URL: 'postgres://example', AUTH_MODE: 'supabase', SUPABASE_JWT_SECRET: 'test' }
    });

    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'privacy.data_region', severity: 'fail' }),
        expect.objectContaining({ key: 'privacy.pii_on_chain', severity: 'fail' }),
        expect.objectContaining({ key: 'privacy.audit_retention', severity: 'fail' })
      ])
    );
  });

  it('allows dev degraded mode with deterministic alpha intelligence', () => {
    const profile = parseProfileYaml(`
profile_id: dev
region: eu-iberia
features:
  tradebrain_llm_enabled: false
payments:
  manual:
    enabled: true
  truelayer:
    enabled: false
finance:
  demo_offers_enabled: true
pilot:
  controlled_rollout: false
`);

    const report = validateRuntimeEnvironment({
      profile,
      target: 'api',
      env: { DATABASE_URL: 'postgres://example', AUTH_MODE: 'dev', DEV_USER_ID: '00000000-0000-0000-0000-0000000000aa' }
    });

    expect(report.status).toBe('warn');
    expect(report.degraded_mode).toBe(true);
    expect(report.warnings).toEqual(expect.arrayContaining([expect.stringContaining('Trade Brain LLM mode is disabled')]));
  });
});
