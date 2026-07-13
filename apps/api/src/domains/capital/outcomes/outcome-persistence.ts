import type { ClientBase } from 'pg';
import { z } from 'zod';
import type { FinancialCalculationRun } from '@traibox/contracts';
import { persistCalculationRun } from '../calculations/calculation-run-persistence';

/**
 * Outcome execution persistence (Phase 4 §D8).
 *
 * Runs inside a caller-owned authenticated RLS-scoped transaction. Persists
 * ONE Trade-Brain outcome result as: the agent_outcomes row (status =
 * persisted_status; draft outcomes are review-ready, never auto-finalised),
 * append-only calculation runs (through the Part B audit adapter — hashes are
 * independently re-verified), the evidence bundle + typed claims (brain claim
 * ids remapped to database uuids with contradiction links preserved), and the
 * immutable artifact version where the outcome produced one. Touches ZERO
 * canonical Finance state.
 */

export class OutcomePersistenceError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const outcomeResultSchema = z
  .object({
    contract_version: z.literal('capital-outcome-result-v1'),
    outcome_type: z.string().min(1),
    definition_version: z.string().min(1),
    execution_status: z.enum(['completed', 'needs_information', 'abstained', 'failed']),
    persisted_status: z.enum(['draft_ready', 'needs_information', 'abstained', 'failed']),
    organization_id: z.string().uuid(),
    principal_id: z.string().uuid(),
    principal_type: z.enum(['company', 'financier', 'platform_internal']),
    mandate_id: z.string().uuid(),
    mandate_version: z.number().int().positive(),
    task_id: z.string().uuid(),
    objective: z.string().min(1),
    evidence: z.object({ claims: z.array(z.record(z.unknown())) }),
    calculation_drafts: z.array(z.record(z.unknown())),
    calculations: z.array(z.record(z.unknown())),
    composed: z.record(z.unknown()),
    recommendation: z.record(z.unknown()).nullable(),
    artifact: z.record(z.unknown()).nullable(),
    unresolved_questions: z.array(z.string()),
    contradictions: z.array(z.string()),
    targeted_questions: z.array(z.string()),
    confidence: z.enum(['high', 'medium', 'low']),
    policy_violations: z.array(z.record(z.unknown())),
    replay_events: z.array(z.record(z.unknown())),
    synthesis_source: z.string(),
    injection_findings: z.array(z.string()),
    abstention_reason: z.string().nullable().optional(),
    trace_id: z.string().min(1),
    idempotency_key: z.string().min(1)
  })
  .passthrough();

export type CapitalOutcomeResult = z.infer<typeof outcomeResultSchema>;

export interface PersistedOutcome {
  outcome_id: string;
  status: string;
  task_status: string | null;
  evidence_bundle_id: string | null;
  claim_ids: string[];
  calculation_runs: FinancialCalculationRun[];
  artifact_id: string | null;
  artifact_version_id: string | null;
  artifact_version: number | null;
  /** True when this call returned an already-persisted execution (exact
   * idempotent replay on the first-class (org_id, idempotency_key)). */
  replayed: boolean;
}

/** Outcome persisted_status → canonical task status (Phase 4.1 §4):
 * draft_ready/abstained finish the task; needs_information awaits input;
 * a failed execution result blocks the task with a typed record. */
export function taskStatusForOutcome(persistedStatus: string): string {
  if (persistedStatus === 'needs_information') return 'pending_input';
  if (persistedStatus === 'failed') return 'blocked';
  return 'completed';
}

interface BrainClaim {
  claim_id: string;
  claim_type: string;
  statement: string;
  source_refs: unknown[];
  calculation_ref: { run_idempotency_key: string } | null;
  visibility_scope: string;
  confidence: string;
  verification_status: string;
  materiality: string;
  as_of: string | null;
  contradicts_claim_ids: string[];
}

/** The outcome authority persisted on the artifact: the definition's
 * requirement is not shipped in the result, so record the recommendation
 * presence honestly — recommend when one exists, analyse otherwise. */
function artifactAuthority(result: CapitalOutcomeResult): string {
  return result.recommendation ? 'recommend' : 'analyse';
}

