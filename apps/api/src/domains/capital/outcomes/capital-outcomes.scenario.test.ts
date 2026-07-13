import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CapitalAgentError, getCapitalOutcome, runCapitalOutcome, type CapitalOutcomeRequestBody } from '../../../services/capital-agent';
import { persistOutcomeExecution } from './outcome-persistence';

/**
 * Capital outcome end-to-end integration (Phase 4 §§D8, D12).
 *
 * The Trade Brain execution result under test is a REAL Python
 * execute_capital_outcome output (fixture, capital_diagnosis with three
 * calculation runs). The stubbed brain transport rebinds it to the entities
 * this suite creates — proving the FULL API-side chain: server-side mandate
 * resolution → task creation → execution request construction → persistence
 * of outcome + audit-hashed calculation runs + evidence claims + immutable
 * artifact version, all inside one authenticated RLS transaction — and the
 * binary Finance boundary (zero canonical Finance rows change).
 */

const TEST_DB_URL = process.env.ALPHA_INTEGRATION_DATABASE_URL;
const run = TEST_DB_URL ? describe : describe.skip;

const FIXTURE = path.resolve(__dirname, '../../../../../../packages/contracts/fixtures/capital-outcome-result.v1.json');

run('capital outcome execution against Postgres', () => {
  let pool: pg.Pool;
  let orgA: string;
  let orgB: string;
  let userId: string;
  let mandateId: string;

  function fixtureResult(): Record<string, unknown> {
    return JSON.parse(readFileSync(FIXTURE, 'utf8')).result as Record<string, unknown>;
  }

  /** Rebind the Python-produced result to the created entities (identity is
   * outside the calculation hashes; the audit chain stays intact). */
  function reboundResult(binding: { taskId: string; idempotencyKey?: string }): Record<string, unknown> {
    const result = fixtureResult();
    const idempotencyKey = binding.idempotencyKey ?? (result.idempotency_key as string);
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
        idempotency_key: `${idempotencyKey}:calc:${String(draft.idempotency_key).split(':calc:')[1]}`
      })),
      evidence: {
        claims: (result.evidence as { claims: Array<Record<string, unknown>> }).claims.map((claim) => ({
          ...claim,
          principal_id: orgA,
          calculation_ref:
            claim.calculation_ref && typeof claim.calculation_ref === 'object'
              ? {
                  ...(claim.calculation_ref as Record<string, unknown>),
                  run_idempotency_key: `${idempotencyKey}:calc:${String((claim.calculation_ref as Record<string, unknown>).run_idempotency_key).split(':calc:')[1]}`
                }
              : null
        }))
      },
      artifact: result.artifact ? rebind(result.artifact as Record<string, unknown>) : null,
      recommendation: result.recommendation
        ? {
            ...(result.recommendation as Record<string, unknown>),
            supporting_calculation_refs: ((result.recommendation as Record<string, unknown>).supporting_calculation_refs as string[]).map(
              (ref) => `${idempotencyKey}:calc:${ref.split(':calc:')[1]}`
            )
          }
        : null
    };
  }

  const outcomeBody = (idempotencyKey: string): CapitalOutcomeRequestBody => ({
    outcome_type: 'capital_diagnosis',
    definition_version: '1.0.0',
    objective: 'Diagnose the financial position of trade TRX-1001',
    inputs: {},
    currency_policy: { base_currency: 'EUR' },
    idempotency_key: idempotencyKey
  });

  function stubbedBrain(binding: { expectMandate?: boolean }) {
    return async (input: { request: Record<string, unknown>; mandate: Record<string, unknown> }) => {
      if (binding.expectMandate) {
        expect(input.mandate.mandate_id).toBe(mandateId);
        expect(input.mandate.status).toBe('active');
        expect(input.mandate.authority_ceiling).toBe('propose_protected_action');
        expect(input.request.organization_id).toBe(orgA);
        expect(input.request.principal_id).toBe(orgA);
        expect(input.request.principal_type).toBe('company');
        expect(input.request.task_id).toBeTruthy();
      }
      return {
        serviceVersion: 'test',
        result: reboundResult({ taskId: input.request.task_id as string, idempotencyKey: input.request.idempotency_key as string }),
        error: null
      };
    };
  }

  async function financeCounts(): Promise<Record<string, number>> {
    const offers = await pool.query(`SELECT count(*)::int AS n FROM finance_offers`);
    const alphaFunding = await pool.query(`SELECT count(*)::int AS n FROM alpha_objects WHERE type IN ('funding_request', 'funding_offer', 'financing_agreement')`);
    const proposals = await pool.query(`SELECT count(*)::int AS n FROM protected_action_proposals`);
    return { finance_offers: offers.rows[0].n, alpha_funding_objects: alphaFunding.rows[0].n, protected_action_proposals: proposals.rows[0].n };
  }

  beforeAll(async () => {
    if (!TEST_DB_URL) return;
    assertLocalTestDatabase(TEST_DB_URL);
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
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('executes and persists a full outcome: task, runs, evidence, artifact — no Finance state', async () => {
    const before = await financeCounts();
    const response = await runCapitalOutcome(pool, { orgId: orgA, userId, traceId: 'trc-e2e-1', body: outcomeBody('e2e-outcome-1') }, stubbedBrain({ expectMandate: true }) as never);
    expect(response.status).toBe('draft_ready');
    expect(response.execution_status).toBe('completed');
    expect(response.calculation_run_ids).toHaveLength(3);
    expect(response.artifact_id).toBeTruthy();
    expect(response.artifact_version).toBe(1);
    expect(response.recommendation).toBeTruthy();
    expect(response.evidence_bundle_id).toBeTruthy();

    // Persisted rows verify the audit chain end-to-end.
    const runs = await pool.query(`SELECT status, input_hash, result_hash, outcome_id FROM financial_calculation_runs WHERE org_id = $1`, [orgA]);
    expect(runs.rows).toHaveLength(3);
    for (const row of runs.rows) {
      expect(row.outcome_id).toBe(response.outcome_id);
      expect(row.input_hash).toMatch(/^sha256:/);
    }
    const claims = await pool.query(`SELECT claim_type, calculation_run_ids_json FROM evidence_claims WHERE org_id = $1`, [orgA]);
    expect(claims.rows.length).toBeGreaterThanOrEqual(6);
    const calculationClaims = claims.rows.filter((row) => row.claim_type === 'calculation');
    expect(calculationClaims.length).toBe(3);
    for (const claim of calculationClaims) {
      expect(claim.calculation_run_ids_json).toHaveLength(1);
    }
    const artifact = await pool.query(`SELECT content_json, version, calculation_run_ids_json FROM capital_artifact_versions WHERE org_id = $1`, [orgA]);
    expect(artifact.rows).toHaveLength(1);
    expect(artifact.rows[0].version).toBe(1);
    expect(artifact.rows[0].content_json.schema_version).toBe('capital-artifact-v1');
    expect(artifact.rows[0].calculation_run_ids_json).toHaveLength(3);

    const after = await financeCounts();
    expect(after).toEqual(before);
  });

  it('reads the persisted outcome with artifact versions and lineage', async () => {
    const listed = await pool.query(`SELECT outcome_id FROM agent_outcomes WHERE org_id = $1 LIMIT 1`, [orgA]);
    const outcome = await getCapitalOutcome(pool, { orgId: orgA, userId, outcomeId: listed.rows[0].outcome_id });
    expect(outcome).toBeTruthy();
    expect(outcome!.status).toBe('draft_ready');
    expect((outcome!.artifact_versions as unknown[]).length).toBe(1);
    expect((outcome!.calculation_run_ids_json as string[]).length).toBe(3);
  });

  it('replays idempotently and never duplicates outcome rows', async () => {
    const first = await pool.query(`SELECT count(*)::int AS n FROM agent_outcomes WHERE org_id = $1`, [orgA]);
    const replay = await runCapitalOutcome(pool, { orgId: orgA, userId, traceId: 'trc-e2e-1', body: outcomeBody('e2e-outcome-1') }, stubbedBrain({}) as never);
    expect(replay.status).toBe('draft_ready');
    const after = await pool.query(`SELECT count(*)::int AS n FROM agent_outcomes WHERE org_id = $1`, [orgA]);
    expect(after.rows[0].n).toBe(first.rows[0].n);
  });

  it('rejects execution when no active company capital mandate exists (org B)', async () => {
    await expect(
      runCapitalOutcome(pool, { orgId: orgB, userId, traceId: 'trc-e2e-2', body: outcomeBody('e2e-outcome-2') }, stubbedBrain({}) as never)
    ).rejects.toMatchObject({ code: 'capital.no_active_mandate' });
  });

  it('surfaces brain unavailability as an explicit typed error — no fabricated result', async () => {
    await expect(
      runCapitalOutcome(pool, { orgId: orgA, userId, traceId: 'trc-e2e-3', body: outcomeBody('e2e-outcome-3') }, (async () => null) as never)
    ).rejects.toBeInstanceOf(CapitalAgentError);
  });

  it('rolls back everything when a calculation draft is tampered (no partial outcome)', async () => {
    const beforeOutcomes = await pool.query(`SELECT count(*)::int AS n FROM agent_outcomes WHERE org_id = $1`, [orgA]);
    const tamperingBrain = async (input: { request: Record<string, unknown> }) => {
      const result = reboundResult({ taskId: input.request.task_id as string, idempotencyKey: input.request.idempotency_key as string });
      const drafts = result.calculation_drafts as Array<Record<string, unknown>>;
      const first = drafts[0];
      if (!first) throw new Error('fixture has no calculation drafts');
      drafts[0] = { ...first, result: { ...(first.result as Record<string, unknown>), net_revenue: '999999.99' } };
      return { serviceVersion: 'test', result, error: null };
    };
    await expect(
      runCapitalOutcome(pool, { orgId: orgA, userId, traceId: 'trc-e2e-4', body: outcomeBody('e2e-outcome-4') }, tamperingBrain as never)
    ).rejects.toMatchObject({ code: 'calculation.projection_result_mismatch' });
    const afterOutcomes = await pool.query(`SELECT count(*)::int AS n FROM agent_outcomes WHERE org_id = $1`, [orgA]);
    expect(afterOutcomes.rows[0].n).toBe(beforeOutcomes.rows[0].n);
  });

  it('rejects persistence under a mismatched RLS organization context', async () => {
    const task = await pool.query(
      `INSERT INTO alpha_agent_tasks(org_id, objective, trace_id, created_by, principal_id, principal_type, mandate_id, mandate_version, task_contract_version, definition_version)
       VALUES ($1, 'rls probe', 'trc-rls', $2, $1, 'company', $3, 1, 'capital-task-v1', 'capital-agent-1.1.0') RETURNING agent_task_id`,
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
    }
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
