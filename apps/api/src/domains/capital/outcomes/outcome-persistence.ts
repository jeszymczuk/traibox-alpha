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
  evidence_bundle_id: string | null;
  claim_ids: string[];
  calculation_runs: FinancialCalculationRun[];
  artifact_id: string | null;
  artifact_version_id: string | null;
  artifact_version: number | null;
  /** True when this call returned an already-persisted execution (§B6-style
   * idempotent replay: same task + idempotency key + outcome identity). */
  replayed: boolean;
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

export async function persistOutcomeExecution(client: ClientBase, rawResult: unknown, options: { actorUserId?: string | null } = {}): Promise<PersistedOutcome> {
  const result = outcomeResultSchema.parse(rawResult);

  const context = await client.query<{ org_id: string | null }>('SELECT app.current_org()::text AS org_id');
  if ((context.rows[0]?.org_id ?? null) !== result.organization_id) {
    throw new OutcomePersistenceError('outcome.rls_context_mismatch', 'transaction RLS organization does not match the outcome result', {
      context_org: context.rows[0]?.org_id ?? null,
      result_org: result.organization_id
    });
  }

  // 1. Idempotent replay (deterministic execution ⇒ same key returns the
  //    existing record); a same-key request with a DIFFERENT outcome identity
  //    is an explicit conflict, never an overwrite.
  const existing = await client.query<{ outcome_id: string; outcome_type: string; definition_version: string; status: string; evidence_bundle_id: string | null; artifact_ids_json: string[] }>(
    `SELECT outcome_id, outcome_type, definition_version, status, evidence_bundle_id, artifact_ids_json
     FROM agent_outcomes WHERE org_id = $1 AND task_id = $2 AND inputs_json->>'idempotency_key' = $3`,
    [result.organization_id, result.task_id, result.idempotency_key]
  );
  const existingRow = existing.rows[0];
  if (existingRow) {
    if (existingRow.outcome_type !== result.outcome_type || existingRow.definition_version !== result.definition_version || existingRow.status !== result.persisted_status) {
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
      evidence_bundle_id: existingRow.evidence_bundle_id,
      claim_ids: [],
      calculation_runs: [],
      artifact_id: existingArtifactId,
      artifact_version_id: existingVersion?.rows[0]?.artifact_version_id ?? null,
      artifact_version: existingVersion?.rows[0]?.version ?? null,
      replayed: true
    };
  }

  const outcome = await client.query<{ outcome_id: string }>(
    `INSERT INTO agent_outcomes(
       outcome_type, definition_version, task_id, org_id, principal_id, principal_type,
       mandate_id, mandate_version, status, inputs_json, unresolved_questions_json,
       recommendations_json, authority_level, trace_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13, $14)
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
      JSON.stringify({
        objective: result.objective,
        idempotency_key: result.idempotency_key,
        execution_status: result.execution_status,
        confidence: result.confidence,
        synthesis_source: result.synthesis_source,
        targeted_questions: result.targeted_questions,
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
  const outcomeId = outcome.rows[0]?.outcome_id;
  if (!outcomeId) throw new OutcomePersistenceError('outcome.insert_failed', 'outcome row insert returned nothing', {});

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

  return {
    outcome_id: outcomeId,
    status: result.persisted_status,
    evidence_bundle_id: bundleId,
    claim_ids: [...claimUuidByBrainId.values()],
    calculation_runs: runs,
    artifact_id: artifactId,
    artifact_version_id: artifactVersionId,
    artifact_version: artifactVersion,
    replayed: false
  };
}
