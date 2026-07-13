import { z } from 'zod';
import type { CheckContext, ConformanceFinding } from './shared/types.mts';
import { parseYamlText, pathExists, readYaml, repoPath, sortedUnique } from './shared/repo.mts';

export const GOVERNANCE_STATUSES = ['CANONICAL', 'APPROVED', 'REVIEW', 'SUPERSEDED', 'ARCHIVED', 'PENDING_IMPORT'] as const;
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export const ROUTE_STATUSES = ['canonical', 'nested', 'redirect_candidate', 'internal', 'external_portal', 'deprecated', 'unresolved'] as const;
export const RELEASE_GATES = ['blocks_real_value_execution'] as const;
export const PILOT_GATES = ['blocks_any_pilot_path_that_can_reach_this_endpoint'] as const;

const governanceStatus = z.enum(GOVERNANCE_STATUSES);
const severity = z.enum(SEVERITIES);
const nonEmpty = z.string().min(1);
const pathString = z.string().min(1);
const stringList = z.array(nonEmpty);

const activationSchema = z
  .object({
    status_semantics: z.literal('intended_post_approval'),
    effective_when: z.literal('merged_to_main_by_repository_owner'),
    approval_record: nonEmpty,
    draft_branch_authority: z.literal(false),
    rule: nonEmpty
  })
  .strict();

const sourceOfTruthSchema = z
  .object({
    schema_version: z.literal(1),
    governance_id: nonEmpty,
    status: governanceStatus,
    owner: nonEmpty,
    last_reviewed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    activation: activationSchema,
    allowed_statuses: z.array(governanceStatus),
    rules: z
      .object({
        implementation_authority: z.array(governanceStatus),
        non_authoritative: z.array(governanceStatus),
        activation_exception: nonEmpty,
        missing_source: nonEmpty,
        repository_reality: nonEmpty,
        status_interpretation: nonEmpty
      })
      .strict(),
    precedence: z.array(
      z
        .object({
          rank: z.number().int().positive(),
          id: nonEmpty,
          title: nonEmpty,
          status: governanceStatus,
          path: z.union([pathString, z.null()]).optional(),
          paths: z.array(pathString).min(1).optional(),
          dependency: nonEmpty.optional(),
          scope: nonEmpty.optional()
        })
        .strict()
        .superRefine((entry, context) => {
          if (entry.path !== undefined && entry.paths !== undefined) context.addIssue({ code: 'custom', message: 'use path or paths, not both' });
          if (entry.status === 'PENDING_IMPORT' && entry.path !== null) context.addIssue({ code: 'custom', message: 'PENDING_IMPORT precedence entries require path: null' });
        })
    ),
    repository_governance: z.array(
      z.object({ id: nonEmpty, path: pathString, status: governanceStatus, scope: nonEmpty }).strict()
    ),
    repository_documents: z.array(
      z
        .object({
          id: nonEmpty,
          path: pathString.optional(),
          paths: z.array(pathString).min(1).optional(),
          status: governanceStatus,
          reason: nonEmpty.optional(),
          scope: nonEmpty.optional()
        })
        .strict()
        .superRefine((entry, context) => {
          if (Boolean(entry.path) === Boolean(entry.paths)) context.addIssue({ code: 'custom', message: 'exactly one of path or paths is required' });
          if (!entry.reason && !entry.scope) context.addIssue({ code: 'custom', message: 'reason or scope is required' });
        })
    ),
    pull_request_exclusions: z.array(
      z.object({ pull_request: z.number().int().positive(), status: governanceStatus, authority: z.boolean(), rule: nonEmpty }).strict()
    ),
    c0_2_sequencing: z
      .object({
        structural_conformance: z.object({ gate: nonEmpty, scope: stringList }).strict(),
        semantic_conformance: z.object({ gate: nonEmpty, required_sources: stringList, scope: stringList }).strict(),
        non_inference_rule: nonEmpty
      })
      .strict()
  })
  .strict();

