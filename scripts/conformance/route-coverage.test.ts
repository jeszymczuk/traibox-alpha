import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareRoutes, discoverRoutes } from './route-coverage.mts';

describe('route coverage negative fixture', () => {
  it('fails for a synthetic page absent from the manifest', () => {
    const root = fileURLToPath(new URL('./fixtures/route-coverage/', import.meta.url));
    const actual = discoverRoutes(root);
    expect(actual).toEqual([{ path: '/synthetic', source: 'apps/web/src/app/synthetic/page.tsx' }]);
    expect(compareRoutes(actual, []).map((finding) => finding.rule)).toContain('ROUTE_ACTUAL_MISSING_MANIFEST');
  });
});
