import { relative } from 'node:path';
import { ESLint } from 'eslint';
import { z } from 'zod';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { fingerprint, readJson } from './shared/repo.mts';

const exactIdentifier = z.string().trim().min(1);
const exactSource = exactIdentifier.refine(
  (source) => !source.startsWith('/') && !source.split('/').includes('..') && !/[*?{}!]/.test(source),
  'must be an exact repository-relative file path without wildcard or parent traversal syntax'
);
const exactRule = exactIdentifier.refine((rule) => !/[*?{}!]/.test(rule), 'must identify one exact rule');

const suppressionSchema = z.record(exactSource, z.record(exactRule, z.object({ count: z.number().int().positive() }).strict()));
const debtSchema = z
  .object({
    schema_version: z.literal(1),
    baseline_id: z.literal('TRAIBOX-C0.2-ESLINT-DEBT'),
    status: z.literal('REVIEW'),
    entries: z.array(
      z
        .object({
          fingerprint: z.string().regex(/^[a-f0-9]{24}$/),
          rule: exactRule,
          source: exactSource,
          owner: z.string().trim().startsWith('@'),
          severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
          rationale: exactIdentifier,
          remediation_condition: exactIdentifier,
          count: z.number().int().positive()
        })
        .strict()
    )
  })
  .strict();

export type EslintSuppressions = z.infer<typeof suppressionSchema>;
export type EslintDebt = z.infer<typeof debtSchema>;

export function eslintInventoryKey(source: string, rule: string): string {
  return `${source}\u0000${rule}`;
}

export function parseEslintSuppressions(document: unknown): EslintSuppressions {
  return suppressionSchema.parse(document);
}

export function parseEslintDebt(document: unknown): EslintDebt {
  return debtSchema.parse(document);
}

function add(findings: ConformanceFinding[], rule: string, message: string): void {
  findings.push({ check: 'eslint-debt', rule, message, source: 'scripts/conformance/baselines/eslint-debt.json', severity: 'high' });
}

export function compareEslintDebt(suppressions: EslintSuppressions, debt: EslintDebt, currentCounts: ReadonlyMap<string, number>): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const expected = new Map<string, { source: string; rule: string; count: number }>();
  for (const [source, rules] of Object.entries(suppressions)) {
    for (const [rule, metadata] of Object.entries(rules)) {
      const key = eslintInventoryKey(source, rule);
      expected.set(key, { source, rule, count: metadata.count });
      if (source.startsWith('scripts/conformance/')) add(findings, 'ESLINT_INTRODUCED_TOOLING_DEBT', `${source} must not baseline new conformance-tooling lint debt`);
      const currentCount = currentCounts.get(key) ?? 0;
      if (currentCount === 0) add(findings, 'ESLINT_CURRENT_FINDING_MISSING', `${source} ${rule} is suppressed but no longer exists in the current raw lint result`);
      else if (currentCount !== metadata.count) add(findings, 'ESLINT_CURRENT_FINDING_COUNT_MISMATCH', `${source} ${rule} current=${currentCount}, suppressions=${metadata.count}`);
    }
  }

  const seenKeys = new Set<string>();
  const seenFingerprints = new Set<string>();
  for (const entry of debt.entries) {
    const key = eslintInventoryKey(entry.source, entry.rule);
    if (seenKeys.has(key) || seenFingerprints.has(entry.fingerprint)) add(findings, 'ESLINT_DEBT_DUPLICATE', `duplicate debt record ${entry.source} ${entry.rule}`);
    seenKeys.add(key);
    seenFingerprints.add(entry.fingerprint);
    const suppression = expected.get(key);
    if (!suppression) add(findings, 'ESLINT_DEBT_STALE', `debt record no longer has a suppression: ${entry.source} ${entry.rule}`);
    else if (suppression.count !== entry.count) add(findings, 'ESLINT_DEBT_COUNT_MISMATCH', `${entry.source} ${entry.rule} debt=${entry.count}, suppressions=${suppression.count}`);
    if ((currentCounts.get(key) ?? 0) === 0) add(findings, 'ESLINT_DEBT_CURRENT_FINDING_MISSING', `debt record no longer has a current raw lint finding: ${entry.source} ${entry.rule}`);
    if (entry.fingerprint !== fingerprint('eslint', entry.source, entry.rule, entry.count)) add(findings, 'ESLINT_DEBT_FINGERPRINT_INVALID', `${entry.source} ${entry.rule} fingerprint is not deterministic`);
  }
  for (const [key, suppression] of expected) if (!seenKeys.has(key)) add(findings, 'ESLINT_SUPPRESSION_UNRECORDED', `suppression lacks an owned debt record: ${suppression.source} ${suppression.rule}`);
  for (const [key, count] of currentCounts) {
    if (count > 0 && !expected.has(key)) {
      const [source, rule] = key.split('\u0000');
      add(findings, 'ESLINT_CURRENT_FINDING_UNRECORDED', `${source} ${rule} has ${count} current finding(s) without an exact suppression/debt pair`);
    }
  }
  return findings;
}

async function currentLintCounts(root: string, sources: string[]): Promise<Map<string, number>> {
  if (sources.length === 0) return new Map();
  const eslint = new ESLint({ cwd: root, warnIgnored: false });
  const results = await eslint.lintFiles(sources);
  const counts = new Map<string, number>();
  for (const result of results) {
    const source = relative(root, result.filePath).replaceAll('\\', '/');
    for (const message of result.messages) {
      if (!message.ruleId) continue;
      const key = eslintInventoryKey(source, message.ruleId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

export async function checkEslintDebt(context: CheckContext): Promise<ConformanceFinding[]> {
  const suppressions = parseEslintSuppressions(readJson<unknown>(context.root, 'eslint-suppressions.json'));
  const debt = parseEslintDebt(readJson<unknown>(context.root, 'scripts/conformance/baselines/eslint-debt.json'));
  const sources = [...new Set([...Object.keys(suppressions), ...debt.entries.map((entry) => entry.source)])].sort();
  return compareEslintDebt(suppressions, debt, await currentLintCounts(context.root, sources));
}

export async function runEslintDebtCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  return { check: 'eslint-debt', findings: await checkEslintDebt(context), baselined: [] };
}
