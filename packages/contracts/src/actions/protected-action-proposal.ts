import type { UUID } from '../index';
import type { CanonicalObjectRef, MandateBinding, PrincipalType, SpecialistAgentClass } from '../agents/common';

/**
 * Protected-action proposal contracts (spec §19, decision CA-102).
 *
 * A proposal is the ONLY way an agent reaches toward canonical Finance change,
 * and it stops at proposal: human approval binds to the exact payload hash,
 * then a typed Finance command is independently validated and executed by the
 * Finance domain. A modified payload requires revalidation, a new hash, and a
 * new approval. Phase 1 defines the contract; no Finance execution exists.
 */

export const PROPOSAL_STATUSES = ['draft', 'pending_policy_check', 'pending_approval', 'approved', 'rejected', 'expired', 'withdrawn'] as const;
export type ProtectedActionProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export interface SeparationOfDutiesRule {
  policy_id: string;
  /** The proposer (and the invoking operator, where policy says so) cannot approve. */
  proposer_cannot_approve: boolean;
  required_approver_roles: string[];
  step_up_required: boolean;
}

export interface ProtectedActionProposal {
  proposal_id: UUID;
  /** Kind within the platform's protected-action vocabulary (e.g. submit_funding_request). */
  proposal_type: string;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  mandate: MandateBinding;
  /** Domain that owns the command, e.g. 'finance'. */
  target_domain: string;
  /** Typed command name, e.g. 'finance.create_funding_request'. */
  target_command: string;
  target_object_ref?: CanonicalObjectRef;
  /** Normalized draft payload the human approves — exactly what Finance would validate. */
  draft_payload: Record<string, unknown>;
  /** Hash of the normalized payload; approval binds to this exact value. */
  payload_hash: string;
  rationale: string;
  rationale_claim_ids: UUID[];
  source_outcome_id: UUID;
  source_artifact_id?: UUID;
  source_artifact_version?: number;
  evidence_refs: UUID[];
  calculation_run_ids: UUID[];
  unresolved_issue_ids: UUID[];
  proposed_by_task_id: UUID;
  proposed_by_agent_class: SpecialistAgentClass;
  separation_of_duties: SeparationOfDutiesRule;
  expires_at: string;
  idempotency_key: string;
  status: ProtectedActionProposalStatus;
  policy_version: string;
  disclosure_set?: UUID[];
  trace_id: string;
  audit_refs?: unknown[];
  created_at: string;
  updated_at: string;
}
