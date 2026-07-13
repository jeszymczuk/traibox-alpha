import { pathToFileURL } from 'node:url';
import { ESLint } from 'eslint';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { readJson, readYaml, repoPath } from './shared/repo.mts';

type WorkflowStep = { name?: string; run?: string };

export type ReleaseIntegrityInput = {
  rootScripts: Record<string, string>;
  webScripts: Record<string, string>;
  ciSteps: WorkflowStep[];
  nextConfig: { eslint?: { ignoreDuringBuilds?: boolean }; typescript?: { ignoreBuildErrors?: boolean } };
  webLintCovered: boolean;
};

function add(findings: ConformanceFinding[], rule: string, message: string, source: string): void {
  findings.push({ check: 'release-integrity', rule, message, source, severity: 'critical' });
}

function commandParts(script: string | undefined): string[] {
  return script?.split(/\s*&&\s*/).map((part) => part.trim()) ?? [];
}

export function inspectReleaseIntegrity(input: ReleaseIntegrityInput): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  if (input.rootScripts.lint !== 'eslint . --max-warnings=0') {
    add(findings, 'ROOT_LINT_SCOPE_INVALID', 'root lint must cover the monorepo with zero warnings', 'package.json');
  }
  if (!input.webLintCovered) add(findings, 'WEB_LINT_COVERAGE_MISSING', 'root ESLint configuration does not apply the required TypeScript, hooks, accessibility, and Next rules to apps/web', 'eslint.config.mjs');
  if (input.rootScripts.build !== 'turbo build' || input.webScripts.build !== 'next build') {
    add(findings, 'PRODUCTION_BUILD_SCRIPT_CHANGED', 'the root and web production build commands must remain turbo build and next build', 'package.json');
  }
  if (input.nextConfig.eslint?.ignoreDuringBuilds !== true) {
    add(findings, 'NEXT_DUPLICATE_LINT_SETTING_CHANGED', 'Next build must skip only its duplicate lint pass while root lint remains enforced', 'apps/web/next.config.mjs');
  }
  if (input.nextConfig.typescript?.ignoreBuildErrors === true) {
    add(findings, 'NEXT_TYPESCRIPT_CHECK_DISABLED', 'Next production builds must not ignore TypeScript errors', 'apps/web/next.config.mjs');
  }

  const releaseParts = commandParts(input.rootScripts['release:gate']);
  const releaseCommands = ['pnpm conformance', 'pnpm conformance:test', 'pnpm audit:component-tokens', 'pnpm lint', 'pnpm typecheck', 'pnpm build'];
  let prior = -1;
  for (const command of releaseCommands) {
    const index = releaseParts.indexOf(command);
    if (index < 0) add(findings, 'RELEASE_GATE_COMMAND_MISSING', `release:gate must include ${command}`, 'package.json');
    else if (index <= prior) add(findings, 'RELEASE_GATE_ORDER_INVALID', `${command} must run after the preceding structural/type gate and before build`, 'package.json');
    prior = Math.max(prior, index);
  }

  const ciRuns = input.ciSteps.map((step) => step.run?.trim() ?? '');
  const ciCommands = ['corepack pnpm conformance', 'corepack pnpm conformance:test', 'corepack pnpm audit:component-tokens', 'corepack pnpm lint', 'corepack pnpm typecheck', 'corepack pnpm build'];
  prior = -1;
  for (const command of ciCommands) {
    const index = ciRuns.indexOf(command);
    if (index < 0) add(findings, 'CI_COMMAND_MISSING', `CI verify job must include ${command}`, '.github/workflows/ci.yml');
    else if (index <= prior) add(findings, 'CI_GATE_ORDER_INVALID', `${command} must run after the preceding gate and before build`, '.github/workflows/ci.yml');
    prior = Math.max(prior, index);
  }
  return findings;
}

function severity(config: Awaited<ReturnType<ESLint['calculateConfigForFile']>>, rule: string): number {
  const setting = config?.rules?.[rule];
  if (Array.isArray(setting)) return Number(setting[0]);
  return Number(setting ?? 0);
}

export async function runReleaseIntegrityCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  const rootPackage = readJson<{ scripts: Record<string, string> }>(context.root, 'package.json');
  const webPackage = readJson<{ scripts: Record<string, string> }>(context.root, 'apps/web/package.json');
  const workflow = readYaml<{ jobs?: { verify?: { steps?: WorkflowStep[] } } }>(context.root, '.github/workflows/ci.yml');
  const nextConfigModule = await import(`${pathToFileURL(repoPath(context.root, 'apps/web/next.config.mjs')).href}?release-integrity`);
  const lintConfig = await new ESLint({ cwd: context.root }).calculateConfigForFile('apps/web/src/app/page.tsx');
  const webLintCovered =
    severity(lintConfig, 'no-console') === 2 &&
    severity(lintConfig, 'react-hooks/rules-of-hooks') === 2 &&
    severity(lintConfig, 'jsx-a11y/alt-text') === 2 &&
    severity(lintConfig, '@next/next/no-img-element') === 1;
  const findings = inspectReleaseIntegrity({
    rootScripts: rootPackage.scripts,
    webScripts: webPackage.scripts,
    ciSteps: workflow.jobs?.verify?.steps ?? [],
    nextConfig: nextConfigModule.default,
    webLintCovered
  });
  return { check: 'release-integrity', findings, baselined: [] };
}
