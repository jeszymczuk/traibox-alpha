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

  // ---------------------------------------------------------------------
  // Mandates (created first: capital-shape tasks now composite-FK to them)
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

  it('enforces the org-backed company invariant and company-only activation', async () => {
    // company principal must equal the org id (CA-113).
    await expect(
      pool.query(
        `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, authority_ceiling, disclosure_policy_id)
         VALUES ($1, 1, $2, $3, 'company', 'capital_agent', 'recommend', 'p')`,
        [randomUUID(), orgA, orgB]
      )
    ).rejects.toThrow(/org_backed_principal/);
    // reserved principal types cannot hold ACTIVE mandates yet.
    await expect(
      pool.query(
        `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id)
         VALUES ($1, 1, $2, $2, 'financier', 'capital_agent', 'active', 'recommend', 'p')`,
        [randomUUID(), orgA]
      )
    ).rejects.toThrow(/company_only_active/);
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
      pool.query(
        `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, principal_id, principal_type, mandate_id, mandate_version, task_contract_version)
         VALUES ($1, 'bad', 'trc', $1, 'lender', $2, 1, 'capital-task-v1')`,
        [orgA, mandateId]
      )
    ).rejects.toThrow(/alpha_agent_tasks_principal_type_check/);
  });

  it('rejects a capital-shape task whose mandate belongs to another organization', async () => {
    // Org B mandate; Org A task trying to bind it (composite FK includes org+principal).
    const foreignMandate = randomUUID();
    await pool.query(
      `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id)
       VALUES ($1, 1, $2, $2, 'company', 'capital_agent', 'active', 'recommend', 'p')`,
      [foreignMandate, orgB]
    );
    await expect(
      pool.query(
        `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, principal_id, principal_type, mandate_id, mandate_version, task_contract_version)
         VALUES ($1, 'cross-org mandate theft', 'trc', $1, 'company', $2, 1, 'capital-task-v1')`,
        [orgA, foreignMandate]
      )
    ).rejects.toThrow(/alpha_agent_tasks_mandate_owned_fk/);
  });

  it('rejects partially populated Capital task bindings (all-or-none)', async () => {
    const partials: Array<[string, string]> = [
      ['principal without mandate', `principal_id, principal_type) VALUES ($1, 'p', 'trc', $1, 'company')`],
      ['principal type without principal id', `principal_type) VALUES ($1, 'p', 'trc', 'company')`],
      ['mandate id without mandate version', `principal_id, principal_type, mandate_id) VALUES ($1, 'p', 'trc', $1, 'company', gen_random_uuid())`],
      ['contract version without principal binding', `task_contract_version) VALUES ($1, 'p', 'trc', 'capital-task-v1')`],
      ['outcome id on a legacy row', `outcome_id) VALUES ($1, 'p', 'trc', gen_random_uuid())`]
    ];
    for (const [label, fragment] of partials) {
      await expect(
        pool.query(`INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, ${fragment}`, [orgA]),
        label
      ).rejects.toThrow(/capital_binding_all_or_none/);
    }
  });

  it('enforces organization-backed principal identity for every principal type', async () => {
    // financier principal_id must ALSO equal the org id (not only company).
    await expect(
      pool.query(
        `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id)
         VALUES ($1, 1, $2, $3, 'financier', 'capital_agent', 'draft', 'recommend', 'p')`,
        [randomUUID(), orgA, orgB]
      )
    ).rejects.toThrow(/org_backed_principal/);
    await expect(
      pool.query(
        `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id)
         VALUES ($1, 1, $2, $3, 'platform_internal', 'capital_agent', 'draft', 'recommend', 'p')`,
        [randomUUID(), orgA, randomUUID()]
      )
    ).rejects.toThrow(/org_backed_principal/);
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
    ).rejects.toThrow(/agent_outcomes_mandate_owned_fk/);

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
      `INSERT INTO evidence_references(claim_id, org_id, principal_id, principal_type, source_layer, domain, object_type, object_id)
       VALUES ($1, $2, $2, 'company', 'alpha_object', 'finance', 'funding_request', 'fr-1')`,
      [claim.rows[0].claim_id, orgA]
    );
    // Append-only: claims and references cannot be updated or deleted.
    await expect(
      pool.query(`UPDATE evidence_claims SET statement='rewritten history' WHERE claim_id=$1`, [claim.rows[0].claim_id])
    ).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM evidence_claims WHERE claim_id=$1`, [claim.rows[0].claim_id])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM evidence_references WHERE claim_id=$1`, [claim.rows[0].claim_id])).rejects.toThrow(/append-only/);
    await expect(
      pool.query(
        `INSERT INTO evidence_claims(bundle_id, org_id, principal_id, principal_type, claim_type, statement, confidence, verification_status, materiality)
         VALUES ($1, $2, $2, 'company', 'vibe', 'not a claim type', 'high', 'verified', 'material')`,
        [bundleId, orgA]
      )
    ).rejects.toThrow(/claim_type/);
    // A claim cannot attach to a bundle owned by another principal.
    await expect(
      pool.query(
        `INSERT INTO evidence_claims(bundle_id, org_id, principal_id, principal_type, claim_type, statement, confidence, verification_status, materiality)
         VALUES ($1, $2, $2, 'financier', 'assumption', 'cross-principal attach', 'low', 'unverified', 'supporting')`,
        [bundleId, orgA]
      )
    ).rejects.toThrow(/evidence_claims_bundle_owned_fk/);
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
        `INSERT INTO capital_artifact_versions(artifact_id, org_id, principal_id, principal_type, version, schema_version, content_json, evidence_bundle_id)
         VALUES ($1, $2, $2, 'company', $3, 'capital-artifact-v1', '{"summary":"v"}'::jsonb, $4)`,
        [artifactId, orgA, version, bundleId]
      );
    await insertVersion(1);
    await insertVersion(2);
    await expect(insertVersion(2)).rejects.toThrow(/capital_artifact_versions_unique/);
    await expect(
      pool.query(`UPDATE capital_artifact_versions SET content_json='{"summary":"tampered"}'::jsonb WHERE artifact_id=$1 AND version=1`, [artifactId])
    ).rejects.toThrow(/append-only/);
    await expect(
      pool.query(`DELETE FROM capital_artifact_versions WHERE artifact_id=$1 AND version=1`, [artifactId])
    ).rejects.toThrow(/append-only/);
  });

  it('rejects an artifact version bound to a different principal than its artifact', async () => {
    await expect(
      pool.query(
        `INSERT INTO capital_artifact_versions(artifact_id, org_id, principal_id, principal_type, version, schema_version, content_json)
         VALUES ($1, $2, $2, 'financier', 9, 'capital-artifact-v1', '{}'::jsonb)`,
        [artifactId, orgA]
      )
    ).rejects.toThrow(/artifact_versions_artifact_owned_fk/);
  });

  it('keeps calculation runs append-only (no update, no ordinary delete)', async () => {
    const run = await pool.query(`SELECT run_id FROM financial_calculation_runs LIMIT 1`);
    const runId = run.rows[0].run_id;
    await expect(pool.query(`UPDATE financial_calculation_runs SET result_json='{"gap":"999"}'::jsonb WHERE run_id=$1`, [runId])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM financial_calculation_runs WHERE run_id=$1`, [runId])).rejects.toThrow(/append-only/);
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
  it('denies cross-organization AND cross-principal access under RLS for a non-bypass role', async () => {
    // A reserved-type (financier, draft) row inside Org A, to prove
    // same-org/other-principal isolation. Its mere existence activates nothing.
    const financierMandate = randomUUID();
    await pool.query(
      `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id)
       VALUES ($1, 1, $2, $2, 'financier', 'capital_agent', 'draft', 'recommend', 'p')`,
      [financierMandate, orgA]
    );
    // A financier-principal Capital task in Org A (full binding), plus the
    // legacy + company tasks created by earlier tests, for the hybrid policy.
    await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, principal_id, principal_type, mandate_id, mandate_version, task_contract_version)
       VALUES ($1, 'financier-side capital task', 'trc-fin', $1, 'financier', $2, 1, 'capital-task-v1')`,
      [orgA, financierMandate]
    );

    const probe = await pool.connect();
    const setCtx = async (org: string, principalId: string | null, principalType: string | null) => {
      await probe.query(`SELECT set_config('app.current_user', $1, false)`, [userId]);
      await probe.query(`SELECT set_config('app.current_org', $1, false)`, [org]);
      await probe.query(`SELECT set_config('app.current_principal_id', $1, false)`, [principalId ?? '']);
      await probe.query(`SELECT set_config('app.current_principal_type', $1, false)`, [principalType ?? '']);
    };
    const CAPITAL_TABLES = [
      'agent_mandates',
      'agent_outcomes',
      'financial_calculation_runs',
      'evidence_bundles',
      'evidence_claims',
      'evidence_references',
      'capital_artifacts',
      'capital_artifact_versions',
      'protected_action_proposals',
      'memory_items',
      'specialist_task_requests',
      'capital_monitoring_states'
    ];
    try {
      await probe.query(`SET ROLE ${PROBE_ROLE}`);

      // Org B company context: no FOREIGN-org rows are visible in any capital
      // table (Org B may legitimately see its own rows created by other tests).
      await setCtx(orgB, orgB, 'company');
      for (const table of CAPITAL_TABLES) {
        const res = await probe.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id <> $1`, [orgB]);
        expect({ table, foreignRowsVisible: res.rows[0].n }).toEqual({ table, foreignRowsVisible: 0 });
      }
      // WITH CHECK blocks writing rows into another org.
      await expect(
        probe.query(
          `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, authority_ceiling, disclosure_policy_id)
           VALUES ($1, 1, $2, $2, 'company', 'capital_agent', 'recommend', 'p')`,
          [randomUUID(), orgA]
        )
      ).rejects.toThrow(/row-level security/);

      // Org A COMPANY context: company rows visible, financier-principal row is NOT.
      await setCtx(orgA, orgA, 'company');
      const companyVisible = await probe.query(`SELECT count(*)::int AS n FROM agent_mandates`);
      expect(companyVisible.rows[0].n).toBeGreaterThan(0);
      const financierLeak = await probe.query(`SELECT count(*)::int AS n FROM agent_mandates WHERE principal_type='financier'`);
      expect(financierLeak.rows[0].n).toBe(0);

      // Org A FINANCIER context: sees only the financier-principal row.
      await setCtx(orgA, orgA, 'financier');
      const financierView = await probe.query(`SELECT count(*)::int AS n, min(principal_type) AS pt FROM agent_mandates`);
      expect(financierView.rows[0].n).toBe(1);
      expect(financierView.rows[0].pt).toBe('financier');

      // Org context WITHOUT principal context sees no capital rows at all
      // (principal-aware policies require the full context).
      await setCtx(orgA, null, null);
      const noPrincipal = await probe.query(`SELECT count(*)::int AS n FROM agent_mandates`);
      expect(noPrincipal.rows[0].n).toBe(0);

      // --- alpha_agent_tasks hybrid policy (A1) ---
      // Company context: sees legacy + company capital tasks, NOT financier tasks.
      await setCtx(orgA, orgA, 'company');
      const companyTasks = await probe.query(
        `SELECT (count(*) FILTER (WHERE principal_type = 'financier'))::int AS financier_visible,
                (count(*) FILTER (WHERE principal_type = 'company'))::int AS company_visible,
                (count(*) FILTER (WHERE principal_id IS NULL))::int AS legacy_visible
         FROM alpha_agent_tasks`
      );
      expect(companyTasks.rows[0].financier_visible).toBe(0);
      expect(companyTasks.rows[0].company_visible).toBeGreaterThan(0);
      expect(companyTasks.rows[0].legacy_visible).toBeGreaterThan(0);
      // Financier context: sees the financier task, no company tasks.
      await setCtx(orgA, orgA, 'financier');
      const financierTasks = await probe.query(
        `SELECT (count(*) FILTER (WHERE principal_type = 'financier'))::int AS financier_visible,
                (count(*) FILTER (WHERE principal_type = 'company'))::int AS company_visible
         FROM alpha_agent_tasks`
      );
      expect(financierTasks.rows[0].financier_visible).toBe(1);
      expect(financierTasks.rows[0].company_visible).toBe(0);
      // Org context without principal context: legacy tasks remain usable,
      // Capital tasks are invisible.
      await setCtx(orgA, null, null);
      const orgOnlyTasks = await probe.query(
        `SELECT (count(*) FILTER (WHERE principal_id IS NOT NULL))::int AS capital_visible,
                (count(*) FILTER (WHERE principal_id IS NULL))::int AS legacy_visible
         FROM alpha_agent_tasks`
      );
      expect(orgOnlyTasks.rows[0].capital_visible).toBe(0);
      expect(orgOnlyTasks.rows[0].legacy_visible).toBeGreaterThan(0);
      // Legacy org-scoped writes still work without principal context.
      await probe.query(`INSERT INTO alpha_agent_tasks(org_id, objective, trace_id) VALUES ($1, 'legacy write under org context', 'trc-legacy-2')`, [orgA]);
      // Cross-organization denial remains intact.
      await setCtx(orgB, orgB, 'company');
      const foreignTasks = await probe.query(`SELECT count(*)::int AS n FROM alpha_agent_tasks WHERE org_id <> $1`, [orgB]);
      expect(foreignTasks.rows[0].n).toBe(0);
    } finally {
      await probe.query(`RESET ROLE`).catch(() => undefined);
      probe.release();
    }
  });

  // ---------------------------------------------------------------------
  // Proposal hardening: payload freezing, approval binding, SoD
  // ---------------------------------------------------------------------
  it('freezes pending proposals, binds approval to the payload hash, and enforces SoD', async () => {
    const approverId = randomUUID();
    await pool.query(`INSERT INTO app_users(user_id, email) VALUES ($1, 'approver@local')`, [approverId]);

    const inserted = await pool.query(
      `INSERT INTO protected_action_proposals(proposal_type, org_id, principal_id, principal_type, mandate_id, mandate_version, target_domain, target_command, draft_payload_json, payload_hash, rationale, source_outcome_id, proposed_by_user_id, proposed_by_agent_class, separation_of_duties_json, expires_at, idempotency_key, status, policy_version, trace_id)
       VALUES ('submit_funding_request', $1, $1, 'company', $2, 1, 'finance', 'finance.create_funding_request', '{"amount":"7000.00"}'::jsonb, 'sha256:frozen', 'Hardening test', $3, $4, 'capital_agent', '{"proposer_cannot_approve":true}'::jsonb, now() + interval '7 days', 'idem-hardening', 'draft', 'capital-actions-v1', 'trc')
       RETURNING proposal_id`,
      [orgA, mandateId, outcomeId, userId]
    );
    const proposalId = inserted.rows[0].proposal_id;

    // Draft payload may be revised.
    await pool.query(`UPDATE protected_action_proposals SET draft_payload_json='{"amount":"7500.00"}'::jsonb, payload_hash='sha256:frozen2' WHERE proposal_id=$1`, [proposalId]);
    // Move to pending: action-defining fields freeze.
    await pool.query(`UPDATE protected_action_proposals SET status='pending_approval' WHERE proposal_id=$1`, [proposalId]);
    await expect(
      pool.query(`UPDATE protected_action_proposals SET draft_payload_json='{"amount":"9999.00"}'::jsonb, payload_hash='sha256:tampered' WHERE proposal_id=$1`, [proposalId])
    ).rejects.toThrow(/frozen after draft/);

    // Approval without binding fields is rejected.
    await expect(pool.query(`UPDATE protected_action_proposals SET status='approved' WHERE proposal_id=$1`, [proposalId])).rejects.toThrow(
      /requires approval_request_id/
    );
    // Approved hash must equal the frozen payload hash.
    await expect(
      pool.query(
        `UPDATE protected_action_proposals SET status='approved', approval_request_id=$2, approved_by_user_id=$3, approved_at=now(), approved_payload_hash='sha256:other' WHERE proposal_id=$1`,
        [proposalId, randomUUID(), approverId]
      )
    ).rejects.toThrow(/approved_payload_hash must equal payload_hash/);
    // Separation of duties: the proposer cannot approve their own proposal.
    await expect(
      pool.query(
        `UPDATE protected_action_proposals SET status='approved', approval_request_id=$2, approved_by_user_id=$3, approved_at=now(), approved_payload_hash='sha256:frozen2' WHERE proposal_id=$1`,
        [proposalId, randomUUID(), userId]
      )
    ).rejects.toThrow(/separation of duties/);
    // A distinct approver with the exact payload hash succeeds.
    await pool.query(
      `UPDATE protected_action_proposals SET status='approved', approval_request_id=$2, approved_by_user_id=$3, approved_at=now(), approved_payload_hash='sha256:frozen2' WHERE proposal_id=$1`,
      [proposalId, randomUUID(), approverId]
    );
    // A proposal can never be born approved.
    await expect(
      pool.query(
        `INSERT INTO protected_action_proposals(proposal_type, org_id, principal_id, principal_type, mandate_id, mandate_version, target_domain, target_command, draft_payload_json, payload_hash, rationale, source_outcome_id, proposed_by_agent_class, separation_of_duties_json, expires_at, idempotency_key, status, policy_version, trace_id)
         VALUES ('submit_funding_request', $1, $1, 'company', $2, 1, 'finance', 'finance.x', '{}'::jsonb, 'sha256:x', 'r', $3, 'capital_agent', '{}'::jsonb, now() + interval '1 day', 'idem-born-approved', 'approved', 'v1', 'trc')`,
        [orgA, mandateId, outcomeId]
      )
    ).rejects.toThrow(/terminal state/);
  });

  it('enforces the proposal lifecycle state machine and terminal-decision immutability', async () => {
    const approverId = randomUUID();
    await pool.query(`INSERT INTO app_users(user_id, email) VALUES ($1, 'approver2@local')`, [approverId]);
    const insertDraft = async (idem: string) => {
      const res = await pool.query(
        `INSERT INTO protected_action_proposals(proposal_type, org_id, principal_id, principal_type, mandate_id, mandate_version, target_domain, target_command, draft_payload_json, payload_hash, rationale, source_outcome_id, proposed_by_user_id, proposed_by_agent_class, separation_of_duties_json, expires_at, idempotency_key, status, policy_version, trace_id)
         VALUES ('submit_funding_request', $1, $1, 'company', $2, 1, 'finance', 'finance.create_funding_request', '{"amount":"1.00"}'::jsonb, 'sha256:lc', 'lifecycle', $3, $4, 'capital_agent', '{"proposer_cannot_approve":true}'::jsonb, now() + interval '7 days', $5, 'draft', 'v1', 'trc')
         RETURNING proposal_id`,
        [orgA, mandateId, outcomeId, userId, idem]
      );
      return res.rows[0].proposal_id as string;
    };

    // Illegal transition: draft cannot jump straight to approved.
    const p1 = await insertDraft('idem-lc-1');
    await expect(
      pool.query(
        `UPDATE protected_action_proposals SET status='approved', approval_request_id=$2, approved_by_user_id=$3, approved_at=now(), approved_payload_hash='sha256:lc' WHERE proposal_id=$1`,
        [p1, randomUUID(), approverId]
      )
    ).rejects.toThrow(/illegal status transition draft -> approved/);

    // Rejection requires actor + timestamp; a rejected decision is terminal.
    const p2 = await insertDraft('idem-lc-2');
    await pool.query(`UPDATE protected_action_proposals SET status='pending_approval' WHERE proposal_id=$1`, [p2]);
    await expect(pool.query(`UPDATE protected_action_proposals SET status='rejected' WHERE proposal_id=$1`, [p2])).rejects.toThrow(
      /rejected status requires rejected_by_user_id and rejected_at/
    );
    await pool.query(
      `UPDATE protected_action_proposals SET status='rejected', rejected_by_user_id=$2, rejected_at=now(), decision_rationale='not eligible yet' WHERE proposal_id=$1`,
      [p2, approverId]
    );
    await expect(
      pool.query(
        `UPDATE protected_action_proposals SET status='approved', approval_request_id=$2, approved_by_user_id=$3, approved_at=now(), approved_payload_hash='sha256:lc' WHERE proposal_id=$1`,
        [p2, randomUUID(), approverId]
      )
    ).rejects.toThrow(/terminal state/);
    await expect(
      pool.query(`UPDATE protected_action_proposals SET decision_rationale='rewritten' WHERE proposal_id=$1`, [p2])
    ).rejects.toThrow(/decision metadata is immutable/);

    // The previously approved proposal (idem-hardening) is terminal: status,
    // approver, and timestamps are frozen.
    await expect(
      pool.query(`UPDATE protected_action_proposals SET status='rejected', rejected_by_user_id=$1, rejected_at=now() WHERE idempotency_key='idem-hardening'`, [approverId])
    ).rejects.toThrow(/terminal state/);
    await expect(
      pool.query(`UPDATE protected_action_proposals SET approved_by_user_id=$1 WHERE idempotency_key='idem-hardening'`, [approverId])
    ).rejects.toThrow(/decision metadata is immutable/);
    await expect(
      pool.query(`UPDATE protected_action_proposals SET approved_at=now() WHERE idempotency_key='idem-hardening'`)
    ).rejects.toThrow(/decision metadata is immutable/);
  });

  it('permits governed purge only with the flag AND the trusted system identity', async () => {
    const fresh = await pool.query(
      `INSERT INTO evidence_claims(bundle_id, org_id, principal_id, principal_type, claim_type, statement, confidence, verification_status, materiality)
       VALUES ($1, $2, $2, 'company', 'estimate', 'purge target', 'low', 'unverified', 'supporting')
       RETURNING claim_id`,
      [bundleId, orgA]
    );
    const claimId = fresh.rows[0].claim_id;
    const client = await pool.connect();
    try {
      // Flag alone (ordinary user identity): still blocked.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.allow_governed_purge = 'on'`);
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      await expect(client.query(`DELETE FROM evidence_claims WHERE claim_id=$1`, [claimId])).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK');
      // System identity alone (no flag): blocked.
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true)`);
      await expect(client.query(`DELETE FROM evidence_claims WHERE claim_id=$1`, [claimId])).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK');
      // Flag + system identity inside the governed transaction: permitted.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.allow_governed_purge = 'on'`);
      await client.query(`SELECT set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true)`);
      await client.query(`DELETE FROM evidence_claims WHERE claim_id=$1`, [claimId]);
      await client.query('COMMIT');
      const gone = await pool.query(`SELECT count(*)::int AS n FROM evidence_claims WHERE claim_id=$1`, [claimId]);
      expect(gone.rows[0].n).toBe(0);
      // UPDATE protection remains absolute even on the governed path.
      await client.query('BEGIN');
      await client.query(`SET LOCAL app.allow_governed_purge = 'on'`);
      await client.query(`SELECT set_config('app.current_user', '00000000-0000-0000-0000-000000000000', true)`);
      await expect(client.query(`UPDATE evidence_claims SET statement='x' WHERE org_id=$1`, [orgA])).rejects.toThrow(/append-only/);
      await client.query('ROLLBACK');
    } finally {
      client.release();
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
      `INSERT INTO capital_artifact_versions(artifact_id, org_id, principal_id, principal_type, version, schema_version, content_json, evidence_bundle_id)
       VALUES ($1, $2, $2, 'company', 1, 'capital-artifact-v1', '{"kind":"financing_packet"}'::jsonb, $3)`,
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
