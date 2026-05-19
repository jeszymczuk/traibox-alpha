-- System bypass for operational flows (partners, webhooks, workers).
-- These policies allow a special system actor (all-zero UUID) to access rows across orgs.
-- Use only from trusted server-side processes.

CREATE OR REPLACE FUNCTION app.is_system() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.current_user() = '00000000-0000-0000-0000-000000000000'::uuid;
$$;

-- Partner offer intake needs to list and read offer requests across orgs.
DROP POLICY IF EXISTS system_bypass ON offer_requests;
CREATE POLICY system_bypass ON offer_requests FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());

-- Webhooks need to resolve payment_id to org_id before setting org context.
DROP POLICY IF EXISTS system_bypass ON payments;
CREATE POLICY system_bypass ON payments FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());

-- Webhooks need to resolve consent_id to org_id before setting org context.
DROP POLICY IF EXISTS system_bypass ON bank_consents;
CREATE POLICY system_bypass ON bank_consents FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());

-- Workers need to scan anchor batches across orgs.
DROP POLICY IF EXISTS system_bypass ON anchor_batches;
CREATE POLICY system_bypass ON anchor_batches FOR ALL USING (app.is_system()) WITH CHECK (app.is_system());

