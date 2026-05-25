import type pg from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { setAppContext, withTx } from '@traibox/db';
import type {
  AlphaObject,
  ListTradeBrainEvalRunsRequest,
  ListTradeBrainEvalRunsResponse,
  ListTradeBrainEvalSuitesResponse,
  RunTradeBrainEvalResponse,
  TradeBrainEvalReport,
  TradeBrainEvalRun,
  TradeBrainEvalStatus
} from '@traibox/contracts';
import { requestTradeBrainEvalSuiteRun, requestTradeBrainEvalSuites } from './trade-brain-client';

type ActorInput = {
  orgId: string;
  userId: string;
  traceId: string;
};

type AlphaObjectRow = {
  object_id: string;
  org_id: string;
  type: string;
  status: string;
  origin_workspace: string;
  owner_id: string;
  trade_id: string | null;
  title: string;
  summary: string | null;
  payload_json: Record<string, unknown> | null;
  permissions_json: Record<string, unknown> | null;
  evidence_refs_json: unknown[] | null;
  audit_refs_json: unknown[] | null;
  trace_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type EvalRunRow = {
  run_id: string;
  eval_object_id: string | null;
  suite_id: string;
  status: TradeBrainEvalStatus;
  score: string | number;
  case_count: number;
  passed: number;
  failed: number;
  harness_version: string;
  service_version: string;
  artifact_refs_json: unknown[] | null;
  trace_id: string;
  created_at: Date | string;
};

export async function listTradeBrainEvalSuites(input: { traceId: string }): Promise<ListTradeBrainEvalSuitesResponse> {
  const suites = await requestTradeBrainEvalSuites();
  return {
    service_version: suites?.serviceVersion ?? null,
    suites: suites?.suites ?? [],
    trace_id: input.traceId
  };
}

export async function runTradeBrainEvalSuite(
  pool: pg.Pool,
  input: ActorInput & { suiteId?: string; persist?: boolean }
): Promise<RunTradeBrainEvalResponse> {
  const report = await requestTradeBrainEvalSuiteRun({ suiteId: input.suiteId ?? 'all' });
  if (!report) {
    const error: any = new Error('Trade Brain eval service is unavailable');
    error.statusCode = 503;
    error.code = 'trade_brain_unavailable';
    throw error;
  }

  if (input.persist === false) {
    return {
      run: transientEvalRun(report, input.traceId),
      report,
      trace_id: input.traceId
    };
  }

  const persisted = await persistTradeBrainEvalReport(pool, { ...input, report });
  return {
    ...persisted,
    trace_id: input.traceId
  };
}

export async function persistTradeBrainEvalReport(
  pool: pg.Pool,
  input: ActorInput & { report: TradeBrainEvalReport }
): Promise<{ run: TradeBrainEvalRun; eval_result: AlphaObject; report: TradeBrainEvalReport }> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const reportHash = sha256(JSON.stringify(input.report));
    const artifactRefs = [
      {
        kind: 'trade_brain_eval_report',
        sha256: reportHash,
        suite_id: input.report.suite_id,
        status: input.report.status,
        generated_at: input.report.generated_at
      }
    ];
    const evalObject = await insertEvalResultObject(client, {
      orgId: input.orgId,
      userId: input.userId,
      traceId: input.traceId,
      report: input.report,
      artifactRefs,
      reportHash
    });
    const row = await insertEvalRun(client, {
      orgId: input.orgId,
      userId: input.userId,
      traceId: input.traceId,
      report: input.report,
      evalObjectId: evalObject.object_id,
      artifactRefs
    });

    await appendEvalAudit(client, input, 'alpha.trade_brain_eval.persisted', {
      run_id: row.run_id,
      eval_object_id: evalObject.object_id,
      suite_id: input.report.suite_id,
      status: input.report.status,
      score: input.report.score,
      report_sha256: reportHash
    });
    await writeEvalMemory(client, input, {
      objectId: evalObject.object_id,
      kind: 'ai_eval.run',
      signal: `${input.report.suite_id}:${input.report.status}`,
      payload: {
        run_id: row.run_id,
        score: input.report.score,
        passed: input.report.passed,
        failed: input.report.failed,
        harness_version: input.report.harness_version,
        service_version: input.report.service_version,
        report_sha256: reportHash
      }
    });
    await insertEvalEvent(client, input, {
      type: 'ai.eval.trade_brain.persisted',
      data: {
        run_id: row.run_id,
        eval_object_id: evalObject.object_id,
        suite_id: input.report.suite_id,
        status: input.report.status,
        score: input.report.score,
        trace_id: input.traceId
      }
    });

    return {
      run: mapEvalRun(row),
      eval_result: evalObject,
      report: input.report
    };
  });
}

