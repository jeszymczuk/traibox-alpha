-- Compliance
CREATE TABLE IF NOT EXISTS compliance_checks (
  check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  type text NOT NULL,
  status text NOT NULL,
  score numeric(5,2),
  reasons jsonb,
  provider text,
  provider_ref text,
  policy_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_cc_updated_at BEFORE UPDATE ON compliance_checks FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS compliance_reports (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  overall text NOT NULL,
  risk_level text,
  json_blob jsonb NOT NULL,
  pdf_url text,
  hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Finance / STF
CREATE TABLE IF NOT EXISTS stf_evidence (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  type text NOT NULL,
  scheme_code text,
  issuer text,
  valid_from date,
  valid_to date,
  verification_level text,
  file_url text,
  links_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stf_grades (
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  path text NOT NULL,
  grade text NOT NULL,
  details_json jsonb,
  verification_level text,
  dns_h_ms_passed boolean,
  cbam_flag boolean,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trade_id, path)
);

CREATE TABLE IF NOT EXISTS offer_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  tenor_days integer NOT NULL,
  sustainable jsonb,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance_offers (
  offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES offer_requests(request_id) ON DELETE SET NULL,
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  financier_id text NOT NULL,
  financier_name text NOT NULL,
  apr_bps integer NOT NULL CHECK (apr_bps >= 0),
  fees numeric(18,2) NOT NULL DEFAULT 0,
  tenor_days integer NOT NULL CHECK (tenor_days > 0),
  currency text NOT NULL DEFAULT 'EUR',
  sustainability_tag text NOT NULL DEFAULT 'none',
  sustainability_grade text NOT NULL DEFAULT 'insufficient_data',
  verification_level text,
  sustainable_pricing_delta_bps integer,
  explanations jsonb,
  allocation_json jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES finance_offers(offer_id) ON DELETE CASCADE,
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  financier_ref text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sf_reports (
  report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  type text NOT NULL,
  json_blob jsonb NOT NULL,
  pdf_url text,
  hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Payments & bank connectivity
CREATE TABLE IF NOT EXISTS bank_providers (
  provider_id text PRIMARY KEY,
  name text NOT NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS bank_consents (
  consent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  provider_id text NOT NULL REFERENCES bank_providers(provider_id),
  type text NOT NULL,
  scope text,
  status text NOT NULL,
  expires_at timestamptz,
  enc_tokens jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_consents_updated_at BEFORE UPDATE ON bank_consents FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS bank_accounts (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  provider_id text NOT NULL REFERENCES bank_providers(provider_id),
  iban text NOT NULL,
  currency text NOT NULL,
  name text,
  type text,
  status text,
  consent_id uuid REFERENCES bank_consents(consent_id) ON DELETE SET NULL,
  meta_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, iban)
);
CREATE TRIGGER trg_accounts_updated_at BEFORE UPDATE ON bank_accounts FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS bank_balances (
  balance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES bank_accounts(account_id) ON DELETE CASCADE,
  as_of timestamptz NOT NULL,
  available numeric(18,2),
  booked numeric(18,2),
  credit_limit numeric(18,2)
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  txn_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES bank_accounts(account_id) ON DELETE CASCADE,
  posted_at timestamptz NOT NULL,
  value_date date,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL,
  counterparty_name text,
  counterparty_iban text,
  remittance text,
  e2e_id text,
  bank_tx_id text,
  status text NOT NULL,
  iso_reason_code text,
  category text,
  payment_id uuid,
  meta_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, bank_tx_id)
);

CREATE TABLE IF NOT EXISTS payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trades(trade_id) ON DELETE SET NULL,
  scheme text NOT NULL,
  debtor_account_id uuid NOT NULL REFERENCES bank_accounts(account_id),
  creditor_name text NOT NULL,
  creditor_iban text NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  purpose text,
  remittance text,
  e2e_id text,
  status text NOT NULL,
  iso_status text,
  return_reason text,
  provider_ref text,
  trace_id text,
  idempotency_key text,
  redirect_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE IF NOT EXISTS payment_attempts (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(payment_id) ON DELETE CASCADE,
  status text NOT NULL,
  code text,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  provider_id text NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  signature_ok boolean NOT NULL,
  processed_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Proofs / ledger
CREATE TABLE IF NOT EXISTS proof_artifacts (
  artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  path text NOT NULL,
  mime text NOT NULL,
  bytes integer,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proof_bundles (
  bundle_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  manifest_sha256 text NOT NULL,
  root text NOT NULL,
  bundle_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proof_inclusions (
  bundle_id uuid REFERENCES proof_bundles(bundle_id) ON DELETE CASCADE,
  artifact_id uuid REFERENCES proof_artifacts(artifact_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  leaf_sha256 text NOT NULL,
  batch_id text,
  position integer,
  PRIMARY KEY (bundle_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS anchor_batches (
  batch_id text PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  root text NOT NULL,
  network text NOT NULL,
  adapter_id text NOT NULL,
  tx_hash text,
  block_number bigint,
  status text NOT NULL,
  fee_wei text,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  anchored_at timestamptz
);

-- Allocation (PriME)
CREATE TABLE IF NOT EXISTS allocation_policies (
  policy_id text PRIMARY KEY,
  market text NOT NULL,
  weights_json jsonb NOT NULL,
  caps_json jsonb,
  eligibility_json jsonb,
  fairness_json jsonb,
  risk_json jsonb,
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz
);

CREATE TABLE IF NOT EXISTS allocation_decisions (
  decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES trades(trade_id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  market text NOT NULL,
  policy_id text NOT NULL REFERENCES allocation_policies(policy_id),
  inputs_hash text NOT NULL,
  winner text NOT NULL,
  ranking_json jsonb NOT NULL,
  caps_applied_json jsonb,
  fairness_notes text,
  reasons_json jsonb,
  timestamp timestamptz NOT NULL DEFAULT now(),
  prev_hash text,
  hash text
);

-- Partners
CREATE TABLE IF NOT EXISTS partners (
  partner_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}'::text[],
  corridors text[],
  rails text[],
  stf_ready boolean NOT NULL DEFAULT false,
  webhook_url text,
  push_mode boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partner_api_keys (
  key_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS partner_capabilities (
  cap_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(partner_id) ON DELETE CASCADE,
  domain text NOT NULL,
  key text NOT NULL,
  meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS for domain tables
ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_checks FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE stf_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE stf_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE stf_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE stf_grades FORCE ROW LEVEL SECURITY;
ALTER TABLE offer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE finance_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_offers FORCE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE sf_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE bank_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_consents FORCE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE bank_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
ALTER TABLE proof_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_artifacts FORCE ROW LEVEL SECURITY;
ALTER TABLE proof_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_bundles FORCE ROW LEVEL SECURITY;
ALTER TABLE proof_inclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE proof_inclusions FORCE ROW LEVEL SECURITY;
ALTER TABLE anchor_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE anchor_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE allocation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE allocation_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners FORCE ROW LEVEL SECURITY;
ALTER TABLE partner_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_api_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE partner_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_capabilities FORCE ROW LEVEL SECURITY;

-- Isolation policies
DO $$ BEGIN
  PERFORM 1;
END $$;

DROP POLICY IF EXISTS cc_rw ON compliance_checks;
CREATE POLICY cc_rw ON compliance_checks FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS cr_rw ON compliance_reports;
CREATE POLICY cr_rw ON compliance_reports FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS ev_rw ON stf_evidence;
CREATE POLICY ev_rw ON stf_evidence FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS gr_rw ON stf_grades;
CREATE POLICY gr_rw ON stf_grades FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS req_rw ON offer_requests;
CREATE POLICY req_rw ON offer_requests FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS fo_rw ON finance_offers;
CREATE POLICY fo_rw ON finance_offers FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS res_rw ON reservations;
CREATE POLICY res_rw ON reservations FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS sfr_rw ON sf_reports;
CREATE POLICY sfr_rw ON sf_reports FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS cons_rw ON bank_consents;
CREATE POLICY cons_rw ON bank_consents FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS acct_rw ON bank_accounts;
CREATE POLICY acct_rw ON bank_accounts FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS bal_rw ON bank_balances;
CREATE POLICY bal_rw ON bank_balances FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS txn_rw ON bank_transactions;
CREATE POLICY txn_rw ON bank_transactions FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS pay_rw ON payments;
CREATE POLICY pay_rw ON payments FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS pay_attempts_rw ON payment_attempts;
CREATE POLICY pay_attempts_rw ON payment_attempts FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS wh_rw ON webhook_events;
CREATE POLICY wh_rw ON webhook_events FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS pa_rw ON proof_artifacts;
CREATE POLICY pa_rw ON proof_artifacts FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS pb_rw ON proof_bundles;
CREATE POLICY pb_rw ON proof_bundles FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS pi_rw ON proof_inclusions;
CREATE POLICY pi_rw ON proof_inclusions FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS ab_rw ON anchor_batches;
CREATE POLICY ab_rw ON anchor_batches FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());
DROP POLICY IF EXISTS alloc_rw ON allocation_decisions;
CREATE POLICY alloc_rw ON allocation_decisions FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());

-- Partners are global (not per org) in MVP; allow select to any authenticated context, writes via server only (still org-scoped RLS can't apply)
DROP POLICY IF EXISTS partners_select ON partners;
CREATE POLICY partners_select ON partners FOR SELECT USING (true);
DROP POLICY IF EXISTS partners_write ON partners;
CREATE POLICY partners_write ON partners FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS pkeys_rw ON partner_api_keys;
CREATE POLICY pkeys_rw ON partner_api_keys FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS pcaps_rw ON partner_capabilities;
CREATE POLICY pcaps_rw ON partner_capabilities FOR ALL USING (true) WITH CHECK (true);

-- Seeds
INSERT INTO bank_providers(provider_id, name, type, status)
  VALUES ('truelayer', 'TrueLayer', 'aggregator', 'active')
  ON CONFLICT DO NOTHING;

INSERT INTO allocation_policies(policy_id, market, weights_json, version)
  VALUES (
    'fin_v1',
    'finance',
    '{"w_price":0.35,"w_sla":0.15,"w_succ":0.2,"w_risk":0.1,"w_esg":0.05,"w_var":0.05,"w_rel":0.05,"w_cov":0.03,"w_fair":0.02}'::jsonb,
    1
  )
  ON CONFLICT DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS ix_cc_trade_type ON compliance_checks(trade_id, type);
CREATE INDEX IF NOT EXISTS ix_cr_trade ON compliance_reports(trade_id);
CREATE INDEX IF NOT EXISTS ix_fo_trade ON finance_offers(trade_id);
CREATE INDEX IF NOT EXISTS ix_req_trade ON offer_requests(trade_id);
CREATE INDEX IF NOT EXISTS ix_pay_org_created ON payments(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_txn_account_posted ON bank_transactions(account_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS ix_pb_trade ON proof_bundles(trade_id);
CREATE INDEX IF NOT EXISTS ix_anchor_status ON anchor_batches(status, created_at DESC);

