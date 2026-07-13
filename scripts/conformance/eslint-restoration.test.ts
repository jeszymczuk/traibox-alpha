import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './shared/repo.mts';

describe('ESLint flat configuration negative fixture', () => {
  it('reports a newly introduced undefined identifier', async () => {
    const source = readFileSync(fileURLToPath(new URL('./fixtures/eslint/no-undef.txt', import.meta.url)), 'utf8');
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [result] = await eslint.lintText(source, { filePath: join(REPO_ROOT, 'scripts/conformance/eslint-negative.js') });
    expect(result?.messages.some((message) => message.ruleId === 'no-undef' && message.severity === 2)).toBe(true);
  });
});