const routeManifestSchema = z
  .object({
    schema_version: z.literal(1),
    manifest_id: nonEmpty,
    status: governanceStatus,
    observed_at_commit: z.string().regex(/^[0-9a-f]{40}$/),
    source_root: pathString,
    allowed_route_statuses: z.array(z.enum(ROUTE_STATUSES)),
    screen_contract_statuses: z
      .object({ review_copy: nonEmpty, missing: nonEmpty, not_applicable: nonEmpty })
      .strict(),
    new_route_gate: z.object({ required: stringList }).strict(),
    routes: z.array(
      z
        .object({
          actual_path: z.string().startsWith('/'),
          intended_canonical_path: z.union([z.string().startsWith('/'), z.null()]),
          owning_workspace: nonEmpty,
          audience: stringList,
          status: z.enum(ROUTE_STATUSES),
          screen_contract_status: z.enum(['review_copy', 'missing', 'not_applicable']),
          authentication_expectation: nonEmpty,
          source: pathString,
          navigation_exposure: nonEmpty,
          notes: nonEmpty,
          compatibility_disposition: nonEmpty
        })
        .strict()
    ),
    discovered_inconsistencies: z.array(z.object({ id: nonEmpty, severity, summary: nonEmpty }).strict())
  })
  .strict();

const protectedActionsSchema = z
  .object({
    schema_version: z.literal(1),
    manifest_id: nonEmpty,
    status: governanceStatus,
    observed_at_commit: z.string().regex(/^[0-9a-f]{40}$/),
    identifier_source: nonEmpty,
    governance_rule: nonEmpty,
    actions: z.array(
      z
        .object({
          identifier: nonEmpty,
          owning_domain: nonEmpty,
          severity: severity.optional(),
          release_gate: z.enum(RELEASE_GATES).optional(),
          pilot_gate: z.enum(PILOT_GATES).optional(),
          required_remediation: nonEmpty.optional(),
          initiating_roles: stringList,
          approval_requirement: z.union([nonEmpty, z.literal('required')]),
          idempotency_requirement: nonEmpty,
          independent_validation_requirement: nonEmpty,
          audit_requirement: z.literal('required'),
          implementation_locations: z.array(pathString),
          test_coverage: z.array(pathString),
          confidence: z.enum(['low', 'medium', 'high']),
          unresolved_questions: stringList
        })
        .strict()
        .superRefine((entry, context) => {
          const gateFields = [entry.severity, entry.release_gate, entry.pilot_gate, entry.required_remediation];
          const present = gateFields.filter((value) => value !== undefined).length;
          if (present > 0 && present < gateFields.length) context.addIssue({ code: 'custom', message: 'critical gate metadata must be complete' });
        })
    ),
    discrepancies: z.array(
      z
        .object({
          id: nonEmpty,
          severity,
          release_gate: z.enum(RELEASE_GATES).optional(),
          pilot_gate: z.enum(PILOT_GATES).optional(),
          summary: nonEmpty
        })
        .strict()
        .superRefine((entry, context) => {
          if (entry.severity === 'critical' && (!entry.release_gate || !entry.pilot_gate)) {
            context.addIssue({ code: 'custom', message: 'critical discrepancies require release_gate and pilot_gate' });
          }
        })
    )
  })
  .strict();

const statusSourceSchema = z
  .object({
    values: z.union([stringList, nonEmpty]).optional(),
    observed_values: stringList.optional(),
    source: pathString.optional(),
    sources: z.array(pathString).optional(),
    enforcement: nonEmpty.optional()
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.values === undefined && entry.observed_values === undefined) context.addIssue({ code: 'custom', message: 'values or observed_values is required' });
    if (!entry.source && !entry.sources) context.addIssue({ code: 'custom', message: 'source or sources is required' });
  });

const statusVocabularySchema = z
  .object({
    schema_version: z.literal(1),
    manifest_id: nonEmpty,
    status: governanceStatus,
    observed_at_commit: z.string().regex(/^[0-9a-f]{40}$/),
    rule: nonEmpty,
    governance_document_statuses: z.object({ values: stringList, owner: pathString, aliases: stringList, deprecated: stringList }).strict(),
    trade_lifecycle_statuses: z
      .object({
        trade_plan: statusSourceSchema,
        trade_record: statusSourceSchema,
        generic_trade_objects: statusSourceSchema,
        aliases: stringList,
        stale_or_unowned: stringList
      })
      .strict(),
    readiness_statuses: z
      .object({ overall: statusSourceSchema, requirement: statusSourceSchema, network_trust: statusSourceSchema, runtime_and_eval: statusSourceSchema, aliases: stringList, collisions: stringList })
      .strict(),
    approval_statuses: z
      .object({ approval_object: statusSourceSchema, approval_chain_step: statusSourceSchema, decision_command: statusSourceSchema, aliases: stringList, collisions: stringList })
      .strict(),
    agent_task_statuses: z
      .object({ task_object: statusSourceSchema, persisted_runtime_task: statusSourceSchema, human_decision: statusSourceSchema, collisions: stringList })
      .strict(),
    payment_statuses: z.object({ canonical_payment: statusSourceSchema, provider_iso_status: statusSourceSchema, aliases: stringList, collisions: stringList }).strict(),
    funding_statuses: z
      .object({ offer_request: statusSourceSchema, offer_response: statusSourceSchema, reservation: statusSourceSchema, funding_object: statusSourceSchema, aliases: stringList, stale_or_unowned: stringList })
      .strict(),
    clearance_statuses: z
      .object({ compliance_check: statusSourceSchema, clearance_requirement: statusSourceSchema, clearance_object: statusSourceSchema, ui_only_or_competing: statusSourceSchema, collisions: stringList })
      .strict(),
    unresolved_competing_terminology: z.array(z.object({ id: nonEmpty, severity, issue: nonEmpty, required_decision: nonEmpty }).strict())
  })
  .strict();

