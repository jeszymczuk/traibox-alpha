import ts from 'typescript';
import { z } from 'zod';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { applyDebtBaseline, loadDebtBaseline } from './shared/baseline.mts';
import { fingerprint, readYaml, sortedUnique } from './shared/repo.mts';
import { findVariable, parseTypeScript, unwrapExpression } from './shared/typescript.mts';

export type CatalogRoute = {
  method: string;
  path: string;
  operationId?: string;
  workspace?: string;
  auth?: string;
  roles?: string[];
  protectedAction?: string;
  tags?: string[];
  stability?: string;
};

export type ServerRoute = {
  method: string;
  path: string;
  normalizedPath: string;
  roles?: string[];
  handlerText: string;
  source: string;
};

const evidenceSchema = z
  .object({
    schema_version: z.literal(1),
    registry_id: z.string().min(1),
    status: z.literal('REVIEW'),
    entries: z.array(
      z
        .object({
          method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
          path: z.string().startsWith('/'),
          protected_action: z.string().min(1),
          handler_symbol: z.string().min(1),
          source: z.string().min(1)
        })
        .strict()
    )
  })
  .strict();

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (!('name' in property) || !property.name) return undefined;
  if (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) return property.name.text;
  return undefined;
}

function propertyExpression(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find((entry) => propertyName(entry) === name);
  return property && ts.isPropertyAssignment(property) ? unwrapExpression(property.initializer) : undefined;
}

function stringProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const expression = propertyExpression(object, name);
  return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
}

function stringArrayProperty(object: ts.ObjectLiteralExpression, name: string): string[] | undefined {
  const expression = propertyExpression(object, name);
  if (!expression) return undefined;
  if (!ts.isArrayLiteralExpression(expression)) return undefined;
  return expression.elements.filter(ts.isStringLiteralLike).map((entry) => entry.text);
}

export function parseCatalogRoutes(root: string, path = 'packages/contracts/src/index.ts'): CatalogRoute[] {
  const sourceFile = parseTypeScript(root, path);
  const declaration = findVariable(sourceFile, 'TRAIBOX_API_ENDPOINTS');
  if (!declaration?.initializer) throw new Error(`${path}: missing TRAIBOX_API_ENDPOINTS`);
  const initializer = unwrapExpression(declaration.initializer);
  if (!ts.isArrayLiteralExpression(initializer)) throw new Error(`${path}: TRAIBOX_API_ENDPOINTS must be an array literal`);
  return initializer.elements.map((element) => {
    const value = unwrapExpression(element as ts.Expression);
    if (!ts.isObjectLiteralExpression(value)) throw new Error(`${path}: catalog entry must be an object literal`);
    return {
      method: stringProperty(value, 'method') ?? '',
      path: stringProperty(value, 'path') ?? '',
      operationId: stringProperty(value, 'operation_id'),
      workspace: stringProperty(value, 'workspace'),
      auth: stringProperty(value, 'auth'),
      roles: stringArrayProperty(value, 'roles'),
      protectedAction: stringProperty(value, 'protected_action'),
      tags: stringArrayProperty(value, 'tags'),
      stability: stringProperty(value, 'stability')
    };
  });
}

function routeRoles(handler: ts.Node): string[] | undefined {
  let roles: string[] | undefined;
  const visit = (node: ts.Node) => {
    if (roles) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'requireRequestRole') {
        const argument = node.arguments[1] ? unwrapExpression(node.arguments[1]) : undefined;
        if (argument && ts.isArrayLiteralExpression(argument)) roles = argument.elements.filter(ts.isStringLiteralLike).map((entry) => entry.text);
      } else if (node.expression.text === 'requireOrgRole') {
        const argument = node.arguments[0] ? unwrapExpression(node.arguments[0]) : undefined;
        if (argument && ts.isObjectLiteralExpression(argument)) roles = stringArrayProperty(argument, 'allowed');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler);
  return roles;
}

