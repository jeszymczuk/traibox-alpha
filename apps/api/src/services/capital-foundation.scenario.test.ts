import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Capital Agent v1.1 Phase 1 — persistence foundation tests.
 *
 * Runs only when ALPHA_INTEGRATION_DATABASE_URL points at a LOCAL test
 * database (same gating as alpha.scenario.test.ts). Resets + migrates the
 * database, then verifies:
 *  - additive alpha_agent_tasks evolution (existing-shape inserts still work);
 *  - mandate/outcome/calculation/evidence/artifact/proposal invariants
 *    enforced IN THE DATABASE (constraints, uniqueness, immutability);
 *  - genuine RLS isolation via a non-superuser probe role (the default
 *    postgres superuser bypasses RLS, so route-level tests alone are not
 *    sufficient evidence);
 *  - the binary Finance-boundary rule: creating the full Capital chain
 *    touches ZERO canonical Finance state (relational tables and alpha
 *    funding objects alike).
 */

const TEST_DB_URL = process.env.ALPHA_INTEGRATION_DATABASE_URL;
const run = TEST_DB_URL ? describe : describe.skip;

const PROBE_ROLE = 'capital_rls_probe';

run('Capital v1.1 foundation against Postgres', () => {
  let pool: pg.Pool;
  let orgA: string;
  let orgB: string;
  let userId: string;
  // Shared chain ids built across tests.
  const mandateId = randomUUID();
  let taskId: string;
  let outcomeId: string;
  let artifactId: string;
  let bundleId: string;

  beforeAll(async () => {
    if (!TEST_DB_URL) return;
    assertLocalTestDatabase(TEST_DB_URL);
    await resetDatabase(TEST_DB_URL);
    await applyMigrations(TEST_DB_URL);
    pool = new pg.Pool({ connectionString: TEST_DB_URL });

    userId = randomUUID();
    await pool.query(`INSERT INTO app_users(user_id, email) VALUES ($1, 'capital-test@local')`, [userId]);
    const a = await pool.query(`INSERT INTO orgs(name, country) VALUES ('Capital Foundation Org A', 'PT') RETURNING org_id`);
    const b = await pool.query(`INSERT INTO orgs(name, country) VALUES ('Capital Foundation Org B', 'ES') RETURNING org_id`);
    orgA = a.rows[0].org_id;
    orgB = b.rows[0].org_id;

    // Non-superuser probe for real RLS verification.
    await pool.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`);
    await pool.query(`CREATE ROLE ${PROBE_ROLE} LOGIN NOBYPASSRLS`);
    await pool.query(`GRANT USAGE ON SCHEMA app, public TO ${PROBE_ROLE}`);
    await pool.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ${PROBE_ROLE}`);
    await pool.query(`GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${PROBE_ROLE}`);
  }, 60_000);

  afterAll(async () => {
    if (!TEST_DB_URL) return;
    await pool.query(`REASSIGN OWNED BY ${PROBE_ROLE} TO postgres`).catch(() => undefined);
    await pool.query(`DROP OWNED BY ${PROBE_ROLE}`).catch(() => undefined);
    await pool.query(`DROP ROLE IF EXISTS ${PROBE_ROLE}`).catch(() => undefined);
    await pool.end();
  });

  // ---------------------------------------------------------------------
  // alpha_agent_tasks: additive evolution
  // ---------------------------------------------------------------------
  it('accepts legacy-shape alpha_agent_tasks inserts (existing callers unaffected)', async () => {
    const legacy = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by)
       VALUES ($1, 'legacy task without capital columns', 'trc-legacy', $2)
       RETURNING agent_task_id, principal_id, principal_type, mandate_id`,
      [orgA, userId]
    );
    expect(legacy.rows[0].principal_id).toBeNull();
    expect(legacy.rows[0].principal_type).toBeNull();
  });

  it('accepts capital-shape tasks and rejects unknown principal types', async () => {
    const row = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version, task_contract_version, definition_version)
       VALUES ($1, 'capital diagnosis task', 'trc-cap', $2, $1, 'company', $3, 1, 'capital-task-v1', 'capital-agent-1.1.0')
       RETURNING agent_task_id`,
      [orgA, userId, mandateId]
    );
    taskId = row.rows[0].agent_task_id;
    await expect(
      pool.query(`INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, principal_type) VALUES ($1, 'bad', 'trc', 'lender')`, [orgA])
    ).rejects.toThrow(/alpha_agent_tasks_principal_type_check/);
  });

  // ---------------------------------------------------------------------
  // Mandates
  // ---------------------------------------------------------------------
  it('stores versioned mandates and rejects duplicate (mandate_id, version)', async () => {
    const insert = (version: number) =>
      pool.query(
        `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id, issued_by)
         VALUES ($1, $2, $3, $3, 'company', 'capital_agent', 'active', 'propose_protected_action', 'disclosure-company-v1', $4)`,
        [mandateId, version, orgA, userId]
      );
    await insert(1);
    await insert(2);
    await expect(insert(2)).rejects.toThrow(/agent_mandates_version_unique/);
  });

  it('rejects mandates with execution-grade authority or bogus principals', async () => {
    await expect(
      pool.query(
        `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, authority_ceiling, disclosure_policy_id)
         VALUES ($1, 1, $2, $2, 'company', 'capital_agent', 'execute_payment', 'p')`,
        [randomUUID(), orgA]
      )
    ).rejects.toThrow(/authority_ceiling/);
    await expect(
      pool.query(
        `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, authority_ceiling, disclosure_policy_id)
         VALUES ($1, 1, $2, $2, 'shadow_bank', 'capital_agent', 'recommend', 'p')`,
        [randomUUID(), orgA]
      )
    ).rejects.toThrow(/principal_type/);
  });

  // ---------------------------------------------------------------------
  // Outcomes
  // ---------------------------------------------------------------------
  it('binds outcomes to an existing mandate version and validates taxonomy', async () => {
    const good = await pool.query(
      `INSERT INTO agent_outcomes(outcome_type, definition_version, task_id, org_id, principal_id, principal_type, mandate_id, mandate_version, status, authority_level, trace_id)
       VALUES ('capital_diagnosis', 'v1', $1, $2, $2, 'company', $3, 1, 'requested', 'recommend', 'trc')
       RETURNING outcome_id`,
      [taskId, orgA, mandateId]
    );
    outcomeId = good.rows[0].outcome_id;

    await expect(
      pool.query(
        `INSERT INTO agent_outcomes(outcome_type, definition_version, task_id, org_id, principal_id, principal_type, mandate_id, mandate_version, status, authority_level, trace_id)
         VALUES ('capital_diagnosis', 'v1', $1, $2, $2, 'company', $3, 99, 'requested', 'recommend', 'trc')`,
        [taskId, orgA, mandateId]
      )
    ).rejects.toThrow(/agent_outcomes_mandate_fk/);

    await expect(
      pool.query(
        `INSERT INTO agent_outcomes(outcome_type, definition_version, task_id, org_id, principal_id, principal_type, mandate_id, mandate_version, status, authority_level, trace_id)
         VALUES ('secret_underwriting_decision', 'v1', $1, $2, $2, 'company', $3, 1, 'requested', 'recommend', 'trc')`,
        [taskId, orgA, mandateId]
      )
    ).rejects.toThrow(/outcome_type/);
  });

  // ---------------------------------------------------------------------
  // Calculation runs
  // ---------------------------------------------------------------------
  it('requires deterministic hashes and a workbench executor on calculation runs', async () => {
    await pool.query(
      `INSERT INTO financial_calculation_runs(calculator_id, calculator_version, formula_version, org_id, principal_id, principal_type, mandate_id, mandate_version, task_id, outcome_id, input_hash, result_hash, trace_id)
       VALUES ('capital.calculate_working_capital', '1.0.0', 'wc-v1', $1, $1, 'company', $2, 1, $3, $4, 'sha256:in', 'sha256:out', 'trc')`,
      [orgA, mandateId, taskId, outcomeId]
    );
    await expect(
      pool.query(
        `INSERT INTO financial_calculation_runs(calculator_id, calculator_version, formula_version, org_id, principal_id, principal_type, mandate_id, mandate_version, input_hash, result_hash, trace_id)
         VALUES ('c', '1', 'f', $1, $1, 'company', $2, 1, '', 'sha256:out', 'trc')`,
        [orgA, mandateId]
      )
    ).rejects.toThrow(/input_hash/);
    await expect(
      pool.query(
        `INSERT INTO financial_calculation_runs(calculator_id, calculator_version, formula_version, org_id, principal_id, principal_type, mandate_id, mandate_version, input_hash, result_hash, executed_by, trace_id)
         VALUES ('c', '1', 'f', $1, $1, 'company', $2, 1, 'sha256:in', 'sha256:out', 'llm', 'trc')`,
        [orgA, mandateId]
      )
    ).rejects.toThrow(/executed_by/);
  });

  // ---------------------------------------------------------------------
  // Evidence
  // ---------------------------------------------------------------------
  it('stores typed claims with contradictions preserved and rejects unknown claim types', async () => {
    const bundle = await pool.query(
      `INSERT INTO evidence_bundles(org_id, principal_id, principal_type, task_id, outcome_id, trace_id)
       VALUES ($1, $1, 'company', $2, $3, 'trc') RETURNING bundle_id`,
      [orgA, taskId, outcomeId]
    );
    bundleId = bundle.rows[0].bundle_id;
    const claim = await pool.query(
      `INSERT INTO evidence_claims(bundle_id, org_id, principal_id, principal_type, claim_type, statement, confidence, verification_status, materiality, contradicts_claim_ids_json)
       VALUES ($1, $2, $2, 'company', 'contradiction', 'Invoice total conflicts with PO total', 'high', 'conflicting', 'critical', '["some-claim"]'::jsonb)
       RETURNING claim_id`,
      [bundleId, orgA]
    );
    await pool.query(
      `INSERT INTO evidence_references(claim_id, org_id, source_layer, domain, object_type, object_id)
       VALUES ($1, $2, 'alpha_object', 'finance', 'funding_request', 'fr-1')`,
      [claim.rows[0].claim_id, orgA]
    );
    await expect(
      pool.query(
        `INSERT INTO evidence_claims(bundle_id, org_id, principal_id, principal_type, claim_type, statement, confidence, verification_status, materiality)
         VALUES ($1, $2, $2, 'company', 'vibe', 'not a claim type', 'high', 'verified', 'material')`,
        [bundleId, orgA]
      )
    ).rejects.toThrow(/claim_type/);
  });

  // ---------------------------------------------------------------------
  // Artifacts
  // ---------------------------------------------------------------------
  it('enforces artifact-version uniqueness and immutability', async () => {
    const artifact = await pool.query(
      `INSERT INTO capital_artifacts(artifact_type, org_id, principal_id, principal_type, mandate_id, mandate_version, outcome_id, task_id, title, authority_level, trace_id)
       VALUES ('capital_diagnosis', $1, $1, 'company', $2, 1, $3, $4, 'Capital diagnosis: test trade', 'recommend', 'trc')
       RETURNING artifact_id`,
      [orgA, mandateId, outcomeId, taskId]
    );
    artifactId = artifact.rows[0].artifact_id;
    const insertVersion = (version: number) =>
      pool.query(
        `INSERT INTO capital_artifact_versions(artifact_id, org_id, version, schema_version, content_json, evidence_bundle_id)
         VALUES ($1, $2, $3, 'capital-artifact-v1', '{"summary":"v"}'::jsonb, $4)`,
        [artifactId, orgA, version, bundleId]
      );
    await insertVersion(1);
    await insertVersion(2);
    await expect(insertVersion(2)).rejects.toThrow(/capital_artifact_versions_unique/);
    await expect(
      pool.query(`UPDATE capital_artifact_versions SET content_json='{"summary":"tampered"}'::jsonb WHERE artifact_id=$1 AND version=1`, [artifactId])
    ).rejects.toThrow(/immutable/);
  });

  // ---------------------------------------------------------------------
  // Proposals
  // ---------------------------------------------------------------------
  it('enforces proposal payload hash, idempotency uniqueness, and expiry consistency', async () => {
    const insert = (idempotencyKey: string, payloadHash = 'sha256:payload', expiresOffset = `interval '7 days'`) =>
      pool.query(
        `INSERT INTO protected_action_proposals(proposal_type, org_id, principal_id, principal_type, mandate_id, mandate_version, target_domain, target_command, draft_payload_json, payload_hash, rationale, source_outcome_id, proposed_by_task_id, proposed_by_agent_class, separation_of_duties_json, expires_at, idempotency_key, status, policy_version, trace_id)
         VALUES ('submit_funding_request', $1, $1, 'company', $2, 1, 'finance', 'finance.create_funding_request', '{"amount":"10000.00"}'::jsonb, $3, 'Working-capital gap', $4, $5, 'capital_agent', '{"proposer_cannot_approve":true}'::jsonb, now() + ${expiresOffset}, $6, 'pending_approval', 'capital-actions-v1', 'trc')`,
        [orgA, mandateId, payloadHash, outcomeId, taskId, idempotencyKey]
      );
    await insert('idem-1');
    await expect(insert('idem-1')).rejects.toThrow(/protected_action_proposals_idem_unique/);
    await expect(insert('idem-2', '')).rejects.toThrow(/payload_hash/);
    await expect(insert('idem-3', 'sha256:x', `interval '-1 hour'`)).rejects.toThrow(/expiry_consistent/);
  });

  // ---------------------------------------------------------------------
  // Real RLS isolation (non-superuser probe)
  // ---------------------------------------------------------------------
  it('denies cross-organization reads and writes under RLS for a non-bypass role', async () => {
    const probe = await pool.connect();
    try {
      await probe.query(`SET ROLE ${PROBE_ROLE}`);
      // Org B context: none of Org A's capital rows are visible.
      await probe.query(`SELECT set_config('app.current_user', $1, false)`, [userId]);
      await probe.query(`SELECT set_config('app.current_org', $1, false)`, [orgB]);
      for (const table of ['agent_mandates', 'agent_outcomes', 'financial_calculation_runs', 'evidence_bundles', 'evidence_claims', 'evidence_references', 'capital_artifacts', 'capital_artifact_versions', 'protected_action_proposals', 'memory_items', 'specialist_task_requests', 'capital_monitoring_states']) {
        const res = await probe.query(`SELECT count(*)::int AS n FROM ${table}`);
        expect({ table, visible: res.rows[0].n }).toEqual({ table, visible: 0 });
      }
      // WITH CHECK blocks writing rows into another org.
      await expect(
        probe.query(
          `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, authority_ceiling, disclosure_policy_id)
           VALUES ($1, 1, $2, $2, 'company', 'capital_agent', 'recommend', 'p')`,
          [randomUUID(), orgA]
        )
      ).rejects.toThrow(/row-level security/);
      // Org A context: rows are visible again (policy works both ways).
      await probe.query(`SELECT set_config('app.current_org', $1, false)`, [orgA]);
      const visible = await probe.query(`SELECT count(*)::int AS n FROM agent_mandates`);
      expect(visible.rows[0].n).toBeGreaterThan(0);
    } finally {
      await probe.query(`RESET ROLE`).catch(() => undefined);
      probe.release();
    }
  });

  // ---------------------------------------------------------------------
  // Binary Finance-boundary test (decision CA-102)
  // ---------------------------------------------------------------------
  it('creating the full Capital chain touches ZERO canonical Finance state', async () => {
    const financeSnapshot = async () => {
      const relational = await pool.query(
        `SELECT
           (SELECT count(*)::int FROM offer_requests) AS offer_requests,
           (SELECT count(*)::int FROM finance_offers) AS finance_offers,
           (SELECT count(*)::int FROM reservations) AS reservations,
           (SELECT count(*)::int FROM payments) AS payments`
      );
      const alpha = await pool.query(
        `SELECT count(*)::int AS funding_objects FROM alpha_objects WHERE type IN ('funding_request', 'funding_offer')`
      );
      return { ...relational.rows[0], ...alpha.rows[0] };
    };

    const before = await financeSnapshot();

    // Full chain: task → mandate(v2 exists) → outcome → calc run → evidence → artifact+version → proposal.
    const chainTask = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, principal_id, principal_type, mandate_id, mandate_version, task_contract_version)
       VALUES ($1, 'boundary-proof financing analysis', 'trc-boundary', $1, 'company', $2, 2, 'capital-task-v1') RETURNING agent_task_id`,
      [orgA, mandateId]
    );
    const chainOutcome = await pool.query(
      `INSERT INTO agent_outcomes(outcome_type, definition_version, task_id, org_id, principal_id, principal_type, mandate_id, mandate_version, status, authority_level, trace_id)
       VALUES ('financing_option_comparison', 'v1', $1, $2, $2, 'company', $3, 2, 'finalised', 'recommend', 'trc-boundary') RETURNING outcome_id`,
      [chainTask.rows[0].agent_task_id, orgA, mandateId]
    );
    await pool.query(
      `INSERT INTO financial_calculation_runs(calculator_id, calculator_version, formula_version, org_id, principal_id, principal_type, mandate_id, mandate_version, outcome_id, input_hash, result_hash, trace_id)
       VALUES ('capital.compare_financing_options', '1.0.0', 'cmp-v1', $1, $1, 'company', $2, 2, $3, 'sha256:i', 'sha256:r', 'trc-boundary')`,
      [orgA, mandateId, chainOutcome.rows[0].outcome_id]
    );
    const chainBundle = await pool.query(
      `INSERT INTO evidence_bundles(org_id, principal_id, principal_type, outcome_id, trace_id)
       VALUES ($1, $1, 'company', $2, 'trc-boundary') RETURNING bundle_id`,
      [orgA, chainOutcome.rows[0].outcome_id]
    );
    const chainArtifact = await pool.query(
      `INSERT INTO capital_artifacts(artifact_type, org_id, principal_id, principal_type, mandate_id, mandate_version, outcome_id, title, authority_level, trace_id)
       VALUES ('financing_packet', $1, $1, 'company', $2, 2, $3, 'Financing packet: boundary proof', 'recommend', 'trc-boundary') RETURNING artifact_id`,
      [orgA, mandateId, chainOutcome.rows[0].outcome_id]
    );
    await pool.query(
      `INSERT INTO capital_artifact_versions(artifact_id, org_id, version, schema_version, content_json, evidence_bundle_id)
       VALUES ($1, $2, 1, 'capital-artifact-v1', '{"kind":"financing_packet"}'::jsonb, $3)`,
      [chainArtifact.rows[0].artifact_id, orgA, chainBundle.rows[0].bundle_id]
    );
    await pool.query(
      `INSERT INTO protected_action_proposals(proposal_type, org_id, principal_id, principal_type, mandate_id, mandate_version, target_domain, target_command, draft_payload_json, payload_hash, rationale, source_outcome_id, proposed_by_agent_class, separation_of_duties_json, expires_at, idempotency_key, status, policy_version, trace_id)
       VALUES ('submit_funding_request', $1, $1, 'company', $2, 2, 'finance', 'finance.create_funding_request', '{"amount":"5000.00"}'::jsonb, 'sha256:boundary', 'Boundary proof', $3, 'capital_agent', '{"proposer_cannot_approve":true}'::jsonb, now() + interval '7 days', 'idem-boundary', 'pending_approval', 'capital-actions-v1', 'trc-boundary')`,
      [orgA, mandateId, chainOutcome.rows[0].outcome_id]
    );

    const after = await financeSnapshot();
    // The entire intelligence chain — including a PROPOSAL to create a funding
    // request — leaves every canonical Finance count untouched.
    expect(after).toEqual(before);
  });
});

function assertLocalTestDatabase(connectionString: string) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Refusing to reset non-local integration database: ${url.hostname}`);
  }
  if (!/test|traibox/i.test(url.pathname)) {
    throw new Error(`Refusing to reset database without test/traibox in name: ${url.pathname}`);
  }
}

async function resetDatabase(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

async function applyMigrations(connectionString: string) {
  const client = new pg.Client({ connectionString });
  const migrationsDir = path.join(findRepoRoot(), 'packages/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, sql: readFileSync(path.join(migrationsDir, name), 'utf8') }));
  await client.connect();
  try {
    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.name} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      readdirSync(path.join(dir, 'packages/db/migrations'));
      return dir;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error('Could not locate repository root with packages/db/migrations');
}
