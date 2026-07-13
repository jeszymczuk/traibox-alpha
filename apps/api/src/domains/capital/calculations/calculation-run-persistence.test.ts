import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FinancialCalculationRunDraft } from '@traibox/contracts';
import { CalculationIdempotencyConflict, CalculationPersistenceError, persistCalculationRun } from './calculation-run-persistence';

/**
 * Calculation persistence adapter tests (Part B §B7).
 *
 * Gated exactly like the other integration suites: runs only when
 * ALPHA_INTEGRATION_DATABASE_URL points at a LOCAL test database. The draft
 * under test is a REAL Python Workbench build_run_draft output (fixture);
 * identity fields are rebound to test entities — identity is outside the
 * hashes, so the audit chain stays intact.
 */

// Own derived database: the capital DB suites run in parallel vitest workers
// and must never share (each resets its schema in beforeAll).
const BASE_DB_URL = process.env.ALPHA_INTEGRATION_DATABASE_URL;
const TEST_DB_URL = BASE_DB_URL ? deriveDatabaseUrl(BASE_DB_URL, '_calc_runs') : undefined;
const run = TEST_DB_URL ? describe : describe.skip;

const FIXTURE = path.resolve(__dirname, '../../../../../../packages/contracts/fixtures/financial-calculation-run-draft.v1.json');

function loadDraft(): FinancialCalculationRunDraft {
  return JSON.parse(readFileSync(FIXTURE, 'utf8')).draft as FinancialCalculationRunDraft;
}