export type SourceOfTruth = z.infer<typeof sourceOfTruthSchema>;
export type RouteManifest = z.infer<typeof routeManifestSchema>;
export type ProtectedActionsManifest = z.infer<typeof protectedActionsSchema>;
export type StatusVocabulary = z.infer<typeof statusVocabularySchema>;

export type GovernanceDocuments = {
  sourceOfTruth: SourceOfTruth;
  routes: RouteManifest;
  protectedActions: ProtectedActionsManifest;
  statuses: StatusVocabulary;
};

const DOCUMENTS = [
  ['sourceOfTruth', 'docs/governance/source-of-truth.yaml', sourceOfTruthSchema],
  ['routes', 'docs/governance/route-manifest.yaml', routeManifestSchema],
  ['protectedActions', 'docs/governance/protected-actions.yaml', protectedActionsSchema],
  ['statuses', 'docs/governance/status-vocabulary.yaml', statusVocabularySchema]
] as const;

export function validateGovernanceYaml(kind: 'sourceOfTruth' | 'routes' | 'protectedActions' | 'statuses', text: string): string[] {
  const document = DOCUMENTS.find(([key]) => key === kind);
  if (!document) return [`unknown governance document kind: ${kind}`];
  try {
    const result = document[2].safeParse(parseYamlText(text, `<fixture:${kind}>`));
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated].sort();
}

function finding(rule: string, message: string, source: string): ConformanceFinding {
  return { check: 'governance-schema', rule, message, source, severity: 'high' };
}

export function loadGovernanceDocuments(root: string): GovernanceDocuments {
  const parsed: Partial<GovernanceDocuments> = {};
  for (const [key, path, schema] of DOCUMENTS) {
    (parsed as Record<string, unknown>)[key] = schema.parse(readYaml(root, path));
  }
  return parsed as GovernanceDocuments;
}

