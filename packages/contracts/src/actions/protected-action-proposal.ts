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
  /**
   * Approval binding (Phase 1 hardening, CA-115). Once status leaves 'draft',
   * every action-defining field above (type, domain, command, target, payload,
   * payload_hash, principal, mandate, sources, evidence/calc refs, SoD,
   * expiry, idempotency, policy version, proposer) is FROZEN at the database —
   * a changed payload requires a NEW proposal with a new id, hash, and
   * approval. 'approved' requires all four approval fields and
   * approved_payload_hash === payload_hash; separation of duties rejects
   * approved_by_user_id === proposed_by_user_id when the SoD rule forbids it.
   * The agent itself is never an approver.
   */
  proposed_by_user_id?: UUID | null;
  /** Reference into the existing approval domain — no second approval system. */
  approval_request_id?: UUID | null;
  approved_by_user_id?: UUID | null;
  approved_at?: string | null;
  approved_payload_hash?: string | null;
  rejected_by_user_id?: UUID | null;
  rejected_at?: string | null;
  decision_rationale?: string | null;
  trace_id: string;
  audit_refs?: unknown[];
  created_at: string;
  updated_at: string;
}
