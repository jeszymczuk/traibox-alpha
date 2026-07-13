import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareStatusValueSets } from './status-vocabulary.mts';

describe('status vocabulary negative fixture', () => {
  it('detects both new implementation drift and a stale manifest-only value', () => {
    const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/status/new-drift.json', import.meta.url)), 'utf8'));
    const rules = compareStatusValueSets({
      id: 'fixture',
      domain: 'fixture',
      stateMachine: 'fixture_machine',
      manifestPath: 'fixture.statuses',
      source: 'fixture.ts',
      implementation: fixture.implementation,
      declared: fixture.declared
    }).map((finding) => finding.rule);
    expect(rules).toContain('STATUS_IMPLEMENTATION_VALUE_UNDECLARED');
    expect(rules).toContain('STATUS_MANIFEST_VALUE_UNIMPLEMENTED');
  });
});
