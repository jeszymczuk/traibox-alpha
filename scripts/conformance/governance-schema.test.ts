import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateGovernanceYaml } from './governance-schema.mts';

describe('governance schema negative fixture', () => {
  it('rejects unknown governance fields instead of normalizing them', () => {
    const path = fileURLToPath(new URL('./fixtures/governance/route-manifest-unknown-field.yaml', import.meta.url));
    const errors = validateGovernanceYaml('routes', readFileSync(path, 'utf8'));
    expect(errors.some((error) => error.includes('unexpected_field') && error.includes('Unrecognized'))).toBe(true);
  });
});
