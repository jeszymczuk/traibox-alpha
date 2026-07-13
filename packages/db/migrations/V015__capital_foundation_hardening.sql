-- Capital Agent v1.1 Phase 1 hardening (founder directive, decisions CA-113…CA-115).
-- Additive over V012–V014. Four concerns:
--   1) principal-aware database context + RLS (org-only isolation was Phase 1
--      initial state; this migration adds real principal isolation);
--   2) cross-record org/principal ownership consistency via composite FKs;
--   3) append-only audit immutability with a governed-purge escape hatch;
--   4) protected-action payload freezing + approval binding + SoD.
--
-- Principal identity (CA-113): organization-backed. principal_id is the org
-- uuid; principal_type states the role. Active company rows MUST satisfy
-- principal_id = org_id (CHECK below). financier/platform_internal stay
-- reserved: only company mandates may be status='active' until a future
-- migration lifts it deliberately.

-- ---------------------------------------------------------------------------
-- 1. Principal context functions (mirror app.current_org()).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_principal_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_principal_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_principal_type() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_principal_type', true), '');
$$;

-- ---------------------------------------------------------------------------
-- 2. Company-principal binding invariant + company-only activation.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_mandates ADD CONSTRAINT agent_mandates_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE agent_mandates ADD CONSTRAINT agent_mandates_company_only_active
  CHECK (status <> 'active' OR principal_type = 'company');
ALTER TABLE agent_outcomes ADD CONSTRAINT agent_outcomes_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE capital_artifacts ADD CONSTRAINT capital_artifacts_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE protected_action_proposals ADD CONSTRAINT proposals_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE memory_items ADD CONSTRAINT memory_items_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE specialist_task_requests ADD CONSTRAINT specialist_requests_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE capital_monitoring_states ADD CONSTRAINT monitoring_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE alpha_agent_tasks ADD CONSTRAINT alpha_agent_tasks_company_principal
  CHECK (principal_type IS NULL OR principal_type <> 'company' OR principal_id = org_id);

-- ---------------------------------------------------------------------------
-- 3. Principal columns on child tables (explicit columns preferred over
--    EXISTS policies for auditability + indexing). All capital tables are
--    empty at this point, so NOT NULL is safe.
-- ---------------------------------------------------------------------------
ALTER TABLE capital_artifact_versions ADD COLUMN IF NOT EXISTS principal_id uuid NOT NULL;
ALTER TABLE capital_artifact_versions ADD COLUMN IF NOT EXISTS principal_type text NOT NULL
  CHECK (principal_type IN ('company', 'financier', 'platform_internal'));
ALTER TABLE capital_artifact_versions ADD CONSTRAINT artifact_versions_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);

ALTER TABLE evidence_references ADD COLUMN IF NOT EXISTS principal_id uuid NOT NULL;
ALTER TABLE evidence_references ADD COLUMN IF NOT EXISTS principal_type text NOT NULL
  CHECK (principal_type IN ('company', 'financier', 'platform_internal'));
ALTER TABLE evidence_references ADD CONSTRAINT evidence_references_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);

ALTER TABLE specialist_reads ADD COLUMN IF NOT EXISTS principal_id uuid NOT NULL;
ALTER TABLE specialist_reads ADD COLUMN IF NOT EXISTS principal_type text NOT NULL
  CHECK (principal_type IN ('company', 'financier', 'platform_internal'));
ALTER TABLE specialist_reads ADD CONSTRAINT specialist_reads_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);

-- Profiles get an unambiguous principal_id like every other foundational record.
ALTER TABLE user_operating_profiles ADD COLUMN IF NOT EXISTS principal_id uuid NOT NULL;
ALTER TABLE user_operating_profiles ADD CONSTRAINT user_profiles_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);
ALTER TABLE org_finance_profiles ADD COLUMN IF NOT EXISTS principal_id uuid NOT NULL;
ALTER TABLE org_finance_profiles ADD CONSTRAINT org_profiles_company_principal
  CHECK (principal_type <> 'company' OR principal_id = org_id);

