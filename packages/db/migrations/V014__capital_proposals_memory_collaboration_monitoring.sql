-- Capital Agent v1.1 Phase 1: protected-action proposals, governed memory,
-- specialist collaboration, and monitoring state (spec §13/§14/§16/§19).
-- Additive; RLS on every table. Proposals stop at approval — no execution
-- state exists here, and nothing in this migration touches Finance tables.

-- ---------------------------------------------------------------------------
-- Protected-action proposals. Approval binds to payload_hash; a changed
-- payload requires a new hash and a new approval (enforced in later phases,
-- represented here).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protected_action_proposals (
  proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_type text NOT NULL,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  mandate_id uuid NOT NULL,
  mandate_version integer NOT NULL,
  target_domain text NOT NULL,
  target_command text NOT NULL,
  target_object_ref_json jsonb,
  draft_payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_hash text NOT NULL CHECK (length(payload_hash) > 0),
  rationale text NOT NULL,
  rationale_claim_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_outcome_id uuid NOT NULL REFERENCES agent_outcomes(outcome_id) ON DELETE CASCADE,
  source_artifact_id uuid REFERENCES capital_artifacts(artifact_id) ON DELETE SET NULL,
  source_artifact_version integer,
  evidence_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculation_run_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_issue_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_by_task_id uuid REFERENCES alpha_agent_tasks(agent_task_id) ON DELETE SET NULL,
  proposed_by_agent_class text NOT NULL,
  separation_of_duties_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'pending_policy_check', 'pending_approval', 'approved', 'rejected', 'expired', 'withdrawn'
  )),
  policy_version text NOT NULL,
  disclosure_set_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id text NOT NULL,
  audit_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT protected_action_proposals_idem_unique UNIQUE (org_id, idempotency_key),
  CONSTRAINT protected_action_proposals_expiry_consistent CHECK (expires_at > created_at)
);

DROP TRIGGER IF EXISTS trg_protected_action_proposals_updated_at ON protected_action_proposals;
CREATE TRIGGER trg_protected_action_proposals_updated_at BEFORE UPDATE ON protected_action_proposals FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_proposals_org_status ON protected_action_proposals (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_outcome ON protected_action_proposals (source_outcome_id);

ALTER TABLE protected_action_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE protected_action_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS protected_action_proposals_rw ON protected_action_proposals;
CREATE POLICY protected_action_proposals_rw ON protected_action_proposals
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Governed memory: items/candidates + profiles. No hidden chain-of-thought —
-- only governed statements with provenance, purpose, and user controls.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_items (
  memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  scope text NOT NULL CHECK (scope IN ('user', 'org', 'relationship', 'workflow', 'entity', 'corridor')),
  user_id uuid REFERENCES app_users(user_id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('explicit', 'observed', 'inferred', 'computed')),
  statement text NOT NULL,
  structured_value_json jsonb,
  source_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  sensitivity text NOT NULL DEFAULT 'internal' CHECK (sensitivity IN (
    'public', 'internal', 'confidential', 'restricted_financial', 'regulated_personal'
  )),
  purpose_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'active', 'rejected', 'expired', 'deleted')),
  review_state text CHECK (review_state IS NULL OR review_state IN (
    'auto_activated', 'confirmation_requested', 'user_confirmed', 'user_rejected'
  )),
  editable_by_user boolean NOT NULL DEFAULT true,
  deletable_by_user boolean NOT NULL DEFAULT true,
  last_confirmed_at timestamptz,
  expires_at timestamptz,
  decay_policy_id text,
  forgotten_at timestamptz,
  exported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_memory_items_updated_at ON memory_items;
CREATE TRIGGER trg_memory_items_updated_at BEFORE UPDATE ON memory_items FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_memory_items_org_status ON memory_items (org_id, principal_type, status);
CREATE INDEX IF NOT EXISTS idx_memory_items_user ON memory_items (user_id) WHERE user_id IS NOT NULL;

ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_items_rw ON memory_items;
CREATE POLICY memory_items_rw ON memory_items
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

