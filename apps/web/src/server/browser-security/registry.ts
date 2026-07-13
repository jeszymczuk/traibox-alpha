export type BffPrincipal = 'user' | 'partner' | 'external' | 'public';

export type BffRoute = {
  method: 'GET' | 'POST' | 'DELETE';
  pattern: RegExp;
  principal: BffPrincipal;
  queryKeys?: readonly string[];
  response: 'json' | 'sse' | 'file';
};

// Explicit transport registry for browser-used routes. It mirrors the approved API
// catalog and the currently exercised compatibility endpoints; unmatched routes fail closed.
export const BFF_ROUTES: readonly BffRoute[] = [
  { method: 'GET', pattern: /^\/readyz$/, principal: 'public', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/orgs$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/orgs$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/orgs\/[^/]+\/access$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/orgs\/[^/]+\/invites$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/trades$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/trades\/[^/]+$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/messages$/, principal: 'user', queryKeys: ['limit'], response: 'json' },
  { method: 'GET', pattern: /^\/v1\/trades\/[^/]+\/messages$/, principal: 'user', queryKeys: ['limit'], response: 'json' },
  { method: 'POST', pattern: /^\/v1\/trades\/[^/]+\/messages$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/trade\/parse$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/documents\/(extract|upload|packs)$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/objects\/[^/]+$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/query$/, principal: 'user', queryKeys: ['origin_workspace', 'owner_id', 'status', 'type', 'trade_id', 'payment_provider', 'adapter_id', 'limit'], response: 'json' },
  { method: 'GET', pattern: /^\/v1\/replay$/, principal: 'user', queryKeys: ['trade_id', 'object_id', 'limit', 'include_audit'], response: 'json' },
  { method: 'GET', pattern: /^\/v1\/governance\/audit-chain$/, principal: 'user', queryKeys: ['limit'], response: 'json' },
  { method: 'GET', pattern: /^\/v1\/memory\/insights$/, principal: 'user', queryKeys: ['trade_id', 'level', 'limit'], response: 'json' },
  { method: 'GET', pattern: /^\/v1\/evals\/trade-brain\/(suites|runs)$/, principal: 'user', queryKeys: ['suite_id', 'status', 'limit'], response: 'json' },
  { method: 'POST', pattern: /^\/v1\/evals\/trade-brain\/run$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/(attachments|readiness\/evaluate|approvals|execution\/tasks|document-requests|proofs\/bundles|proofs\/share-requests|agents\/tasks|intelligence\/run)$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/intelligence\/stream$/, principal: 'user', response: 'sse' },
  { method: 'POST', pattern: /^\/v1\/approvals\/[^/]+\/decision$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/execution\/tasks\/[^/]+\/status$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/external-access\/grants$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/external-access\/grants\/[^/]+\/revoke$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/document-requests\/[^/]+\/submissions$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/demo\/internal-alpha$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/compliance\/check$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/clearance\/checks\/[^/]+\/evaluate$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/network\/counterparties\/[^/]+\/trust-context$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/finance\/funding$/, principal: 'user', queryKeys: ['limit'], response: 'json' },
  { method: 'POST', pattern: /^\/v1\/finance\/offers$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/finance\/offers\/[^/]+\/accept$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/banks\/(link|exchange|manual\/accounts)$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/banks\/(accounts|consents)$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/banks\/accounts\/[^/]+\/balances$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/payments$/, principal: 'user', queryKeys: ['limit'], response: 'json' },
  { method: 'POST', pattern: /^\/v1\/payments\/(routes|execute|mock\/sca-complete|manual\/complete)$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/payments\/intents\/[^/]+\/execute$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/payments\/[^/]+$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/ledger\/proofs$/, principal: 'user', queryKeys: ['trade_id'], response: 'json' },
  { method: 'POST', pattern: /^\/v1\/ledger\/(proofs\/verify|export)$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/allocation\/policies$/, principal: 'user', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/utg\/(recall|partner\/features)$/, principal: 'user', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/events$/, principal: 'user', queryKeys: ['org_id', 'trade_id'], response: 'sse' },
  { method: 'GET', pattern: /^\/v1\/files$/, principal: 'user', queryKeys: ['org_id', 'url'], response: 'file' },
  { method: 'GET', pattern: /^\/v1\/partners\/(profile|offer-requests)$/, principal: 'partner', queryKeys: ['status'], response: 'json' },
  { method: 'POST', pattern: /^\/v1\/partners\/offer-requests\/[^/]+\/offers$/, principal: 'partner', response: 'json' },
  { method: 'GET', pattern: /^\/v1\/external-participants\/session$/, principal: 'external', response: 'json' },
  { method: 'POST', pattern: /^\/v1\/external-participants\/(onboarding-evidence|execution-tasks\/[^/]+\/updates|document-requests\/[^/]+\/submissions)$/, principal: 'external', response: 'json' }
] as const;

const CREDENTIAL_QUERY_KEYS = new Set(['token', 'access_token', 'refresh_token', 'authorization', 'api_key']);

export function resolveBffRoute(method: string, rawSegments: readonly string[]): { route: BffRoute; path: string } {
  if (rawSegments.length === 0 || rawSegments.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment))) {
    throw new Error('invalid_bff_path');
  }
  const path = `/${rawSegments.join('/')}`;
  const route = BFF_ROUTES.find((candidate) => candidate.method === method.toUpperCase() && candidate.pattern.test(path));
  if (!route) throw new Error('unregistered_bff_route');
  return { route, path };
}

export function sanitizedQuery(route: BffRoute, searchParams: URLSearchParams): URLSearchParams {
  const allowed = new Set(route.queryKeys ?? []);
  const output = new URLSearchParams();
  for (const [key, value] of searchParams) {
    if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) throw new Error('credential_query_rejected');
    if (!allowed.has(key)) throw new Error('unregistered_bff_query');
    if (value.length > 4096 || /[\r\n\0]/.test(value)) throw new Error('invalid_bff_query');
    output.append(key, value);
  }
  return output;
}
