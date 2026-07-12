import type { UUID } from '../index';
import type { DataSensitivity, PrincipalType } from '../agents/common';

/**
 * Governed memory and personalization contracts (spec §13).
 *
 * No hidden chain-of-thought is ever persisted. Memory holds only governed
 * information: preferences, working conventions, approved assumptions,
 * decisions, concise rationale, and evidence references. Memory is
 * principal-scoped: company memory never becomes visible to a financier
 * principal implicitly (CA-101); sharing requires an explicit disclosure
 * package (deferred with financier UX).
 */

export const MEMORY_SCOPES = ['user', 'org', 'relationship', 'workflow', 'entity', 'corridor'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_ORIGINS = ['explicit', 'observed', 'inferred', 'computed'] as const;
export type MemoryOrigin = (typeof MEMORY_ORIGINS)[number];

export const MEMORY_STATUSES = ['candidate', 'active', 'rejected', 'expired', 'deleted'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export interface MemoryItem {
  memory_id: UUID;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  scope: MemoryScope;
  origin: MemoryOrigin;
  statement: string;
  structured_value?: unknown;
  source_refs: unknown[];
  confidence: 'high' | 'medium' | 'low';
  sensitivity: DataSensitivity;
  /** Purpose binding — retrieval must state a matching purpose. */
  purpose: string[];
  status: MemoryStatus;
  /** Review lifecycle for candidates (policy service decides). */
  review_state?: 'auto_activated' | 'confirmation_requested' | 'user_confirmed' | 'user_rejected';
  created_at: string;
  last_confirmed_at?: string;
  expires_at?: string;
  decay_policy_id?: string;
  editable_by_user: boolean;
  deletable_by_user: boolean;
  /** Forget/reset/export governance metadata. */
  forgotten_at?: string;
  exported_at?: string;
}

/** A candidate produced by an agent run; a memory policy service promotes/rejects it. Critical financial facts are never inferred into active memory without an authoritative source or explicit confirmation. */
export type MemoryCandidate = MemoryItem & { status: 'candidate' };

export interface UserOperatingProfile {
  user_id: UUID;
  organization_id: UUID;
  principal_type: PrincipalType;
  preferred_detail_level?: 'executive' | 'professional' | 'technical';
  preferred_artifact_formats?: string[];
  preferred_currency?: string;
  risk_communication_style?: 'direct' | 'balanced' | 'detailed';
  approval_responsibilities?: string[];
  recurring_objectives?: string[];
  explicit_preference_ids: UUID[];
  inferred_preference_ids: UUID[];
  last_reviewed_at?: string;
  version: number;
}

export interface OrgFinanceProfile {
  organization_id: UUID;
  principal_type: PrincipalType;
  base_currency?: string;
  finance_policies?: Record<string, unknown>;
  recurring_counterparty_refs?: unknown[];
  recurring_pattern_ids?: UUID[];
  accepted_recommendation_ids?: UUID[];
  rejected_recommendation_ids?: UUID[];
  last_reviewed_at?: string;
  version: number;
}