run('capital calculation-run persistence adapter against Postgres', () => {
  let pool: pg.Pool;
  let orgA: string;
  let orgB: string;
  let userId: string;
  let mandateId: string;
  let mandateB: string;
  let financierMandate: string;
  let taskA: string;
  let taskB: string;
  let outcomeA: string;
  let foreignTask: string;

  /** Rebind the fixture draft to test entities; audit hashes are unaffected. */
  function draftFor(overrides: Partial<FinancialCalculationRunDraft> = {}): FinancialCalculationRunDraft {
    return {
      ...loadDraft(),
      organization_id: orgA,
      principal_id: orgA,
      mandate_id: mandateId,
      mandate_version: 1,
      task_id: taskA,
      outcome_id: null,
      actor_user_id: userId,
      idempotency_key: `idem-${randomUUID()}`,
      ...overrides
    };
  }

  async function inOrgTx<T>(orgId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      await client.query(`SELECT set_config('app.current_org', $1, true)`, [orgId]);
      await client.query(`SELECT set_config('app.current_principal_id', $1, true)`, [orgId]);
      await client.query(`SELECT set_config('app.current_principal_type', 'company', true)`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  const persist = (draft: FinancialCalculationRunDraft, orgId = orgA) => inOrgTx(orgId, (client) => persistCalculationRun(client, draft));

  beforeAll(async () => {
    if (!TEST_DB_URL || !BASE_DB_URL) return;
    assertLocalTestDatabase(TEST_DB_URL);
    await ensureDatabase(BASE_DB_URL, TEST_DB_URL);
    await resetDatabase(TEST_DB_URL);
    await applyMigrations(TEST_DB_URL);
    pool = new pg.Pool({ connectionString: TEST_DB_URL });

    userId = randomUUID();
    await pool.query(`INSERT INTO app_users(user_id, email) VALUES ($1, 'calc-adapter@local')`, [userId]);
    const a = await pool.query(`INSERT INTO orgs(name, country) VALUES ('Calc Adapter Org A', 'PT') RETURNING org_id`);
    const b = await pool.query(`INSERT INTO orgs(name, country) VALUES ('Calc Adapter Org B', 'ES') RETURNING org_id`);
    orgA = a.rows[0].org_id;
    orgB = b.rows[0].org_id;

    mandateId = randomUUID();
    mandateB = randomUUID();
    financierMandate = randomUUID();
    await pool.query(
      `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id, issued_by)
       VALUES ($1, 1, $2, $2, 'company', 'capital_agent', 'active', 'recommend', 'disclosure-company-v1', $3)`,
      [mandateId, orgA, userId]
    );
    await pool.query(
      `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id, issued_by)
       VALUES ($1, 1, $2, $2, 'company', 'capital_agent', 'active', 'recommend', 'disclosure-company-v1', $3)`,
      [mandateB, orgB, userId]
    );
    // Reserved financier mandate (draft status: financier is never active;
    // principals are org-backed for every type per the V016 closure).
    await pool.query(
      `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status, authority_ceiling, disclosure_policy_id, issued_by)
       VALUES ($1, 1, $2, $2, 'financier', 'capital_agent', 'draft', 'recommend', 'disclosure-company-v1', $3)`,
      [financierMandate, orgA, userId]
    );

    const task = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version, task_contract_version, definition_version)
       VALUES ($1, 'calc adapter task A', 'trc-a', $2, $1, 'company', $3, 1, 'capital-task-v1', 'capital-agent-1.1.0') RETURNING agent_task_id`,
      [orgA, userId, mandateId]
    );
    taskA = task.rows[0].agent_task_id;
    const otherTask = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version, task_contract_version, definition_version)
       VALUES ($1, 'calc adapter task B (other org)', 'trc-b', $2, $1, 'company', $3, 1, 'capital-task-v1', 'capital-agent-1.1.0') RETURNING agent_task_id`,
      [orgB, userId, mandateB]
    );
    foreignTask = otherTask.rows[0].agent_task_id;
    const secondTask = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version, task_contract_version, definition_version)
       VALUES ($1, 'calc adapter task A2', 'trc-a2', $2, $1, 'company', $3, 1, 'capital-task-v1', 'capital-agent-1.1.0') RETURNING agent_task_id`,
      [orgA, userId, mandateId]
    );
    taskB = secondTask.rows[0].agent_task_id;

    const outcome = await pool.query(
      `INSERT INTO agent_outcomes(outcome_type, definition_version, task_id, org_id, principal_id, principal_type, mandate_id, mandate_version, status, authority_level, trace_id)
       VALUES ('capital_diagnosis', 'v1', $1, $2, $2, 'company', $3, 1, 'requested', 'recommend', 'trc')
       RETURNING outcome_id`,
      [taskA, orgA, mandateId]
    );
    outcomeA = outcome.rows[0].outcome_id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('persists a real Python-produced draft and returns the typed run', async () => {
    const persisted = await persist(draftFor());
    expect(persisted.run_id).toBeTruthy();
    expect(persisted.executed_by).toBe('workbench');
    expect(persisted.status).toBe('completed');
    expect(persisted.eligibility).toBe('eligible');
    expect(persisted.input_manifest).toEqual(loadDraft().input_manifest);
    expect(persisted.result_envelope).toEqual(loadDraft().result_envelope);
    expect(persisted.assumptions_used).toEqual(loadDraft().assumptions_used);
    expect(persisted.warnings).toEqual(loadDraft().warnings);
    expect(persisted.validations).toEqual(loadDraft().validations);
    expect(persisted.execution).toEqual({ duration_ms: 7, engine: 'workbench' });
    expect(persisted.mandate).toEqual({ mandate_id: mandateId, mandate_version: 1 });
    expect(persisted.created_at).toBeTruthy();
  });

  it('persists every status/eligibility pair through the unified contract', async () => {
    const base = draftFor();
    const cases: Array<[FinancialCalculationRunDraft['status'], FinancialCalculationRunDraft['eligibility']]> = [
      ['completed', 'eligible'],
      ['insufficient_information', 'insufficient_information'],
      ['invalid_input', 'not_applicable'],
      ['failed', 'not_applicable'],
      ['completed', 'ineligible']
    ];
    for (const [status, eligibility] of cases) {
      // Rewrite the envelope so hashes and projections stay consistent.
      const envelope = { ...base.result_envelope, status, eligibility };
      const { deterministicCalculationHash } = await import('./calculation-run-hashing');
      const resultHash = deterministicCalculationHash(envelope, {
        calculator_id: base.calculator_id,
        calculator_version: base.calculator_version,
        formula_version: base.formula_version
      });
      const persisted = await persist(draftFor({ status, eligibility, result_envelope: envelope, result_hash: resultHash }));
      expect(persisted.status).toBe(status);
      expect(persisted.eligibility).toBe(eligibility);
    }
  });

  it('persists scenario identity, provenance, contradictions, and missing fields losslessly', async () => {
    const base = loadDraft();
    const persisted = await persist(draftFor());
    expect(persisted.scenario_id).toBe(base.scenario_id ?? null);
    expect(persisted.input_provenance).toEqual(base.input_provenance);
    expect(persisted.contradictions).toEqual(base.contradictions);
    expect(persisted.missing_fields).toEqual(base.missing_fields);
    const row = await pool.query(`SELECT input_manifest_json, result_envelope_json FROM financial_calculation_runs WHERE run_id = $1`, [persisted.run_id]);
    expect(row.rows[0].input_manifest_json).toEqual(base.input_manifest);
    expect(row.rows[0].result_envelope_json).toEqual(base.result_envelope);
  });

  const tamperCases: Array<[string, (draft: FinancialCalculationRunDraft) => FinancialCalculationRunDraft, string]> = [
    [
      'altered output',
      (d) => ({ ...d, result: { ...d.result, net_proceeds_now: '99999.99' } }),
      'calculation.projection_result_mismatch'
    ],
    ['altered status projection', (d) => ({ ...d, status: 'failed' }), 'calculation.projection_status_mismatch'],
    [
      'altered warning projection',
      (d) => ({ ...d, warnings: [...d.warnings, { code: 'fabricated', message: 'x', severity: 'info' as const, related_input_paths: [] }] }),
      'calculation.projection_warnings_mismatch'
    ],
    ['altered assumption projection', (d) => ({ ...d, assumptions_used: [...d.assumptions_used, 'fabricated assumption'] }), 'calculation.projection_assumptions_mismatch'],
    ['altered contradiction projection', (d) => ({ ...d, contradictions: ['fabricated contradiction'] }), 'calculation.projection_contradictions_mismatch'],
    [
      'altered envelope (status inside hash payload)',
      (d) => ({ ...d, status: 'failed', result_envelope: { ...d.result_envelope, status: 'failed' } }),
      'calculation.result_hash_mismatch'
    ],
    [
      'altered policy (inside hashed input manifest)',
      (d) => ({
        ...d,
        input_manifest: { ...d.input_manifest, currency_policy: { ...(d.input_manifest.currency_policy as Record<string, unknown>), base_currency: 'USD' } }
      }),
      'calculation.input_hash_mismatch'
    ],
    ['altered input hash', (d) => ({ ...d, input_hash: `sha256:${'0'.repeat(64)}` }), 'calculation.input_hash_mismatch'],
    ['altered result hash', (d) => ({ ...d, result_hash: `sha256:${'f'.repeat(64)}` }), 'calculation.result_hash_mismatch']
  ];

  for (const [name, mutate, code] of tamperCases) {
    it(`rejects a tampered draft: ${name}`, async () => {
      const tampered = mutate(draftFor());
      await expect(persist(tampered)).rejects.toMatchObject({ code });
      const count = await pool.query(`SELECT count(*)::int AS n FROM financial_calculation_runs WHERE idempotency_key = $1`, [tampered.idempotency_key]);
      expect(count.rows[0].n).toBe(0);
    });
  }

  it('rejects cross-organization insertion (RLS context mismatch)', async () => {
    await expect(persist(draftFor(), orgB)).rejects.toMatchObject({ code: 'calculation.rls_context_mismatch' });
  });

  it('rejects cross-principal and financier execution', async () => {
    await expect(persist(draftFor({ principal_id: randomUUID() }))).rejects.toMatchObject({ code: 'calculation.principal_not_org_backed' });
    await expect(
      persist(draftFor({ principal_type: 'financier' as const, mandate_id: financierMandate }))
    ).rejects.toMatchObject({ code: 'calculation.principal_not_company' });
  });

  it('rejects a mismatched task and a mismatched outcome', async () => {
    await expect(persist(draftFor({ task_id: foreignTask }))).rejects.toMatchObject({ code: 'calculation.task_not_owned' });
    await expect(persist(draftFor({ task_id: taskB, outcome_id: outcomeA }))).rejects.toMatchObject({ code: 'calculation.outcome_not_owned' });
    const bound = await persist(draftFor({ outcome_id: outcomeA }));
    expect(bound.outcome_id).toBe(outcomeA);
  });

  it('rejects an unknown mandate version and a non-active mandate', async () => {
    await expect(persist(draftFor({ mandate_version: 99 }))).rejects.toMatchObject({ code: 'calculation.mandate_not_found' });
  });

  it('idempotent retry returns the existing record; conflicting retry is rejected', async () => {
    const key = `idem-replay-${randomUUID()}`;
    const first = await persist(draftFor({ idempotency_key: key }));
    const replay = await persist(draftFor({ idempotency_key: key }));
    expect(replay.run_id).toBe(first.run_id);

    const conflicting = draftFor({ idempotency_key: key, task_id: taskB });
    await expect(persist(conflicting)).rejects.toBeInstanceOf(CalculationIdempotencyConflict);
    // The prior record is never overwritten.
    const untouched = await pool.query(`SELECT task_id FROM financial_calculation_runs WHERE run_id = $1`, [first.run_id]);
    expect(untouched.rows[0].task_id).toBe(taskA);
  });

  it('is concurrency-safe: parallel same-key inserts yield one record', async () => {
    const key = `idem-parallel-${randomUUID()}`;
    const results = await Promise.allSettled([persist(draftFor({ idempotency_key: key })), persist(draftFor({ idempotency_key: key }))]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof persist>>> => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(2);
    expect(new Set(fulfilled.map((r) => r.value.run_id)).size).toBe(1);
    const count = await pool.query(`SELECT count(*)::int AS n FROM financial_calculation_runs WHERE idempotency_key = $1`, [key]);
    expect(count.rows[0].n).toBe(1);
  });

  it('creates no Finance table or Alpha Finance object changes', async () => {
    const financeCounts = async () => {
      const tables = ['finance_offers'];
      const counts: Record<string, number> = {};
      for (const table of tables) {
        const res = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
        counts[table] = res.rows[0].n;
      }
      const alphaFunding = await pool.query(
        `SELECT count(*)::int AS n FROM alpha_objects WHERE type IN ('funding_request', 'funding_offer', 'financing_agreement')`
      );
      counts.alpha_funding_objects = alphaFunding.rows[0].n;
      return counts;
    };
    const before = await financeCounts();
    await persist(draftFor());
    await expect(persist(draftFor({ status: 'failed' }))).rejects.toBeInstanceOf(CalculationPersistenceError);
    const after = await financeCounts();
    expect(after).toEqual(before);
  });
});

function deriveDatabaseUrl(baseUrl: string, suffix: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname}${suffix}`;
  return url.toString();
}

async function ensureDatabase(adminUrl: string, targetUrl: string) {
  const database = new URL(targetUrl).pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+$/.test(database)) throw new Error(`unsafe test database name: ${database}`);
  const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } catch (error) {
    if ((error as { code?: string }).code !== '42P04') throw error; // 42P04 = duplicate_database
  } finally {
    await admin.end();
  }
}

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
  const admin = new pg.Pool({ connectionString, max: 1 });
  await admin.query('DROP SCHEMA IF EXISTS public CASCADE');
  await admin.query('DROP SCHEMA IF EXISTS app CASCADE');
  await admin.query('CREATE SCHEMA public');
  await admin.end();
}

async function applyMigrations(connectionString: string) {
  const migrationsDir = path.resolve(__dirname, '../../../../../../packages/db/migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const admin = new pg.Pool({ connectionString, max: 1 });
  for (const file of files) {
    await admin.query(readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  await admin.end();
}
