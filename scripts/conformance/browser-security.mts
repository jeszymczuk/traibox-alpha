import { readFileSync } from 'node:fs';

import { repoPath, walkFiles } from './shared/repo.mts';
import type { CheckContext, CheckResult, ConformanceFinding } from './shared/types.mts';

type SourceMap = Record<string, string>;

function finding(rule: string, source: string, message: string): ConformanceFinding {
  return { check: 'browser-security', rule, source, message, severity: 'critical' };
}

function clientProductionSource(path: string): boolean {
  return (
    path.startsWith('apps/web/src/') &&
    !path.startsWith('apps/web/src/server/') &&
    !path.startsWith('apps/web/src/app/api/') &&
    !path.endsWith('.test.ts') &&
    !path.endsWith('.test.tsx')
  );
}

export function scanBrowserSecuritySources(sources: SourceMap): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  for (const [source, text] of Object.entries(sources)) {
    if (clientProductionSource(source)) {
      if (/NEXT_PUBLIC_AUTH_TOKEN/.test(text)) findings.push(finding('BROWSER_PUBLIC_AUTH_TOKEN', source, 'Public browser auth-token configuration is forbidden'));
      if (/NEXT_PUBLIC_API_BASE_URL/.test(text)) findings.push(finding('BROWSER_DIRECT_API_BASE', source, 'Client code must use the same-origin BFF'));
      if (/NEXT_PUBLIC_[A-Z0-9_]*(?:TOKEN|SECRET|CREDENTIAL)/.test(text)) findings.push(finding('BROWSER_PUBLIC_CREDENTIAL', source, 'Credentials must not use NEXT_PUBLIC variables'));
      if (/from\s+['"][^'"]*\/(?:server|app\/api)\//.test(text)) findings.push(finding('BROWSER_SERVER_IMPORT', source, 'Client production code must not import server-boundary modules'));
      if (/\bAuthorization\b\s*[:=]|Bearer\s+\$\{/.test(text)) findings.push(finding('BROWSER_BEARER_CONSTRUCTION', source, 'Client code must not construct application Authorization headers'));
      if (/\.auth\.(?:getSession|onAuthStateChange|setSession|refreshSession|signInWith)/.test(text) || /persistSession\s*:\s*true|detectSessionInUrl\s*:\s*true|autoRefreshToken\s*:\s*true/.test(text)) {
        findings.push(finding('BROWSER_SUPABASE_SESSION', source, 'Supabase session APIs and persistence belong on the server boundary'));
      }
      if (/searchParams\.set\(\s*['"]token['"]/.test(text) || /\/v1\/(?:events|files)[^\n]*[?&]token=/.test(text)) {
        findings.push(finding('BROWSER_URL_TOKEN', source, 'Event and file URLs must never contain a bearer token'));
      }
      if (/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:auth|access|refresh|partner)[_-]?token/i.test(text)) {
        findings.push(finding('BROWSER_TOKEN_PERSISTENCE', source, 'Browser token persistence is forbidden'));
      }
      if (/(?:localStorage|sessionStorage)\.setItem\([^\n]*(?:intel|transcript|message|approval|document|financial)/i.test(text)) {
        findings.push(finding('BROWSER_PRIVATE_DATA_PERSISTENCE', source, 'Private transcripts and protected data must not persist in browser storage'));
      }
      if (/indexedDB\.(?:open|deleteDatabase)[^\n]*(?:auth|token|transcript|partner)/i.test(text)) {
        findings.push(finding('BROWSER_INDEXEDDB_SENSITIVE', source, 'Sensitive browser IndexedDB persistence is forbidden'));
      }
      if (source !== 'apps/web/src/lib/client-session.ts' && /traibox_auth_token/.test(text)) {
        findings.push(finding('BROWSER_LEGACY_AUTH_KEY', source, 'The legacy auth key may appear only in one-time cleanup code'));
      }
      if (source !== 'apps/web/src/lib/client-session.ts' && /traibox_partner_token/.test(text)) {
        findings.push(finding('BROWSER_PARTNER_TOKEN', source, 'Partner tokens must never be browser-visible'));
      }
    }
  }

  const apiServer = sources['apps/api/src/server.ts'] ?? '';
  if (/req\.query[^\n]*token|\(req\.query as any\)\?\.token/.test(apiServer) && /\/v1\/(?:events|files)/.test(apiServer)) {
    findings.push(finding('API_QUERY_TOKEN_AUTH', 'apps/api/src/server.ts', 'Fastify must not authenticate event or file requests from query tokens'));
  }

  const catchall = sources['apps/web/src/app/api/bff/[...path]/route.ts'];
  const proxy = sources['apps/web/src/server/browser-security/proxy.ts'];
  const registry = sources['apps/web/src/server/browser-security/registry.ts'];
  if (!catchall || !proxy || !registry || !/resolveBffRoute\(/.test(proxy) || !/BFF_ROUTES/.test(registry)) {
    findings.push(finding('BFF_UNRESTRICTED_PROXY', 'apps/web/src/app/api/bff/[...path]/route.ts', 'A catch-all BFF route requires an explicit method/path registry'));
  }
  if (proxy && /new URL\(request\.(?:url|nextUrl)|fetch\(request\.(?:url|nextUrl)/.test(proxy)) {
    findings.push(finding('BFF_USER_CONTROLLED_UPSTREAM', 'apps/web/src/server/browser-security/proxy.ts', 'The browser may not select the upstream host or protocol'));
  }
  return findings;
}

export async function runBrowserSecurityCheck(context: CheckContext): Promise<CheckResult> {
  const paths = [
    ...walkFiles(context.root, 'apps/web/src', (path) => /\.(?:ts|tsx|js|jsx)$/.test(path)),
    'apps/api/src/server.ts'
  ];
  const sources = Object.fromEntries(paths.map((path) => [path, readFileSync(repoPath(context.root, path), 'utf8')]));
  return { check: 'browser-security', findings: scanBrowserSecuritySources(sources), baselined: [] };
}