export function normalizeApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\/+$/, '') || '/';
}

export function parseServerRoutes(root: string, path = 'apps/api/src/server.ts'): ServerRoute[] {
  const sourceFile = parseTypeScript(root, path);
  const routes: ServerRoute[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'app' &&
      ['get', 'post', 'put', 'patch', 'delete'].includes(node.expression.name.text)
    ) {
      const routePath = node.arguments[0];
      const handler = node.arguments.at(-1);
      if (routePath && ts.isStringLiteralLike(routePath) && handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        routes.push({
          method: node.expression.name.text.toUpperCase(),
          path: routePath.text,
          normalizedPath: normalizeApiPath(routePath.text),
          roles: routeRoles(handler),
          handlerText: handler.getText(sourceFile),
          source: path
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return routes;
}

function inferredAuth(route: ServerRoute): string {
  if (['/healthz', '/readyz', '/metrics', '/v1/api/catalog', '/v1/openapi.json'].includes(route.path)) return 'public';
  if (route.path.startsWith('/webhooks/')) return 'webhook';
  if (route.path.startsWith('/v1/partners/')) return 'partner';
  if (route.path.startsWith('/v1/external-participants/')) return 'external_participant';
  if (route.path.startsWith('/v1/orgs')) return 'user';
  return 'org_user';
}

function add(findings: ConformanceFinding[], rule: string, method: string, path: string, message: string, severity: ConformanceFinding['severity'] = 'medium'): void {
  const source = rule.startsWith('API_CATALOG') ? 'packages/contracts/src/index.ts' : 'apps/api/src/server.ts';
  findings.push({
    check: 'api-catalog-alignment',
    rule,
    message,
    source,
    severity,
    baselineKey: fingerprint(rule, method, normalizeApiPath(path), message)
  });
}

export function compareApiRoutes(catalog: CatalogRoute[], server: ServerRoute[], protectedEvidence: z.infer<typeof evidenceSchema>['entries'] = []): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const catalogMap = new Map<string, CatalogRoute[]>();
  const serverMap = new Map<string, ServerRoute[]>();
  const key = (method: string, path: string) => `${method.toUpperCase()} ${normalizeApiPath(path)}`;
  for (const route of catalog) catalogMap.set(key(route.method, route.path), [...(catalogMap.get(key(route.method, route.path)) ?? []), route]);
  for (const route of server) serverMap.set(key(route.method, route.normalizedPath), [...(serverMap.get(key(route.method, route.normalizedPath)) ?? []), route]);

  for (const [routeKey, routes] of catalogMap) {
    const route = routes[0]!;
    if (routes.length > 1) add(findings, 'API_CATALOG_DUPLICATE_ROUTE', route.method, route.path, `${routeKey} appears ${routes.length} times`, 'high');
    if (!serverMap.has(routeKey)) add(findings, 'API_CATALOG_ROUTE_MISSING_SERVER', route.method, route.path, `${routeKey} is catalogued but not registered by Fastify`, 'high');
    for (const field of ['operationId', 'workspace', 'auth', 'stability'] as const) if (!route[field]) add(findings, 'API_CATALOG_METADATA_MISSING', route.method, route.path, `${routeKey} is missing ${field}`, 'high');
    if (!route.tags?.length) add(findings, 'API_CATALOG_METADATA_MISSING', route.method, route.path, `${routeKey} is missing tags`, 'high');
  }
  for (const [routeKey, routes] of serverMap) {
    const route = routes[0]!;
    if (routes.length > 1) add(findings, 'API_SERVER_DUPLICATE_ROUTE', route.method, route.path, `${routeKey} is registered ${routes.length} times`, 'high');
    if (!catalogMap.has(routeKey)) add(findings, 'API_SERVER_ROUTE_MISSING_CATALOG', route.method, route.path, `${routeKey} is registered by Fastify but absent from TRAIBOX_API_ENDPOINTS`);
  }

  for (const [routeKey, catalogRoutes] of catalogMap) {
    const catalogRoute = catalogRoutes[0]!;
    const serverRoute = serverMap.get(routeKey)?.[0];
    if (!serverRoute) continue;
    if (catalogRoute.auth !== inferredAuth(serverRoute)) add(findings, 'API_AUTH_MISMATCH', catalogRoute.method, catalogRoute.path, `${routeKey} catalog auth=${catalogRoute.auth}; server boundary=${inferredAuth(serverRoute)}`);
    if (catalogRoute.roles) {
      if (!serverRoute.roles) add(findings, 'API_SERVER_ROLE_METADATA_MISSING', catalogRoute.method, catalogRoute.path, `${routeKey} declares roles in the catalog but has no statically visible role guard`);
      else if (sortedUnique(catalogRoute.roles).join('|') !== sortedUnique(serverRoute.roles).join('|')) {
        add(findings, 'API_ROLE_MISMATCH', catalogRoute.method, catalogRoute.path, `${routeKey} catalog roles=${sortedUnique(catalogRoute.roles).join(',')}; server roles=${sortedUnique(serverRoute.roles).join(',')}`);
      }
    }
  }

  const evidenceKeys = new Set<string>();
  for (const evidence of protectedEvidence) {
    const routeKey = key(evidence.method, evidence.path);
    if (evidenceKeys.has(routeKey)) add(findings, 'API_PROTECTED_EVIDENCE_DUPLICATE', evidence.method, evidence.path, `${routeKey} has duplicate protected-action evidence`, 'high');
    evidenceKeys.add(routeKey);
    const serverRoute = serverMap.get(routeKey)?.[0];
    if (!serverRoute) {
      add(findings, 'API_PROTECTED_EVIDENCE_ROUTE_MISSING', evidence.method, evidence.path, `${routeKey} protected-action evidence references no server route`, 'high');
      continue;
    }
    if (!serverRoute.handlerText.includes(evidence.handler_symbol)) add(findings, 'API_PROTECTED_EVIDENCE_STALE', evidence.method, evidence.path, `${routeKey} no longer references ${evidence.handler_symbol}`, 'high');
    const catalogRoute = catalogMap.get(routeKey)?.[0];
    if (!catalogRoute?.protectedAction) add(findings, 'API_PROTECTED_ACTION_ANNOTATION_MISSING', evidence.method, evidence.path, `${routeKey} executes ${evidence.protected_action} but lacks the catalog annotation`, 'high');
    else if (catalogRoute.protectedAction !== evidence.protected_action) add(findings, 'API_PROTECTED_ACTION_MISMATCH', evidence.method, evidence.path, `${routeKey} catalog action=${catalogRoute.protectedAction}; server evidence=${evidence.protected_action}`, 'high');
  }
  return findings;
}

export function findApiCatalogDiscrepancies(context: CheckContext): ConformanceFinding[] {
  const evidence = evidenceSchema.parse(readYaml(context.root, 'scripts/conformance/registries/api-server-evidence.yaml'));
  return compareApiRoutes(parseCatalogRoutes(context.root), parseServerRoutes(context.root), evidence.entries);
}

export async function runApiCatalogAlignmentCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  const raw = findApiCatalogDiscrepancies(context);
  const baseline = loadDebtBaseline(context.root, 'scripts/conformance/baselines/api-catalog-debt.json');
  const applied = applyDebtBaseline(raw, baseline.entries);
  for (const stale of applied.stale) {
    applied.unbaselined.push({
      check: 'api-catalog-alignment',
      rule: 'API_BASELINE_STALE',
      message: `remove remediated baseline entry ${stale.fingerprint} (${stale.rule})`,
      source: 'scripts/conformance/baselines/api-catalog-debt.json',
      severity: 'medium'
    });
  }
  return { check: 'api-catalog-alignment', findings: applied.unbaselined, baselined: applied.baselined };
}
