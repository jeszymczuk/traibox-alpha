import { describe, expect, it } from 'vitest';
import { inspectReleaseIntegrity, type ReleaseIntegrityInput } from './release-integrity.mts';

const valid: ReleaseIntegrityInput = {
  rootScripts: {
    build: 'turbo build',
    lint: 'eslint . --max-warnings=0',
    'release:gate':
      'pnpm conformance && pnpm conformance:test && pnpm audit:component-tokens && pnpm lint && pnpm typecheck && pnpm test && pnpm test:trade-brain && pnpm eval:trade-brain:ci && pnpm build'
  },
  webScripts: { build: 'next build' },
  ciSteps: [
    { run: 'corepack pnpm conformance' },
    { run: 'corepack pnpm conformance:test' },
    { run: 'corepack pnpm audit:component-tokens' },
    { run: 'corepack pnpm lint' },
    { run: 'corepack pnpm typecheck' },
    { run: 'corepack pnpm build' }
  ],
  nextConfig: { eslint: { ignoreDuringBuilds: true } },
  webLintCovered: true
};

describe('release and Next lint integrity', () => {
  it('accepts root web lint, lint-before-build CI, and TypeScript-safe Next separation', () => {
    expect(inspectReleaseIntegrity(valid)).toEqual([]);
  });

  it('fails when the release gate can reach build without lint', () => {
    const input = { ...valid, rootScripts: { ...valid.rootScripts, 'release:gate': 'pnpm typecheck && pnpm build' } };
    expect(inspectReleaseIntegrity(input).map((finding) => finding.rule)).toContain('RELEASE_GATE_COMMAND_MISSING');
  });

  it('fails when CI places root lint after build', () => {
    const input = { ...valid, ciSteps: [...valid.ciSteps.slice(0, 3), ...valid.ciSteps.slice(4), valid.ciSteps[3]!] };
    expect(inspectReleaseIntegrity(input).map((finding) => finding.rule)).toContain('CI_GATE_ORDER_INVALID');
  });

  it('fails when root ESLint no longer covers the web application', () => {
    expect(inspectReleaseIntegrity({ ...valid, webLintCovered: false }).map((finding) => finding.rule)).toContain('WEB_LINT_COVERAGE_MISSING');
  });

  it('fails if Next is configured to ignore TypeScript build errors', () => {
    const input = { ...valid, nextConfig: { eslint: { ignoreDuringBuilds: true }, typescript: { ignoreBuildErrors: true } } };
    expect(inspectReleaseIntegrity(input).map((finding) => finding.rule)).toContain('NEXT_TYPESCRIPT_CHECK_DISABLED');
  });
});
