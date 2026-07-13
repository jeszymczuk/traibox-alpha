import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import { ContextReadError, resolveAuthorizedRefs, type CanonicalSnapshot } from '../domains/capital/context/context-readers.js';
import { loadOutcomeResponseData, persistOutcomeExecution, type PersistedOutcome } from '../domains/capital/outcomes/outcome-persistence.js';
import { computeExecutionHash, computeRequestHash } from '../domains/capital/outcomes/request-fingerprint.js';
import { requestTradeBrainCapitalOutcome, type TradeBrainCapitalOutcomeResponse } from './trade-brain-client.js';

/**
 * Capital Agent outcome orchestration (Phase 4 §D8; hardened in Phase 4.1).
 *
 * The TypeScript API owns: authentication (route layer), organization and
 * org-backed company principal resolution (CA-113), exact server-side mandate
 * loading, canonical context reads, task lifecycle, request fingerprints,
 * short-lived database transactions, RLS context, and persistence. The Trade
 * Brain owns governed execution and is called with NO database transaction
 * held open.
 *
 * Task lifecycle (canonical status vocabulary): 'draft' (queued) →
 * 'in_progress' (running) → 'completed' | 'pending_input'
 * (needs_information) | 'blocked' (typed error record). A synchronous
 * request can never leave a task indefinitely in_progress: every failure
 * path finalizes the task before the error is surfaced.
 *
 * Idempotency (Phase 4.1 §§2–3): tasks and outcomes are identified by a
 * first-class exact (org_id, idempotency_key); the semantic request_hash
 * (no volatile trace ids) distinguishes exact replays (full original
 * response returned) from conflicting reuse (explicit HTTP 409).
 *
 * Nothing here creates or mutates canonical Finance state, executes
 * protected actions, or activates financier-direct functionality.
 */

export class CapitalAgentError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface CapitalOutcomeRequestBody {
  outcome_type: string;
  definition_version: string;
  objective: string;
  inputs: Record<string, unknown>;
  input_facts?: Array<Record<string, unknown>>;
  authorized_object_refs?: Array<Record<string, unknown>>;
  documents?: Array<{ source_id: string; content: string; media_type?: string | null }>;
  currency_policy: Record<string, unknown>;
  rounding_policy?: Record<string, unknown> | null;
  requested_authority?: string;
  idempotency_key: string;
}

export interface CapitalOutcomeResponse {
  task_id: string;
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
  request_hash: string;
  execution_hash: string | null;
  replayed: boolean;
  trace_id: string;
}

interface MandateRow {
  mandate_id: string;
  version: number;
  org_id: string;
  principal_id: string;
  principal_type: string;
  agent_class: string;
  status: string;
  allowed_outcome_types_json: string[];
  permitted_tool_classes_json: string[];
  permitted_data_classes_json: string[];
  permitted_specialist_reads_json: string[];
  prohibited_actions_json: string[];
  authority_ceiling: string;
  max_sensitivity: string;
  disclosure_policy_id: string;
  effective_from: Date | null;
  expires_at: Date | null;
}

export type CapitalBrainCall = typeof requestTradeBrainCapitalOutcome;

const CAPITAL_TASK_CONTRACT = 'capital-task-v1';

