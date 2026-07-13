import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCapitalOutcome, runCapitalOutcome, type CapitalOutcomeRequestBody } from '../../../services/capital-agent';
import { persistOutcomeExecution } from './outcome-persistence';

/**
 * Capital outcome end-to-end integration (Phase 4 §D8; Phase 4.1 §§2–4, 6,
 * 10, 13). The Trade Brain result under test is a REAL Python
 * execute_capital_outcome output (fixture v2 with canonical snapshots and
 * evidence coverage); a stubbed transport rebinds it to the entities this
 * suite creates. Proves: exact task + outcome idempotency, semantic-hash 409
 * conflicts, complete replay equality, concurrency (one task, one outcome),
 * honest task lifecycle on every failure path (no orphaned running task),
 * canonical context reads, and the binary Finance boundary.
 */

// Own derived database: the capital DB suites run in parallel vitest workers
// and must never share (each resets its schema in beforeAll).
const BASE_DB_URL = process.env.ALPHA_INTEGRATION_DATABASE_URL;
const TEST_DB_URL = BASE_DB_URL ? deriveDatabaseUrl(BASE_DB_URL, '_outcomes') : undefined;
const run = TEST_DB_URL ? describe : describe.skip;

const FIXTURE = path.resolve(__dirname, '../../../../../../packages/contracts/fixtures/capital-outcome-result.v1.json');

