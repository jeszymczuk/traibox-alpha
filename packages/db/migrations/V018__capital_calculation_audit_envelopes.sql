-- Capital Agent v1.1 — calculation persistence and audit-chain closure (Part B).
-- Additive only; V013 and V017 are not edited destructively.
--
-- The input and result hashes are computed over exact manifests (input
-- manifest and result envelope). This migration persists those manifests in
-- canonized (tagged, JSON-safe) form so both hashes are independently
-- reproducible from the stored record alone — no undocumented reconstruction
-- from scattered columns. The existing query-oriented columns
-- (result_json, warnings_json, validation_results_json, status, eligibility,
-- missing_fields_json) remain as projections and must not contradict the
-- envelope; the TypeScript persistence adapter enforces that agreement.

ALTER TABLE financial_calculation_runs
  ADD COLUMN IF NOT EXISTS input_manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE financial_calculation_runs
  ADD COLUMN IF NOT EXISTS result_envelope_json jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE financial_calculation_runs
  ADD COLUMN IF NOT EXISTS assumptions_used_json jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE financial_calculation_runs
  ADD COLUMN IF NOT EXISTS contradictions_json jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE financial_calculation_runs
  ADD COLUMN IF NOT EXISTS execution_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Structural checks: manifests are JSON objects, list fields are JSON arrays.
-- Defaults above only serve legacy rows; the persistence adapter always
-- supplies complete values for new records.
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_input_manifest_is_object
  CHECK (jsonb_typeof(input_manifest_json) = 'object');
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_result_envelope_is_object
  CHECK (jsonb_typeof(result_envelope_json) = 'object');
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_assumptions_is_array
  CHECK (jsonb_typeof(assumptions_used_json) = 'array');
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_contradictions_is_array
  CHECK (jsonb_typeof(contradictions_json) = 'array');
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_execution_metadata_is_object
  CHECK (jsonb_typeof(execution_metadata_json) = 'object');

-- Scenario identity: the Workbench scenario engine produces named scenario
-- identities (e.g. 'fx_up'), not UUIDs. Widening uuid → text preserves every
-- existing value losslessly (uuid casts cleanly to its canonical text form)
-- and lets scenario identity persist exactly as hashed in the input manifest.
ALTER TABLE financial_calculation_runs
  ALTER COLUMN scenario_id TYPE text USING scenario_id::text;

-- Append-only protections from V013/V015 remain in force (no UPDATE/DELETE);
-- this migration adds no Finance-table foreign keys and touches no canonical
-- Finance objects.
