-- Durable browser security state and least-privilege access boundary for ADR-004.
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

-- The web/BFF connects as this dedicated login role. Operators provision its
-- password outside migrations and place only that connection string in
-- BROWSER_SESSION_DATABASE_URL. The role has no canonical-table privileges and
-- can execute only the narrowly scoped security-definer operations below.
DO $browser_session_role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'traibox_browser_session') THEN
    CREATE ROLE traibox_browser_session
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = membership.member
    WHERE member_role.rolname = 'traibox_browser_session'
  ) THEN
    RAISE EXCEPTION 'traibox_browser_session must not inherit or SET ROLE into any other database role';
  END IF;
END
$browser_session_role$;

ALTER ROLE traibox_browser_session WITH
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE traibox_browser_session SET search_path = browser_security, pg_catalog;
ALTER ROLE traibox_browser_session SET statement_timeout = '30s';

CREATE SCHEMA IF NOT EXISTS browser_security;
REVOKE ALL ON SCHEMA browser_security FROM PUBLIC;
GRANT USAGE ON SCHEMA browser_security TO traibox_browser_session;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM traibox_browser_session;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM traibox_browser_session;
-- PostgreSQL roles always inherit PUBLIC privileges; remove any ambient table
-- grants so they cannot accidentally widen the dedicated BFF login.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;

CREATE OR REPLACE FUNCTION browser_security.persist_session(
  p_session_id_hash text,
  p_auth_kind text,
  p_principal_id text,
  p_display_json jsonb,
  p_scope_json jsonb,
  p_credential_ciphertext text,
  p_refresh_ciphertext text,
  p_credential_expires_at timestamptz,
  p_csrf_token_hash text,
  p_csrf_ciphertext text,
  p_created_at timestamptz,
  p_last_seen_at timestamptz,
  p_idle_expires_at timestamptz,
  p_absolute_expires_at timestamptz,
  p_revoked_at timestamptz,
  p_replaced_by_hash text,
  p_previous_hash text,
  p_replacement_required boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $browser_session_persist$
DECLARE
  replaced_count integer := 0;
BEGIN
  PERFORM pg_catalog.set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true);
  PERFORM pg_catalog.set_config('app.current_org', '', true);

  IF p_previous_hash IS NOT NULL THEN
    UPDATE public.browser_sessions
    SET revoked_at = p_created_at,
        replaced_by_hash = p_session_id_hash
    WHERE session_id_hash = p_previous_hash
      AND revoked_at IS NULL
      AND idle_expires_at > p_created_at
      AND absolute_expires_at > p_created_at;
    GET DIAGNOSTICS replaced_count = ROW_COUNT;
    IF p_replacement_required AND replaced_count <> 1 THEN
      RETURN false;
    END IF;
  END IF;

  INSERT INTO public.browser_sessions(
    session_id_hash, auth_kind, principal_id, display_json, scope_json,
    credential_ciphertext, refresh_ciphertext, credential_expires_at,
    csrf_token_hash, csrf_ciphertext, created_at, last_seen_at,
    idle_expires_at, absolute_expires_at, revoked_at, replaced_by_hash
  ) VALUES(
    p_session_id_hash, p_auth_kind, p_principal_id, p_display_json, p_scope_json,
    p_credential_ciphertext, p_refresh_ciphertext, p_credential_expires_at,
    p_csrf_token_hash, p_csrf_ciphertext, p_created_at, p_last_seen_at,
    p_idle_expires_at, p_absolute_expires_at, p_revoked_at, p_replaced_by_hash
  );
  RETURN true;
END
$browser_session_persist$;