export async function persistOutcomeExecution(
  client: ClientBase,
  rawResult: unknown,
  options: { actorUserId?: string | null; requestHash?: string | null; executionHash?: string | null; finalizeTaskId?: string | null } = {}
): Promise<PersistedOutcome> {
  const result = outcomeResultSchema.parse(rawResult);

  const context = await client.query<{ org_id: string | null }>('SELECT app.current_org()::text AS org_id');
  if ((context.rows[0]?.org_id ?? null) !== result.organization_id) {
    throw new OutcomePersistenceError('outcome.rls_context_mismatch', 'transaction RLS organization does not match the outcome result', {
      context_org: context.rows[0]?.org_id ?? null,
      result_org: result.organization_id
    });
  }

  // 1. Atomic insert on the first-class exact idempotency key. A concurrent
  //    duplicate hits ON CONFLICT DO NOTHING and returns the EXISTING record
  //    (exact replay); a same-key insert with a different semantic request
  //    hash is an explicit conflict, never an overwrite.
  const outcome = await client.query<{ outcome_id: string }>(
    `INSERT INTO agent_outcomes(
       outcome_type, definition_version, task_id, org_id, principal_id, principal_type,
       mandate_id, mandate_version, status, idempotency_key, request_hash, execution_hash,
       inputs_json, unresolved_questions_json, recommendations_json, authority_level, trace_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17)
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING outcome_id`,
    [
      result.outcome_type,
      result.definition_version,
      result.task_id,
      result.organization_id,
      result.principal_id,
      result.principal_type,
      result.mandate_id,
      result.mandate_version,
      result.persisted_status,
      result.idempotency_key,
      options.requestHash ?? null,
      options.executionHash ?? null,
      JSON.stringify({
        objective: result.objective,
        idempotency_key: result.idempotency_key,
        execution_status: result.execution_status,
        confidence: result.confidence,
        synthesis_source: result.synthesis_source,
        provisional: result.provisional ?? false,
        evidence_coverage: result.evidence_coverage ?? {},
        trust_notes: result.trust_notes ?? [],
        targeted_questions: result.targeted_questions,
        contradictions: result.contradictions,
        injection_findings: result.injection_findings,
        abstention_reason: result.abstention_reason ?? null,
        composed: result.composed,
        replay_events: result.replay_events
      }),
      JSON.stringify(result.unresolved_questions),
      JSON.stringify(result.recommendation ? [result.recommendation] : []),
      artifactAuthority(result),
      result.trace_id
    ]
  );
  const insertedOutcomeId = outcome.rows[0]?.outcome_id;
  if (!insertedOutcomeId) {
    const existing = await client.query<{ outcome_id: string; status: string; request_hash: string | null; evidence_bundle_id: string | null; artifact_ids_json: string[] }>(
      `SELECT outcome_id, status, request_hash, evidence_bundle_id, artifact_ids_json
       FROM agent_outcomes WHERE org_id = $1 AND idempotency_key = $2`,
      [result.organization_id, result.idempotency_key]
    );
    const existingRow = existing.rows[0];
    if (!existingRow) throw new OutcomePersistenceError('outcome.idempotency_lookup_failed', 'insert conflicted but the existing outcome could not be read', {});
    if (options.requestHash && existingRow.request_hash && existingRow.request_hash !== options.requestHash) {
      throw new OutcomePersistenceError('outcome.idempotency_conflict', 'idempotency key was already used for a materially different outcome execution', {
        outcome_id: existingRow.outcome_id,
        idempotency_key: result.idempotency_key
      });
    }
    const existingArtifactId = existingRow.artifact_ids_json[0] ?? null;
    const existingVersion = existingArtifactId
      ? await client.query<{ artifact_version_id: string; version: number }>(
          `SELECT artifact_version_id, version FROM capital_artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1`,
          [existingArtifactId]
        )
      : null;
    return {
      outcome_id: existingRow.outcome_id,
      status: existingRow.status,
      task_status: null,
      evidence_bundle_id: existingRow.evidence_bundle_id,
      claim_ids: [],
      calculation_runs: [],
      artifact_id: existingArtifactId,
      artifact_version_id: existingVersion?.rows[0]?.artifact_version_id ?? null,
      artifact_version: existingVersion?.rows[0]?.version ?? null,
      replayed: true
    };
  }
  const outcomeId = insertedOutcomeId;

  // 2. Calculation runs through the Part B audit adapter (hash re-verification).
  const runs: FinancialCalculationRun[] = [];
  const runIdByIdempotency = new Map<string, string>();
  for (const draft of result.calculation_drafts) {
    const bound = { ...draft, outcome_id: outcomeId, actor_user_id: options.actorUserId ?? null };
    const run = await persistCalculationRun(client, bound);
    runs.push(run);
    runIdByIdempotency.set(run.idempotency_key, run.run_id);
  }

  // 3. Evidence bundle + claims (brain claim ids → database uuids).
  const bundle = await client.query<{ bundle_id: string }>(
    `INSERT INTO evidence_bundles(org_id, principal_id, principal_type, task_id, outcome_id, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING bundle_id`,
    [result.organization_id, result.principal_id, result.principal_type, result.task_id, outcomeId, result.trace_id]
  );
  const bundleId = bundle.rows[0]?.bundle_id ?? null;
  const claimUuidByBrainId = new Map<string, string>();
  const claims = result.evidence.claims as unknown as BrainClaim[];
  for (const claim of claims) {
    const runIds = claim.calculation_ref ? [runIdByIdempotency.get(claim.calculation_ref.run_idempotency_key)].filter(Boolean) : [];
    if (claim.calculation_ref && runIds.length === 0) {
      throw new OutcomePersistenceError('outcome.calculation_claim_unlinked', 'a calculation claim references a run that was not persisted', {
        claim_id: claim.claim_id,
        run_idempotency_key: claim.calculation_ref.run_idempotency_key
      });
    }
    const inserted = await client.query<{ claim_id: string }>(
      `INSERT INTO evidence_claims(
         bundle_id, org_id, principal_id, principal_type, claim_type, statement,
         structured_value_json, source_refs_json, visibility_scope, as_of, confidence,
         verification_status, materiality, calculation_run_ids_json, contradicts_claim_ids_json
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)
       RETURNING claim_id`,
      [
        bundleId,
        result.organization_id,
        result.principal_id,
        result.principal_type,
        claim.claim_type,
        claim.statement,
        claim.calculation_ref ? JSON.stringify(claim.calculation_ref) : null,
        JSON.stringify([...claim.source_refs, { source_type: 'brain_claim_id', detail: claim.claim_id }]),
        claim.visibility_scope === 'platform_internal' ? 'principal' : claim.visibility_scope,
        claim.as_of ?? null,
        claim.confidence,
        claim.verification_status,
        claim.materiality,
        JSON.stringify(runIds),
        JSON.stringify(claim.contradicts_claim_ids.map((brainId) => claimUuidByBrainId.get(brainId) ?? brainId))
      ]
    );
    const claimId = inserted.rows[0]?.claim_id;
    if (claimId) claimUuidByBrainId.set(claim.claim_id, claimId);
  }

  // 4. Immutable artifact version (structured-first content).
  let artifactId: string | null = null;
  let artifactVersionId: string | null = null;
  let artifactVersion: number | null = null;
  if (result.artifact) {
    const artifact = result.artifact as Record<string, unknown>;
    const artifactRow = await client.query<{ artifact_id: string }>(
      `INSERT INTO capital_artifacts(
         artifact_type, org_id, principal_id, principal_type, mandate_id, mandate_version,
         outcome_id, task_id, title, status, authority_level, trace_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'review_ready', $10, $11)
       RETURNING artifact_id`,
      [
        artifact.artifact_type,
        result.organization_id,
        result.principal_id,
        result.principal_type,
        result.mandate_id,
        result.mandate_version,
        outcomeId,
        result.task_id,
        String(artifact.title ?? result.objective).slice(0, 300),
        artifactAuthority(result),
        result.trace_id
      ]
    );
    artifactId = artifactRow.rows[0]?.artifact_id ?? null;
    if (artifactId) {
      const versionRow = await client.query<{ artifact_version_id: string; version: number }>(
        `INSERT INTO capital_artifact_versions(
           artifact_id, org_id, principal_id, principal_type, version, schema_version,
           content_json, evidence_bundle_id, calculation_run_ids_json, unresolved_questions_json, generated_by_json
         ) VALUES ($1, $2, $3, $4, 1, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb)
         RETURNING artifact_version_id, version`,
        [
          artifactId,
          result.organization_id,
          result.principal_id,
          result.principal_type,
          artifact.schema_version ?? 'capital-artifact-v1',
          JSON.stringify(artifact),
          bundleId,
          JSON.stringify(runs.map((run) => run.run_id)),
          JSON.stringify(result.unresolved_questions),
          JSON.stringify(artifact.generated_by ?? {})
        ]
      );
      artifactVersionId = versionRow.rows[0]?.artifact_version_id ?? null;
      artifactVersion = versionRow.rows[0]?.version ?? null;
    }
  }

  // 5. Close the loop on the outcome row (linkage columns; status unchanged).
  await client.query(
    `UPDATE agent_outcomes
     SET evidence_bundle_id = $2,
         calculation_run_ids_json = $3::jsonb,
         artifact_ids_json = $4::jsonb,
         contradiction_claim_ids_json = $5::jsonb,
         updated_at = now()
     WHERE outcome_id = $1`,
    [
      outcomeId,
      bundleId,
      JSON.stringify(runs.map((run) => run.run_id)),
      JSON.stringify(artifactId ? [artifactId] : []),
      JSON.stringify(
        claims
          .filter((claim) => claim.claim_type === 'contradiction')
          .map((claim) => claimUuidByBrainId.get(claim.claim_id))
          .filter(Boolean)
      )
    ]
  );

  // 6. Finalize the task ATOMICALLY with the outcome (Phase 4.1 §4): the
  //    task's terminal status, result references, and replay linkage commit
  //    or roll back together with everything above.
  let taskStatus: string | null = null;
  if (options.finalizeTaskId) {
    taskStatus = taskStatusForOutcome(result.persisted_status);
    await client.query(
      `UPDATE alpha_agent_tasks
       SET status = $2,
           outcome_id = $3,
           result_json = result_json || $4::jsonb,
           replay_log_json = $5::jsonb,
           updated_at = now()
       WHERE agent_task_id = $1 AND org_id = $6`,
      [
        options.finalizeTaskId,
        taskStatus,
        outcomeId,
        JSON.stringify({
          outcome_id: outcomeId,
          outcome_status: result.persisted_status,
          execution_status: result.execution_status,
          execution_hash: options.executionHash ?? null,
          evidence_bundle_id: bundleId,
          artifact_id: artifactId,
          calculation_run_ids: runs.map((run) => run.run_id),
          trace_id: result.trace_id
        }),
        JSON.stringify(result.replay_events),
        result.organization_id
      ]
    );
  }

  return {
    outcome_id: outcomeId,
    status: result.persisted_status,
    task_status: taskStatus,
    evidence_bundle_id: bundleId,
    claim_ids: [...claimUuidByBrainId.values()],
    calculation_runs: runs,
    artifact_id: artifactId,
    artifact_version_id: artifactVersionId,
    artifact_version: artifactVersion,
    replayed: false
  };
}

