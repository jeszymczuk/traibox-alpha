import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkCriticalProtectedActionMetadata,
  checkLivePaymentProviderBoundaries,
  compareProtectedActions
} from './protected-actions.mts';
import { REPO_ROOT } from './shared/repo.mts';

const COMMON_IMPLEMENTATIONS = [
  'packages/contracts/src/index.ts',
  'apps/api/src/server.ts',
  'apps/api/src/domains/approvals/protected-execution.ts',
  'apps/api/src/domains/approvals/protected-execution-consumption.ts',
  'apps/api/src/services/protected-denial-audit.ts'
];

describe('protected action negative fixture', () => {
  const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/protected-actions/missing-and-weakened.json', import.meta.url)), 'utf8'));

  it('fails when a contract action is absent from the manifest', () => {
    expect(compareProtectedActions(fixture.contract_actions, fixture.manifest_actions).map((finding) => finding.rule)).toContain('ACTION_CONTRACT_MISSING_MANIFEST');
  });

  it('fails when critical severity, release gate, or pilot gate is weakened', () => {
    const rules = checkCriticalProtectedActionMetadata(fixture.manifest_actions).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_SEVERITY_WEAKENED');
    expect(rules).toContain('ACTION_CRITICAL_RELEASE_GATE_WEAKENED');
    expect(rules).toContain('ACTION_CRITICAL_PILOT_GATE_WEAKENED');
  });

  it('fails when an open discrepancy is hidden by removing unresolved evidence', () => {
    const action = validAction('send_payment');
    action.unresolved_questions = [];
    const rules = checkCriticalProtectedActionMetadata([action], new Set(['PA-001'])).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_DEBT_HIDDEN');
  });

  it('fails when a closed discrepancy is silently reopened by unresolved critical questions', () => {
    const action = validAction('send_payment');
    action.unresolved_questions = ['The protected execution boundary may still be bypassed.'];
    const rules = checkCriticalProtectedActionMetadata([action], new Set()).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_CLOSURE_REOPENED');
  });

  it('fails when closure cites a nonexistent implementation or test path', () => {
    const action = validAction('send_payment');
    action.implementation_locations.push('apps/api/src/services/does-not-exist.ts');
    const rules = checkCriticalProtectedActionMetadata([action], new Set(), REPO_ROOT).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_EVIDENCE_PATH_MISSING');
  });

  it('fails when unrelated files replace the guarded action service', () => {
    const action = validAction('send_payment');
    action.implementation_locations = action.implementation_locations
      .filter((path) => path !== 'apps/api/src/services/payments.ts')
      .concat('apps/api/src/services/alpha.ts');
    const rules = checkCriticalProtectedActionMetadata([action], new Set()).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_GUARDED_SERVICE_EVIDENCE_MISSING');
  });

  it('fails when shared authorization evidence is omitted', () => {
    const action = validAction('send_payment');
    action.implementation_locations = action.implementation_locations.filter(
      (path) => path !== 'apps/api/src/domains/approvals/protected-execution.ts'
    );
    const rules = checkCriticalProtectedActionMetadata([action], new Set()).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_AUTHORIZATION_EVIDENCE_MISSING');
  });

  it('fails when immutable consumption evidence is omitted', () => {
    const action = validAction('accept_funding_offer');
    action.implementation_locations = action.implementation_locations.filter(
      (path) => path !== 'apps/api/src/domains/approvals/protected-execution-consumption.ts'
    );
    const rules = checkCriticalProtectedActionMetadata([action], new Set()).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_CONSUMPTION_EVIDENCE_MISSING');
  });

  it('fails when DB-backed action coverage is omitted', () => {
    const action = validAction('send_payment');
    action.test_coverage = action.test_coverage.filter((path) => path !== 'apps/api/src/services/rails.scenario.test.ts');
    const rules = checkCriticalProtectedActionMetadata([action], new Set()).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_DB_TEST_EVIDENCE_MISSING');
  });

  it('fails when claimed DB coverage lacks replay and concurrency proof', () => {
    const root = mkdtempSync(join(tmpdir(), 'traibox-protected-actions-'));
    try {
      const dbTestPath = join(root, 'apps/api/src/services/rails.scenario.test.ts');
      mkdirSync(join(root, 'apps/api/src/services'), { recursive: true });
      writeFileSync(dbTestPath, "it('mentions send_payment only', () => 'send_payment');\n");
      const rules = checkCriticalProtectedActionMetadata([validAction('send_payment')], new Set(), root).map((finding) => finding.rule);
      expect(rules).toContain('ACTION_CRITICAL_REPLAY_CONCURRENCY_EVIDENCE_MISSING');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails when production code imports live payment access outside the guarded boundary', () => {
    const root = mkdtempSync(join(tmpdir(), 'traibox-provider-boundary-'));
    try {
      const file = join(root, 'apps/api/src/domains/intelligence/agent-runtime.ts');
      mkdirSync(join(root, 'apps/api/src/domains/intelligence'), { recursive: true });
      writeFileSync(file, "import { getPaymentAdapter } from '../../services/payment-adapters.js';\nvoid getPaymentAdapter;\n");
      expect(checkLivePaymentProviderBoundaries(root).map((finding) => finding.rule)).toContain('LIVE_PAYMENT_PROVIDER_BOUNDARY_BYPASS');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('accepts critical closure only with exact implementation and test evidence', () => {
    const rules = checkCriticalProtectedActionMetadata([validAction('send_payment')], new Set(), REPO_ROOT).map((finding) => finding.rule);
    expect(rules).toEqual([]);
    expect(checkLivePaymentProviderBoundaries(REPO_ROOT)).toEqual([]);
  });
});

function validAction(identifier: 'send_payment' | 'accept_funding_offer') {
  return {
    identifier,
    severity: 'critical',
    release_gate: 'blocks_real_value_execution',
    pilot_gate: 'blocks_any_pilot_path_that_can_reach_this_endpoint',
    required_remediation: 'Bind exact execution to authorization, immutable consumption, denial audit, replay, and concurrency evidence.',
    unresolved_questions: [] as string[],
    implementation_locations: [
      ...COMMON_IMPLEMENTATIONS,
      ...(identifier === 'send_payment'
        ? [
            'apps/api/src/services/payments.ts',
            'apps/api/src/services/payment-policy.ts',
            'apps/api/src/services/payment-adapters.ts',
            'apps/api/src/services/payment-provider-capability.ts'
          ]
        : ['apps/api/src/services/finance.ts'])
    ],
    test_coverage:
      identifier === 'send_payment'
        ? [
            'apps/api/src/services/rails.scenario.test.ts',
            'apps/api/src/domains/approvals/protected-execution.test.ts',
            'apps/api/src/services/payments.test.ts'
          ]
        : ['apps/api/src/services/rails.scenario.test.ts', 'apps/api/src/domains/approvals/protected-execution.test.ts']
  };
}
