-- Capital Agent v1.1 Phase 1 (decisions CA-101/102/104, spec §4/§7).
-- Additive only. Principal strategy: a clearly enforced principal REFERENCE
-- (principal_id + principal_type + org_id with CHECK + RLS) rather than a
-- separate principals table — principals derive from authenticated tenancy
-- (org + type); company principals use the org id as principal_id initially.
-- A dedicated principals table can be added additively when financier
-- onboarding needs one. Agent/outcome/formula DEFINITIONS live in
-- version-controlled code; instances persist here.

-- ---------------------------------------------------------------------------
-- Mandates: the agent's authorized remit for one principal. Versioned;
-- a task binds to one exact (mandate_id, version).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_mandates (
  mandate_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mandate_id uuid NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  agent_class text NOT NULL CHECK (agent_class IN (
    'capital_agent', 'compliance_agent', 'risk_agent', 'market_network_agent',
    'trade_operations_agent', 'audit_monitoring_agent', 'concierge_coordinator'
  )),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'suspended', 'expired', 'revoked')),
  allowed_outcome_types_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  permitted_tool_classes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  permitted_data_classes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  permitted_specialist_reads_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  permitted_proposal_kinds_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  authority_ceiling text NOT NULL CHECK (authority_ceiling IN (
    'observe', 'calculate', 'analyse', 'recommend', 'draft', 'monitor', 'propose_protected_action'
  )),
  prohibited_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_sensitivity text NOT NULL DEFAULT 'confidential' CHECK (max_sensitivity IN (
    'public', 'internal', 'confidential', 'restricted_financial', 'regulated_personal'
  )),
  disclosure_policy_id text NOT NULL,
  policy_refs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  issued_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  accepted_at timestamptz,
  audit_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_mandates_version_unique UNIQUE (mandate_id, version),
  CONSTRAINT agent_mandates_expiry_consistent CHECK (expires_at IS NULL OR expires_at > effective_from)
);

DROP TRIGGER IF EXISTS trg_agent_mandates_updated_at ON agent_mandates;
CREATE TRIGGER trg_agent_mandates_updated_at BEFORE UPDATE ON agent_mandates FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_agent_mandates_org_principal ON agent_mandates (org_id, principal_type, status);
CREATE INDEX IF NOT EXISTS idx_agent_mandates_mandate ON agent_mandates (mandate_id, version DESC);

ALTER TABLE agent_mandates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_mandates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_mandates_rw ON agent_mandates;
CREATE POLICY agent_mandates_rw ON agent_mandates
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Outcome instances (definitions live in code). Intelligence products only —
-- NOT Finance objects; no FK into Finance tables, references go through the
-- typed CanonicalObjectRef contract in input_object_refs_json.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_outcomes (
  outcome_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_type text NOT NULL CHECK (outcome_type IN (
    'capital_diagnosis', 'trade_cost_analysis', 'landed_cost_analysis', 'transaction_pnl',
    'portfolio_pnl', 'cashflow_forecast', 'working_capital_analysis', 'scenario_model',
    'financing_need_classification', 'financing_strategy', 'financing_option_comparison',
    'funding_packet', 'term_sheet_review', 'financial_counteroffer', 'capital_plan',
    'treasury_liquidity_plan', 'fx_exposure_analysis', 'instrument_blueprint',
    'milestone_monitoring_report', 'underwriting_pre_read', 'credit_memo_draft',
    'allocation_memo_draft', 'portfolio_exposure_brief'
  )),
  definition_version text NOT NULL,
  task_id uuid NOT NULL REFERENCES alpha_agent_tasks(agent_task_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  mandate_id uuid NOT NULL,
  mandate_version integer NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'gathering_context', 'needs_information', 'specialist_reads_pending',
    'calculating', 'draft_ready', 'under_review', 'finalised', 'superseded',
    'blocked', 'failed', 'abstained'
  )),
  inputs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_object_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_bundle_id uuid,
  calculation_run_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_questions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradiction_claim_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  authority_level text NOT NULL CHECK (authority_level IN (
    'observe', 'calculate', 'analyse', 'recommend', 'draft', 'monitor', 'propose_protected_action'
  )),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_outcome_id uuid REFERENCES agent_outcomes(outcome_id) ON DELETE SET NULL,
  trace_id text NOT NULL,
  audit_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_outcomes_mandate_fk FOREIGN KEY (mandate_id, mandate_version)
    REFERENCES agent_mandates (mandate_id, version)
);

DROP TRIGGER IF EXISTS trg_agent_outcomes_updated_at ON agent_outcomes;
CREATE TRIGGER trg_agent_outcomes_updated_at BEFORE UPDATE ON agent_outcomes FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_agent_outcomes_org_status ON agent_outcomes (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_outcomes_task ON agent_outcomes (task_id);

ALTER TABLE agent_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_outcomes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_outcomes_rw ON agent_outcomes;
CREATE POLICY agent_outcomes_rw ON agent_outcomes
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- alpha_agent_tasks: additive evolution (decision CA-104). Nullable columns;
-- existing rows and callers unaffected. outcome_id carries no FK to avoid a
-- circular constraint with agent_outcomes.task_id.
-- ---------------------------------------------------------------------------
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS principal_id uuid;
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS principal_type text;
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS mandate_id uuid;
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS mandate_version integer;
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS outcome_id uuid;
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS task_contract_version text;
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS definition_version text;

ALTER TABLE alpha_agent_tasks DROP CONSTRAINT IF EXISTS alpha_agent_tasks_principal_type_check;
ALTER TABLE alpha_agent_tasks ADD CONSTRAINT alpha_agent_tasks_principal_type_check
  CHECK (principal_type IS NULL OR principal_type IN ('company', 'financier', 'platform_internal'));

CREATE INDEX IF NOT EXISTS idx_alpha_agent_tasks_mandate ON alpha_agent_tasks (mandate_id) WHERE mandate_id IS NOT NULL;