export async function runCapitalOutcome(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; body: CapitalOutcomeRequestBody },
  brainCall: CapitalBrainCall = requestTradeBrainCapitalOutcome
): Promise<CapitalOutcomeResponse> {
  const { orgId, userId, traceId, body } = input;

  const inOrgTx = <T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
    withTx(pool, async (client) => {
      await setAppContext(client, { userId, orgId, principalId: orgId, principalType: 'company' });
      return fn(client);
    });

  // ------------------------------------------------------------------
  // 1. Server-side mandate resolution (request values never authoritative).
  // ------------------------------------------------------------------
  const mandate = await inOrgTx(async (client) => {
    const row = await client.query<MandateRow>(
      `SELECT mandate_id, version, org_id, principal_id, principal_type, agent_class, status,
              allowed_outcome_types_json, permitted_tool_classes_json, permitted_data_classes_json,
              permitted_specialist_reads_json, prohibited_actions_json, authority_ceiling,
              max_sensitivity, disclosure_policy_id, effective_from, expires_at
       FROM agent_mandates
       WHERE org_id = $1 AND principal_type = 'company' AND agent_class = 'capital_agent' AND status = 'active'
       ORDER BY version DESC
       LIMIT 1`,
      [orgId]
    );
    return row.rows[0] ?? null;
  });
  if (!mandate) {
    throw new CapitalAgentError('capital.no_active_mandate', 'No active company Capital Agent mandate exists for this organization.', 409);
  }
  if (mandate.expires_at && mandate.expires_at.getTime() < Date.now()) {
    throw new CapitalAgentError('capital.mandate_expired', 'The active Capital Agent mandate version has expired.', 409);
  }

  // ------------------------------------------------------------------
  // 2. Semantic request fingerprint (no volatile trace ids).
  // ------------------------------------------------------------------
  const requestedAuthority = body.requested_authority ?? 'recommend';
  const requestHash = computeRequestHash({
    outcome_type: body.outcome_type,
    definition_version: body.definition_version,
    objective: body.objective,
    inputs: body.inputs,
    input_facts: body.input_facts ?? [],
    authorized_object_refs: body.authorized_object_refs ?? [],
    documents: body.documents ?? [],
    currency_policy: body.currency_policy,
    rounding_policy: body.rounding_policy ?? null,
    requested_authority: requestedAuthority,
    organization_id: orgId,
    principal_id: orgId,
    principal_type: 'company',
    mandate_id: mandate.mandate_id,
    mandate_version: mandate.version
  });

  // ------------------------------------------------------------------
  // 3. Atomic task acquisition on the exact idempotency key.
  // ------------------------------------------------------------------
  const acquisition = await inOrgTx(async (client) => {
    const inserted = await client.query<{ agent_task_id: string }>(
      `INSERT INTO alpha_agent_tasks(
         org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version,
         task_contract_version, definition_version, status, idempotency_key, request_hash,
         permitted_tools_json, data_access_json, input_objects_json
       ) VALUES ($1, $2, $3, $4, $1, 'company', $5, $6, $7, 'capital-agent-1.1.0', 'draft', $8, $9, $10::jsonb, $11::jsonb, $12::jsonb)
       ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL AND task_contract_version = 'capital-task-v1' DO NOTHING
       RETURNING agent_task_id`,
      [
        orgId,
        body.objective,
        traceId,
        userId,
        mandate.mandate_id,
        mandate.version,
        CAPITAL_TASK_CONTRACT,
        body.idempotency_key,
        requestHash,
        JSON.stringify(mandate.permitted_tool_classes_json),
        JSON.stringify(mandate.permitted_data_classes_json),
        JSON.stringify(body.authorized_object_refs ?? [])
      ]
    );
    if (inserted.rows[0]) return { taskId: inserted.rows[0].agent_task_id, created: true };
    const existing = await client.query<{ agent_task_id: string; request_hash: string | null; status: string }>(
      `SELECT agent_task_id, request_hash, status FROM alpha_agent_tasks
       WHERE org_id = $1 AND idempotency_key = $2 AND task_contract_version = $3`,
      [orgId, body.idempotency_key, CAPITAL_TASK_CONTRACT]
    );
    const task = existing.rows[0];
    if (!task) throw new CapitalAgentError('capital.task_acquisition_failed', 'Task insert conflicted but the existing task could not be read.', 500);
    return { taskId: task.agent_task_id, created: false, existingRequestHash: task.request_hash, existingStatus: task.status };
  });
  const taskId = acquisition.taskId;

  if (!acquisition.created) {
    // Exact replay vs conflicting reuse is decided by the SEMANTIC hash.
    if (acquisition.existingRequestHash !== requestHash) {
      throw new CapitalAgentError(
        'capital.idempotency_conflict',
        'This idempotency key was already used with a materially different request; stale analysis is never returned.',
        409
      );
    }
    const replay = await inOrgTx((client) => loadOutcomeResponseData(client, { orgId, idempotencyKey: body.idempotency_key }));
    if (replay) {
      return { ...replay, task_id: taskId, request_hash: requestHash, replayed: true, trace_id: traceId };
    }
    // Same request, no persisted outcome yet: a concurrent request is in
    // flight or a prior attempt failed — continue executing; the outcome
    // unique index guarantees exactly one persisted outcome.
  }

  const finalizeBlocked = async (code: string, message: string): Promise<void> => {
    await inOrgTx(async (client) => {
      await client.query(
        `UPDATE alpha_agent_tasks
         SET status = 'blocked',
             result_json = result_json || $2::jsonb,
             updated_at = now()
         WHERE agent_task_id = $1 AND org_id = $3 AND status NOT IN ('completed', 'pending_input')`,
        [taskId, JSON.stringify({ error: { code, message, at: new Date().toISOString() } }), orgId]
      );
    }).catch(() => undefined); // finalization is best-effort; the original error is surfaced
  };

  try {
    // ------------------------------------------------------------------
    // 4. Canonical context reads (short read transaction under RLS).
    // ------------------------------------------------------------------
    let snapshots: CanonicalSnapshot[] = [];
    if ((body.authorized_object_refs ?? []).length > 0) {
      snapshots = await inOrgTx((client) => resolveAuthorizedRefs(client, body.authorized_object_refs ?? [], { orgId, principalId: orgId }));
    }

    // ------------------------------------------------------------------
    // 5. Mark the task running, then call the Trade Brain with NO database
    //    transaction held open.
    // ------------------------------------------------------------------
    await inOrgTx(async (client) => {
      await client.query(`UPDATE alpha_agent_tasks SET status = 'in_progress', updated_at = now() WHERE agent_task_id = $1 AND org_id = $2`, [taskId, orgId]);
    });

    const executionRequest: Record<string, unknown> = {
      contract_version: 'capital-outcome-execution-v1',
      outcome_type: body.outcome_type,
      definition_version: body.definition_version,
      organization_id: orgId,
      principal_id: orgId,
      principal_type: 'company',
      mandate_id: mandate.mandate_id,
      mandate_version: mandate.version,
      task_id: taskId,
      objective: body.objective,
      requested_authority: requestedAuthority,
      tool_scope: mandate.permitted_tool_classes_json,
      data_scope: mandate.permitted_data_classes_json,
      inputs: body.inputs,
      input_facts: body.input_facts ?? [],
      authorized_object_refs: body.authorized_object_refs ?? [],
      canonical_snapshots: snapshots,
      documents: body.documents ?? [],
      currency_policy: body.currency_policy,
      ...(body.rounding_policy ? { rounding_policy: body.rounding_policy } : {}),
      trace_id: traceId,
      idempotency_key: body.idempotency_key,
      actor_user_id: userId
    };
    const mandatePayload: Record<string, unknown> = {
      mandate_id: mandate.mandate_id,
      version: mandate.version,
      org_id: mandate.org_id,
      principal_id: mandate.principal_id,
      principal_type: mandate.principal_type,
      agent_class: mandate.agent_class,
      status: mandate.status,
      allowed_outcome_types: mandate.allowed_outcome_types_json,
      permitted_tool_classes: mandate.permitted_tool_classes_json,
      permitted_data_classes: mandate.permitted_data_classes_json,
      permitted_specialist_reads: mandate.permitted_specialist_reads_json,
      prohibited_actions: mandate.prohibited_actions_json,
      authority_ceiling: mandate.authority_ceiling,
      max_sensitivity: mandate.max_sensitivity,
      disclosure_policy_id: mandate.disclosure_policy_id,
      effective_from: mandate.effective_from?.toISOString() ?? null,
      expires_at: mandate.expires_at?.toISOString() ?? null
    };

    const brainResponse: TradeBrainCapitalOutcomeResponse | null = await brainCall({ request: executionRequest, mandate: mandatePayload });
    if (!brainResponse) {
      throw new CapitalAgentError('capital.brain_unavailable', 'The Trade Brain intelligence service is not available; the outcome was not executed.', 503);
    }
    if (brainResponse.error || !brainResponse.result) {
      throw new CapitalAgentError(brainResponse.error?.code ?? 'capital.brain_error', brainResponse.error?.message ?? 'Trade Brain returned no result.', 502);
    }
    const result = brainResponse.result as Record<string, unknown>;
    if (result.execution_status === 'failed') {
      const violation = ((result.policy_violations as Array<Record<string, unknown>>) ?? [])[0];
      throw new CapitalAgentError(String(violation?.code ?? 'capital.execution_failed'), String(violation?.message ?? 'The outcome execution failed.'), 422);
    }
    const executionHash = computeExecutionHash(result);

    // ------------------------------------------------------------------
    // 6. Persist outcome + finalize task atomically (one transaction).
    // ------------------------------------------------------------------
    const persisted: PersistedOutcome = await inOrgTx((client) =>
      persistOutcomeExecution(client, result, {
        actorUserId: userId,
        requestHash,
        executionHash,
        finalizeTaskId: taskId
      })
    );

    if (persisted.replayed) {
      const replay = await inOrgTx((client) => loadOutcomeResponseData(client, { orgId, idempotencyKey: body.idempotency_key }));
      if (replay) return { ...replay, task_id: taskId, request_hash: requestHash, replayed: true, trace_id: traceId };
    }

    return {
      task_id: taskId,
      task_status: persisted.task_status ?? 'completed',
      outcome_id: persisted.outcome_id,
      status: persisted.status,
      execution_status: String(result.execution_status),
      confidence: String(result.confidence ?? 'medium'),
      synthesis_source: String(result.synthesis_source ?? 'deterministic'),
      provisional: Boolean(result.provisional ?? false),
      evidence_coverage: (result.evidence_coverage as Record<string, string>) ?? {},
      trust_notes: (result.trust_notes as string[]) ?? [],
      unresolved_questions: (result.unresolved_questions as string[]) ?? [],
      targeted_questions: (result.targeted_questions as string[]) ?? [],
      contradictions: (result.contradictions as string[]) ?? [],
      recommendation: (result.recommendation as Record<string, unknown> | null) ?? null,
      artifact_id: persisted.artifact_id,
      artifact_version: persisted.artifact_version,
      calculation_run_ids: persisted.calculation_runs.map((run) => run.run_id),
      evidence_bundle_id: persisted.evidence_bundle_id,
      request_hash: requestHash,
      execution_hash: executionHash,
      replayed: false,
      trace_id: traceId
    };
  } catch (error) {
    // No task may remain running after a synchronous error (Phase 4.1 §4).
    if (error instanceof ContextReadError) {
      await finalizeBlocked(error.code, error.message);
      throw new CapitalAgentError(error.code, error.message, error.statusCode);
    }
    if (error instanceof CapitalAgentError) {
      await finalizeBlocked(error.code, error.message);
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code ?? 'capital.unexpected_error';
    await finalizeBlocked(String(code), message);
    throw error;
  }
}

export async function getCapitalOutcome(pool: pg.Pool, input: { orgId: string; userId: string; outcomeId: string }): Promise<Record<string, unknown> | null> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId, principalId: input.orgId, principalType: 'company' });
    const row = await client.query(
      `SELECT o.outcome_id, o.outcome_type, o.definition_version, o.status, o.task_id, o.mandate_id, o.mandate_version,
              o.idempotency_key, o.request_hash, o.execution_hash,
              o.inputs_json, o.unresolved_questions_json, o.recommendations_json, o.calculation_run_ids_json,
              o.artifact_ids_json, o.evidence_bundle_id, o.trace_id, o.created_at, o.updated_at
       FROM agent_outcomes o
       WHERE o.outcome_id = $1 AND o.org_id = $2`,
      [input.outcomeId, input.orgId]
    );
    if (!row.rows[0]) return null;
    const versions = await client.query(
      `SELECT v.artifact_version_id, v.artifact_id, v.version, v.schema_version, v.content_json, v.created_at
       FROM capital_artifact_versions v
       JOIN capital_artifacts a ON a.artifact_id = v.artifact_id
       WHERE a.outcome_id = $1
       ORDER BY v.version ASC`,
      [input.outcomeId]
    );
    return { ...row.rows[0], artifact_versions: versions.rows };
  });
}
