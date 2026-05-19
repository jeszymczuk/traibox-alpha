-- Trusted alpha workflow worker access.
-- The worker needs to scan active workflow_run objects across tenants, then write
-- org-scoped monitoring signals, memory, events, and audit entries. The system
-- actor remains restricted to trusted server-side processes.

DROP POLICY IF EXISTS system_bypass ON alpha_objects;
CREATE POLICY system_bypass ON alpha_objects
  FOR ALL
  USING (app.is_system())
  WITH CHECK (app.is_system());

DROP POLICY IF EXISTS system_bypass ON alpha_memory_events;
CREATE POLICY system_bypass ON alpha_memory_events
  FOR ALL
  USING (app.is_system())
  WITH CHECK (app.is_system());

DROP POLICY IF EXISTS system_bypass ON trade_events;
CREATE POLICY system_bypass ON trade_events
  FOR ALL
  USING (app.is_system())
  WITH CHECK (app.is_system());

DROP POLICY IF EXISTS system_bypass ON audit_events;
CREATE POLICY system_bypass ON audit_events
  FOR ALL
  USING (app.is_system())
  WITH CHECK (app.is_system());
