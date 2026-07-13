import { describe, expect, it } from 'vitest';
import { applyDebtBaseline, parseDebtBaseline } from './shared/baseline.mts';
import { fingerprint } from './shared/repo.mts';
import type { ConformanceFinding, DebtBaselineEntry } from './shared/types.mts';

const oldFingerprint = fingerprint('fixture', 'source.ts', 'RULE', 'old context');
const entry: DebtBaselineEntry = {
  fingerprint: oldFingerprint,
  rule: 'RULE',
  source: 'source.ts',
  owner: '@fixture-owner',
  severity: 'medium',
  rationale: 'Existing fixture debt.',
  remediation_condition: 'Remove the fixture violation and this exact entry.'
};

function document(entries: unknown[]): unknown {
  return { schema_version: 1, baseline_id: 'FIXTURE-DEBT', status: 'REVIEW', entries };
}

function finding(baselineKey: string): ConformanceFinding {
  return { check: 'fixture', rule: 'RULE', source: 'source.ts', severity: 'medium', message: 'fixture finding', baselineKey };
}

describe('debt baseline lifecycle', () => {
  it('leaves a new unbaselined finding as a gate failure', () => {
    const applied = applyDebtBaseline([finding(oldFingerprint)], []);
    expect(applied.unbaselined).toHaveLength(1);
    expect(applied.baselined).toHaveLength(0);
  });

  it('marks an entry stale when its underlying finding disappears', () => {
    const applied = applyDebtBaseline([], [entry]);
    expect(applied.stale).toEqual([entry]);
  });

  it('treats changed source context as a new finding and the old fingerprint as stale', () => {
    const changedFingerprint = fingerprint('fixture', 'source.ts', 'RULE', 'changed context');
    const applied = applyDebtBaseline([finding(changedFingerprint)], [entry]);
    expect(applied.unbaselined).toHaveLength(1);
    expect(applied.stale).toEqual([entry]);
  });

  it('rejects duplicate baseline fingerprints', () => {
    expect(() => parseDebtBaseline(document([entry, entry]), 'fixture.json')).toThrow(/duplicate baseline fingerprint/);
  });

  it.each([
    ['missing remediation condition', { ...entry, remediation_condition: undefined }],
    ['invalid fingerprint', { ...entry, fingerprint: 'not-stable' }],
    ['invalid owner', { ...entry, owner: 'fixture-owner' }],
    ['invalid severity', { ...entry, severity: 'urgent' }],
    ['wildcard source', { ...entry, source: 'apps/**' }]
  ])('rejects malformed or incomplete entries: %s', (_label, malformed) => {
    expect(() => parseDebtBaseline(document([malformed]), 'fixture.json')).toThrow(/invalid debt baseline/);
  });

  it('requires the baseline entry to be removed when the actual violation is removed', () => {
    const before = applyDebtBaseline([finding(oldFingerprint)], [entry]);
    const after = applyDebtBaseline([], [entry]);
    expect(before.baselined).toHaveLength(1);
    expect(after.stale).toHaveLength(1);
  });
});
