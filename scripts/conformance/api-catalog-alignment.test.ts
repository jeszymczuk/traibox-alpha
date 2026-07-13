import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareApiRoutes, parseCatalogRoutes, parseServerRoutes } from './api-catalog-alignment.mts';

describe('API catalog alignment negative fixtures', () => {
  it('detects method, role, and protected-action annotation mismatches', () => {
    const root = fileURLToPath(new URL('./fixtures/api/', import.meta.url));
    const catalog = parseCatalogRoutes(root, 'catalog.ts');
    const server = parseServerRoutes(root, 'server.ts');
    const findings = compareApiRoutes(catalog, server, [
      { method: 'POST', path: '/v1/protected', protected_action: 'synthetic_action', handler_symbol: 'executeSyntheticAction', source: 'server.ts' }
    ]);
    const rules = findings.map((finding) => finding.rule);
    expect(rules).toContain('API_CATALOG_ROUTE_MISSING_SERVER');
    expect(rules).toContain('API_SERVER_ROUTE_MISSING_CATALOG');
    expect(rules).toContain('API_ROLE_MISMATCH');
    expect(rules).toContain('API_PROTECTED_ACTION_ANNOTATION_MISSING');
  });
});