-- ---------------------------------------------------------------------------
-- 4. Ownership unique keys (targets for composite FKs).
-- ---------------------------------------------------------------------------
ALTER TABLE alpha_agent_tasks ADD CONSTRAINT alpha_agent_tasks_ownership_unique
  UNIQUE (agent_task_id, org_id, principal_id, principal_type);
ALTER TABLE agent_mandates ADD CONSTRAINT agent_mandates_ownership_unique
  UNIQUE (mandate_id, version, org_id, principal_id, principal_type);
ALTER TABLE agent_outcomes ADD CONSTRAINT agent_outcomes_ownership_unique
  UNIQUE (outcome_id, org_id, principal_id, principal_type);
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_ownership_unique
  UNIQUE (bundle_id, org_id, principal_id, principal_type);
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_ownership_unique
  UNIQUE (claim_id, org_id, principal_id, principal_type);
ALTER TABLE capital_artifacts ADD CONSTRAINT capital_artifacts_ownership_unique
  UNIQUE (artifact_id, org_id, principal_id, principal_type);
ALTER TABLE specialist_task_requests ADD CONSTRAINT specialist_requests_ownership_unique
  UNIQUE (request_id, org_id, principal_id, principal_type);

-- ---------------------------------------------------------------------------
-- 5. Composite ownership foreign keys. Simple single-column FKs are replaced
--    where ownership consistency matters; NO ACTION (statement-end check)
--    keeps full-organization cascade deletion workable while blocking
--    single-parent deletion under surviving audit children.
--    NOTE: replacing ON DELETE SET NULL with NO ACTION is deliberate —
--    audit-grade lineage must not be silently detached (see §6).
-- ---------------------------------------------------------------------------
-- Mandate binding.
ALTER TABLE agent_outcomes DROP CONSTRAINT IF EXISTS agent_outcomes_mandate_fk;
ALTER TABLE agent_outcomes ADD CONSTRAINT agent_outcomes_mandate_owned_fk
  FOREIGN KEY (mandate_id, mandate_version, org_id, principal_id, principal_type)
  REFERENCES agent_mandates (mandate_id, version, org_id, principal_id, principal_type);
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_mandate_owned_fk
  FOREIGN KEY (mandate_id, mandate_version, org_id, principal_id, principal_type)
  REFERENCES agent_mandates (mandate_id, version, org_id, principal_id, principal_type);
ALTER TABLE capital_artifacts ADD CONSTRAINT capital_artifacts_mandate_owned_fk
  FOREIGN KEY (mandate_id, mandate_version, org_id, principal_id, principal_type)
  REFERENCES agent_mandates (mandate_id, version, org_id, principal_id, principal_type);
ALTER TABLE protected_action_proposals ADD CONSTRAINT proposals_mandate_owned_fk
  FOREIGN KEY (mandate_id, mandate_version, org_id, principal_id, principal_type)
  REFERENCES agent_mandates (mandate_id, version, org_id, principal_id, principal_type);
ALTER TABLE capital_monitoring_states ADD CONSTRAINT monitoring_mandate_owned_fk
  FOREIGN KEY (mandate_id, mandate_version, org_id, principal_id, principal_type)
  REFERENCES agent_mandates (mandate_id, version, org_id, principal_id, principal_type);
ALTER TABLE alpha_agent_tasks ADD CONSTRAINT alpha_agent_tasks_mandate_owned_fk
  FOREIGN KEY (mandate_id, mandate_version, org_id, principal_id, principal_type)
  REFERENCES agent_mandates (mandate_id, version, org_id, principal_id, principal_type);

-- Task binding (capital-shape rows only; legacy rows keep NULL capital fields).
ALTER TABLE agent_outcomes DROP CONSTRAINT IF EXISTS agent_outcomes_task_id_fkey;
ALTER TABLE agent_outcomes ADD CONSTRAINT agent_outcomes_task_owned_fk
  FOREIGN KEY (task_id, org_id, principal_id, principal_type)
  REFERENCES alpha_agent_tasks (agent_task_id, org_id, principal_id, principal_type);
ALTER TABLE financial_calculation_runs DROP CONSTRAINT IF EXISTS financial_calculation_runs_task_id_fkey;
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_task_owned_fk
  FOREIGN KEY (task_id, org_id, principal_id, principal_type)
  REFERENCES alpha_agent_tasks (agent_task_id, org_id, principal_id, principal_type);
