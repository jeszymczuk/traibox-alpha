import { writeFileSync } from 'node:fs';
import { findApiCatalogDiscrepancies } from './api-catalog-alignment.mts';
import { findStatusVocabularyDiscrepancies } from './status-vocabulary.mts';
import { REPO_ROOT, fingerprint, readJson, repoPath } from './shared/repo.mts';
import type { ConformanceFinding, DebtBaselineEntry } from './shared/types.mts';

function entry(finding: ConformanceFinding, owner: string, remediation: string): DebtBaselineEntry {
  if (!finding.baselineKey || !finding.source) throw new Error(`finding ${finding.rule} is not baselinable`);
  return {
    fingerprint: finding.baselineKey,
    rule: finding.rule,
    source: finding.source,
    owner,
    severity: finding.severity,
    rationale: finding.message,
    remediation_condition: remediation
  };
}

function writeBaseline(path: string, baselineId: string, entries: DebtBaselineEntry[]): void {
  const fingerprints = entries.map((item) => item.fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length) throw new Error(`${path}: generated duplicate fingerprint`);
  writeFileSync(repoPath(REPO_ROOT, path), `${JSON.stringify({ schema_version: 1, baseline_id: baselineId, status: 'REVIEW', entries }, null, 2)}\n`);
  console.log(`wrote ${entries.length} reviewed candidates to ${path}`);
}

const mode = process.argv[2];
if (mode === 'api-catalog') {
  const findings = findApiCatalogDiscrepancies({ root: REPO_ROOT });
  writeBaseline(
    'scripts/conformance/baselines/api-catalog-debt.json',
    'TRAIBOX-C0.2-API-CATALOG-DEBT',
    findings.map((finding) => entry(finding, '@api-governance', 'Align the Fastify registration and executable catalog, then remove this exact baseline entry.'))
  );
} else if (mode === 'status-vocabulary') {
  const findings = findStatusVocabularyDiscrepancies({ root: REPO_ROOT });
  writeBaseline(
    'scripts/conformance/baselines/status-vocabulary-debt.json',
    'TRAIBOX-C0.2-STATUS-VOCABULARY-DEBT',
    findings.map((finding) => entry(finding, '@domain-governance', 'Reconcile the domain-owned status source and manifest without collapsing state machines, then remove this exact baseline entry.'))
  );
} else if (mode === 'eslint') {
  const suppressions = readJson<Record<string, Record<string, { count: number }>>>(REPO_ROOT, 'eslint-suppressions.json');
  const entries = Object.entries(suppressions).flatMap(([source, rules]) =>
    Object.entries(rules).map(([rule, metadata]) => ({
      fingerprint: fingerprint('eslint', source, rule, metadata.count),
      rule,
      source,
      owner: '@code-quality',
      severity: (rule.startsWith('jsx-a11y/') || rule.startsWith('react-hooks/') ? 'high' : 'medium') as 'high' | 'medium',
      rationale: `${metadata.count} pre-existing ${rule} finding(s) remain in ${source}.`,
      remediation_condition: `Resolve the ${rule} findings in ${source}, regenerate ESLint suppressions, and remove this exact debt entry.`,
      count: metadata.count
    }))
  );
  writeFileSync(
    repoPath(REPO_ROOT, 'scripts/conformance/baselines/eslint-debt.json'),
    `${JSON.stringify({ schema_version: 1, baseline_id: 'TRAIBOX-C0.2-ESLINT-DEBT', status: 'REVIEW', entries }, null, 2)}\n`
  );
  console.log(`wrote ${entries.length} ESLint debt records`);
} else {
  throw new Error('usage: tsx scripts/conformance/baseline-maintenance.mts <api-catalog|status-vocabulary|eslint>');
}
