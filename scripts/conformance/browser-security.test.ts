import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { scanBrowserSecuritySources } from './browser-security.mts';

const fixtureRoot = fileURLToPath(new URL('./fixtures/browser-security/', import.meta.url));

function fixture(name: string): string {
  return readFileSync(`${fixtureRoot}/${name}`, 'utf8');
}

describe('browser security negative fixtures', () => {
  const cases: Array<[string, string]> = [
    ['public-auth-token.ts', 'BROWSER_PUBLIC_AUTH_TOKEN'],
    ['direct-api-base.ts', 'BROWSER_DIRECT_API_BASE'],
    ['bearer-header.ts', 'BROWSER_BEARER_CONSTRUCTION'],
    ['event-url-token.ts', 'BROWSER_URL_TOKEN'],
    ['supabase-session.ts', 'BROWSER_SUPABASE_SESSION'],
    ['auth-storage.ts', 'BROWSER_TOKEN_PERSISTENCE'],
    ['private-transcript.ts', 'BROWSER_PRIVATE_DATA_PERSISTENCE'],
    ['partner-storage.ts', 'BROWSER_PARTNER_TOKEN'],
    ['indexeddb-sensitive.ts', 'BROWSER_INDEXEDDB_SENSITIVE'],
    ['server-import.ts', 'BROWSER_SERVER_IMPORT']
  ];

  it.each(cases)('rejects %s with %s', (name, rule) => {
    const findings = scanBrowserSecuritySources({ [`apps/web/src/${name}`]: fixture(name) });
    expect(findings.map((finding) => finding.rule)).toContain(rule);
  });

  it('rejects query-token compatibility in Fastify', () => {
    const findings = scanBrowserSecuritySources({
      'apps/api/src/server.ts': fixture('api-query-token.ts'),
      'apps/web/src/app/api/bff/[...path]/route.ts': fixture('registered-catchall.ts'),
      'apps/web/src/server/browser-security/proxy.ts': 'resolveBffRoute([])',
      'apps/web/src/server/browser-security/registry.ts': 'const BFF_ROUTES = []'
    });
    expect(findings.map((finding) => finding.rule)).toContain('API_QUERY_TOKEN_AUTH');
  });

  it('rejects an unrestricted catch-all proxy', () => {
    const findings = scanBrowserSecuritySources({ 'apps/web/src/app/api/bff/[...path]/route.ts': fixture('unrestricted-proxy.ts') });
    expect(findings.map((finding) => finding.rule)).toContain('BFF_UNRESTRICTED_PROXY');
  });

  it('rejects a generic BFF database connection', () => {
    const findings = scanBrowserSecuritySources({
      'apps/web/src/server/browser-security/config.ts': fixture('generic-session-database.ts')
    });
    expect(findings.map((finding) => finding.rule)).toContain('BFF_GENERIC_DATABASE_CONNECTION');
  });

  it('rejects direct BFF session-table access', () => {
    const findings = scanBrowserSecuritySources({
      'apps/web/src/server/browser-security/store.ts': fixture('direct-session-table.ts')
    });
    expect(findings.map((finding) => finding.rule)).toContain('BFF_DIRECT_DATABASE_TABLE_ACCESS');
  });
});
