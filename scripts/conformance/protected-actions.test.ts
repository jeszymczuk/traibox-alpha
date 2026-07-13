import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCriticalProtectedActionMetadata, compareProtectedActions } from './protected-actions.mts';

describe('protected action negative fixture', () => {
  const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/protected-actions/missing-and-weakened.json', import.meta.url)), 'utf8'));

  it('fails when a contract action is absent from the manifest', () => {
    expect(compareProtectedActions(fixture.contract_actions, fixture.manifest_actions).map((finding) => finding.rule)).toContain('ACTION_CONTRACT_MISSING_MANIFEST');
  });

  it('fails when send_payment release and pilot gates are weakened', () => {
    const rules = checkCriticalProtectedActionMetadata(fixture.manifest_actions).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_SEVERITY_WEAKENED');
    expect(rules).toContain('ACTION_CRITICAL_RELEASE_GATE_WEAKENED');
    expect(rules).toContain('ACTION_CRITICAL_PILOT_GATE_WEAKENED');
  });

  it('requires unresolved evidence while a critical discrepancy remains open', () => {
    const action = {
      identifier: 'send_payment',
      severity: 'critical',
      release_gate: 'blocks_real_value_execution',
      pilot_gate: 'blocks_any_pilot_path_that_can_reach_this_endpoint',
      required_remediation: 'Bind execution to exact approval evidence.',
      unresolved_questions: [],
      implementation_locations: ['apps/api/src/services/payments.ts'],
      test_coverage: ['apps/api/src/services/rails.scenario.test.ts']
    };
    const rules = checkCriticalProtectedActionMetadata([action], new Set(['PA-001'])).map((finding) => finding.rule);
    expect(rules).toContain('ACTION_CRITICAL_DEBT_HIDDEN');
  });

  it('accepts critical discrepancy closure only with implementation and test evidence', () => {
    const action = {
      identifier: 'send_payment',
      severity: 'critical',
      release_gate: 'blocks_real_value_execution',
      pilot_gate: 'blocks_any_pilot_path_that_can_reach_this_endpoint',
      required_remediation: 'Bind execution to exact approval evidence.',
      unresolved_questions: [],
      implementation_locations: ['apps/api/src/services/payments.ts'],
      test_coverage: ['apps/api/src/services/rails.scenario.test.ts']
    };
    const rules = checkCriticalProtectedActionMetadata([action], new Set()).map((finding) => finding.rule);
    expect(rules).not.toContain('ACTION_CRITICAL_DEBT_HIDDEN');
    expect(rules).not.toContain('ACTION_CRITICAL_CLOSURE_EVIDENCE_MISSING');
  });
});