export function checkGovernanceSchemas(context: CheckContext): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const parsed: Partial<GovernanceDocuments> = {};
  for (const [key, path, schema] of DOCUMENTS) {
    try {
      (parsed as Record<string, unknown>)[key] = schema.parse(readYaml(context.root, path));
    } catch (error) {
      findings.push(finding('GOV_SCHEMA_INVALID', error instanceof Error ? error.message : String(error), path));
    }
  }
  if (findings.length > 0) return findings;

  const documents = parsed as GovernanceDocuments;
  if (sortedUnique(documents.sourceOfTruth.allowed_statuses).join('|') !== [...GOVERNANCE_STATUSES].sort().join('|')) {
    findings.push(finding('GOV_ALLOWED_STATUS_SET', 'source-of-truth allowed_statuses must exactly match the constitutional vocabulary', 'docs/governance/source-of-truth.yaml'));
  }
  const uniqueChecks: Array<[string, string[], string]> = [
    ['GOV_PRECEDENCE_ID_UNIQUE', documents.sourceOfTruth.precedence.map((entry) => entry.id), 'docs/governance/source-of-truth.yaml'],
    ['GOV_PRECEDENCE_RANK_UNIQUE', documents.sourceOfTruth.precedence.map((entry) => String(entry.rank)), 'docs/governance/source-of-truth.yaml'],
    ['GOV_GOVERNANCE_ID_UNIQUE', documents.sourceOfTruth.repository_governance.map((entry) => entry.id), 'docs/governance/source-of-truth.yaml'],
    ['GOV_DOCUMENT_ID_UNIQUE', documents.sourceOfTruth.repository_documents.map((entry) => entry.id), 'docs/governance/source-of-truth.yaml'],
    ['GOV_ROUTE_PATH_UNIQUE', documents.routes.routes.map((entry) => entry.actual_path), 'docs/governance/route-manifest.yaml'],
    ['GOV_ROUTE_SOURCE_UNIQUE', documents.routes.routes.map((entry) => entry.source), 'docs/governance/route-manifest.yaml'],
    ['GOV_ROUTE_FINDING_ID_UNIQUE', documents.routes.discovered_inconsistencies.map((entry) => entry.id), 'docs/governance/route-manifest.yaml'],
    ['GOV_ACTION_ID_UNIQUE', documents.protectedActions.actions.map((entry) => entry.identifier), 'docs/governance/protected-actions.yaml'],
    ['GOV_ACTION_FINDING_ID_UNIQUE', documents.protectedActions.discrepancies.map((entry) => entry.id), 'docs/governance/protected-actions.yaml'],
    ['GOV_STATUS_FINDING_ID_UNIQUE', documents.statuses.unresolved_competing_terminology.map((entry) => entry.id), 'docs/governance/status-vocabulary.yaml']
  ];
  for (const [rule, values, source] of uniqueChecks) {
    const repeated = duplicates(values);
    if (repeated.length > 0) findings.push(finding(rule, `duplicate values: ${repeated.join(', ')}`, source));
  }
  if (sortedUnique(documents.routes.allowed_route_statuses).join('|') !== [...ROUTE_STATUSES].sort().join('|')) {
    findings.push(finding('GOV_ROUTE_STATUS_SET', 'allowed_route_statuses must exactly match the C0.1 route status vocabulary', 'docs/governance/route-manifest.yaml'));
  }

  const pathReferences: Array<[string, string]> = [];
  for (const entry of documents.sourceOfTruth.precedence) {
    if (entry.path) pathReferences.push(['docs/governance/source-of-truth.yaml', entry.path]);
    for (const path of entry.paths ?? []) pathReferences.push(['docs/governance/source-of-truth.yaml', path]);
  }
  for (const entry of documents.sourceOfTruth.repository_governance) pathReferences.push(['docs/governance/source-of-truth.yaml', entry.path]);
  for (const entry of documents.sourceOfTruth.repository_documents) {
    if (entry.path) pathReferences.push(['docs/governance/source-of-truth.yaml', entry.path]);
    for (const path of entry.paths ?? []) pathReferences.push(['docs/governance/source-of-truth.yaml', path]);
  }
  pathReferences.push(['docs/governance/route-manifest.yaml', documents.routes.source_root]);
  for (const entry of documents.routes.routes) pathReferences.push(['docs/governance/route-manifest.yaml', entry.source]);
  pathReferences.push(['docs/governance/protected-actions.yaml', documents.protectedActions.identifier_source]);
  for (const entry of documents.protectedActions.actions) {
    for (const path of [...entry.implementation_locations, ...entry.test_coverage]) pathReferences.push(['docs/governance/protected-actions.yaml', path]);
  }
  const visitStatusSources = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'source' || key === 'owner') && typeof child === 'string') pathReferences.push(['docs/governance/status-vocabulary.yaml', child]);
      else if (key === 'sources' && Array.isArray(child)) for (const source of child) if (typeof source === 'string') pathReferences.push(['docs/governance/status-vocabulary.yaml', source]);
      else visitStatusSources(child);
    }
  };
  visitStatusSources(documents.statuses);
  for (const [source, reference] of pathReferences) {
    if (!pathExists(context.root, reference)) findings.push(finding('GOV_REFERENCED_PATH_MISSING', `referenced path does not exist: ${reference}`, source));
  }

  if (!repoPath(context.root, documents.routes.source_root).startsWith(repoPath(context.root, 'apps/web/src/app'))) {
    findings.push(finding('GOV_ROUTE_SOURCE_ROOT_INVALID', 'route source_root must remain under apps/web/src/app', 'docs/governance/route-manifest.yaml'));
  }
  return findings;
}

export async function runGovernanceSchemaCheck(context: CheckContext): Promise<{ check: string; findings: ConformanceFinding[]; baselined: ConformanceFinding[] }> {
  return { check: 'governance-schema', findings: checkGovernanceSchemas(context), baselined: [] };
}