ALTER TABLE evidence_bundles DROP CONSTRAINT IF EXISTS evidence_bundles_task_id_fkey;
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_task_owned_fk
  FOREIGN KEY (task_id, org_id, principal_id, principal_type)
  REFERENCES alpha_agent_tasks (agent_task_id, org_id, principal_id, principal_type);
ALTER TABLE capital_artifacts DROP CONSTRAINT IF EXISTS capital_artifacts_task_id_fkey;
ALTER TABLE capital_artifacts ADD CONSTRAINT capital_artifacts_task_owned_fk
  FOREIGN KEY (task_id, org_id, principal_id, principal_type)
  REFERENCES alpha_agent_tasks (agent_task_id, org_id, principal_id, principal_type);
ALTER TABLE protected_action_proposals DROP CONSTRAINT IF EXISTS protected_action_proposals_proposed_by_task_id_fkey;
ALTER TABLE protected_action_proposals ADD CONSTRAINT proposals_task_owned_fk
  FOREIGN KEY (proposed_by_task_id, org_id, principal_id, principal_type)
  REFERENCES alpha_agent_tasks (agent_task_id, org_id, principal_id, principal_type);
ALTER TABLE specialist_task_requests DROP CONSTRAINT IF EXISTS specialist_task_requests_parent_task_id_fkey;
ALTER TABLE specialist_task_requests ADD CONSTRAINT specialist_requests_task_owned_fk
  FOREIGN KEY (parent_task_id, org_id, principal_id, principal_type)
  REFERENCES alpha_agent_tasks (agent_task_id, org_id, principal_id, principal_type);

-- Outcome binding.
ALTER TABLE financial_calculation_runs DROP CONSTRAINT IF EXISTS financial_calculation_runs_outcome_id_fkey;
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_outcome_owned_fk
  FOREIGN KEY (outcome_id, org_id, principal_id, principal_type)
  REFERENCES agent_outcomes (outcome_id, org_id, principal_id, principal_type);
ALTER TABLE evidence_bundles DROP CONSTRAINT IF EXISTS evidence_bundles_outcome_id_fkey;
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_outcome_owned_fk
  FOREIGN KEY (outcome_id, org_id, principal_id, principal_type)
  REFERENCES agent_outcomes (outcome_id, org_id, principal_id, principal_type);
ALTER TABLE capital_artifacts DROP CONSTRAINT IF EXISTS capital_artifacts_outcome_id_fkey;
ALTER TABLE capital_artifacts ADD CONSTRAINT capital_artifacts_outcome_owned_fk
  FOREIGN KEY (outcome_id, org_id, principal_id, principal_type)
  REFERENCES agent_outcomes (outcome_id, org_id, principal_id, principal_type);
ALTER TABLE protected_action_proposals DROP CONSTRAINT IF EXISTS protected_action_proposals_source_outcome_id_fkey;
ALTER TABLE protected_action_proposals ADD CONSTRAINT proposals_outcome_owned_fk
  FOREIGN KEY (source_outcome_id, org_id, principal_id, principal_type)
  REFERENCES agent_outcomes (outcome_id, org_id, principal_id, principal_type);

-- Evidence binding.
ALTER TABLE evidence_claims DROP CONSTRAINT IF EXISTS evidence_claims_bundle_id_fkey;
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_bundle_owned_fk
  FOREIGN KEY (bundle_id, org_id, principal_id, principal_type)
  REFERENCES evidence_bundles (bundle_id, org_id, principal_id, principal_type);
ALTER TABLE evidence_references DROP CONSTRAINT IF EXISTS evidence_references_claim_id_fkey;
ALTER TABLE evidence_references ADD CONSTRAINT evidence_references_claim_owned_fk
  FOREIGN KEY (claim_id, org_id, principal_id, principal_type)
  REFERENCES evidence_claims (claim_id, org_id, principal_id, principal_type);

