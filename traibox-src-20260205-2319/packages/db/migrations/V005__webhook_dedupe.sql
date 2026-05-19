-- Webhook replay protection (best-effort): dedupe by (org_id, provider_id, topic, dedupe_key)

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS dedupe_key text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_webhook_events_dedupe
  ON webhook_events(org_id, provider_id, topic, dedupe_key);

