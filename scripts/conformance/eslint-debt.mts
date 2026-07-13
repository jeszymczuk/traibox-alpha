import { z } from 'zod';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { fingerprint, readJson } from './shared/repo.mts';

const debtSchema = z
  .object({
    schema_version: z.literal(1),
    baseline_id: z.literal('TRAIBOX-C0.2-ESLINT-DEBT'),
    status: z.literal('REVIEW'),
    entries: z.array(
      z
        .object({
          fingerprint: z.string().length(24),
          rule: z.string().min(1),
          source: z.string().min(1),
          owner: z.string().startsWith('@'),
          severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
          rationale: z.string().min(1),
          remediation_condition: z.string().min(1),
          count: z.number().int().positive()
        })
        .strict()
    )
  })
  .strict();

function add(findings: ConformanceFinding[], rule: string, message: string): void {
  findings.push({ check: 'eslint-debt', rule, message, source: 'scripts/conformance/baselines/eslint-debt.json', severity: 'high' });
}

export function checkEslintDebt(context: CheckContext): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const suppressions = readJson<Record<string, Record<string, { count: number }>>>(context.root, 'eslint-suppressions.json');
  const debt = debtSchema.parse(readJson(context.root, 'scripts/conformance/baselines/eslint-debt.json'));
  const expected = new Map<string, { source: string; rule: string; count: number }>();
  for (const [source, rules] of Object.entries(suppressions)) {
    for (const [rule, metadata] of Object.entries(rules)) {
      const key = `${source}\u0000${rule}`;
      expected.set(key, { source, rule, count: metadata.count });
      if (source.startsWith('scripts/conformance/')) add(findings, 'ESLINT_INTRODUCED_TOOLING_DEBT', `${source} must not baseline new conformance-tooling lint debt`);
    }
  }
  const seen = new Set<string>();
  for (const entry of debt.entries) {
    const key = `${entry.source}\u0000${entry.rule}`;
    if (seen.has(key)) add(findings, 'ESLINT_DEBT_DUPLICATE', `duplicate debt record ${entry.source} ${entry.rule}`);
    seen.add(key);
    const suppression = expected.get(key);
    if (!suppression) add(findings, 'ESLINT_DEBT_STALE', `debt record no longer has a suppression: ${entry.source} ${entry.rule}`);
    else if (suppression.count !== entry.count) add(findings, 'ESLINT_DEBT_COUNT_MISMATCH', `${entry.source} ${entry.rule} debt=${entry.count}, suppressions=${suppression.count}`);
    if (entry.fingerprint !== fingerprint('eslint', entry.source, entry.rule, entry.count)) add(findings, 'ESLINT_DEBT_FINGERPRINT_INVALID', `${entry.source} ${entry.rule} fingerprint is not deterministic`);
  }
  for (const [key, suppression] of expected) if (!seen.has(key)) add(findings, 'ESLINT_SUPPRESSION_UNRECORDED', `suppression lacks an owned debt record: ${suppression.source} ${suppression.rule}`);
  return findings;
}

export async function runEslintDebtCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  return { check: 'eslint-debt', findings: checkEslintDebt(context), baselined: [] };
}
