-- Capital Agent v1.1 Phase 1: deterministic calculation runs, evidence, and
-- versioned artifacts (spec §8/§11/§12). Additive; RLS on every table.
-- Calculation and evidence records are effectively immutable once written;
-- artifact versions are enforced immutable (trigger below).

-- ---------------------------------------------------------------------------
-- Deterministic calculation runs (the Financial Workbench's ledger of record).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_calculation_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculator_id text NOT NULL,
  calculator_version text NOT NULL,
  formula_version text NOT NULL,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  mandate_id uuid NOT NULL,
  mandate_version integer NOT NULL,
  task_id uuid REFERENCES alpha_agent_tasks(agent_task_id) ON DELETE SET NULL,
  outcome_id uuid REFERENCES agent_outcomes(outcome_id) ON DELETE SET NULL,
  scenario_id uuid,
  input_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_provenance_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumption_claim_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  rounding_policy_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_hash text NOT NULL CHECK (length(input_hash) > 0),
  result_hash text NOT NULL CHECK (length(result_hash) > 0),
  warnings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  validation_results_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'failed', 'invalid_input')),
  executed_by text NOT NULL DEFAULT 'workbench' CHECK (executed_by = 'workbench'),
  actor_user_id uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calc_runs_org_created ON financial_calculation_runs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calc_runs_outcome ON financial_calculation_runs (outcome_id) WHERE outcome_id IS NOT NULL;

ALTER TABLE financial_calculation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_calculation_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS financial_calculation_runs_rw ON financial_calculation_runs;
CREATE POLICY financial_calculation_runs_rw ON financial_calculation_runs
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Evidence bundles, claims, and references.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS evidence_bundles (
  bundle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  task_id uuid REFERENCES alpha_agent_tasks(agent_task_id) ON DELETE SET NULL,
  outcome_id uuid REFERENCES agent_outcomes(outcome_id) ON DELETE SET NULL,
  source_access_log_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  specialist_read_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_versions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_bundles_org ON evidence_bundles (org_id, created_at DESC);

ALTER TABLE evidence_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_bundles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_bundles_rw ON evidence_bundles;
CREATE POLICY evidence_bundles_rw ON evidence_bundles
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

CREATE TABLE IF NOT EXISTS evidence_claims (
  claim_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id uuid REFERENCES evidence_bundles(bundle_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  claim_type text NOT NULL CHECK (claim_type IN (
    'verified_fact', 'inference', 'assumption', 'estimate', 'calculation',
    'recommendation', 'unresolved_question', 'contradiction'
  )),
  statement text NOT NULL,
  structured_value_json jsonb,
  subject text,
  object_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility_scope text NOT NULL DEFAULT 'principal' CHECK (visibility_scope IN ('principal', 'organization', 'disclosed')),
  sensitivity text CHECK (sensitivity IS NULL OR sensitivity IN (
    'public', 'internal', 'confidential', 'restricted_financial', 'regulated_personal'
  )),
  observed_at timestamptz,
  as_of timestamptz,
  freshness text CHECK (freshness IS NULL OR freshness IN ('current', 'recent', 'stale', 'unknown')),
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  verification_status text NOT NULL CHECK (verification_status IN (
    'verified', 'partially_verified', 'unverified', 'conflicting', 'stale', 'not_applicable'
  )),
  materiality text NOT NULL CHECK (materiality IN ('critical', 'material', 'supporting')),
  calculation_run_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  assumption_claim_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradicts_claim_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  supersedes_claim_id uuid REFERENCES evidence_claims(claim_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_claims_bundle ON evidence_claims (bundle_id);
CREATE INDEX IF NOT EXISTS idx_evidence_claims_org_type ON evidence_claims (org_id, claim_type);

ALTER TABLE evidence_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_claims_rw ON evidence_claims;
CREATE POLICY evidence_claims_rw ON evidence_claims
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- Typed references from claims to canonical objects in either Finance layer.
-- No FK into Finance tables by design (CA-105): layers do not share ids and
-- the reference must never imply write access.
CREATE TABLE IF NOT EXISTS evidence_references (
  reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES evidence_claims(claim_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  source_layer text NOT NULL CHECK (source_layer IN ('relational', 'alpha_object', 'external')),
  domain text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  trade_id uuid,
  object_version text,
  observed_at timestamptz,
  access_scope text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_references_claim ON evidence_references (claim_id);

ALTER TABLE evidence_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_references FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_references_rw ON evidence_references;
CREATE POLICY evidence_references_rw ON evidence_references
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Capital artifacts (identity) + immutable versions (content).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capital_artifacts (
  artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_type text NOT NULL CHECK (artifact_type IN (
    'capital_diagnosis', 'trade_cost_model', 'landed_cost_model', 'transaction_pnl',
    'portfolio_pnl', 'cashflow_forecast', 'working_capital_plan', 'scenario_model',
    'financing_strategy', 'financing_packet', 'capital_plan', 'treasury_plan', 'fx_plan',
    'term_sheet_review', 'financial_counteroffer', 'instrument_blueprint',
    'milestone_monitoring_report', 'underwriting_memorandum', 'credit_memo_draft',
    'allocation_memo_draft', 'portfolio_exposure_brief'
  )),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  mandate_id uuid NOT NULL,
  mandate_version integer NOT NULL,
  outcome_id uuid NOT NULL REFERENCES agent_outcomes(outcome_id) ON DELETE CASCADE,
  task_id uuid REFERENCES alpha_agent_tasks(agent_task_id) ON DELETE SET NULL,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_ready', 'finalised', 'superseded')),
  visibility_scope text NOT NULL DEFAULT 'principal' CHECK (visibility_scope IN ('principal', 'organization', 'disclosed')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  authority_level text NOT NULL CHECK (authority_level IN (
    'observe', 'calculate', 'analyse', 'recommend', 'draft', 'monitor', 'propose_protected_action'
  )),
  linked_object_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id text NOT NULL,
  audit_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_capital_artifacts_updated_at ON capital_artifacts;
CREATE TRIGGER trg_capital_artifacts_updated_at BEFORE UPDATE ON capital_artifacts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_capital_artifacts_org_status ON capital_artifacts (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_capital_artifacts_outcome ON capital_artifacts (outcome_id);

ALTER TABLE capital_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capital_artifacts_rw ON capital_artifacts;
CREATE POLICY capital_artifacts_rw ON capital_artifacts
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

CREATE TABLE IF NOT EXISTS capital_artifact_versions (
  artifact_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES capital_artifacts(artifact_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  schema_version text NOT NULL,
  content_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_bundle_id uuid REFERENCES evidence_bundles(bundle_id) ON DELETE SET NULL,
  calculation_run_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_questions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  specialist_read_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_by_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT capital_artifact_versions_unique UNIQUE (artifact_id, version)
);

-- Artifact versions are immutable: a new version appends, never overwrites.
CREATE OR REPLACE FUNCTION app.capital_artifact_versions_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'capital_artifact_versions rows are immutable; create a new version instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_capital_artifact_versions_immutable ON capital_artifact_versions;
CREATE TRIGGER trg_capital_artifact_versions_immutable
  BEFORE UPDATE ON capital_artifact_versions
  FOR EACH ROW EXECUTE FUNCTION app.capital_artifact_versions_immutable();

CREATE INDEX IF NOT EXISTS idx_capital_artifact_versions_artifact ON capital_artifact_versions (artifact_id, version DESC);

ALTER TABLE capital_artifact_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_artifact_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capital_artifact_versions_rw ON capital_artifact_versions;
CREATE POLICY capital_artifact_versions_rw ON capital_artifact_versions
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());
