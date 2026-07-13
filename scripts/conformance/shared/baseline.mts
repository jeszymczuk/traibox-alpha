import type { ConformanceFinding, DebtBaselineEntry } from './types.mts';
import { readJson } from './repo.mts';

type BaselineDocument = {
  schema_version: 1;
  baseline_id: string;
  status: 'REVIEW';
  entries: DebtBaselineEntry[];
};

export function loadDebtBaseline(root: string, path: string): BaselineDocument {
  const document = readJson<BaselineDocument>(root, path);
  if (document.schema_version !== 1 || document.status !== 'REVIEW' || !Array.isArray(document.entries)) {
    throw new Error(`${path}: invalid debt baseline shape`);
  }
  const fingerprints = document.entries.map((entry) => entry.fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length) throw new Error(`${path}: duplicate baseline fingerprint`);
  for (const entry of document.entries) {
    for (const field of ['fingerprint', 'rule', 'source', 'owner', 'severity', 'rationale', 'remediation_condition'] as const) {
      if (!entry[field]) throw new Error(`${path}: baseline entry ${entry.fingerprint || '<missing>'} is missing ${field}`);
    }
  }
  return document;
}

export function applyDebtBaseline(findings: ConformanceFinding[], entries: DebtBaselineEntry[]): {
  unbaselined: ConformanceFinding[];
  baselined: ConformanceFinding[];
  stale: DebtBaselineEntry[];
} {
  const byFingerprint = new Map(entries.map((entry) => [entry.fingerprint, entry]));
  const seen = new Set<string>();
  const baselined: ConformanceFinding[] = [];
  const unbaselined: ConformanceFinding[] = [];
  for (const finding of findings) {
    const entry = finding.baselineKey ? byFingerprint.get(finding.baselineKey) : undefined;
    if (entry && entry.rule === finding.rule && entry.source === finding.source) {
      seen.add(entry.fingerprint);
      baselined.push(finding);
    } else {
      unbaselined.push(finding);
    }
  }
  return {
    unbaselined,
    baselined,
    stale: entries.filter((entry) => !seen.has(entry.fingerprint))
  };
}
