import type { GlassBox, UUID } from '../index';
import type { CanonicalObjectRef, DataSensitivity, PrincipalType } from '../agents/common';

/**
 * Evidence and provenance contracts (spec §12, decision CA-111).
 *
 * Evidence presence is never decided by string matching, and no generic proof
 * object counts as proof of a specific claim. Unknown stays unknown; missing
 * stays missing; contradictions stay visible until resolved.
 */

export const CLAIM_TYPES = [
  'verified_fact',
  'inference',
  'assumption',
  'estimate',
  'calculation',
  'recommendation',
  'unresolved_question',
  'contradiction'
] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const VERIFICATION_STATUSES = ['verified', 'partially_verified', 'unverified', 'conflicting', 'stale', 'not_applicable'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Where a claim's support comes from. Canonical refs beat documents beat memory beats model inference (spec §12.4). */
export interface EvidenceSourceRef {
  source_type: 'canonical_record' | 'provider_record' | 'document' | 'external_authoritative' | 'user_confirmed' | 'memory_signal' | 'model_inference';
  ref?: CanonicalObjectRef;
  document_id?: UUID;
  /** Content hash for tamper-evidence, where available. */
  source_hash?: string;
  description?: string;
  observed_at?: string;
}

export interface EvidenceClaim {
  claim_id: UUID;
  claim_type: ClaimType;
  /** Human-readable statement; structured_value carries the machine form. */
  statement: string;
  structured_value?: unknown;
  subject?: string;
  /** Transaction / canonical-object linkage. */
  object_refs?: CanonicalObjectRef[];
  source_refs: EvidenceSourceRef[];
  principal_id: UUID;
  principal_type: PrincipalType;
  /** Visibility scope; cross-principal disclosure requires an explicit package. */
  visibility_scope: 'principal' | 'organization' | 'disclosed';
  sensitivity?: DataSensitivity;
  observed_at?: string;
  as_of?: string;
  freshness?: 'current' | 'recent' | 'stale' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  verification_status: VerificationStatus;
  materiality: 'critical' | 'material' | 'supporting';
  /** Material numeric claims MUST reference the deterministic run that produced them. */
  calculation_run_ids?: UUID[];
  assumption_claim_ids?: UUID[];
  /** Conflicting claims stay linked and visible until resolved. */
  contradicts_claim_ids?: UUID[];
  supersedes_claim_id?: UUID;
  created_at?: string;
}

/** Everything a finalised artifact stands on (spec §12.3). */
export interface EvidenceBundle {
  bundle_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  organization_id: UUID;
  task_id?: UUID;
  outcome_id?: UUID;
  claim_ids: UUID[];
  source_access_log?: unknown[];
  specialist_read_ids?: UUID[];
  policy_versions?: Record<string, string>;
  created_at?: string;
}

/**
 * Compatibility adapter: renders structured claims into the legacy
 * `GlassBox { reasons: string[] }` shape for callers that still consume it.
 * The adapter is one-way and lossy by design — structured claims remain the
 * source of truth and MUST NOT be replaced by the string form.
 */
export function glassBoxFromClaims(claims: Array<Pick<EvidenceClaim, 'claim_type' | 'statement' | 'verification_status'>>): GlassBox {
  return {
    reasons: claims.map((claim) => `[${claim.claim_type}:${claim.verification_status}] ${claim.statement}`)
  };
}
