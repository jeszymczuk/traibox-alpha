-- Capital Agent v1.1 Phase 1 closure (founder directive Part A). Additive over
-- V012–V015. Four concerns: hybrid legacy/Capital task RLS, all-or-none
-- Capital task binding, complete organization-backed principal identity, and
-- proposal lifecycle / terminal-decision immutability + governed-purge
-- authorization hardening.

-- ---------------------------------------------------------------------------
-- A2. All-or-none Capital task binding. SQL composite FKs skip validation
-- when any referencing column is NULL, so partial bindings must be rejected
-- explicitly. Legacy Alpha rows keep every Capital field NULL (including
-- outcome_id and definition_version); a Capital task provides the complete
-- core binding (definition_version and outcome_id may arrive later in the
-- task lifecycle, but only on a fully bound Capital row).
-- ---------------------------------------------------------------------------
ALTER TABLE alpha_agent_tasks ADD CONSTRAINT alpha_agent_tasks_capital_binding_all_or_none
  CHECK (
    (
      principal_id IS NULL
      AND principal_type IS NULL
      AND mandate_id IS NULL
      AND mandate_version IS NULL
      AND task_contract_version IS NULL
      AND definition_version IS NULL
      AND outcome_id IS NULL
    )
    OR (
      principal_id IS NOT NULL
      AND principal_type IS NOT NULL
      AND mandate_id IS NOT NULL
      AND mandate_version IS NOT NULL
      AND task_contract_version IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- A1. Hybrid legacy/Capital RLS for alpha_agent_tasks. Legacy rows (no
-- Capital binding) keep the original organization-scoped behavior so existing
-- /v1/agents/tasks callers work unchanged. Capital rows additionally require
-- explicit principal context — organization context alone sees no Capital
-- tasks. (With the all-or-none CHECK above, principal_id IS NULL alone
-- classifies a legacy row; the full conjunction is kept for defense in depth.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS alpha_agent_tasks_rw ON alpha_agent_tasks;
CREATE POLICY alpha_agent_tasks_rw ON alpha_agent_tasks
  FOR ALL
  USING (
    org_id = app.current_org()
    AND (
      (
        principal_id IS NULL
        AND principal_type IS NULL
        AND mandate_id IS NULL
        AND mandate_version IS NULL
        AND task_contract_version IS NULL
      )
      OR (
        principal_id = app.current_principal_id()
        AND principal_type = app.current_principal_type()
      )
    )
  )
  WITH CHECK (
    org_id = app.current_org()
    AND (
      (
        principal_id IS NULL
        AND principal_type IS NULL
        AND mandate_id IS NULL
        AND mandate_version IS NULL
        AND task_contract_version IS NULL
      )
      OR (
        principal_id = app.current_principal_id()
        AND principal_type = app.current_principal_type()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- A3. Complete organization-backed principal identity (CA-113 extended).
-- principal_id IS the organization uuid for ALL principal types — company,
-- financier (still inactive), and platform_internal (alpha-stage rule:
-- org-backed like the others; a dedicated platform identity would arrive via
-- a future migration). Arbitrary, unowned principal UUIDs are unrepresentable.
-- Replaces the company-only CHECKs from V015.
-- ---------------------------------------------------------------------------
ALTER TABLE agent_mandates DROP CONSTRAINT IF EXISTS agent_mandates_company_principal;
ALTER TABLE agent_mandates ADD CONSTRAINT agent_mandates_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE agent_outcomes DROP CONSTRAINT IF EXISTS agent_outcomes_company_principal;
ALTER TABLE agent_outcomes ADD CONSTRAINT agent_outcomes_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE financial_calculation_runs DROP CONSTRAINT IF EXISTS calc_runs_company_principal;
ALTER TABLE financial_calculation_runs ADD CONSTRAINT calc_runs_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE evidence_bundles DROP CONSTRAINT IF EXISTS evidence_bundles_company_principal;
ALTER TABLE evidence_bundles ADD CONSTRAINT evidence_bundles_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE evidence_claims DROP CONSTRAINT IF EXISTS evidence_claims_company_principal;
ALTER TABLE evidence_claims ADD CONSTRAINT evidence_claims_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE evidence_references DROP CONSTRAINT IF EXISTS evidence_references_company_principal;
ALTER TABLE evidence_references ADD CONSTRAINT evidence_references_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE capital_artifacts DROP CONSTRAINT IF EXISTS capital_artifacts_company_principal;
ALTER TABLE capital_artifacts ADD CONSTRAINT capital_artifacts_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE capital_artifact_versions DROP CONSTRAINT IF EXISTS artifact_versions_company_principal;
ALTER TABLE capital_artifact_versions ADD CONSTRAINT artifact_versions_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE protected_action_proposals DROP CONSTRAINT IF EXISTS proposals_company_principal;
ALTER TABLE protected_action_proposals ADD CONSTRAINT proposals_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE memory_items DROP CONSTRAINT IF EXISTS memory_items_company_principal;
ALTER TABLE memory_items ADD CONSTRAINT memory_items_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE specialist_task_requests DROP CONSTRAINT IF EXISTS specialist_requests_company_principal;
ALTER TABLE specialist_task_requests ADD CONSTRAINT specialist_requests_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE specialist_reads DROP CONSTRAINT IF EXISTS specialist_reads_company_principal;
ALTER TABLE specialist_reads ADD CONSTRAINT specialist_reads_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE capital_monitoring_states DROP CONSTRAINT IF EXISTS monitoring_company_principal;
ALTER TABLE capital_monitoring_states ADD CONSTRAINT monitoring_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE user_operating_profiles DROP CONSTRAINT IF EXISTS user_profiles_company_principal;
ALTER TABLE user_operating_profiles ADD CONSTRAINT user_profiles_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE org_finance_profiles DROP CONSTRAINT IF EXISTS org_profiles_company_principal;
ALTER TABLE org_finance_profiles ADD CONSTRAINT org_profiles_org_backed_principal CHECK (principal_id = org_id);
ALTER TABLE alpha_agent_tasks DROP CONSTRAINT IF EXISTS alpha_agent_tasks_company_principal;
ALTER TABLE alpha_agent_tasks ADD CONSTRAINT alpha_agent_tasks_org_backed_principal
  CHECK (principal_id IS NULL OR principal_id = org_id);

-- ---------------------------------------------------------------------------
-- A5. Proposal lifecycle state machine + terminal-decision immutability.
-- Extends the V015 guard. Terminal states: approved, rejected, expired,
-- withdrawn — once entered, status and every decision field are frozen.
-- Corrections require a new (superseding) proposal.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.protected_action_proposal_guard()
RETURNS trigger AS $$
DECLARE
  terminal_states text[] := ARRAY['approved', 'rejected', 'expired', 'withdrawn'];
BEGIN
  -- Lifecycle: validate status transitions.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = ANY (terminal_states) THEN
      RAISE EXCEPTION 'protected_action_proposals: % is a terminal state; corrections require a new proposal', OLD.status;
    END IF;
    IF NOT (
      (OLD.status = 'draft' AND NEW.status IN ('pending_policy_check', 'pending_approval', 'withdrawn'))
      OR (OLD.status = 'pending_policy_check' AND NEW.status IN ('pending_approval', 'rejected', 'expired', 'withdrawn'))
      OR (OLD.status = 'pending_approval' AND NEW.status IN ('approved', 'rejected', 'expired', 'withdrawn'))
    ) THEN
      RAISE EXCEPTION 'protected_action_proposals: illegal status transition % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  -- Terminal decision immutability: once terminal, decision metadata is frozen.
  IF OLD.status = ANY (terminal_states) THEN
    IF NEW.approval_request_id IS DISTINCT FROM OLD.approval_request_id
      OR NEW.approved_by_user_id IS DISTINCT FROM OLD.approved_by_user_id
      OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.approved_payload_hash IS DISTINCT FROM OLD.approved_payload_hash
      OR NEW.rejected_by_user_id IS DISTINCT FROM OLD.rejected_by_user_id
      OR NEW.rejected_at IS DISTINCT FROM OLD.rejected_at
      OR NEW.decision_rationale IS DISTINCT FROM OLD.decision_rationale
    THEN
      RAISE EXCEPTION 'protected_action_proposals: decision metadata is immutable after a terminal state';
    END IF;
  END IF;

  -- Payload freezing: once a proposal leaves 'draft', the fields that define
  -- the proposed action are frozen (V015 behavior, retained).
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
  IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    RAISE EXCEPTION 'protected_action_proposals: org_id is immutable';
  END IF;

  -- Approval binding (V015 behavior, retained).
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
    IF COALESCE(NEW.separation_of_duties_json->>'proposer_cannot_approve', 'true') = 'true'
      AND NEW.proposed_by_user_id IS NOT NULL
      AND NEW.approved_by_user_id = NEW.proposed_by_user_id
    THEN
      RAISE EXCEPTION 'protected_action_proposals: separation of duties — proposer cannot approve their own proposal';
    END IF;
  END IF;

  -- Rejection binding: a rejected decision carries its actor and timestamp.
  IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM 'rejected' THEN
    IF NEW.rejected_by_user_id IS NULL OR NEW.rejected_at IS NULL THEN
      RAISE EXCEPTION 'protected_action_proposals: rejected status requires rejected_by_user_id and rejected_at';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Proposals cannot be born in any terminal state.
CREATE OR REPLACE FUNCTION app.protected_action_proposal_insert_guard()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected', 'expired', 'withdrawn') THEN
    RAISE EXCEPTION 'protected_action_proposals: a proposal cannot be created directly in a terminal state (%)', NEW.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- A6. Governed purge authorization. The caller-controlled flag alone is not
-- sufficient: deletion of audit-grade records additionally requires the
-- trusted system identity (app.is_system(), V004 — the all-zero system user
-- set only by trusted server-side processes). This is an administrative
-- retention / organization-deletion path, never an ordinary application
-- capability.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.capital_append_only_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('app.allow_governed_purge', true) = 'on'
    AND app.is_system()
  THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% rows are append-only; corrections require a new record (governed purge requires the system identity AND app.allow_governed_purge)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
