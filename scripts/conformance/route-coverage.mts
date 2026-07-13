import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { loadGovernanceDocuments } from './governance-schema.mts';
import { posixPath, repoPath, walkFiles } from './shared/repo.mts';

export type ActualRoute = { path: string; source: string };

export function routePathFromPage(sourceRoot: string, source: string): string {
  const relativeDirectory = posixPath(dirname(source).slice(sourceRoot.length)).replace(/^\/+/, '');
  const segments = relativeDirectory
    .split('/')
    .filter(Boolean)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .filter((segment) => !segment.startsWith('@'));
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

export function discoverRoutes(root: string, sourceRoot = 'apps/web/src/app'): ActualRoute[] {
  return walkFiles(root, sourceRoot, (path) => path.endsWith('/page.tsx') || path === `${sourceRoot}/page.tsx`).map((source) => ({
    path: routePathFromPage(sourceRoot, source),
    source
  }));
}

function add(findings: ConformanceFinding[], rule: string, message: string, source?: string): void {
  findings.push({ check: 'route-coverage', rule, message, source, severity: 'high' });
}

export function compareRoutes(actualRoutes: ActualRoute[], manifestRoutes: Array<{ actual_path: string; source: string; status: string }>): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const actualByPath = new Map<string, ActualRoute[]>();
  const manifestByPath = new Map<string, typeof manifestRoutes>();
  for (const route of actualRoutes) actualByPath.set(route.path, [...(actualByPath.get(route.path) ?? []), route]);
  for (const route of manifestRoutes) manifestByPath.set(route.actual_path, [...(manifestByPath.get(route.actual_path) ?? []), route]);

  for (const [path, routes] of actualByPath) {
    if (routes.length > 1) add(findings, 'ROUTE_ACTUAL_DUPLICATE', `${path} is implemented by ${routes.map((route) => route.source).join(', ')}`, routes[0]?.source);
    if (!manifestByPath.has(path)) add(findings, 'ROUTE_ACTUAL_MISSING_MANIFEST', `actual route ${path} is absent from route-manifest.yaml`, routes[0]?.source);
  }
  for (const [path, routes] of manifestByPath) {
    if (routes.length > 1) add(findings, 'ROUTE_MANIFEST_DUPLICATE', `${path} is declared ${routes.length} times`, 'docs/governance/route-manifest.yaml');
    if (!actualByPath.has(path)) add(findings, 'ROUTE_MANIFEST_MISSING_ACTUAL', `manifest route ${path} has no page.tsx implementation`, routes[0]?.source);
  }
  for (const route of manifestRoutes) {
    const actual = actualByPath.get(route.actual_path)?.[0];
    if (actual && actual.source !== route.source) add(findings, 'ROUTE_SOURCE_MISMATCH', `${route.actual_path} declares ${route.source} but is implemented at ${actual.source}`, route.source);
  }
  return findings;
}

export function checkRouteCoverage(context: CheckContext): ConformanceFinding[] {
  const { routes } = loadGovernanceDocuments(context.root);
  const findings = compareRoutes(discoverRoutes(context.root, routes.source_root), routes.routes);
  for (const route of routes.routes) {
    if (!existsSync(repoPath(context.root, route.source))) add(findings, 'ROUTE_SOURCE_MISSING', `route source does not exist: ${route.source}`, route.source);
  }
  return findings;
}

export async function runRouteCoverageCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  return { check: 'route-coverage', findings: checkRouteCoverage(context), baselined: [] };
}
