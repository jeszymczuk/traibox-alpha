import type { UUID } from '../index';
import type { AgentProvenance, CanonicalObjectRef, CapitalAuthorityLevel, MandateBinding, PrincipalType } from '../agents/common';
import type { UnresolvedQuestion } from '../outcomes/capital';

/**
 * Capital artifact contracts (spec §8). Artifacts are versioned intelligence
 * deliverables — NOT canonical Finance objects. Rendering never alters
 * reasoning, calculations, or evidence. Versions are immutable: a new version
 * appends; it never overwrites.
 */

export const CAPITAL_ARTIFACT_TYPES = [
  'capital_diagnosis',
  'trade_cost_model',
  'landed_cost_model',
  'transaction_pnl',
  'portfolio_pnl',
  'cashflow_forecast',
  'working_capital_plan',
  'scenario_model',
  'financing_strategy',
  'financing_packet',
  'capital_plan',
  'treasury_plan',
  'fx_plan',
  'term_sheet_review',
  'financial_counteroffer',
  'instrument_blueprint',
  'milestone_monitoring_report',
  'underwriting_memorandum',
  'credit_memo_draft',
  'allocation_memo_draft',
  'portfolio_exposure_brief'
] as const;
export type CapitalArtifactType = (typeof CAPITAL_ARTIFACT_TYPES)[number];

export const CAPITAL_ARTIFACT_STATUSES = ['draft', 'review_ready', 'finalised', 'superseded'] as const;
export type CapitalArtifactStatus = (typeof CAPITAL_ARTIFACT_STATUSES)[number];

export interface HumanReviewRef {
  user_id: UUID;
  reviewed_at: string;
  disposition: 'accepted' | 'edited' | 'rejected';
  note?: string;
}

/** The stable artifact identity; content lives in immutable versions. */
export interface CapitalArtifact {
  artifact_id: UUID;
  artifact_type: CapitalArtifactType;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  mandate: MandateBinding;
  outcome_id: UUID;
  task_id?: UUID;
  trade_id?: UUID | null;
  title: string;
  status: CapitalArtifactStatus;
  visibility_scope: 'principal' | 'organization' | 'disclosed';
  current_version: number;
  authority_level: CapitalAuthorityLevel;
  linked_object_refs: CanonicalObjectRef[];
  trace_id: string;
  audit_refs?: unknown[];
  created_at: string;
  updated_at: string;
}

/**
 * Immutable per-version content record. (artifact_id, version) is unique; rows
 * are never updated AND never deleted by ordinary application roles (database
 * append-only guard; only governed retention/purge operations may remove them,
 * CA-114). Principal binding mirrors the parent artifact and is enforced by a
 * composite ownership foreign key.
 */
export interface CapitalArtifactVersion<TContent = Record<string, unknown>> {
  artifact_version_id: UUID;
  artifact_id: UUID;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  version: number;
  schema_version: string;
  content: TContent;
  evidence_bundle_id: UUID;
  calculation_run_ids: UUID[];
  unresolved_questions: UnresolvedQuestion[];
  specialist_read_ids?: UUID[];
  generated_by: AgentProvenance;
  reviewed_by?: HumanReviewRef[];
  created_at: string;
}