CREATE TABLE IF NOT EXISTS user_operating_profiles (
  user_id uuid NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, org_id, principal_type)
);

DROP TRIGGER IF EXISTS trg_user_operating_profiles_updated_at ON user_operating_profiles;
CREATE TRIGGER trg_user_operating_profiles_updated_at BEFORE UPDATE ON user_operating_profiles FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE user_operating_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_operating_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_operating_profiles_rw ON user_operating_profiles;
CREATE POLICY user_operating_profiles_rw ON user_operating_profiles
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

CREATE TABLE IF NOT EXISTS org_finance_profiles (
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  profile_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, principal_type)
);

DROP TRIGGER IF EXISTS trg_org_finance_profiles_updated_at ON org_finance_profiles;
CREATE TRIGGER trg_org_finance_profiles_updated_at BEFORE UPDATE ON org_finance_profiles FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE org_finance_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_finance_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_finance_profiles_rw ON org_finance_profiles;
CREATE POLICY org_finance_profiles_rw ON org_finance_profiles
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Specialist collaboration: typed, bounded requests and reads.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS specialist_task_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  workflow_id uuid,
  parent_task_id uuid NOT NULL REFERENCES alpha_agent_tasks(agent_task_id) ON DELETE CASCADE,
  requesting_agent_class text NOT NULL,
  target_agent_class text NOT NULL,
  question text NOT NULL,
  requested_read_type text NOT NULL,
  permitted_context_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  disclosed_evidence_claim_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  permitted_data_classes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  excluded_context_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_schema text NOT NULL,
  authority_requested text NOT NULL CHECK (authority_requested IN ('read', 'recommendation')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN (
    'requested', 'in_progress', 'complete', 'partial', 'blocked', 'abstained', 'expired'
  )),
  due_at timestamptz,
  expires_at timestamptz,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_specialist_task_requests_updated_at ON specialist_task_requests;
CREATE TRIGGER trg_specialist_task_requests_updated_at BEFORE UPDATE ON specialist_task_requests FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_specialist_requests_org_status ON specialist_task_requests (org_id, status);
CREATE INDEX IF NOT EXISTS idx_specialist_requests_parent ON specialist_task_requests (parent_task_id);

ALTER TABLE specialist_task_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_task_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS specialist_task_requests_rw ON specialist_task_requests;
CREATE POLICY specialist_task_requests_rw ON specialist_task_requests
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

CREATE TABLE IF NOT EXISTS specialist_reads (
  specialist_read_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES specialist_task_requests(request_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  agent_class text NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'partial', 'blocked', 'abstained')),
  findings_claim_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  authoritative_for_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  not_authoritative_for_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_next_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  provenance_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_specialist_reads_request ON specialist_reads (request_id);

ALTER TABLE specialist_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_reads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS specialist_reads_rw ON specialist_reads;
CREATE POLICY specialist_reads_rw ON specialist_reads
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

-- ---------------------------------------------------------------------------
-- Monitoring state: analysis + recommendations only; no execution semantics
-- and no Finance-table references (canonical refs go through the typed
-- monitored_object_ref_json contract).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS capital_monitoring_states (
  monitoring_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('company', 'financier', 'platform_internal')),
  mandate_id uuid NOT NULL,
  mandate_version integer NOT NULL,
  monitored_object_ref_json jsonb NOT NULL,
  conditions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  schedule text,
  trigger_description text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'expired', 'cancelled')),
  last_evaluated_at timestamptz,
  last_evaluation_json jsonb,
  next_evaluation_at timestamptz,
  generated_outcome_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_recommendation_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id text NOT NULL,
  audit_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_capital_monitoring_states_updated_at ON capital_monitoring_states;
CREATE TRIGGER trg_capital_monitoring_states_updated_at BEFORE UPDATE ON capital_monitoring_states FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_capital_monitoring_org_status ON capital_monitoring_states (org_id, status, next_evaluation_at);

ALTER TABLE capital_monitoring_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE capital_monitoring_states FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capital_monitoring_states_rw ON capital_monitoring_states;
CREATE POLICY capital_monitoring_states_rw ON capital_monitoring_states
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());
