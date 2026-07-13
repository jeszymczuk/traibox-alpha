-- Durable, server-only browser security state for ADR-004.
-- These rows are transport/session infrastructure and are not canonical product state.

ALTER TABLE alpha_external_access_tokens
  ADD COLUMN IF NOT EXISTS exchanged_at timestamptz,
  ADD COLUMN IF NOT EXISTS exchange_expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours');

CREATE TABLE IF NOT EXISTS alpha_external_participant_sessions (
  session_token_hash text PRIMARY KEY CHECK (session_token_hash ~ '^[a-f0-9]{64}$'),
  access_token_hash text NOT NULL REFERENCES alpha_external_access_tokens(token_hash) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  grant_object_id uuid NOT NULL REFERENCES alpha_objects(object_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_external_participant_sessions_grant
  ON alpha_external_participant_sessions(org_id, grant_object_id)
  WHERE revoked_at IS NULL;

ALTER TABLE alpha_external_participant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_external_participant_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS alpha_external_participant_sessions_rw ON alpha_external_participant_sessions;
CREATE POLICY alpha_external_participant_sessions_rw ON alpha_external_participant_sessions
  FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS alpha_external_participant_sessions_system_bypass ON alpha_external_participant_sessions;
CREATE POLICY alpha_external_participant_sessions_system_bypass ON alpha_external_participant_sessions
  FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());

CREATE TABLE IF NOT EXISTS browser_sessions (
  session_id_hash text PRIMARY KEY CHECK (session_id_hash ~ '^[a-f0-9]{64}$'),
  auth_kind text NOT NULL CHECK (auth_kind IN ('user', 'dev', 'partner', 'external')),
  principal_id text NOT NULL,
  display_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ciphertext text NOT NULL,
  refresh_ciphertext text,
  credential_expires_at timestamptz,
  csrf_token_hash text NOT NULL CHECK (csrf_token_hash ~ '^[a-f0-9]{64}$'),
  csrf_ciphertext text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_hash text CHECK (replaced_by_hash IS NULL OR replaced_by_hash ~ '^[a-f0-9]{64}$'),
  CHECK (idle_expires_at <= absolute_expires_at)
);

CREATE INDEX IF NOT EXISTS ix_browser_sessions_expiry
  ON browser_sessions(absolute_expires_at, idle_expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_browser_sessions_principal
  ON browser_sessions(auth_kind, principal_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS browser_auth_flows (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  pkce_ciphertext text NOT NULL,
  return_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS ix_browser_auth_flows_expiry
  ON browser_auth_flows(expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS browser_external_exchanges (
  exchange_token_hash text PRIMARY KEY CHECK (exchange_token_hash ~ '^[a-f0-9]{64}$'),
  exchanged_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE browser_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE browser_auth_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_auth_flows FORCE ROW LEVEL SECURITY;
ALTER TABLE browser_external_exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE browser_external_exchanges FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS browser_sessions_server_only ON browser_sessions;
CREATE POLICY browser_sessions_server_only ON browser_sessions
  FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());

DROP POLICY IF EXISTS browser_auth_flows_server_only ON browser_auth_flows;
CREATE POLICY browser_auth_flows_server_only ON browser_auth_flows
  FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());

DROP POLICY IF EXISTS browser_external_exchanges_server_only ON browser_external_exchanges;
CREATE POLICY browser_external_exchanges_server_only ON browser_external_exchanges
  FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());