run('capital outcome execution against Postgres', () => {
  let pool: pg.Pool;
  let orgA: string;
  let orgB: string;
  let userId: string;
  let mandateId: string;
  let tradeId: string;

  function fixtureResult(): Record<string, unknown> {
    return JSON.parse(readFileSync(FIXTURE, 'utf8')).result as Record<string, unknown>;
  }

  /** Rebind the Python-produced result to the created entities (identity is
   * outside the calculation hashes; the audit chain stays intact). */
  function reboundResult(binding: { taskId: string; idempotencyKey?: string }): Record<string, unknown> {
    const result = fixtureResult();
    const idempotencyKey = binding.idempotencyKey ?? (result.idempotency_key as string);
    const rebindKey = (key: unknown) => `${idempotencyKey}:calc:${String(key).split(':calc:')[1]}`;
    const rebind = (record: Record<string, unknown>) => ({
      ...record,
      organization_id: orgA,
      principal_id: orgA,
      mandate_id: mandateId,
      task_id: binding.taskId
    });
    return {
      ...rebind(result),
      idempotency_key: idempotencyKey,
      calculation_drafts: (result.calculation_drafts as Array<Record<string, unknown>>).map((draft) => ({
        ...rebind(draft),
        idempotency_key: rebindKey(draft.idempotency_key)
      })),
      calculations: (result.calculations as Array<Record<string, unknown>>).map((summary) => ({
        ...summary,
        idempotency_key: rebindKey(summary.idempotency_key)
      })),
      evidence: {
        claims: (result.evidence as { claims: Array<Record<string, unknown>> }).claims.map((claim) => ({
          ...claim,
          principal_id: orgA,
          calculation_ref:
            claim.calculation_ref && typeof claim.calculation_ref === 'object'
              ? { ...(claim.calculation_ref as Record<string, unknown>), run_idempotency_key: rebindKey((claim.calculation_ref as Record<string, unknown>).run_idempotency_key) }
              : null
        }))
      },
      artifact: result.artifact ? rebind(result.artifact as Record<string, unknown>) : null,
      recommendation: result.recommendation
        ? {
            ...(result.recommendation as Record<string, unknown>),
            supporting_calculation_refs: ((result.recommendation as Record<string, unknown>).supporting_calculation_refs as string[]).map(rebindKey)
          }
        : null
    };
  }

  const outcomeBody = (idempotencyKey: string, overrides: Partial<CapitalOutcomeRequestBody> = {}): CapitalOutcomeRequestBody => ({
    outcome_type: 'capital_diagnosis',
    definition_version: '1.0.0',
    objective: 'Diagnose the financial position of trade TRX-1001',
    inputs: {},
    currency_policy: { base_currency: 'EUR' },
    idempotency_key: idempotencyKey,
    ...overrides
  });

  function stubbedBrain(options: { assertRequest?: (request: Record<string, unknown>) => void } = {}) {
    return async (input: { request: Record<string, unknown>; mandate: Record<string, unknown> }) => {
      options.assertRequest?.(input.request);
      return {
        serviceVersion: 'test',
        result: reboundResult({ taskId: input.request.task_id as string, idempotencyKey: input.request.idempotency_key as string }),
        error: null
      };
    };
  }

  const execute = (body: CapitalOutcomeRequestBody, brain = stubbedBrain(), traceId = `trc-${randomUUID().slice(0, 8)}`) =>
    runCapitalOutcome(pool, { orgId: orgA, userId, traceId, body }, brain as never);

  async function taskByKey(key: string) {
    const row = await pool.query(`SELECT agent_task_id, status, result_json, request_hash FROM alpha_agent_tasks WHERE org_id = $1 AND idempotency_key = $2`, [orgA, key]);
    return row.rows[0] ?? null;
  }

  async function financeCounts(): Promise<Record<string, number>> {
    const offers = await pool.query(`SELECT count(*)::int AS n FROM finance_offers`);
    const alphaFunding = await pool.query(`SELECT count(*)::int AS n FROM alpha_objects WHERE type IN ('funding_request', 'funding_offer', 'financing_agreement')`);
    const proposals = await pool.query(`SELECT count(*)::int AS n FROM protected_action_proposals`);
    return { finance_offers: offers.rows[0].n, alpha_funding_objects: alphaFunding.rows[0].n, protected_action_proposals: proposals.rows[0].n };
  }

  beforeAll(async () => {
    if (!TEST_DB_URL || !BASE_DB_URL) return;
    assertLocalTestDatabase(TEST_DB_URL);
    await ensureDatabase(BASE_DB_URL, TEST_DB_URL);
    await resetDatabase(TEST_DB_URL);
    await applyMigrations(TEST_DB_URL);
    pool = new pg.Pool({ connectionString: TEST_DB_URL });

    userId = randomUUID();
    await pool.query(`INSERT INTO app_users(user_id, email) VALUES ($1, 'capital-outcome@local')`, [userId]);
    const a = await pool.query(`INSERT INTO orgs(name, country) VALUES ('Capital Outcome Org A', 'PT') RETURNING org_id`);
    const b = await pool.query(`INSERT INTO orgs(name, country) VALUES ('Capital Outcome Org B', 'ES') RETURNING org_id`);
    orgA = a.rows[0].org_id;
    orgB = b.rows[0].org_id;

    mandateId = randomUUID();
    await pool.query(
      `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status,
                                  allowed_outcome_types_json, permitted_tool_classes_json, permitted_data_classes_json,
                                  authority_ceiling, max_sensitivity, disclosure_policy_id, issued_by)
       VALUES ($1, 1, $2, $2, 'company', 'capital_agent', 'active',
               '["capital_diagnosis","financing_need_classification"]'::jsonb,
               '["context_read","calculation","artifact","proposal"]'::jsonb,
               '["selected_objects","trade_context","finance_read","org_finance_profile"]'::jsonb,
               'propose_protected_action', 'restricted_financial', 'disclosure-company-v1', $3)`,
      [mandateId, orgA, userId]
    );
    const trade = await pool.query(
      `INSERT INTO trades(org_id, title, corridor, amount, currency, status, created_by)
       VALUES ($1, 'Olive oil export to Hamburg', 'PT-DE', 60000.00, 'EUR', 'in_execution', $2) RETURNING trade_id`,
      [orgA, userId]
    );
    tradeId = trade.rows[0].trade_id;
  });

  afterAll(async () => {
    if (pool) {
      const orphans = await pool.query(`SELECT count(*)::int AS n FROM alpha_agent_tasks WHERE task_contract_version = 'capital-task-v1' AND status IN ('draft', 'in_progress')`);
      expect(orphans.rows[0].n, 'no capital task may remain queued/running after synchronous requests returned').toBe(0);
      await pool.end();
    }
  });

  // ------------------------------------------------------------------
  // Happy path + task lifecycle + boundary
  // ------------------------------------------------------------------
  it('executes and persists a full outcome with an honest task lifecycle — no Finance state', async () => {
    const before = await financeCounts();
    const response = await execute(outcomeBody('e2e-outcome-1'));
    expect(response.status).toBe('draft_ready');
    expect(response.task_status).toBe('completed');
    expect(response.execution_status).toBe('completed');
    expect(response.calculation_run_ids).toHaveLength(3);
    expect(response.artifact_version).toBe(1);
    expect(response.recommendation).toBeTruthy();
    expect(response.evidence_coverage).toEqual({ trade_context: 'verified', cost_evidence: 'verified', cashflow_basis: 'verified' });
    expect(response.trust_notes.some((note) => note.includes('downgraded'))).toBe(true);
    expect(response.request_hash).toMatch(/^sha256:/);
    expect(response.execution_hash).toMatch(/^sha256:/);
    expect(response.replayed).toBe(false);

    const task = await taskByKey('e2e-outcome-1');
    expect(task.status).toBe('completed');
    expect(task.result_json.outcome_id).toBe(response.outcome_id);
    expect(task.result_json.execution_hash).toBe(response.execution_hash);
    expect(task.request_hash).toBe(response.request_hash);

    const outcomeRow = await pool.query(`SELECT idempotency_key, request_hash, execution_hash FROM agent_outcomes WHERE outcome_id = $1`, [response.outcome_id]);
    expect(outcomeRow.rows[0].idempotency_key).toBe('e2e-outcome-1');
    expect(outcomeRow.rows[0].request_hash).toBe(response.request_hash);
    expect(outcomeRow.rows[0].execution_hash).toBe(response.execution_hash);

    expect(await financeCounts()).toEqual(before);
  });

  it('returns the COMPLETE original response on exact replay (contract equality)', async () => {
    const first = await execute(outcomeBody('e2e-replay-1'));
    const replay = await execute(outcomeBody('e2e-replay-1'), stubbedBrain({ assertRequest: () => { throw new Error('the brain must NOT be called on an exact replay'); } }));
    expect(replay.replayed).toBe(true);
    const volatile = new Set(['trace_id', 'replayed']);
    const strip = (response: Record<string, unknown>) => Object.fromEntries(Object.entries(response).filter(([key]) => !volatile.has(key)));
    expect(strip(replay as unknown as Record<string, unknown>)).toEqual(strip(first as unknown as Record<string, unknown>));
    expect(replay.calculation_run_ids).toEqual(first.calculation_run_ids);
    expect(replay.calculation_run_ids.length).toBe(3);
    const tasks = await pool.query(`SELECT count(*)::int AS n FROM alpha_agent_tasks WHERE org_id = $1 AND idempotency_key = 'e2e-replay-1'`, [orgA]);
    expect(tasks.rows[0].n).toBe(1);
  });

  // ------------------------------------------------------------------
  // Idempotency conflict matrix (§13): same key + any material difference.
  // ------------------------------------------------------------------
  const conflictCases: Array<[string, Partial<CapitalOutcomeRequestBody>]> = [
    ['changed objective', { objective: 'A different objective entirely' }],
    ['changed inputs', { inputs: { pnl: { revenue: '999.00' } } }],
    ['changed evidence facts', { input_facts: [{ input_path: 'x', kind: 'assumption', statement: 'new assumption' }] }],
    ['changed documents', { documents: [{ source_id: 'new.pdf', content: 'other content' }] }],
    ['changed authority', { requested_authority: 'analyse' }]
  ];
  for (const [label, overrides] of conflictCases) {
    it(`rejects same key + ${label} with an explicit 409`, async () => {
      const key = `conflict-${label.replaceAll(' ', '-')}`;
      await execute(outcomeBody(key));
      await expect(execute(outcomeBody(key, overrides))).rejects.toMatchObject({ code: 'capital.idempotency_conflict', statusCode: 409 });
      const outcomes = await pool.query(`SELECT count(*)::int AS n FROM agent_outcomes WHERE org_id = $1 AND idempotency_key = $2`, [orgA, key]);
      expect(outcomes.rows[0].n).toBe(1);
    });
  }

  it('rejects same key + changed mandate version with an explicit 409', async () => {
    const key = 'conflict-mandate-version';
    await execute(outcomeBody(key));
    await pool.query(
      `INSERT INTO agent_mandates(mandate_id, version, org_id, principal_id, principal_type, agent_class, status,
                                  allowed_outcome_types_json, permitted_tool_classes_json, permitted_data_classes_json,
                                  authority_ceiling, max_sensitivity, disclosure_policy_id, issued_by)
       SELECT mandate_id, 2, org_id, principal_id, principal_type, agent_class, status,
              allowed_outcome_types_json, permitted_tool_classes_json, permitted_data_classes_json,
              authority_ceiling, max_sensitivity, disclosure_policy_id, issued_by
       FROM agent_mandates WHERE mandate_id = $1 AND version = 1`,
      [mandateId]
    );
    try {
      await expect(execute(outcomeBody(key))).rejects.toMatchObject({ code: 'capital.idempotency_conflict', statusCode: 409 });
    } finally {
      await pool.query(`DELETE FROM agent_mandates WHERE mandate_id = $1 AND version = 2`, [mandateId]);
    }
  });

  it('produces exactly one task and one outcome under concurrent identical requests', async () => {
    const key = 'concurrent-1';
    const results = await Promise.allSettled([execute(outcomeBody(key)), execute(outcomeBody(key))]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof execute>>> => r.status === 'fulfilled');
    expect(fulfilled.length).toBe(2);
    expect(new Set(fulfilled.map((r) => r.value.outcome_id)).size).toBe(1);
    expect(new Set(fulfilled.map((r) => r.value.task_id)).size).toBe(1);
    const tasks = await pool.query(`SELECT count(*)::int AS n FROM alpha_agent_tasks WHERE org_id = $1 AND idempotency_key = $2`, [orgA, key]);
    const outcomes = await pool.query(`SELECT count(*)::int AS n FROM agent_outcomes WHERE org_id = $1 AND idempotency_key = $2`, [orgA, key]);
    expect(tasks.rows[0].n).toBe(1);
    expect(outcomes.rows[0].n).toBe(1);
  });

  // ------------------------------------------------------------------
  // Failure paths finalize the task honestly (§4).
  // ------------------------------------------------------------------
  it('finalizes the task as blocked when the brain is unavailable', async () => {
    await expect(execute(outcomeBody('fail-brain-down'), (async () => null) as never)).rejects.toMatchObject({ code: 'capital.brain_unavailable', statusCode: 503 });
    const task = await taskByKey('fail-brain-down');
    expect(task.status).toBe('blocked');
    expect(task.result_json.error.code).toBe('capital.brain_unavailable');
  });

  it('finalizes the task as blocked on an unauthorized outcome (brain validation failure)', async () => {
    const brain = async () => ({ serviceVersion: 'test', result: null, error: { code: 'mandate.outcome_not_permitted', message: 'outcome not in mandate scope' } });
    await expect(execute(outcomeBody('fail-unauthorized'), brain as never)).rejects.toMatchObject({ code: 'mandate.outcome_not_permitted', statusCode: 502 });
    const task = await taskByKey('fail-unauthorized');
    expect(task.status).toBe('blocked');
    expect(task.result_json.error.code).toBe('mandate.outcome_not_permitted');
  });

  it('rolls back everything and blocks the task when a calculation draft is tampered', async () => {
    const tamperingBrain = async (input: { request: Record<string, unknown> }) => {
      const result = reboundResult({ taskId: input.request.task_id as string, idempotencyKey: input.request.idempotency_key as string });
      const drafts = result.calculation_drafts as Array<Record<string, unknown>>;
      const first = drafts[0];
      if (!first) throw new Error('fixture has no calculation drafts');
      drafts[0] = { ...first, result: { ...(first.result as Record<string, unknown>), net_revenue: '999999.99' } };
      return { serviceVersion: 'test', result, error: null };
    };
    await expect(execute(outcomeBody('fail-tamper'), tamperingBrain as never)).rejects.toMatchObject({ code: 'calculation.projection_result_mismatch' });
    const task = await taskByKey('fail-tamper');
    expect(task.status).toBe('blocked');
    // Persistence rollback: no outcome, no runs, no artifact remain.
    const outcomes = await pool.query(`SELECT count(*)::int AS n FROM agent_outcomes WHERE org_id = $1 AND idempotency_key = 'fail-tamper'`, [orgA]);
    expect(outcomes.rows[0].n).toBe(0);
    const runsCount = await pool.query(`SELECT count(*)::int AS n FROM financial_calculation_runs WHERE org_id = $1 AND idempotency_key LIKE 'fail-tamper%'`, [orgA]);
    expect(runsCount.rows[0].n).toBe(0);
  });

  it('finalizes the task as blocked when the brain reports a failed execution result', async () => {
    const failingBrain = async (input: { request: Record<string, unknown> }) => {
      const result = reboundResult({ taskId: input.request.task_id as string, idempotencyKey: input.request.idempotency_key as string });
      return {
        serviceVersion: 'test',
        result: { ...result, execution_status: 'failed', persisted_status: 'failed', policy_violations: [{ code: 'outcome.calculation_invalid', message: 'material calculation rejected' }], artifact: null, recommendation: null },
        error: null
      };
    };
    await expect(execute(outcomeBody('fail-execution'), failingBrain as never)).rejects.toMatchObject({ code: 'outcome.calculation_invalid', statusCode: 422 });
    const task = await taskByKey('fail-execution');
    expect(task.status).toBe('blocked');
  });

  // ------------------------------------------------------------------
  // Canonical context reads (§6).
  // ------------------------------------------------------------------
  it('resolves authorized object references into verified canonical snapshots', async () => {
    let seenSnapshots: Array<Record<string, unknown>> = [];
    const brain = stubbedBrain({
      assertRequest: (request) => {
        seenSnapshots = request.canonical_snapshots as Array<Record<string, unknown>>;
      }
    });
    const body = outcomeBody('ctx-read-1', {
      authorized_object_refs: [{ source_layer: 'relational', domain: 'trades', object_type: 'trade', object_id: tradeId, organization_id: orgA }]
    });
    await execute(body, brain);
    expect(seenSnapshots).toHaveLength(1);
    const snapshot = seenSnapshots[0]!;
    expect(snapshot.object_type).toBe('trade');
    expect(snapshot.object_id).toBe(tradeId);
    expect(snapshot.organization_id).toBe(orgA);
    expect(snapshot.freshness).toBe('current');
    const facts = snapshot.facts as Array<Record<string, unknown>>;
    expect(facts.some((fact) => String(fact.statement).includes('60000.00 EUR') && fact.category === 'cashflow_basis')).toBe(true);
  });

  it('fails closed (and blocks the task) on a cross-organization object reference', async () => {
    const body = outcomeBody('ctx-cross-org', {
      authorized_object_refs: [{ source_layer: 'relational', domain: 'trades', object_type: 'trade', object_id: tradeId, organization_id: orgB }]
    });
    await expect(execute(body)).rejects.toMatchObject({ code: 'context.cross_org_ref', statusCode: 403 });
    const task = await taskByKey('ctx-cross-org');
    expect(task.status).toBe('blocked');
  });

  it('rejects execution when no active company capital mandate exists (org B)', async () => {
    await expect(
      runCapitalOutcome(pool, { orgId: orgB, userId, traceId: 'trc-no-mandate', body: outcomeBody('no-mandate-1') }, stubbedBrain() as never)
    ).rejects.toMatchObject({ code: 'capital.no_active_mandate', statusCode: 409 });
  });

  it('reads the persisted outcome with artifact versions, lineage, and fingerprints', async () => {
    const listed = await pool.query(`SELECT outcome_id FROM agent_outcomes WHERE org_id = $1 AND idempotency_key = 'e2e-outcome-1'`, [orgA]);
    const outcome = await getCapitalOutcome(pool, { orgId: orgA, userId, outcomeId: listed.rows[0].outcome_id });
    expect(outcome).toBeTruthy();
    expect(outcome!.status).toBe('draft_ready');
    expect(outcome!.idempotency_key).toBe('e2e-outcome-1');
    expect(outcome!.request_hash).toMatch(/^sha256:/);
    expect(outcome!.execution_hash).toMatch(/^sha256:/);
    expect((outcome!.artifact_versions as unknown[]).length).toBe(1);
    expect((outcome!.calculation_run_ids_json as string[]).length).toBe(3);
  });

  it('rejects persistence under a mismatched RLS organization context', async () => {
    const task = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version, task_contract_version, definition_version, status, idempotency_key)
       VALUES ($1, 'rls probe', 'trc-rls', $2, $1, 'company', $3, 1, 'capital-task-v1', 'capital-agent-1.1.0', 'in_progress', 'rls-probe-task') RETURNING agent_task_id`,
      [orgA, userId, mandateId]
    );
    const result = reboundResult({ taskId: task.rows[0].agent_task_id, idempotencyKey: 'rls-probe-1' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_user', $1, true)`, [userId]);
      await client.query(`SELECT set_config('app.current_org', $1, true)`, [orgB]);
      await expect(persistOutcomeExecution(client, result)).rejects.toMatchObject({ code: 'outcome.rls_context_mismatch' });
      await client.query('ROLLBACK');
    } finally {
      client.release();
      await pool.query(`UPDATE alpha_agent_tasks SET status = 'blocked' WHERE agent_task_id = $1`, [task.rows[0].agent_task_id]);
    }
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
