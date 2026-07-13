import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applyDebtBaseline, loadDebtBaseline } from './shared/baseline.mts';
import { fingerprint, readText, repoPath, sortedUnique, walkFiles, REPO_ROOT } from './shared/repo.mts';
import type { ConformanceFinding, DebtBaselineEntry } from './shared/types.mts';

export type AuditClassification = 'confirmed_violation' | 'likely_violation' | 'legitimate_exception' | 'requires_review';

export type AuditFinding = {
  file: string;
  line: number;
  value: string;
  normalized_value: string;
  area: string;
  context: string;
  rule: string;
  classification: AuditClassification;
  reason: string;
  recommended_token?: string;
  fingerprint: string;
  content_class: 'production_ui' | 'test_fixture_generated';
};

export type AuditResult = {
  generated_from: string;
  canonical_cyan: string;
  production_files: string[];
  non_production_files: string[];
  findings: AuditFinding[];
};

const SOURCE_ROOT = 'apps/web/src';
const EXCLUDED = new Set(['apps/web/src/styles/tokens.css', 'apps/web/src/styles/themes.css', 'apps/web/src/app/globals.css']);
const SOURCE_EXTENSION = /\.(?:tsx?|css|scss)$/;
const TEST_OR_GENERATED = /(?:^|\/)(?:__tests__|fixtures?|generated|vendor)(?:\/|$)|\.(?:test|spec)\.[^.]+$/i;
const CANONICAL_RADIUS = new Set([0, 4, 8, 12, 18, 22, 9999]);
const KNOWN_LEGACY_HEX = new Set(['#4f8ff4', '#0b0d0e', '#0a0c0f']);
const KNOWN_LEGACY_RGB = new Set(['79,143,244', '11,13,14', '10,12,15']);

function normalizeColor(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/\.$/, '');
}

