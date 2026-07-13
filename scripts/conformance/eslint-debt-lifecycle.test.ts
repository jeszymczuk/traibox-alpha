import { describe, expect, it } from 'vitest';
import { compareEslintDebt, eslintInventoryKey, parseEslintDebt, parseEslintSuppressions } from './eslint-debt.mts';
import { fingerprint } from './shared/repo.mts';

const source = 'apps/web/src/app/page.tsx';
const rule = 'no-console';
const count = 1;
const entry = {
  fingerprint: fingerprint('eslint', source, rule, count),
  rule,
  source,
  owner: '@code-quality',
  severity: 'medium' as const,
  rationale: 'Existing fixture lint debt.',
  remediation_condition: 'Fix the finding and remove this exact record.',
  count
};

function debt(entries = [entry]) {
  return parseEslintDebt({ schema_version: 1, baseline_id: 'TRAIBOX-C0.2-ESLINT-DEBT', status: 'REVIEW', entries });
}

function suppressions(path = source) {
  return parseEslintSuppressions({ [path]: { [rule]: { count } } });
}

describe('ESLint debt lifecycle', () => {
  it('fails a suppression without a matching debt record', () => {
    const rules = compareEslintDebt(suppressions(), debt([]), new Map([[eslintInventoryKey(source, rule), count]])).map((finding) => finding.rule);
    expect(rules).toContain('ESLINT_SUPPRESSION_UNRECORDED');
  });

  it('fails a debt record and suppression with no matching current lint finding', () => {
    const rules = compareEslintDebt(suppressions(), debt(), new Map()).map((finding) => finding.rule);
    expect(rules).toContain('ESLINT_CURRENT_FINDING_MISSING');
    expect(rules).toContain('ESLINT_DEBT_CURRENT_FINDING_MISSING');
  });

  it('fails a debt record without its exact suppression', () => {
    const rules = compareEslintDebt(parseEslintSuppressions({}), debt(), new Map([[eslintInventoryKey(source, rule), count]])).map((finding) => finding.rule);
    expect(rules).toContain('ESLINT_DEBT_STALE');
  });

  it.each(['apps/web/**', '**/*', 'apps/web/src/**/*.tsx'])('rejects broad or repository-wide suppression path %s', (path) => {
    expect(() => suppressions(path)).toThrow();
  });

  it('rejects a whole-rule wildcard suppression', () => {
    expect(() => parseEslintSuppressions({ [source]: { '*': { count } } })).toThrow();
  });

  it('detects a repository-wide rule disable as stale current debt', () => {
    const rules = compareEslintDebt(suppressions(), debt(), new Map()).map((finding) => finding.rule);
    expect(rules).toContain('ESLINT_CURRENT_FINDING_MISSING');
  });

  it('forbids suppressing C0.2 conformance tooling', () => {
    const toolingSource = 'scripts/conformance/example.mts';
    const toolingEntry = { ...entry, source: toolingSource, fingerprint: fingerprint('eslint', toolingSource, rule, count) };
    const rules = compareEslintDebt(
      suppressions(toolingSource),
      debt([toolingEntry]),
      new Map([[eslintInventoryKey(toolingSource, rule), count]])
    ).map((finding) => finding.rule);
    expect(rules).toContain('ESLINT_INTRODUCED_TOOLING_DEBT');
  });
});
