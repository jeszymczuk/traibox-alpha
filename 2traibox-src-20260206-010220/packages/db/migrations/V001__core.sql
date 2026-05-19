-- Core extensions and helpers
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gin;

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_org', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.current_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.current_user', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Orgs & users
CREATE TABLE IF NOT EXISTS orgs (
  org_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  country text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_users (
  user_id uuid PRIMARY KEY,
  email text UNIQUE,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS org_members (
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS org_invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  invited_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz
);

-- Trades & chat
CREATE TABLE IF NOT EXISTS trades (
  trade_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  title text,
  corridor text,
  amount numeric(18,2),
  currency text,
  status text NOT NULL DEFAULT 'draft',
  created_by uuid REFERENCES app_users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_trades_updated_at BEFORE UPDATE ON trades FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS trade_plans (
  plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  parties jsonb NOT NULL DEFAULT '[]'::jsonb,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric(3,2),
  glass_box jsonb NOT NULL DEFAULT '{"reasons":[]}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  user_id uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  role text NOT NULL, -- user|assistant|system
  text text NOT NULL,
  attachments jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Events (for SSE)
CREATE TABLE IF NOT EXISTS trade_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE CASCADE,
  type text NOT NULL,
  ts timestamptz NOT NULL DEFAULT now(),
  trace_id text NOT NULL,
  actor text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE OR REPLACE FUNCTION app.notify_trade_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('trade_events', row_to_json(NEW)::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trade_events_notify ON trade_events;
CREATE TRIGGER trg_trade_events_notify AFTER INSERT ON trade_events FOR EACH ROW EXECUTE FUNCTION app.notify_trade_event();

-- Idempotency (server-side)
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotency_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  key text NOT NULL,
  route text NOT NULL,
  request_hash text NOT NULL,
  status_code integer NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (org_id, key, route)
);

-- Audit events (hash chain)
CREATE TABLE IF NOT EXISTS audit_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  trade_id uuid,
  actor text NOT NULL,
  action text NOT NULL,
  payload_json jsonb,
  prev_hash text,
  hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION app.audit_hash() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text;
BEGIN
  SELECT hash INTO prev FROM audit_events WHERE org_id = NEW.org_id ORDER BY created_at DESC, event_id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := encode(digest(coalesce(prev,'') || ':' || coalesce(NEW.actor,'') || ':' || coalesce(NEW.action,'') || ':' || coalesce(NEW.payload_json::text,''), 'sha256'),'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_hash ON audit_events;
CREATE TRIGGER trg_audit_hash BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION app.audit_hash();

-- Indexes
CREATE INDEX IF NOT EXISTS ix_trades_org_created ON trades(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_trade_plans_trade ON trade_plans(trade_id);
CREATE INDEX IF NOT EXISTS ix_trade_events_trade_ts ON trade_events(trade_id, ts DESC);

-- RLS
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs FORCE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users FORCE ROW LEVEL SECURITY;
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_members FORCE ROW LEVEL SECURITY;
ALTER TABLE org_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_invites FORCE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades FORCE ROW LEVEL SECURITY;
ALTER TABLE trade_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE trade_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE trade_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_events FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;

-- Policies (tenant isolation)
DROP POLICY IF EXISTS orgs_select ON orgs;
CREATE POLICY orgs_select ON orgs
  FOR SELECT
  USING (
    org_id = app.current_org()
    OR org_id IN (SELECT org_id FROM org_members WHERE user_id = app.current_user())
  );

DROP POLICY IF EXISTS orgs_insert ON orgs;
CREATE POLICY orgs_insert ON orgs
  FOR INSERT
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS users_select ON app_users;
CREATE POLICY users_select ON app_users
  FOR SELECT
  USING (user_id = app.current_user() OR user_id IN (SELECT user_id FROM org_members WHERE org_id = app.current_org()));

DROP POLICY IF EXISTS users_insert ON app_users;
CREATE POLICY users_insert ON app_users
  FOR INSERT
  WITH CHECK (user_id = app.current_user());

DROP POLICY IF EXISTS members_select ON org_members;
CREATE POLICY members_select ON org_members
  FOR SELECT
  USING (org_id = app.current_org() OR user_id = app.current_user());

DROP POLICY IF EXISTS members_write ON org_members;
CREATE POLICY members_write ON org_members
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS invites_select ON org_invites;
CREATE POLICY invites_select ON org_invites
  FOR SELECT
  USING (org_id = app.current_org());

DROP POLICY IF EXISTS invites_write ON org_invites;
CREATE POLICY invites_write ON org_invites
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS trades_rw ON trades;
CREATE POLICY trades_rw ON trades
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS plans_rw ON trade_plans;
CREATE POLICY plans_rw ON trade_plans
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS messages_rw ON trade_messages;
CREATE POLICY messages_rw ON trade_messages
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS events_rw ON trade_events;
CREATE POLICY events_rw ON trade_events
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS idem_rw ON idempotency_keys;
CREATE POLICY idem_rw ON idempotency_keys
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

DROP POLICY IF EXISTS audit_rw ON audit_events;
CREATE POLICY audit_rw ON audit_events
  FOR ALL
  USING (org_id = app.current_org())
  WITH CHECK (org_id = app.current_org());

