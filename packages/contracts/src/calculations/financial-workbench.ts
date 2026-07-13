import type { UUID } from '../index';
import type { MandateBinding, PrincipalType } from '../agents/common';

/**
 * Deterministic Financial Workbench contracts (spec §11; Phase 3 closure §1).
 *
 * The LLM may select calculators, assemble inputs, and explain outputs. It is
 * NEVER the authoritative calculator: every material financial value must
 * trace to a FinancialCalculationRun with versioned formulas and hashes.
 *
 * Contract chain (§1): WorkbenchCalculationRequest →
 * WorkbenchCalculationResult → FinancialCalculationRunDraft → TypeScript
 * persistence adapter → FinancialCalculationRun record. The Python Workbench
 * is persistence-independent; the TS API owns transactions, RLS context,
 * run_id, and persisted timestamps.
 */

/** Unified across Python, TypeScript, and the database CHECK (V017).
 * `ineligible` is an ELIGIBILITY result, never a calculation status. */
export const CALCULATION_STATUSES = ['completed', 'insufficient_information', 'invalid_input', 'failed'] as const;
export type CalculationStatus = (typeof CALCULATION_STATUSES)[number];

export const CALCULATION_ELIGIBILITIES = ['eligible', 'ineligible', 'insufficient_information', 'not_applicable'] as const;
export type CalculationEligibility = (typeof CALCULATION_ELIGIBILITIES)[number];

/** Explicit currency policy (§4): no defaults, no implicit conversion. */
export interface CurrencyPolicy {
  base_currency: string;
  conversion_allowed: boolean;
  accepted_fx_sources: string[];
  fx_as_of_required: boolean;
  allow_stale_rates: boolean;
  rate_direction: 'base_to_quote';
}

/** The only supported policy in this release — explicit and hash-relevant (§4.1). */
export interface RoundingPolicy {
  mode: 'half_even';
  monetary_scale: 'currency_minor_units';
  rate_scale: 10;
}

export interface CalculationValidation {
  check: string;
  status: 'pass' | 'warn' | 'fail';
  finding?: string;
}

/** Structured warnings (§1.3). */
export interface StructuredWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  related_input_paths: string[];
}

/** Canonical object identity backing a verified input (provenance-binding
 * closure §2). Mirrors EvidenceSourceRef in the Python Workbench. */
export interface CalculationEvidenceSourceRef {
  object_type: string;
  source_layer: 'relational' | 'alpha_object' | 'external';
  object_id: string;
  organization_id: string;
  principal_id: string;
}

/** Path-based provenance (§5; hardened by the provenance-binding closure):
 * 'revenue', 'reference_rate.rate', 'components[0].amount'.
 *
 * 'verified_fact' is never a caller-assignable label: it requires the
 * complete typed evidence binding (canonical claim, canonical source, source
 * field path, normalized source value that exactly matches the calculator
 * input, verified status, acceptable freshness). Both the Python model and
 * the TypeScript persistence schema fail closed without it. */
export interface InputProvenanceEntry {
  input_path: string;
  kind: 'verified_fact' | 'user_provided' | 'assumption' | 'estimate' | 'derived' | 'unresolved';
  claim_id?: string | null;
  source?: string | null;
  as_of?: string | null;
  source_ref?: CalculationEvidenceSourceRef | null;
  source_field_path?: string | null;
  source_value?: string | null;
  freshness?: 'current' | 'recent' | 'stale' | 'unknown' | null;
  verification_status?: 'verified' | 'unverified' | 'conflicting' | null;
  // Semantic binding-policy identity (mandatory for 'verified_fact'; semantic
  // evidence-binding closure §3). Proves the canonical field is semantically
  // permitted to support this input, not merely value-equal. Included in the
  // audited calculation input hash.
  binding_policy_version?: string | null;
  binding_rule_id?: string | null;
  semantic_concept?: string | null;
  source_evidence_category?: string | null;
  target_evidence_category?: string | null;
}

export interface CalculationExecutionMetadata {
  duration_ms?: number | null;
  engine: 'workbench';
}

/**
 * Canonized (tagged, JSON-safe) audit manifests (Part B §B1). These are the
 * EXACT payloads the deterministic hashes were computed over:
 * - Decimals appear as {"$dec": "10.00"}, dates as {"$date": "2026-07-01"},
 *   datetimes as {"$dt": "..."}, rejected floats as {"$float": "..."};
 * - object keys are sorted; declared semantically-unordered lists are
 *   canonically sorted; ordered lists keep their order;
 * - null and missing are distinct.
 * Hashing the stored form MUST reproduce input_hash / result_hash exactly
 * (see calculation-run-hashing in the API and the Python Workbench hashing).
 */
export type CanonicalManifest = Record<string, unknown>;

/** input_manifest contents: normalized inputs, currency and rounding policy,
 * scenario identity, and behavior-affecting provenance classifications. The
 * calculator/formula versions are bound inside the hash wrapper. */
export interface CalculationInputManifest extends CanonicalManifest {
  inputs: Record<string, unknown>;
  currency_policy: Record<string, unknown>;
  rounding_policy: Record<string, unknown>;
  scenario_id: string | null;
  provenance: Record<string, string>;
}

/** result_envelope contents: the complete result including every caveat. */
export interface CalculationResultEnvelope extends CanonicalManifest {
  status: CalculationStatus;
  eligibility: CalculationEligibility;
  outputs: Record<string, unknown>;
  warnings: StructuredWarning[];
  validations: CalculationValidation[];
  assumptions_used: string[];
  missing_fields: string[];
  contradictions: string[];
}

/**
 * Everything required for persistence EXCEPT database-assigned fields
 * (run_id, persisted created_at). Produced by the Python Workbench
 * (build_run_draft) and consumed by the TS persistence adapter.
 */
export interface FinancialCalculationRunDraft {
  calculator_id: string;
  calculator_version: string;
  formula_version: string;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  mandate_id: UUID;
  mandate_version: number;
  task_id?: string | null;
  outcome_id?: string | null;
  scenario_id?: string | null;
  input_snapshot: Record<string, unknown>;
  input_provenance: InputProvenanceEntry[];
  assumption_refs: string[];
  result: Record<string, unknown>;
  currency_policy: CurrencyPolicy;
  rounding_policy: RoundingPolicy;
  input_hash: string;
  result_hash: string;
  /** Immutable audit payloads (Part B §B2): the exact canonized manifests the
   * hashes were computed over. The query-oriented fields (result, warnings,
   * validations, status, eligibility, missing_fields) are projections of
   * result_envelope and must never contradict it. */
  input_manifest: CalculationInputManifest;
  result_envelope: CalculationResultEnvelope;
  assumptions_used: string[];
  contradictions: string[];
  warnings: StructuredWarning[];
  validations: CalculationValidation[];
  status: CalculationStatus;
  eligibility: CalculationEligibility;
  missing_fields: string[];
  executed_by: 'workbench';
  actor_user_id?: string | null;
  trace_id: string;
  idempotency_key: string;
  execution: CalculationExecutionMetadata;
}

/** The persisted record (draft + database-assigned identity/timestamps). */
export interface FinancialCalculationRun extends Omit<FinancialCalculationRunDraft, 'mandate_id' | 'mandate_version'> {
  run_id: UUID;
  mandate: MandateBinding;
  created_at: string;
}
