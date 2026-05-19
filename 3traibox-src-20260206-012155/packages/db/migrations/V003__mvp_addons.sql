-- MVP add-ons: exports tracking + KYB/passport metadata

-- Track ledger export ZIPs so /v1/files can authorize downloads safely.
CREATE TABLE IF NOT EXISTS ledger_exports (
  export_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  requested_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  url text NOT NULL,
  hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ledger_exports_org_created ON ledger_exports(org_id, created_at DESC);

ALTER TABLE ledger_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_exports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS exports_rw ON ledger_exports;
CREATE POLICY exports_rw ON ledger_exports FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());

-- Trade Passport document metadata (documents themselves stored in object storage).
CREATE TABLE IF NOT EXISTS passport_documents (
  doc_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES app_users(user_id) ON DELETE SET NULL,
  type text,
  file_url text NOT NULL,
  mime text,
  bytes integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_passport_docs_org_created ON passport_documents(org_id, created_at DESC);

ALTER TABLE passport_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE passport_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS passport_rw ON passport_documents;
CREATE POLICY passport_rw ON passport_documents FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());

-- KYB/KYC verification status per org (vendor refs only; no raw PII).
CREATE TABLE IF NOT EXISTS kyb_verifications (
  verification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  vendor text NOT NULL,
  applicant_id text,
  status text NOT NULL,
  meta_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_kyb_updated_at BEFORE UPDATE ON kyb_verifications FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX IF NOT EXISTS ix_kyb_org_updated ON kyb_verifications(org_id, updated_at DESC);

ALTER TABLE kyb_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyb_verifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyb_rw ON kyb_verifications;
CREATE POLICY kyb_rw ON kyb_verifications FOR ALL USING (org_id = app.current_org()) WITH CHECK (org_id = app.current_org());