DROP FUNCTION IF EXISTS browser_security.find_session(text);
DROP FUNCTION IF EXISTS browser_security.touch_session(text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION browser_security.authenticate_session(
  p_session_id_hash text,
  p_idle_ttl_ms bigint
)
RETURNS TABLE(
  session_id_hash text,
  auth_kind text,
  principal_id text,
  display_json jsonb,
  scope_json jsonb,
  credential_ciphertext text,
  refresh_ciphertext text,
  credential_expires_at timestamptz,
  csrf_token_hash text,
  csrf_ciphertext text,
  created_at timestamptz,
  last_seen_at timestamptz,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz,
  revoked_at timestamptz,
  replaced_by_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $browser_session_authenticate$
DECLARE
  authenticated_at timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM pg_catalog.set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true);
  PERFORM pg_catalog.set_config('app.current_org', '', true);
  IF p_idle_ttl_ms IS NULL OR p_idle_ttl_ms <= 0 THEN
    RETURN;
  END IF;
  RETURN QUERY
    UPDATE public.browser_sessions AS session
    SET last_seen_at = authenticated_at,
        idle_expires_at = LEAST(
          session.absolute_expires_at,
          authenticated_at + (p_idle_ttl_ms::double precision * interval '1 millisecond')
        )
    WHERE session.session_id_hash = p_session_id_hash
      AND session.revoked_at IS NULL
      AND session.idle_expires_at > authenticated_at
      AND session.absolute_expires_at > authenticated_at
    RETURNING
      session.session_id_hash,
      session.auth_kind,
      session.principal_id,
      session.display_json,
      session.scope_json,
      session.credential_ciphertext,
      session.refresh_ciphertext,
      session.credential_expires_at,
      session.csrf_token_hash,
      session.csrf_ciphertext,
      session.created_at,
      session.last_seen_at,
      session.idle_expires_at,
      session.absolute_expires_at,
      session.revoked_at,
      session.replaced_by_hash;
END
$browser_session_authenticate$;

COMMENT ON FUNCTION browser_security.authenticate_session(text, bigint) IS
  'Atomically authenticates one active session at database time and extends its bounded idle lifetime.';

CREATE OR REPLACE FUNCTION browser_security.revoke_session(
  p_session_id_hash text,
  p_revoked_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $browser_session_revoke$
BEGIN
  PERFORM pg_catalog.set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true);
  PERFORM pg_catalog.set_config('app.current_org', '', true);
  UPDATE public.browser_sessions
  SET revoked_at = COALESCE(revoked_at, p_revoked_at)
  WHERE session_id_hash = p_session_id_hash;
END
$browser_session_revoke$;

CREATE OR REPLACE FUNCTION browser_security.save_auth_flow(
  p_state_hash text,
  p_pkce_ciphertext text,
  p_return_path text,
  p_expires_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $browser_auth_flow_save$
BEGIN
  PERFORM pg_catalog.set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true);
  PERFORM pg_catalog.set_config('app.current_org', '', true);
  INSERT INTO public.browser_auth_flows(state_hash, pkce_ciphertext, return_path, expires_at)
  VALUES(p_state_hash, p_pkce_ciphertext, p_return_path, p_expires_at);
END
$browser_auth_flow_save$;

CREATE OR REPLACE FUNCTION browser_security.consume_auth_flow(
  p_state_hash text,
  p_consumed_at timestamptz
) RETURNS TABLE(
  state_hash text,
  pkce_ciphertext text,
  return_path text,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $browser_auth_flow_consume$
BEGIN
  PERFORM pg_catalog.set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true);
  PERFORM pg_catalog.set_config('app.current_org', '', true);
  RETURN QUERY
    UPDATE public.browser_auth_flows AS flow
    SET consumed_at = p_consumed_at
    WHERE flow.state_hash = p_state_hash
      AND flow.consumed_at IS NULL
      AND flow.expires_at > p_consumed_at
    RETURNING flow.state_hash, flow.pkce_ciphertext, flow.return_path, flow.expires_at;
END
$browser_auth_flow_consume$;

CREATE OR REPLACE FUNCTION browser_security.consume_external_exchange(
  p_exchange_token_hash text,
  p_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $browser_exchange_consume$
DECLARE
  inserted_count integer := 0;
BEGIN
  PERFORM pg_catalog.set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true);
  PERFORM pg_catalog.set_config('app.current_org', '', true);
  INSERT INTO public.browser_external_exchanges(exchange_token_hash, expires_at)
  VALUES(p_exchange_token_hash, p_expires_at)
  ON CONFLICT (exchange_token_hash) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END
$browser_exchange_consume$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA browser_security FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA browser_security FROM traibox_browser_session;
GRANT EXECUTE ON FUNCTION browser_security.persist_session(
  text, text, text, jsonb, jsonb, text, text, timestamptz, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text, text, boolean
) TO traibox_browser_session;
GRANT EXECUTE ON FUNCTION browser_security.authenticate_session(text, bigint) TO traibox_browser_session;
GRANT EXECUTE ON FUNCTION browser_security.revoke_session(text, timestamptz) TO traibox_browser_session;
GRANT EXECUTE ON FUNCTION browser_security.save_auth_flow(text, text, text, timestamptz) TO traibox_browser_session;
GRANT EXECUTE ON FUNCTION browser_security.consume_auth_flow(text, timestamptz) TO traibox_browser_session;
GRANT EXECUTE ON FUNCTION browser_security.consume_external_exchange(text, timestamptz) TO traibox_browser_session;
ALTER DEFAULT PRIVILEGES IN SCHEMA browser_security REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON ROLE traibox_browser_session IS
  'Least-privilege login for the Next.js browser session boundary; password is provisioned outside migrations.';
COMMENT ON SCHEMA browser_security IS
  'Security-definer operations exposed only to the restricted Next.js browser-session principal.';