export async function listTradeBrainEvalRuns(
  pool: pg.Pool,
  input: ActorInput & { query: ListTradeBrainEvalRunsRequest }
): Promise<ListTradeBrainEvalRunsResponse> {
  const runs = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const clauses = ['org_id=$1'];
    const params: unknown[] = [input.orgId];
    let idx = params.length + 1;
    if (input.query.suite_id) {
      clauses.push(`suite_id=$${idx++}`);
      params.push(input.query.suite_id);
    }
    if (input.query.status) {
      clauses.push(`status=$${idx++}`);
      params.push(input.query.status);
    }
    const limit = Math.min(Math.max(input.query.limit ?? 50, 1), 200);
    params.push(limit);
    const result = await client.query<EvalRunRow>(
      `SELECT run_id, eval_object_id, suite_id, status, score, case_count, passed, failed,
              harness_version, service_version, artifact_refs_json, trace_id, created_at
       FROM alpha_eval_runs
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${idx}`,
      params
    );
    return result.rows.map(mapEvalRun);
  });
  return { runs, trace_id: input.traceId };
}

async function insertEvalResultObject(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    traceId: string;
    report: TradeBrainEvalReport;
    artifactRefs: unknown[];
    reportHash: string;
  }
): Promise<AlphaObject> {
  const status = input.report.status === 'pass' ? 'completed' : input.report.status === 'warn' ? 'ready_for_review' : 'blocked';
  const payload = {
    artifact_kind: 'trade_brain_eval_report',
    suite: input.report.suite_id,
    run_id: input.report.run_id,
    suite_id: input.report.suite_id,
    status: input.report.status,
    score: input.report.score,
    case_count: input.report.case_count,
    passed: input.report.passed,
    failed: input.report.failed,
    generated_at: input.report.generated_at,
    harness_version: input.report.harness_version,
    service_version: input.report.service_version,
    report_sha256: input.reportHash,
    replayable: true,
    final_outcome: `${input.report.passed}/${input.report.case_count} Trade Brain eval cases passed with ${input.report.failed} failure(s).`,
    checks: input.report.results.slice(0, 12).map((result) => ({
      case: result.id,
      status: result.status,
      score: result.status === 'pass' ? 100 : result.status === 'warn' ? 70 : 0,
      finding: `${result.dataset}:${result.kind}`
    })),
    report: input.report
  };
  const inserted = await client.query<AlphaObjectRow>(
    `INSERT INTO alpha_objects(
       object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
       title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
     )
     VALUES($1,$2,'ai_eval_result',$3,'operations',$4,NULL,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      randomUUID(),
      input.orgId,
      status,
      input.userId,
      `Trade Brain eval gate: ${input.report.suite_id}`,
      `${input.report.status.toUpperCase()} · ${input.report.passed}/${input.report.case_count} cases · score ${input.report.score}`,
      JSON.stringify(payload),
      JSON.stringify({ visibility: 'org', external_access: false, protected_actions_require_approval: true }),
      JSON.stringify(input.artifactRefs),
      input.traceId
    ]
  );
  return mapAlphaObject(inserted.rows[0]!);
}

async function insertEvalRun(
  client: pg.PoolClient,
  input: {
    orgId: string;
    userId: string;
    traceId: string;
    report: TradeBrainEvalReport;
    evalObjectId: string;
    artifactRefs: unknown[];
  }
): Promise<EvalRunRow> {
  const inserted = await client.query<EvalRunRow>(
    `INSERT INTO alpha_eval_runs(
       run_id, org_id, eval_object_id, suite_id, status, score, case_count, passed, failed,
       harness_version, service_version, report_json, artifact_refs_json, trace_id, created_by
     )
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING run_id, eval_object_id, suite_id, status, score, case_count, passed, failed,
               harness_version, service_version, artifact_refs_json, trace_id, created_at`,
    [
      input.report.run_id,
      input.orgId,
      input.evalObjectId,
      input.report.suite_id,
      input.report.status,
      input.report.score,
      input.report.case_count,
      input.report.passed,
      input.report.failed,
      input.report.harness_version,
      input.report.service_version,
      JSON.stringify(input.report),
      JSON.stringify(input.artifactRefs),
      input.traceId,
      input.userId
    ]
  );
  return inserted.rows[0]!;
}

async function appendEvalAudit(client: pg.PoolClient, input: ActorInput, action: string, payload: Record<string, unknown>) {
  await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,NULL,$2,$3,$4)', [
    input.orgId,
    `user:${input.userId}`,
    action,
    JSON.stringify({ ...payload, trace_id: input.traceId })
  ]);
}

async function writeEvalMemory(
  client: pg.PoolClient,
  input: ActorInput,
  event: { objectId: string; kind: string; signal: string; payload: Record<string, unknown> }
) {
  const memoryId = randomUUID();
  await client.query(
    `INSERT INTO alpha_memory_events(memory_event_id, org_id, level, trade_id, object_id, kind, signal, payload_json, trace_id)
     VALUES($1,$2,'L2',NULL,$3,$4,$5,$6,$7)`,
    [memoryId, input.orgId, event.objectId, event.kind, event.signal, JSON.stringify(event.payload), input.traceId]
  );
}

async function insertEvalEvent(client: pg.PoolClient, input: ActorInput, event: { type: string; data: Record<string, unknown> }) {
  await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,NULL,$3,$4,$5,$6)', [
    randomUUID(),
    input.orgId,
    event.type,
    input.traceId,
    `user:${input.userId}`,
    JSON.stringify(event.data)
  ]);
}

function transientEvalRun(report: TradeBrainEvalReport, traceId: string): TradeBrainEvalRun {
  return {
    run_id: report.run_id,
    eval_object_id: null,
    suite_id: report.suite_id,
    status: report.status,
    score: report.score,
    case_count: report.case_count,
    passed: report.passed,
    failed: report.failed,
    harness_version: report.harness_version,
    service_version: report.service_version,
    artifact_refs: [],
    trace_id: traceId,
    created_at: report.generated_at
  };
}

function mapEvalRun(row: EvalRunRow): TradeBrainEvalRun {
  return {
    run_id: row.run_id,
    eval_object_id: row.eval_object_id,
    suite_id: row.suite_id,
    status: row.status,
    score: Number(row.score),
    case_count: row.case_count,
    passed: row.passed,
    failed: row.failed,
    harness_version: row.harness_version,
    service_version: row.service_version,
    artifact_refs: Array.isArray(row.artifact_refs_json) ? row.artifact_refs_json : [],
    trace_id: row.trace_id,
    created_at: toIso(row.created_at)
  };
}

function mapAlphaObject(row: AlphaObjectRow): AlphaObject {
  return {
    object_id: row.object_id,
    org_id: row.org_id,
    type: 'ai_eval_result',
    status: row.status as AlphaObject['status'],
    origin_workspace: 'operations',
    owner_id: row.owner_id,
    trade_id: row.trade_id,
    title: row.title,
    summary: row.summary,
    payload_json: row.payload_json ?? {},
    permissions_json: row.permissions_json ?? {},
    evidence_refs_json: Array.isArray(row.evidence_refs_json) ? row.evidence_refs_json : [],
    audit_refs_json: Array.isArray(row.audit_refs_json) ? row.audit_refs_json : [],
    trace_id: row.trace_id,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
