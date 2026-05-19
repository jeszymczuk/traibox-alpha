-- TRAIBOX v1 internal alpha spine:
-- typed standalone objects, attach-to-trade, readiness, scoped agents, memory, and proof skeletons.

CREATE TABLE IF NOT EXISTS alpha_objects (
  object_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  origin_workspace text NOT NULL,
  owner_id uuid NOT NULL REFERENCES app_users(user_id) ON DELETE RESTRICT,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  permissions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_alpha_objects_updated_at ON alpha_objects;
CREATE TRIGGER trg_alpha_objects_updated_at BEFORE UPDATE ON alpha_objects FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS alpha_object_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  source_object_id uuid NOT NULL REFERENCES alpha_objects(object_id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'attach',
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id text NOT NULL,
  created_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alpha_readiness_states (
  readiness_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  object_id uuid REFERENCES alpha_objects(object_id) ON DELETE SET NULL,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE CASCADE,
  overall text NOT NULL,
  score numeric(5,2) NOT NULL,
  dimensions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_findings_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_actions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alpha_agent_tasks (
  agent_task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE SET NULL,
  objective text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  input_objects_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  permitted_tools_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_access_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  write_permissions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  approval_gates_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  replay_log_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id text NOT NULL,
  created_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_alpha_agent_tasks_updated_at ON alpha_agent_tasks;
CREATE TRIGGER trg_alpha_agent_tasks_updated_at BEFORE UPDATE ON alpha_agent_tasks FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS alpha_memory_events (
  memory_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  level text NOT NULL,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE SET NULL,
  object_id uuid REFERENCES alpha_objects(object_id) ON DELETE SET NULL,
  kind text NOT NULL,
  signal text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alpha_proof_bundles (
  bundle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE SET NULL,
  object_id uuid REFERENCES alpha_objects(object_id) ON DELETE SET NULL,
  root text NOT NULL,
  manifest_sha256 text NOT NULL,
  artifact_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'completed',
  trace_id text NOT NULL,
  created_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_alpha_objects_query ON alpha_objects(org_id, origin_workspace, owner_id, status, type, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_objects_trade ON alpha_objects(org_id, trade_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_object_links_source ON alpha_object_links(org_id, source_object_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_object_links_target ON alpha_object_links(org_id, target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_readiness_trade ON alpha_readiness_states(org_id, trade_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_readiness_object ON alpha_readiness_states(org_id, object_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_agent_tasks_status ON alpha_agent_tasks(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_memory_trade ON alpha_memory_events(org_id, level, trade_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_memory_object ON alpha_memory_events(org_id, object_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_proof_bundles_trade ON alpha_proof_bundles(org_id, trade_id, created_at DESC);

ALTER TABLE alpha_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_objects FORCE ROW LEVEL SECURITY;
ALTER TABLE alpha_object_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_object_links FORCE ROW LEVEL SECURITY;
ALTER TABLE alpha_readiness_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_readiness_states FORCE ROW LEVEL SECURITY;
ALTER TABLE alpha_agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_agent_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE alpha_memory_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_memory_events FORCE ROW LEVEL SECURITY;
ALTER TABLE alpha_proof_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_proof_bundles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alpha_objects_rw ON alpha_objects;
CREATE POLICY alpha_objects_rw ON alpha_objects
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS alpha_object_links_rw ON alpha_object_links;
CREATE POLICY alpha_object_links_rw ON alpha_object_links
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS alpha_readiness_states_rw ON alpha_readiness_states;
CREATE POLICY alpha_readiness_states_rw ON alpha_readiness_states
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS alpha_agent_tasks_rw ON alpha_agent_tasks;
CREATE POLICY alpha_agent_tasks_rw ON alpha_agent_tasks
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS alpha_memory_events_rw ON alpha_memory_events;
CREATE POLICY alpha_memory_events_rw ON alpha_memory_events
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS alpha_proof_bundles_rw ON alpha_proof_bundles;
CREATE POLICY alpha_proof_bundles_rw ON alpha_proof_bundles
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());
