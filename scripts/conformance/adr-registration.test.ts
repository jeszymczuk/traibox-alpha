import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareAdrRegistration, parseAdr } from './adr-registration.mts';

describe('ADR registration negative fixture', () => {
  it('fails when an Accepted ADR is removed from the index and source-of-truth registry', () => {
    const path = fileURLToPath(new URL('./fixtures/adr/ADR-006-unregistered.md', import.meta.url));
    const adr = parseAdr('docs/adrs/ADR-006-unregistered.md', readFileSync(path, 'utf8'));
    const rules = compareAdrRegistration([adr], '# Empty ADR index\n', []).map((finding) => finding.rule);
    expect(rules).toContain('ADR_MISSING_INDEX');
    expect(rules).toContain('ADR_APPROVED_NOT_REGISTERED');
  });
});