-- Artifact binding.
ALTER TABLE capital_artifact_versions DROP CONSTRAINT IF EXISTS capital_artifact_versions_artifact_id_fkey;
ALTER TABLE capital_artifact_versions ADD CONSTRAINT artifact_versions_artifact_owned_fk
  FOREIGN KEY (artifact_id, org_id, principal_id, principal_type)
  REFERENCES capital_artifacts (artifact_id, org_id, principal_id, principal_type);
ALTER TABLE protected_action_proposals DROP CONSTRAINT IF EXISTS protected_action_proposals_source_artifact_id_fkey;
ALTER TABLE protected_action_proposals ADD CONSTRAINT proposals_artifact_owned_fk
  FOREIGN KEY (source_artifact_id, org_id, principal_id, principal_type)
  REFERENCES capital_artifacts (artifact_id, org_id, principal_id, principal_type);

-- Collaboration binding.
ALTER TABLE specialist_reads DROP CONSTRAINT IF EXISTS specialist_reads_request_id_fkey;
ALTER TABLE specialist_reads ADD CONSTRAINT specialist_reads_request_owned_fk
  FOREIGN KEY (request_id, org_id, principal_id, principal_type)
  REFERENCES specialist_task_requests (request_id, org_id, principal_id, principal_type);

-- ---------------------------------------------------------------------------
-- 6. Append-only guard (audit-grade records) with governed-purge escape.
--    Ordinary application roles can never UPDATE or DELETE these rows.
--    Governed system operations (full-organization deletion, legal retention
--    purges) must SET LOCAL app.allow_governed_purge = 'on' inside the
--    privileged transaction — this is the documented retention path; without
--    it, org deletion cascades will fail by design.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.capital_append_only_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.allow_governed_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are append-only; corrections require a new record (governed purge requires app.allow_governed_purge)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_calc_runs_append_only_update ON financial_calculation_runs;
CREATE TRIGGER trg_calc_runs_append_only_update BEFORE UPDATE ON financial_calculation_runs
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();
DROP TRIGGER IF EXISTS trg_calc_runs_append_only_delete ON financial_calculation_runs;
CREATE TRIGGER trg_calc_runs_append_only_delete BEFORE DELETE ON financial_calculation_runs
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();

DROP TRIGGER IF EXISTS trg_evidence_claims_append_only_update ON evidence_claims;
CREATE TRIGGER trg_evidence_claims_append_only_update BEFORE UPDATE ON evidence_claims
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();
DROP TRIGGER IF EXISTS trg_evidence_claims_append_only_delete ON evidence_claims;
CREATE TRIGGER trg_evidence_claims_append_only_delete BEFORE DELETE ON evidence_claims
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();

DROP TRIGGER IF EXISTS trg_evidence_references_append_only_update ON evidence_references;
CREATE TRIGGER trg_evidence_references_append_only_update BEFORE UPDATE ON evidence_references
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();
DROP TRIGGER IF EXISTS trg_evidence_references_append_only_delete ON evidence_references;
CREATE TRIGGER trg_evidence_references_append_only_delete BEFORE DELETE ON evidence_references
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();

-- Evidence bundles: append-only FROM CREATION (documented choice — the bundle
-- row is written once at persist time; claims attach via their own inserts).
DROP TRIGGER IF EXISTS trg_evidence_bundles_append_only_update ON evidence_bundles;
CREATE TRIGGER trg_evidence_bundles_append_only_update BEFORE UPDATE ON evidence_bundles
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();
DROP TRIGGER IF EXISTS trg_evidence_bundles_append_only_delete ON evidence_bundles;
CREATE TRIGGER trg_evidence_bundles_append_only_delete BEFORE DELETE ON evidence_bundles
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();

-- Artifact versions: V013 blocked UPDATE only; close the DELETE gap and use
-- the shared guard for both.
DROP TRIGGER IF EXISTS trg_capital_artifact_versions_immutable ON capital_artifact_versions;
DROP TRIGGER IF EXISTS trg_artifact_versions_append_only_update ON capital_artifact_versions;
CREATE TRIGGER trg_artifact_versions_append_only_update BEFORE UPDATE ON capital_artifact_versions
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();
DROP TRIGGER IF EXISTS trg_artifact_versions_append_only_delete ON capital_artifact_versions;
CREATE TRIGGER trg_artifact_versions_append_only_delete BEFORE DELETE ON capital_artifact_versions
  FOR EACH ROW EXECUTE FUNCTION app.capital_append_only_guard();