function canonicalTokenMaps(root: string): { exact: Map<string, string>; rgb: Map<string, string>; cyan: string } {
  const exact = new Map<string, string>();
  const rgb = new Map<string, string>();
  for (const path of ['apps/web/src/styles/tokens.css', 'apps/web/src/styles/themes.css']) {
    for (const match of readText(root, path).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const token = match[1]!;
      const value = normalizeColor(match[2]!);
      if (!exact.has(value)) exact.set(value, token);
      const hex = value.match(/^#([0-9a-f]{6})$/);
      if (hex) {
        const number = Number.parseInt(hex[1]!, 16);
        const key = `${(number >> 16) & 255},${(number >> 8) & 255},${number & 255}`;
        if (!rgb.has(key)) rgb.set(key, token);
      }
    }
  }
  const cyan = readText(root, 'apps/web/src/styles/tokens.css').match(/--cyan\s*:\s*(#[0-9a-f]{6})\s*;/i)?.[1]?.toLowerCase();
  if (!cyan) throw new Error('tokens.css does not define --cyan as a hex color');
  return { exact, rgb, cyan };
}

function featureArea(path: string): string {
  const module = path.match(/\/styles\/modules\/([^/]+)\.css$/)?.[1];
  if (module) {
    if (['finance', 'payments', 'payment-detail', 'portfolio'].includes(module)) return 'finance';
    if (['new-trade', 'trade-room'].includes(module)) return 'trades';
    if (module === 'counterparty') return 'network';
    return module.replace('v9-shared', 'shared');
  }
  const app = path.match(/\/app\/([^/]+)/)?.[1];
  if (app) {
    if (app === 'payments') return 'finance';
    if (app === 'trade') return 'trades';
    return app;
  }
  if (path.includes('/components/ui/')) return 'shared-primitives';
  if (path.includes('/components/')) return 'shared-components';
  if (path.includes('/features/')) return path.match(/\/features\/([^/]+)/)?.[1] ?? 'features';
  return 'platform';
}

function selectorAt(lines: string[], lineIndex: number): string {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const line = lines[index]!.trim();
    if (line.includes('{') && !line.startsWith('@')) return line.slice(0, line.indexOf('{')).trim();
  }
  return '';
}

function stylingContext(path: string, line: string): string {
  if (/\b(?:fill|stroke|stopColor)=/.test(line)) return 'SVG presentation value';
  if (/className\s*=|\bcn\(|\bclassName:/.test(line)) return line.includes('[radial-gradient') || line.includes('[linear-gradient') ? 'Tailwind arbitrary value' : 'class-name string';
  if (/\bstyle\s*=|\b(?:backgroundColor|borderColor|fontFamily|color)\s*:/.test(line) && path.endsWith('.tsx')) return 'inline React style object';
  if (/border-radius\s*:|font-family\s*:|(?:background|color|border|shadow|fill|stroke)\s*:/.test(line)) return 'CSS declaration';
  if (/[`'"]/.test(line)) return 'CSS-in-JS or template-string styling';
  return 'styling literal';
}

function exceptionReason(path: string, line: string, selector: string, contentClass: AuditFinding['content_class']): string | undefined {
  if (contentClass === 'test_fixture_generated') return 'Literal is confined to test, fixture, generated, or third-party evidence rather than production UI.';
  if (path.includes('/finance/portfolio/page.tsx') && /(?:DONUT_)?COLORS/.test(line)) return 'Literal is part of a chart/data-series palette.';
  if (/\b(?:fill|stroke|stopColor)=/.test(line)) return path.includes('/portfolio/') || path.includes('/network/') ? 'Literal is an SVG chart or data-visualization presentation value.' : 'Literal is an SVG/image presentation value.';
  if (path.endsWith('/styles/modules/network.css') && /\.map-(?:edge|legend)/.test(selector)) return 'Literal is part of the network-map data-visualization palette.';
  if (/\.flag\.(?:eur|usd|gbp)/.test(selector)) return 'Literal represents an external currency/flag brand identity.';
  if (/pdf|document-render|provider-supplied/i.test(path + line)) return 'Literal belongs to document/PDF or provider-supplied rendering.';
  return undefined;
}

function colorClassification(value: string, maps: ReturnType<typeof canonicalTokenMaps>, exception?: string): Pick<AuditFinding, 'rule' | 'classification' | 'reason' | 'recommended_token'> {
  if (exception) return { rule: 'DS_LITERAL_COLOR', classification: 'legitimate_exception', reason: exception };
  const normalized = normalizeColor(value);
  const rgbMatch = normalized.match(/^rgba?\((\d+),(\d+),(\d+)(?:,|\))/);
  const rgbKey = rgbMatch ? `${rgbMatch[1]},${rgbMatch[2]},${rgbMatch[3]}` : undefined;
  if (KNOWN_LEGACY_HEX.has(normalized) || (rgbKey && KNOWN_LEGACY_RGB.has(rgbKey))) {
    return { rule: 'DS_LEGACY_COLOR', classification: 'confirmed_violation', reason: 'Known legacy palette value bypasses Design System v2.', recommended_token: 'var(--cyan)' };
  }
  const exactToken = maps.exact.get(normalized);
  if (exactToken) return { rule: 'DS_DUPLICATE_FOUNDATIONAL_VALUE', classification: 'confirmed_violation', reason: `Literal duplicates canonical ${exactToken}.`, recommended_token: `var(${exactToken})` };
  const baseToken = rgbKey ? maps.rgb.get(rgbKey) : undefined;
  if (baseToken) return { rule: 'DS_DUPLICATE_FOUNDATIONAL_VALUE', classification: 'confirmed_violation', reason: `Literal reuses the canonical ${baseToken} base color with a hand-picked opacity.`, recommended_token: `var(${baseToken})` };
  if (/^(?:bg|text|border|ring|from|to|via)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-|\/|$)/.test(normalized)) {
    return { rule: 'DS_TAILWIND_PALETTE_COLOR', classification: 'likely_violation', reason: 'Tailwind palette utility bypasses the configured semantic token names.' };
  }
  return { rule: 'DS_LITERAL_COLOR', classification: 'requires_review', reason: 'Literal color has no unambiguous existing semantic-token mapping; design intent requires review.' };
}

function pushFinding(findings: AuditFinding[], input: Omit<AuditFinding, 'fingerprint'>, lines: string[], lineIndex: number, ordinal: number): void {
  const selector = input.file.endsWith('.css') || input.file.endsWith('.scss') ? selectorAt(lines, lineIndex) : '';
  const contextIdentifier = [selector, lines[lineIndex - 1] ?? '', lines[lineIndex] ?? '', lines[lineIndex + 1] ?? ''].join('\n');
  findings.push({ ...input, fingerprint: fingerprint(input.file, input.rule, input.normalized_value, contextIdentifier, ordinal) });
}

export function auditComponentTokens(root = REPO_ROOT): AuditResult {
  const maps = canonicalTokenMaps(root);
  const files = walkFiles(root, SOURCE_ROOT, (path) => SOURCE_EXTENSION.test(path) && !EXCLUDED.has(path));
  const productionFiles = files.filter((path) => !TEST_OR_GENERATED.test(path));
  const nonProductionFiles = files.filter((path) => TEST_OR_GENERATED.test(path));
  const findings: AuditFinding[] = [];
  for (const file of files) {
    const lines = readText(root, file).split('\n');
    const contentClass: AuditFinding['content_class'] = TEST_OR_GENERATED.test(file) ? 'test_fixture_generated' : 'production_ui';
    for (const [lineIndex, line] of lines.entries()) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;
      const selector = file.endsWith('.css') || file.endsWith('.scss') ? selectorAt(lines, lineIndex) : '';
      const exception = exceptionReason(file, line, selector, contentClass);
      const colorMatches: string[] = [];
      for (const match of line.matchAll(/#[0-9a-f]{3,8}\b/gi)) colorMatches.push(match[0]);
      for (const match of line.matchAll(/\brgba?\(\s*\d+(?:\s*,\s*\d+){2}(?:\s*,\s*(?:\d*\.)?\d+)?\s*\)/gi)) colorMatches.push(match[0]);
      for (const match of line.matchAll(/\bhsla?\(\s*\d+[^)]*\)/gi)) colorMatches.push(match[0]);
      for (const match of line.matchAll(/\b(?:bg|text|border|ring|from|to|via)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g)) colorMatches.push(match[0]);
      colorMatches
        .filter((value) => !/^(?:bg|text|border|ring|from|to|via)-(?:cyan|teal|violet|pink)(?:\/\d{1,3})?$/.test(value))
        .forEach((value, ordinal) => {
        const classification = colorClassification(value, maps, exception);
        pushFinding(
          findings,
          {
            file,
            line: lineIndex + 1,
            value,
            normalized_value: normalizeColor(value),
            area: featureArea(file),
            context: stylingContext(file, line),
            ...classification,
            content_class: contentClass
          },
          lines,
          lineIndex,
          ordinal
        );
        });

      const radius = line.match(/border-radius\s*:\s*([^;]+)/i)?.[1] ?? line.match(/rounded-\[([^\]]+)\]/i)?.[1];
      if (radius) {
        const pixelValues = [...radius.matchAll(/([0-9]+(?:\.[0-9]+)?)px/gi)].map((match) => Number(match[1]));
        if (pixelValues.some((value) => !CANONICAL_RADIUS.has(value))) {
          pushFinding(
            findings,
            {
              file,
              line: lineIndex + 1,
              value: radius.trim(),
              normalized_value: radius.toLowerCase().replace(/\s+/g, ' ').trim(),
              area: featureArea(file),
              context: stylingContext(file, line),
              rule: 'DS_NONCANONICAL_RADIUS',
              classification: contentClass === 'production_ui' ? 'confirmed_violation' : 'legitimate_exception',
              reason: contentClass === 'production_ui' ? 'Hard-coded pixel radius is outside the canonical 4/8/12/18/22/full scale.' : 'Radius occurs only in tests, fixtures, generated, or third-party content.',
              content_class: contentClass
            },
            lines,
            lineIndex,
            0
          );
        }
      }

      if (/\bInter\b/i.test(line)) {
        pushFinding(
          findings,
          {
            file,
            line: lineIndex + 1,
            value: 'Inter',
            normalized_value: 'inter',
            area: featureArea(file),
            context: stylingContext(file, line),
            rule: 'DS_LEGACY_PRIMARY_FONT',
            classification: contentClass === 'production_ui' ? 'confirmed_violation' : 'legitimate_exception',
            reason: contentClass === 'production_ui' ? 'Literal Inter primary font bypasses --font-sans.' : 'Font literal occurs only in tests, fixtures, generated, or third-party content.',
            recommended_token: contentClass === 'production_ui' ? 'var(--font-sans)' : undefined,
            content_class: contentClass
          },
          lines,
          lineIndex,
          0
        );
      }
      const fontFamily = line.match(/font-family\s*:\s*([^;]+)/i)?.[1];
      if (fontFamily && !/var\(--font-(?:sans|mono)\)|\binherit\b/i.test(fontFamily) && !/\bInter\b/i.test(fontFamily)) {
        pushFinding(
          findings,
          {
            file,
            line: lineIndex + 1,
            value: fontFamily.trim(),
            normalized_value: fontFamily.toLowerCase().replace(/\s+/g, ' ').trim(),
            area: featureArea(file),
            context: 'CSS declaration',
            rule: 'DS_NONCANONICAL_FONT',
            classification: contentClass === 'production_ui' ? 'requires_review' : 'legitimate_exception',
            reason: contentClass === 'production_ui' ? 'Primary font choice is outside the canonical typography variables and requires intent review.' : 'Font literal occurs only in tests, fixtures, generated, or third-party content.',
            content_class: contentClass
          },
          lines,
          lineIndex,
          0
        );
      }
    }
  }
  return { generated_from: SOURCE_ROOT, canonical_cyan: maps.cyan, production_files: productionFiles, non_production_files: nonProductionFiles, findings };
}

function featureVerdict(findings: AuditFinding[]): 'COMPLIANT' | 'MINOR_DRIFT' | 'NEEDS_REWORK' | 'REVIEW_REQUIRED' {
  const confirmed = findings.filter((finding) => finding.classification === 'confirmed_violation').length;
  if (confirmed >= 5) return 'NEEDS_REWORK';
  if (confirmed > 0) return 'MINOR_DRIFT';
  if (findings.some((finding) => finding.classification === 'likely_violation' || finding.classification === 'requires_review')) return 'REVIEW_REQUIRED';
  return 'COMPLIANT';
}

export function renderAuditReport(result: AuditResult): string {
  const productionFindings = result.findings.filter((finding) => finding.content_class === 'production_ui');
  const nonProductionFindings = result.findings.filter((finding) => finding.content_class === 'test_fixture_generated');
  const filesWithFindings = new Set(productionFindings.map((finding) => finding.file));
  const confirmedFiles = new Set(productionFindings.filter((finding) => finding.classification === 'confirmed_violation').map((finding) => finding.file));
  const reviewFiles = new Set(productionFindings.filter((finding) => finding.classification === 'requires_review').map((finding) => finding.file));
  const nonCompliantFiles = new Set(productionFindings.filter((finding) => ['confirmed_violation', 'likely_violation', 'requires_review'].includes(finding.classification)).map((finding) => finding.file));
  const compliant = result.production_files.length - nonCompliantFiles.size;
  const areas = sortedUnique(productionFindings.map((finding) => finding.area));
  const areaRows = areas.map((area) => {
    const findings = productionFindings.filter((finding) => finding.area === area);
    return `| ${area} | ${findings.length} | ${findings.filter((finding) => finding.classification === 'confirmed_violation').length} | ${findings.filter((finding) => finding.classification === 'likely_violation').length} | ${findings.filter((finding) => finding.classification === 'requires_review').length} | ${findings.filter((finding) => finding.classification === 'legitimate_exception').length} | ${featureVerdict(findings)} |`;
  });
  const concentration = areas
    .map((area) => ({ area, count: productionFindings.filter((finding) => finding.area === area && finding.classification === 'confirmed_violation').length }))
    .sort((left, right) => right.count - left.count || left.area.localeCompare(right.area))
    .slice(0, 5)
    .map((entry) => `${entry.area} (${entry.count})`)
    .join(', ');
  const findingRows = result.findings.map((finding) => {
    const recommendation = finding.recommended_token ?? '—';
    return `| ${finding.file} | ${finding.line} | \`${finding.value.replaceAll('|', '\\|')}\` | ${finding.area} | ${finding.context} | ${finding.rule} | ${finding.classification} | ${recommendation} | ${finding.reason.replaceAll('|', '\\|')} |`;
  });
  const count = (items: AuditFinding[], classification: AuditClassification) => items.filter((finding) => finding.classification === classification).length;
  return `# Component token conformance audit

- Status: **REVIEW** evidence; not product or design authority
- Scope: \`${result.generated_from}/**/*.{tsx,ts,css,scss}\`
- Canonical sources excluded from findings: \`tokens.css\`, \`themes.css\`, and \`app/globals.css\`
- Canonical dark-theme \`--cyan\` read from \`tokens.css\`: **\`${result.canonical_cyan}\`**
- Component remediation owner: **C0.6**; this audit changes no component or token value

## Summary

| Measure | Total |
| --- | ---: |
| Production UI files scanned | ${result.production_files.length} |
| Production files with no findings | ${result.production_files.length - filesWithFindings.size} |
| Production files with confirmed violations | ${confirmedFiles.size} |
| Production files requiring review | ${reviewFiles.size} |
| Production files compliant | ${compliant} |
| Percentage compliant | ${result.production_files.length ? ((compliant / result.production_files.length) * 100).toFixed(1) : '100.0'}% |
| Production confirmed violations | ${count(productionFindings, 'confirmed_violation')} |
| Production likely violations | ${count(productionFindings, 'likely_violation')} |
| Production requires review | ${count(productionFindings, 'requires_review')} |
| Production legitimate exceptions | ${count(productionFindings, 'legitimate_exception')} |
| Test/fixture/generated files scanned | ${result.non_production_files.length} |
| Test/fixture/generated findings | ${nonProductionFindings.length} |

Compliance means a production file has no confirmed, likely, or review-required finding. Legitimate SVG, chart, document/PDF, external-brand, provider, fixture, generated, and third-party literals are recorded separately and do not reduce compliance.

## Feature-area verdicts

| Feature area | Findings | Confirmed | Likely | Review | Exceptions | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
${areaRows.join('\n')}

Confirmed debt is concentrated in: ${concentration || 'none'}.

## Classification rules

- \`confirmed_violation\`: known legacy palette/font usage, a literal reuse of a canonical foundational color, or a pixel radius outside the canonical scale.
- \`likely_violation\`: framework palette styling that bypasses the configured semantic names.
- \`legitimate_exception\`: evidenced SVG/image, chart/data series, document/PDF, external-brand, provider, fixture, generated, or third-party usage.
- \`requires_review\`: a literal exists, but the current canonical sources do not make a safe replacement mapping clear.

No replacement token is proposed when design intent cannot be determined. Line numbers are evidence only; the machine baseline uses a source-context fingerprint as stable identity.

## Findings

| File | Line | Value | Area | Styling context | Rule | Classification | Existing token when clear | Reason |
| --- | ---: | --- | --- | --- | --- | --- | --- | --- |
${findingRows.join('\n')}
`;
}

export function componentDebtEntries(result: AuditResult): Array<DebtBaselineEntry & Record<string, unknown>> {
  return result.findings
    .filter((finding) => finding.content_class === 'production_ui' && finding.classification === 'confirmed_violation')
    .map((finding) => ({
      fingerprint: finding.fingerprint,
      rule: finding.rule,
      source: finding.file,
      owner: '@design-system-c0.6',
      severity: (finding.rule === 'DS_LEGACY_COLOR' || finding.rule === 'DS_LEGACY_PRIMARY_FONT' ? 'high' : 'medium') as 'high' | 'medium',
      rationale: finding.reason,
      remediation_condition: 'Remove the literal during C0.6 component remediation and delete this exact baseline entry.',
      normalized_value: finding.normalized_value,
      classification: finding.classification,
      context_identifier: finding.fingerprint,
      evidence_line: finding.line,
      recommended_token: finding.recommended_token ?? null
    }));
}

export function verifyComponentDebt(root: string, result: AuditResult): { findings: ConformanceFinding[]; baselined: ConformanceFinding[] } {
  const raw: ConformanceFinding[] = result.findings
    .filter((finding) => finding.content_class === 'production_ui' && finding.classification === 'confirmed_violation')
    .map((finding) => ({
      check: 'design-tokens',
      rule: finding.rule,
      message: `${finding.file}:${finding.line} introduces ${finding.normalized_value}`,
      source: finding.file,
      severity: finding.rule.startsWith('DS_LEGACY') ? 'high' : 'medium',
      baselineKey: finding.fingerprint
    }));
  const baseline = loadDebtBaseline(root, 'scripts/conformance/baselines/component-token-debt.json');
  const applied = applyDebtBaseline(raw, baseline.entries);
  for (const stale of applied.stale) {
    applied.unbaselined.push({ check: 'design-tokens', rule: 'DS_BASELINE_STALE', message: `remove remediated component debt baseline ${stale.fingerprint}`, source: 'scripts/conformance/baselines/component-token-debt.json', severity: 'medium' });
  }
  return { findings: applied.unbaselined, baselined: applied.baselined };
}

async function main(): Promise<void> {
  const result = auditComponentTokens(REPO_ROOT);
  if (process.argv.includes('--write')) {
    writeFileSync(repoPath(REPO_ROOT, 'docs/audits/component-token-conformance.md'), renderAuditReport(result));
    writeFileSync(
      repoPath(REPO_ROOT, 'scripts/conformance/baselines/component-token-debt.json'),
      `${JSON.stringify({ schema_version: 1, baseline_id: 'TRAIBOX-C0.2-COMPONENT-TOKEN-DEBT', status: 'REVIEW', entries: componentDebtEntries(result) }, null, 2)}\n`
    );
    console.log(`wrote audit with ${result.findings.length} findings and ${componentDebtEntries(result).length} confirmed debt entries`);
    return;
  }
  const verification = verifyComponentDebt(REPO_ROOT, result);
  console.log(`component-token audit: ${result.production_files.length} production files, ${result.findings.length} findings, ${verification.baselined.length} baselined confirmed violations`);
  if (verification.findings.length > 0) {
    for (const finding of verification.findings) console.error(`[${finding.rule}] ${finding.message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
