import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadProfileFromFile } from '@traibox/profiles';
import { buildDeploymentTargetReport, buildPilotOnboardingSmoke, CORE_PILOT_SCENARIOS, loadPilotScenarioFixture } from './staging-rehearsal.js';

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
});
