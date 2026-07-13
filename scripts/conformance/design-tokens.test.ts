import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { auditComponentTokens } from './component-token-audit.mts';
import { undefinedTailwindVariables } from './design-tokens.mts';

describe('Design System structural negative fixtures', () => {
  const root = fileURLToPath(new URL('./fixtures/design/', import.meta.url));

  it('fails a new known legacy palette violation', () => {
    const audit = auditComponentTokens(root);
    expect(audit.findings.some((finding) => finding.rule === 'DS_LEGACY_COLOR' && finding.classification === 'confirmed_violation')).toBe(true);
  });

  it('fails a Tailwind mapping to an undefined CSS variable', () => {
    const tailwind = readFileSync(fileURLToPath(new URL('./fixtures/design/tailwind.config.ts', import.meta.url)), 'utf8');
    expect(undefinedTailwindVariables(['--cyan'], tailwind)).toEqual(['--undefined-token']);
  });
});