-- ---------------------------------------------------------------------------
-- 7. Protected-action proposals: approval binding + payload freezing + SoD.
-- ---------------------------------------------------------------------------
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS proposed_by_user_id uuid REFERENCES app_users(user_id) ON DELETE SET NULL;
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS approval_request_id uuid;
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS approved_by_user_id uuid REFERENCES app_users(user_id) ON DELETE SET NULL;
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS approved_payload_hash text;
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS rejected_by_user_id uuid REFERENCES app_users(user_id) ON DELETE SET NULL;
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
ALTER TABLE protected_action_proposals ADD COLUMN IF NOT EXISTS decision_rationale text;

CREATE OR REPLACE FUNCTION app.protected_action_proposal_guard()
RETURNS trigger AS $$
BEGIN
  -- Payload freezing: once a proposal leaves 'draft', the fields that define
  -- the proposed action are frozen. A changed payload needs a NEW proposal
  -- with a new id, hash, and approval.
  IF OLD.status <> 'draft' THEN
    IF NEW.proposal_type IS DISTINCT FROM OLD.proposal_type
      OR NEW.target_domain IS DISTINCT FROM OLD.target_domain
      OR NEW.target_command IS DISTINCT FROM OLD.target_command
      OR NEW.target_object_ref_json IS DISTINCT FROM OLD.target_object_ref_json
      OR NEW.draft_payload_json IS DISTINCT FROM OLD.draft_payload_json
      OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash
      OR NEW.org_id IS DISTINCT FROM OLD.org_id
      OR NEW.principal_id IS DISTINCT FROM OLD.principal_id
      OR NEW.principal_type IS DISTINCT FROM OLD.principal_type
      OR NEW.mandate_id IS DISTINCT FROM OLD.mandate_id
      OR NEW.mandate_version IS DISTINCT FROM OLD.mandate_version
      OR NEW.source_outcome_id IS DISTINCT FROM OLD.source_outcome_id
      OR NEW.source_artifact_id IS DISTINCT FROM OLD.source_artifact_id
      OR NEW.source_artifact_version IS DISTINCT FROM OLD.source_artifact_version
      OR NEW.evidence_refs_json IS DISTINCT FROM OLD.evidence_refs_json
      OR NEW.calculation_run_ids_json IS DISTINCT FROM OLD.calculation_run_ids_json
      OR NEW.separation_of_duties_json IS DISTINCT FROM OLD.separation_of_duties_json
      OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
      OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
      OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
      OR NEW.proposed_by_user_id IS DISTINCT FROM OLD.proposed_by_user_id
    THEN
      RAISE EXCEPTION 'protected_action_proposals: action-defining fields are frozen after draft; create a new proposal';
    END IF;
  END IF;

  -- The organization is immutable even in draft.
  IF TG_OP = 'UPDATE' AND NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'protected_action_proposals: org_id is immutable';
  END IF;

  -- Approval binding: an approved proposal must carry the full approval
  -- record and the approved hash must equal the frozen payload hash.
  IF NEW.status = 'approved' THEN
    IF NEW.approval_request_id IS NULL
      OR NEW.approved_by_user_id IS NULL
      OR NEW.approved_at IS NULL
      OR NEW.approved_payload_hash IS NULL
    THEN
      RAISE EXCEPTION 'protected_action_proposals: approved status requires approval_request_id, approved_by_user_id, approved_at, approved_payload_hash';
    END IF;
    IF NEW.approved_payload_hash IS DISTINCT FROM NEW.payload_hash THEN
      RAISE EXCEPTION 'protected_action_proposals: approved_payload_hash must equal payload_hash';
    END IF;
    -- Separation of duties: the proposer cannot approve their own proposal.
    IF COALESCE(NEW.separation_of_duties_json->>'proposer_cannot_approve', 'true') = 'true'
      AND NEW.proposed_by_user_id IS NOT NULL
      AND NEW.approved_by_user_id = NEW.proposed_by_user_id
    THEN
      RAISE EXCEPTION 'protected_action_proposals: separation of duties — proposer cannot approve their own proposal';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protected_action_proposal_guard ON protected_action_proposals;
