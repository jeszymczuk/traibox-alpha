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
});
