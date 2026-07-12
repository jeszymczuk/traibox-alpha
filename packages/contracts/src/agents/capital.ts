import type { UUID } from '../index';
import type { CanonicalObjectRef, CapitalAuthorityLevel, MandateBinding, PrincipalRef } from './common';
import type { CapitalOutcomeType, OutcomeRecommendation } from '../outcomes/capital';

/**
 * Versioned Capital Agent task contracts (spec §17.2–17.3).
 *
 * These are the v1.1 task shapes. The legacy `AgentTaskRequest` /
 * `AgentWorkResult` (index.ts) and `POST /v1/agents/tasks` remain untouched
 * for compatibility until callers migrate in a later phase.
 */

export const CAPITAL_TASK_CONTRACT_VERSION = 'capital-task-v1' as const;

export interface CapitalAgentTaskRequest {
  contract_version: typeof CAPITAL_TASK_CONTRACT_VERSION;
  task_id?: UUID;
  objective: string;
  principal: PrincipalRef;
  mandate: MandateBinding;
  requested_outcome_type?: CapitalOutcomeType;
  input_object_refs: CanonicalObjectRef[];
  user_provided_inputs?: Record<string, unknown>;
  scenario_ids?: UUID[];
  requested_artifact_format?: string;
  /** Ceiling for this invocation; may be lower than the mandate ceiling, never higher. */
  requested_authority?: CapitalAuthorityLevel;
  tool_scope?: string[];
  data_scope?: string[];
  interaction_context?: {
    workspace: 'intelligence' | 'trades' | 'finance' | 'financier';
    trade_id?: UUID;
    conversation_id?: UUID;
  };
  constraints?: {
    deadline?: string;
    max_tool_calls?: number;
    max_model_steps?: number;
    max_cost_usd?: number;
    timeout_seconds?: number;
  };
  trace_id: string;
  idempotency_key: string;
}

export const CAPITAL_TASK_COMPLETION_STATUSES = ['completed', 'partial', 'blocked', 'failed', 'timed_out', 'abstained'] as const;
export type CapitalTaskCompletionStatus = (typeof CAPITAL_TASK_COMPLETION_STATUSES)[number];

export interface ModelUsageRecord {
  provider: string;
  model_id: string;
  prompt_version?: string;
  input_tokens?: number;
  output_tokens?: number;
  latency_ms?: number;
  cost_estimate_usd?: number;
  stop_reason?: string;
}

export interface CapitalAgentWorkResult {
  contract_version: typeof CAPITAL_TASK_CONTRACT_VERSION;
  task_id: UUID;
  outcome_id: UUID;
  completion_status: CapitalTaskCompletionStatus;
  objective_summary: string;
  output_artifact_ids: UUID[];
  evidence_bundle_id?: UUID;
  calculation_run_ids: UUID[];
  specialist_read_ids: UUID[];
  verified_fact_claim_ids: UUID[];
  assumption_claim_ids: UUID[];
  unresolved_question_ids: UUID[];
  contradiction_claim_ids: UUID[];
  recommended_next_actions: OutcomeRecommendation[];
  protected_action_proposal_ids: UUID[];
  memory_candidate_ids: UUID[];
  model_usage: ModelUsageRecord[];
  policy_versions: Record<string, string>;
  trace_id: string;
  created_at: string;
}
