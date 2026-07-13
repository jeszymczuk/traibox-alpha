import { z } from 'zod';
import type { ConformanceFinding, DebtBaselineEntry } from './types.mts';
import { readJson } from './repo.mts';

const exactIdentifier = z.string().trim().min(1);
const exactSource = exactIdentifier.refine(
  (source) => !source.startsWith('/') && !source.split('/').includes('..') && !/[*?{}!]/.test(source),
  'must be an exact repository-relative file path without wildcard or parent traversal syntax'
);
const exactRule = exactIdentifier.refine((rule) => !/[*?{}!]/.test(rule), 'must identify one exact rule');

const debtBaselineEntrySchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{24}$/),
    rule: exactRule,
    source: exactSource,
    owner: z.string().trim().startsWith('@'),
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
    rationale: exactIdentifier,
    remediation_condition: exactIdentifier
  })
  .passthrough();

const debtBaselineSchema = z
  .object({
    schema_version: z.literal(1),
    baseline_id: exactIdentifier,
    status: z.literal('REVIEW'),
    entries: z.array(debtBaselineEntrySchema)
  })
  .strict();

export type BaselineDocument = z.infer<typeof debtBaselineSchema> & { entries: DebtBaselineEntry[] };

export function parseDebtBaseline(document: unknown, path = '<debt-baseline>'): BaselineDocument {
  const parsed = debtBaselineSchema.safeParse(document);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
    throw new Error(`${path}: invalid debt baseline: ${detail}`);
  }
  const fingerprints = parsed.data.entries.map((entry) => entry.fingerprint);
  if (new Set(fingerprints).size !== fingerprints.length) throw new Error(`${path}: duplicate baseline fingerprint`);
  return parsed.data as BaselineDocument;
}

export function loadDebtBaseline(root: string, path: string): BaselineDocument {
  return parseDebtBaseline(readJson<unknown>(root, path), path);
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
