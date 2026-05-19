-- Scoped external participant access for TRAIBOX alpha workflows.
-- Raw tokens are returned once by the API; only hashes are stored.

CREATE TABLE IF NOT EXISTS alpha_external_access_tokens (
  token_hash text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  grant_object_id uuid NOT NULL REFERENCES alpha_objects(object_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_alpha_external_access_tokens_org ON alpha_external_access_tokens(org_id, grant_object_id);
CREATE INDEX IF NOT EXISTS ix_alpha_external_access_tokens_status ON alpha_external_access_tokens(status, expires_at);

ALTER TABLE alpha_external_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_external_access_tokens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alpha_external_access_tokens_rw ON alpha_external_access_tokens;
CREATE POLICY alpha_external_access_tokens_rw ON alpha_external_access_tokens
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS alpha_external_access_tokens_system_bypass ON alpha_external_access_tokens;
CREATE POLICY alpha_external_access_tokens_system_bypass ON alpha_external_access_tokens
  FOR ALL
  USING (app.is_system())
  WITH CHECK (app.is_system());
