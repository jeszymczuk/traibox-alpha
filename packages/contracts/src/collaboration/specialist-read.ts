import type { UUID } from '../index';
import type { AgentProvenance, CanonicalObjectRef, PrincipalRef, PrincipalType, SpecialistAgentClass } from '../agents/common';
import type { EvidenceClaim } from '../evidence/claims';
import type { UnresolvedQuestion } from '../outcomes/capital';

/**
 * Typed specialist collaboration (spec §14). Agents never free-form command
 * one another: the orchestrator creates bounded, typed requests carrying only
 * the minimum context the target specialist needs. Private memory and
 * unrelated conversations are never exposed without purpose + authorization.
 */

export interface SpecialistTaskRequest {
  request_id: UUID;
  workflow_id?: UUID;
  parent_task_id: UUID;
  requesting_agent_class: SpecialistAgentClass;
  target_agent_class: SpecialistAgentClass;
  principal: PrincipalRef;
  question: string;
  requested_read_type: string;
  /** Explicit inclusion — nothing outside this set is visible to the specialist. */
  permitted_context_refs: CanonicalObjectRef[];
  disclosed_evidence_claim_ids: UUID[];
  permitted_data_classes: string[];
  /** Explicit exclusions, recorded for audit. */
  excluded_context?: string[];
  expected_schema: string;
  authority_requested: 'read' | 'recommendation';
  status: 'requested' | 'in_progress' | 'complete' | 'partial' | 'blocked' | 'abstained' | 'expired';
  due_at?: string;
  expires_at?: string;
  trace_id: string;
  created_at: string;
}

export interface SpecialistRead {
  specialist_read_id: UUID;
  request_id: UUID;
  /** Inherits and must match the request's org/principal (composite FK). */
  organization_id?: UUID;
  principal_id?: UUID;
  principal_type?: PrincipalType;
  agent_class: SpecialistAgentClass;
  status: 'complete' | 'partial' | 'blocked' | 'abstained';
  findings: EvidenceClaim[];
  blockers: UnresolvedQuestion[];
  /** Explicit authority attribution — what this read can and cannot decide. */
  authoritative_for: string[];
  not_authoritative_for: string[];
  recommended_next_actions: string[];
  provenance: AgentProvenance;
  created_at: string;
}
