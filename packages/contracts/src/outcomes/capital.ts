import type { UUID } from '../index';
import type { CanonicalObjectRef, CapitalAuthorityLevel, MandateBinding, PrincipalType } from '../agents/common';

/**
 * Capital outcome contracts (spec §7). Outcome DEFINITIONS (blocking inputs,
 * calculators, evidence policies, quality gates) live in version-controlled
 * code/config; outcome INSTANCES are first-class persisted records.
 *
 * Outcomes are intelligence products. They are not Finance objects and do not
 * map 1:1 onto Finance object types (decision CA-102).
 */

/** Complete company-side v1.1 outcome taxonomy (spec §7.2). Financier-exclusive outcomes are registered but not activated by initial company policies. */
export const CAPITAL_OUTCOME_TYPES = [
  'capital_diagnosis',
  'trade_cost_analysis',
  'landed_cost_analysis',
  'transaction_pnl',
  'portfolio_pnl',
  'cashflow_forecast',
  'working_capital_analysis',
  'scenario_model',
  'financing_need_classification',
  'financing_strategy',
  'financing_option_comparison',
  'funding_packet',
  'term_sheet_review',
  'financial_counteroffer',
  'capital_plan',
  'treasury_liquidity_plan',
  'fx_exposure_analysis',
  'instrument_blueprint',
  'milestone_monitoring_report',
  'underwriting_pre_read',
  'credit_memo_draft',
  'allocation_memo_draft',
  'portfolio_exposure_brief'
] as const;
export type CapitalOutcomeType = (typeof CAPITAL_OUTCOME_TYPES)[number];

/** Outcome lifecycle (spec §7.4). `finalised` = complete for its authority level; it never means approved or executed. */
export const CAPITAL_OUTCOME_STATUSES = [
  'requested',
  'gathering_context',
  'needs_information',
  'specialist_reads_pending',
  'calculating',
  'draft_ready',
  'under_review',
  'finalised',
  'superseded',
  'blocked',
  'failed',
  'abstained'
] as const;
export type CapitalOutcomeStatus = (typeof CAPITAL_OUTCOME_STATUSES)[number];

export interface UnresolvedQuestion {
  question_id: UUID;
  question: string;
  blocking: boolean;
  directed_to?: 'user' | 'specialist' | 'document';
}

export interface OutcomeRecommendation {
  recommendation_id: UUID;
  label: string;
  description: string;
  action_class: 'user_input' | 'specialist_review' | 'internal_work' | 'protected_action_proposal';
  priority: 'critical' | 'high' | 'normal' | 'low';
  rationale_claim_ids: UUID[];
  prerequisites?: string[];
  /** A proposed typed command name — never an executed one. */
  proposed_command?: string;
}

export interface CapitalOutcomeInstance {
  outcome_id: UUID;
  outcome_type: CapitalOutcomeType;
  definition_version: string;
  task_id: UUID;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  mandate: MandateBinding;
  status: CapitalOutcomeStatus;
  /** User + context inputs as accepted (normalized). */
  inputs: Record<string, unknown>;
  input_object_refs: CanonicalObjectRef[];
  evidence_bundle_id?: UUID;
  calculation_run_ids: UUID[];
  artifact_ids: UUID[];
  recommendations: OutcomeRecommendation[];
  unresolved_questions: UnresolvedQuestion[];
  contradiction_claim_ids: UUID[];
  authority_level: CapitalAuthorityLevel;
  version: number;
  supersedes_outcome_id?: UUID;
  trace_id: string;
  audit_refs?: unknown[];
  created_at: string;
  updated_at: string;
}
