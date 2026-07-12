import type { UUID } from '../index';
import type { MandateBinding, PrincipalType } from '../agents/common';

/**
 * Deterministic Financial Workbench contracts (spec §11).
 *
 * The LLM may select calculators, assemble inputs, and explain outputs. It is
 * NEVER the authoritative calculator: every material financial value must
 * trace to a FinancialCalculationRun with versioned formulas and hashes.
 * Calculator/formula DEFINITIONS live in version-controlled code (directive
 * §6); runs persist the exact versions used.
 */

export interface CurrencyPolicy {
  base_currency: string;
  fx_source?: string;
  fx_as_of?: string;
  conversion_note?: string;
}

export interface RoundingPolicy {
  /** e.g. 'half_even' (banker's), 'half_up'. */
  mode: string;
  /** Decimal places for stored monetary values. */
  scale: number;
}

export interface CalculationValidation {
  check: string;
  status: 'pass' | 'warn' | 'fail';
  finding?: string;
}

export interface CalculationWarning {
  code: string;
  message: string;
}

export interface InputProvenanceEntry {
  input_key: string;
  /** Claim or canonical ref that supplied the value. */
  claim_id?: UUID;
  source_description?: string;
  as_of?: string;
}

export interface FinancialCalculationRun {
  run_id: UUID;
  calculator_id: string;
  calculator_version: string;
  formula_version: string;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  mandate: MandateBinding;
  task_id?: UUID;
  outcome_id?: UUID;
  scenario_id?: UUID;
  /** Normalized inputs exactly as computed over. */
  input_snapshot: Record<string, unknown>;
  input_provenance: InputProvenanceEntry[];
  assumption_claim_ids: UUID[];
  result: Record<string, unknown>;
  currency_policy: CurrencyPolicy;
  rounding_policy: RoundingPolicy;
  /** Deterministic hashes: same inputs + versions ⇒ same hashes. */
  input_hash: string;
  result_hash: string;
  warnings: CalculationWarning[];
  validation_results: CalculationValidation[];
  status: 'completed' | 'failed' | 'invalid_input';
  executed_by: 'workbench';
  actor_user_id?: UUID;
  trace_id: string;
  created_at: string;
}
