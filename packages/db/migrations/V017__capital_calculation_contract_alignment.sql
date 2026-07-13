-- Capital Agent v1.1 Phase 3 closure (§1.2): unify calculation status
-- semantics across Python, TypeScript, and the database. Additive; V013 is
-- not edited destructively. `insufficient_information` is a first-class
-- calculation status (missing material inputs / contradictory evidence);
-- `ineligible` remains an ELIGIBILITY result, never a calculation status.

ALTER TABLE financial_calculation_runs DROP CONSTRAINT IF EXISTS financial_calculation_runs_status_check;
ALTER TABLE financial_calculation_runs ADD CONSTRAINT financial_calculation_runs_status_check
  CHECK (status IN ('completed', 'insufficient_information', 'invalid_input', 'failed'));

-- Eligibility surfaced as a first-class column (was inside result_json only),
-- so audits and inspectors can filter without JSON parsing. Nullable +
-- defaulted for existing rows; the persistence adapter always writes it.
ALTER TABLE financial_calculation_runs ADD COLUMN IF NOT EXISTS eligibility text
  CHECK (eligibility IS NULL OR eligibility IN ('eligible', 'ineligible', 'insufficient_information', 'not_applicable'));

-- Structured warnings and missing fields land in dedicated jsonb columns for
-- the aligned draft contract (previously folded into result_json).
ALTER TABLE financial_calculation_runs ADD COLUMN IF NOT EXISTS structured_warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE financial_calculation_runs ADD COLUMN IF NOT EXISTS missing_fields_json jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE financial_calculation_runs ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Idempotent run creation per organization (nullable for legacy rows; the
-- adapter always supplies one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_calc_runs_idem
  ON financial_calculation_runs (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
