-- Capital Agent v1.1 Phase 4.1 — exact idempotency and request fingerprints.
-- Additive only; prior migrations are not edited.
--
-- Task idempotency (§4.1-2): Capital-bound tasks are identified by a
-- first-class exact (org_id, idempotency_key) — never by objective text,
-- trace_id LIKE, or best-effort SELECT-then-INSERT. The unique index is
-- partial so legacy Alpha tasks (NULL key / non-capital contract) keep their
-- existing behavior.
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE alpha_agent_tasks ADD COLUMN IF NOT EXISTS request_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tasks_capital_idem
  ON alpha_agent_tasks (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND task_contract_version = 'capital-task-v1';

-- Outcome idempotency + fingerprints (§4.1-3): exact replay is enforced by
-- (org_id, idempotency_key); request_hash is the canonical semantic request
-- fingerprint (no volatile trace ids); execution_hash is the immutable
-- result fingerprint saved at persistence time.
ALTER TABLE agent_outcomes ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE agent_outcomes ADD COLUMN IF NOT EXISTS request_hash text;
ALTER TABLE agent_outcomes ADD COLUMN IF NOT EXISTS execution_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_outcomes_idem
  ON agent_outcomes (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- No Finance tables are touched; append-only protections are unaffected.
