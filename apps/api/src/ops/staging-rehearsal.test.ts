import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadProfileFromFile, validateRuntimeEnvironment } from '@traibox/profiles';
import { buildDeploymentTargetReport, buildOperatorEvidence, buildPilotOnboardingSmoke, CORE_PILOT_SCENARIOS, loadPilotScenarioFixture } from './staging-rehearsal.js';

describe('staging rehearsal checks', () => {
  it('requires all core scenarios for the staging pilot onboarding smoke', () => {
    const repoRoot = path.resolve(process.cwd(), '../..');
    const profile = loadProfileFromFile(path.join(repoRoot, 'packages/profiles/profiles/staging.yaml'));
    const fixture = loadPilotScenarioFixture(path.join(repoRoot, 'docs/pilot/fixtures/alpha-pilot-scenarios.json'));
    const report = buildPilotOnboardingSmoke(profile, fixture);

    expect(report.status).toBe('pass');
    expect(report.required_scenarios).toEqual([...CORE_PILOT_SCENARIOS]);
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'pilot.onboarding_proof_points', status: 'pass' })]));
  });

  it('fails real rehearsal when staging targets are missing', () => {
    const report = buildDeploymentTargetReport({}, { fixtureMode: false });

    expect(report.status).toBe('fail');
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'staging.api_base_url', status: 'fail' })]));
  });

  it('marks missing staging targets as skipped in fixture mode', () => {
    const report = buildDeploymentTargetReport({}, { fixtureMode: true });

    expect(report.status).toBe('warn');
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'staging.web_base_url', status: 'skipped' })]));
  });

  it('surfaces an operator evidence checklist for pilot invitation decisions', () => {
    const repoRoot = path.resolve(process.cwd(), '../..');
    const profile = loadProfileFromFile(path.join(repoRoot, 'packages/profiles/profiles/staging.yaml'));
    const now = new Date('2026-07-08T10:00:00.000Z').toISOString();
    const runtimeEnv = {
      DATABASE_URL: 'postgres://postgres:postgres@staging.example/traibox',
      AUTH_MODE: 'supabase',
      SUPABASE_JWT_SECRET: 'secret',
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'secret',
      SUPABASE_SERVICE_ROLE_KEY: 'secret',
      TRUELAYER_CLIENT_ID: 'secret',
      TRUELAYER_CLIENT_SECRET: 'secret',
      TRUELAYER_WEBHOOK_SECRET: 'secret',
      COMPLYADVANTAGE_API_KEY: 'secret',
      EVM_RPC_URL: 'https://rpc.example',
      EVM_ANCHOR_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000001',
      EVM_ANCHOR_WALLET_PRIVATE_KEY: 'secret',
      PARTNER_JWT_SECRET: 'secret'
    };
    const apiRuntime = validateRuntimeEnvironment({ profile, target: 'api', env: runtimeEnv, generatedAt: now });
    const workerRuntime = validateRuntimeEnvironment({ profile, target: 'worker', env: runtimeEnv, generatedAt: now });
    const evidence = buildOperatorEvidence({
      fixtureMode: false,
      apiRuntime,
      workerRuntime,
      backupRestoreStatus: 'pass',
      migrationPreflight: { status: 'pass', checks: [] },
      deploymentTargets: { status: 'pass', api_base_url_present: true, web_base_url_present: true, checks: [] },
      httpSmoke: { status: 'pass', checks: [] },
      pilotOnboardingSmoke: {
        status: 'pass',
        fixture_id: 'alpha',
        required_scenarios: [...CORE_PILOT_SCENARIOS],
        first_session_steps: [],
        checks: []
      },
      artifactPaths: {
        latest: 'artifacts/staging-rehearsals/latest.json',
        timestamped: 'artifacts/staging-rehearsals/2026.json'
      }
    });

    expect(evidence.status).toBe('warn');
    expect(evidence.ready_for_pilot_invitation).toBe(true);
    expect(evidence.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'runtime.api', status: 'warn' }),
        expect.objectContaining({ key: 'pilot_onboarding_smoke', status: 'pass' }),
        expect.objectContaining({ key: 'rehearsal_artifact', artifact_ref: 'artifacts/staging-rehearsals/2026.json' })
      ])
    );
  });

  it('does not treat fixture rehearsal output as pilot invitation evidence', () => {
    const repoRoot = path.resolve(process.cwd(), '../..');
    const profile = loadProfileFromFile(path.join(repoRoot, 'packages/profiles/profiles/staging.yaml'));
    const apiRuntime = validateRuntimeEnvironment({ profile, target: 'api', env: {}, generatedAt: '2026-07-08T10:00:00.000Z' });
    const evidence = buildOperatorEvidence({
      fixtureMode: true,
      apiRuntime,
      workerRuntime: apiRuntime,
      backupRestoreStatus: 'pass',
      migrationPreflight: { status: 'pass', checks: [] },
      deploymentTargets: { status: 'warn', api_base_url_present: false, web_base_url_present: false, checks: [] },
      httpSmoke: { status: 'warn', checks: [] },
      pilotOnboardingSmoke: {
        status: 'pass',
        fixture_id: 'alpha',
        required_scenarios: [...CORE_PILOT_SCENARIOS],
        first_session_steps: [],
        checks: []
      },
      artifactPaths: {
        latest: 'artifacts/staging-rehearsals/latest.json',
        timestamped: 'artifacts/staging-rehearsals/fixture.json'
      }
    });

    expect(evidence.ready_for_pilot_invitation).toBe(false);
    expect(evidence.next_operator_actions).toEqual(expect.arrayContaining(['Fixture reports are not pilot evidence; rerun with real staging inputs.']));
  });
});