CREATE TRIGGER trg_protected_action_proposal_guard
  BEFORE UPDATE ON protected_action_proposals
  FOR EACH ROW EXECUTE FUNCTION app.protected_action_proposal_guard();

-- Inserting directly as 'approved' must satisfy the same binding.
CREATE OR REPLACE FUNCTION app.protected_action_proposal_insert_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'approved' THEN
    RAISE EXCEPTION 'protected_action_proposals: a proposal cannot be created directly in approved status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protected_action_proposal_insert_guard ON protected_action_proposals;
CREATE TRIGGER trg_protected_action_proposal_insert_guard
  BEFORE INSERT ON protected_action_proposals
  FOR EACH ROW EXECUTE FUNCTION app.protected_action_proposal_insert_guard();

-- ---------------------------------------------------------------------------
-- 8. Principal-aware RLS. Replaces the Phase 1 org-only policies on
--    principal-owned Capital tables. Context comes from setAppContext
--    (app.current_principal_id / app.current_principal_type); company-side
--    requests set principal_id = org id, principal_type = 'company'.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS agent_mandates_rw ON agent_mandates;
CREATE POLICY agent_mandates_rw ON agent_mandates FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS agent_outcomes_rw ON agent_outcomes;
CREATE POLICY agent_outcomes_rw ON agent_outcomes FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS financial_calculation_runs_rw ON financial_calculation_runs;
CREATE POLICY financial_calculation_runs_rw ON financial_calculation_runs FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS evidence_bundles_rw ON evidence_bundles;
CREATE POLICY evidence_bundles_rw ON evidence_bundles FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS evidence_claims_rw ON evidence_claims;
CREATE POLICY evidence_claims_rw ON evidence_claims FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS evidence_references_rw ON evidence_references;
CREATE POLICY evidence_references_rw ON evidence_references FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS capital_artifacts_rw ON capital_artifacts;
CREATE POLICY capital_artifacts_rw ON capital_artifacts FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS capital_artifact_versions_rw ON capital_artifact_versions;
CREATE POLICY capital_artifact_versions_rw ON capital_artifact_versions FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS protected_action_proposals_rw ON protected_action_proposals;
CREATE POLICY protected_action_proposals_rw ON protected_action_proposals FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS memory_items_rw ON memory_items;
CREATE POLICY memory_items_rw ON memory_items FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS user_operating_profiles_rw ON user_operating_profiles;
CREATE POLICY user_operating_profiles_rw ON user_operating_profiles FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS org_finance_profiles_rw ON org_finance_profiles;
CREATE POLICY org_finance_profiles_rw ON org_finance_profiles FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS specialist_task_requests_rw ON specialist_task_requests;
CREATE POLICY specialist_task_requests_rw ON specialist_task_requests FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS specialist_reads_rw ON specialist_reads;
CREATE POLICY specialist_reads_rw ON specialist_reads FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

DROP POLICY IF EXISTS capital_monitoring_states_rw ON capital_monitoring_states;
CREATE POLICY capital_monitoring_states_rw ON capital_monitoring_states FOR ALL
  USING (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type())
  WITH CHECK (org_id = app.current_org() AND principal_id = app.current_principal_id() AND principal_type = app.current_principal_type());

-- Supporting indexes for the principal-aware predicates.
CREATE INDEX IF NOT EXISTS idx_agent_mandates_principal ON agent_mandates (org_id, principal_id, principal_type);
CREATE INDEX IF NOT EXISTS idx_agent_outcomes_principal ON agent_outcomes (org_id, principal_id, principal_type);
CREATE INDEX IF NOT EXISTS idx_calc_runs_principal ON financial_calculation_runs (org_id, principal_id, principal_type);
CREATE INDEX IF NOT EXISTS idx_capital_artifacts_principal ON capital_artifacts (org_id, principal_id, principal_type);
CREATE INDEX IF NOT EXISTS idx_proposals_principal ON protected_action_proposals (org_id, principal_id, principal_type);
