import { describe, expect, it } from 'vitest';
import { buildBundleZip, verifyBundleZip } from './index.js';

describe('proof bundle', () => {
  it('produces deterministic roots (artifact order independent)', async () => {
    const base = {
      trade_id: 't-01',
      org_id: 'org-01',
      created_at: '2026-01-01T00:00:00Z',
      policy: { retention_days: 365, pii_on_chain: false },
      build: { service: 'ledger', version: '0.1.0', trace_id: 'trc_test' }
    } as const;

    const a = { id: 'a1', path: 'artifacts/a.json', mime: 'application/json', data: Buffer.from(JSON.stringify({ a: 1 }), 'utf8'), hashing: 'jcs-json' as const };
    const b = { id: 'b1', path: 'artifacts/b.json', mime: 'application/json', data: Buffer.from(JSON.stringify({ b: 2 }), 'utf8'), hashing: 'jcs-json' as const };

    const out1 = await buildBundleZip({ ...base, artifacts: [a, b] });
    const out2 = await buildBundleZip({ ...base, artifacts: [b, a] });
    expect(out1.root).toBe(out2.root);

    const verify = await verifyBundleZip(out1.zipBytes);
    expect(verify.valid).toBe(true);
    expect(verify.root).toBe(out1.root);
    expect(verify.artifactCount).toBe(2);
  });
});