/**
 * Load the COMPLETE persisted response for an exact replay (Phase 4.1 §10):
 * the original calculation-run ids, evidence bundle, artifact + latest
 * version, recommendation, questions, contradictions, coverage, confidence,
 * synthesis source, and both statuses. The caller adds request-scoped fields
 * (task_id, request_hash, trace_id, replayed).
 */
export async function loadOutcomeResponseData(
  client: ClientBase,
  input: { orgId: string; idempotencyKey: string }
): Promise<null | {
  task_status: string;
  outcome_id: string;
  status: string;
  execution_status: string;
  confidence: string;
  synthesis_source: string;
  provisional: boolean;
  evidence_coverage: Record<string, string>;
  trust_notes: string[];
  unresolved_questions: string[];
  targeted_questions: string[];
  contradictions: string[];
  recommendation: Record<string, unknown> | null;
  artifact_id: string | null;
  artifact_version: number | null;
  calculation_run_ids: string[];
  evidence_bundle_id: string | null;
  execution_hash: string | null;
}> {
  const row = await client.query(
    `SELECT o.outcome_id, o.status, o.execution_hash, o.evidence_bundle_id, o.task_id,
            o.inputs_json, o.unresolved_questions_json, o.recommendations_json,
            o.calculation_run_ids_json, o.artifact_ids_json,
            t.status AS task_status
     FROM agent_outcomes o
     LEFT JOIN alpha_agent_tasks t ON t.agent_task_id = o.task_id
     WHERE o.org_id = $1 AND o.idempotency_key = $2`,
    [input.orgId, input.idempotencyKey]
  );
  const outcome = row.rows[0];
  if (!outcome) return null;
  const inputs = outcome.inputs_json as Record<string, unknown>;
  const artifactId = (outcome.artifact_ids_json as string[])[0] ?? null;
  const artifactVersion = artifactId
    ? await client.query<{ version: number }>(`SELECT version FROM capital_artifact_versions WHERE artifact_id = $1 ORDER BY version DESC LIMIT 1`, [artifactId])
    : null;
  return {
    task_status: (outcome.task_status as string) ?? 'completed',
    outcome_id: outcome.outcome_id,
    status: outcome.status,
    execution_status: String(inputs.execution_status ?? 'completed'),
    confidence: String(inputs.confidence ?? 'medium'),
    synthesis_source: String(inputs.synthesis_source ?? 'deterministic'),
    provisional: Boolean(inputs.provisional ?? false),
    evidence_coverage: (inputs.evidence_coverage as Record<string, string>) ?? {},
    trust_notes: (inputs.trust_notes as string[]) ?? [],
    unresolved_questions: (outcome.unresolved_questions_json as string[]) ?? [],
    targeted_questions: (inputs.targeted_questions as string[]) ?? [],
    contradictions: (inputs.contradictions as string[]) ?? [],
    recommendation: ((outcome.recommendations_json as Array<Record<string, unknown>>) ?? [])[0] ?? null,
    artifact_id: artifactId,
    artifact_version: artifactVersion?.rows[0]?.version ?? null,
    calculation_run_ids: (outcome.calculation_run_ids_json as string[]) ?? [],
    evidence_bundle_id: outcome.evidence_bundle_id,
    execution_hash: outcome.execution_hash ?? null
  };
}
