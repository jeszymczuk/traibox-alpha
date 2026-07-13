import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import { persistOutcomeExecution, type PersistedOutcome } from '../domains/capital/outcomes/outcome-persistence.js';
import { requestTradeBrainCapitalOutcome, type TradeBrainCapitalOutcomeResponse } from './trade-brain-client.js';

/**
 * Capital Agent outcome orchestration (Phase 4 §D8).
 *
 * The TypeScript API owns: authentication (route layer), organization and
 * principal resolution (company principal = the organization, CA-113), exact
 * mandate loading from the database, task creation, the database transaction,
 * RLS context, and persistence of outcomes / calculation runs / evidence /
 * artifacts. The Trade Brain owns governed execution. Nothing here creates or
 * mutates canonical Finance state, executes protected actions, or activates
 * financier-direct functionality.
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
  documents?: Array<{ source_id: string; content: string; media_type?: string | null }>;
  currency_policy: Record<string, unknown>;
  requested_authority?: string;
  idempotency_key: string;
}

export interface CapitalOutcomeResponse {
  task_id: string;
  outcome_id: string;
  status: string;
  execution_status: string;
  confidence: string;
  synthesis_source: string;
  unresolved_questions: string[];
  targeted_questions: string[];
  contradictions: string[];
  recommendation: Record<string, unknown> | null;
  artifact_id: string | null;
  artifact_version: number | null;
  calculation_run_ids: string[];
  evidence_bundle_id: string | null;
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

export async function runCapitalOutcome(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; body: CapitalOutcomeRequestBody },
  brainCall: CapitalBrainCall = requestTradeBrainCapitalOutcome
): Promise<CapitalOutcomeResponse> {
  const { orgId, userId, traceId, body } = input;

  // 1. Server-side mandate resolution: the latest ACTIVE company capital
  //    mandate for this organization. Values from the request are never
  //    authoritative for principal or mandate identity.
  const mandate = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId, principalId: orgId, principalType: 'company' });
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

  // 2. Task creation, bound to the exact mandate version.
  const taskIdempotency = `capital-outcome:${body.idempotency_key}`;
  const taskId = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId, principalId: orgId, principalType: 'company' });
    const existing = await client.query<{ agent_task_id: string }>(
      `SELECT agent_task_id FROM alpha_agent_tasks WHERE org_id = $1 AND objective = $2 AND trace_id LIKE $3 LIMIT 1`,
      [orgId, body.objective, `capital:${taskIdempotency}%`]
    );
    if (existing.rows[0]) return existing.rows[0].agent_task_id;
    const inserted = await client.query<{ agent_task_id: string }>(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version, task_contract_version, definition_version)
       VALUES ($1, $2, $3, $4, $1, 'company', $5, $6, 'capital-task-v1', 'capital-agent-1.1.0')
       RETURNING agent_task_id`,
      [orgId, body.objective, `capital:${taskIdempotency}:${traceId}`, userId, mandate.mandate_id, mandate.version]
    );
    const id = inserted.rows[0]?.agent_task_id;
    if (!id) throw new CapitalAgentError('capital.task_creation_failed', 'Task creation returned no id.', 500);
    return id;
  });

  // 3. Governed execution in the Trade Brain (deterministic; no DB access).
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
    requested_authority: body.requested_authority ?? 'recommend',
    tool_scope: mandate.permitted_tool_classes_json,
    data_scope: mandate.permitted_data_classes_json,
    inputs: body.inputs,
    input_facts: body.input_facts ?? [],
    documents: body.documents ?? [],
    currency_policy: body.currency_policy,
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

  // 4. Persist the complete execution in ONE authenticated RLS transaction.
  const persisted: PersistedOutcome = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId, principalId: orgId, principalType: 'company' });
    return persistOutcomeExecution(client, result, { actorUserId: userId });
  });

  return {
    task_id: taskId,
    outcome_id: persisted.outcome_id,
    status: persisted.status,
    execution_status: String(result.execution_status),
    confidence: String(result.confidence ?? 'medium'),
    synthesis_source: String(result.synthesis_source ?? 'deterministic'),
    unresolved_questions: (result.unresolved_questions as string[]) ?? [],
    targeted_questions: (result.targeted_questions as string[]) ?? [],
    contradictions: (result.contradictions as string[]) ?? [],
    recommendation: (result.recommendation as Record<string, unknown> | null) ?? null,
    artifact_id: persisted.artifact_id,
    artifact_version: persisted.artifact_version,
    calculation_run_ids: persisted.calculation_runs.map((run) => run.run_id),
    evidence_bundle_id: persisted.evidence_bundle_id,
    trace_id: traceId
  };
}

export async function getCapitalOutcome(pool: pg.Pool, input: { orgId: string; userId: string; outcomeId: string }): Promise<Record<string, unknown> | null> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId, principalId: input.orgId, principalType: 'company' });
    const row = await client.query(
      `SELECT o.outcome_id, o.outcome_type, o.definition_version, o.status, o.task_id, o.mandate_id, o.mandate_version,
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
