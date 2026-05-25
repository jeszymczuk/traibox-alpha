-- Durable Trade Brain eval reports as queryable product artifacts.

CREATE TABLE IF NOT EXISTS alpha_eval_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  eval_object_id uuid REFERENCES alpha_objects(object_id) ON DELETE SET NULL,
  suite_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pass', 'warn', 'fail')),
  score numeric(5,2) NOT NULL,
  case_count integer NOT NULL,
  passed integer NOT NULL,
  failed integer NOT NULL,
  harness_version text NOT NULL,
  service_version text NOT NULL,
  report_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  artifact_refs_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  trace_id text NOT NULL,
  created_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_alpha_eval_runs_query ON alpha_eval_runs(org_id, suite_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_alpha_eval_runs_object ON alpha_eval_runs(org_id, eval_object_id, created_at DESC);

ALTER TABLE alpha_eval_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_eval_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alpha_eval_runs_rw ON alpha_eval_runs;
CREATE POLICY alpha_eval_runs_rw ON alpha_eval_runs
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());
