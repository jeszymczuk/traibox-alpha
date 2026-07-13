import { pathToFileURL } from 'node:url';
import { runGovernanceSchemaCheck } from './governance-schema.mts';
import { runRouteCoverageCheck } from './route-coverage.mts';
import { runProtectedActionsCheck } from './protected-actions.mts';
import { runAdrRegistrationCheck } from './adr-registration.mts';
import { runApiCatalogAlignmentCheck } from './api-catalog-alignment.mts';
import { runStatusVocabularyCheck } from './status-vocabulary.mts';
import { runDesignTokensCheck } from './design-tokens.mts';
import { runEslintDebtCheck } from './eslint-debt.mts';
import { runReleaseIntegrityCheck } from './release-integrity.mts';
import { runBrowserSecurityCheck } from './browser-security.mts';
import { REPO_ROOT } from './shared/repo.mts';
import type { CheckResult, ConformanceFinding } from './shared/types.mts';

const CHECKS = [
  runGovernanceSchemaCheck,
  runRouteCoverageCheck,
  runProtectedActionsCheck,
  runAdrRegistrationCheck,
  runApiCatalogAlignmentCheck,
  runStatusVocabularyCheck,
  runEslintDebtCheck,
  runDesignTokensCheck,
  runBrowserSecurityCheck,
  runReleaseIntegrityCheck
];

export async function runConformance(root = REPO_ROOT): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    try {
      results.push(await check({ root }));
    } catch (error) {
      const name = check.name.replace(/^run|Check$/g, '').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      const finding: ConformanceFinding = {
        check: name,
        rule: 'CONFORMANCE_CHECK_CRASHED',
        message: error instanceof Error ? error.stack ?? error.message : String(error),
        severity: 'critical'
      };
      results.push({ check: name, findings: [finding], baselined: [] });
    }
  }
  return results;
}

async function main(): Promise<void> {
  const results = await runConformance();
  let failed = false;
  for (const result of results) {
    if (result.findings.length === 0) {
      console.log(`PASS ${result.check} (${result.baselined.length} existing discrepancies baselined)`);
      continue;
    }
    failed = true;
    console.error(`FAIL ${result.check}`);
    for (const finding of result.findings) console.error(`  [${finding.severity}] ${finding.rule}${finding.source ? ` ${finding.source}` : ''}: ${finding.message}`);
  }
  const baselineCount = results.reduce((sum, result) => sum + result.baselined.length, 0);
  const failureCount = results.reduce((sum, result) => sum + result.findings.length, 0);
  console.log(`structural conformance: ${results.length} checks, ${baselineCount} explicit existing discrepancies, ${failureCount} failures`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
