ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS provider_mode text,
  ADD COLUMN IF NOT EXISTS provider_capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS provider_fallback boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS provider_reason text,
  ADD COLUMN IF NOT EXISTS adapter_id text,
  ADD COLUMN IF NOT EXISTS adapter_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS ix_payments_provider ON payments(org_id, provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_payments_adapter ON payments(org_id, adapter_id, created_at DESC);
