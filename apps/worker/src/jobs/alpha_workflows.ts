import { randomUUID } from 'node:crypto';
import type pg from 'pg';

import { setAppContext, withTx } from '@traibox/db';
import { buildWorkflowRuntimeState, isWorkflowRunKind } from '@traibox/contracts';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';
const ACTIVE_WORKFLOW_STATUSES = ['approval_required', 'in_progress', 'ready_for_review', 'blocked'] as const;
const TERMINAL_WORKFLOW_STATUSES = new Set(['completed', 'rejected', 'cancelled', 'archived']);

type JsonRecord = Record<string, unknown>;

export type AlphaWorkflowRunRow = {
  object_id: string;
  org_id: string;
  trade_id: string | null;
  status: string;
  title: string;
  payload_json: unknown;
  trace_id: string;
  updated_at: Date | string;
};

export type WorkflowMonitorDecision = {
  workflowRunId: string;
  workflowKind: string;
  status: string;
  phase: string;
  signal: string;
  summary: string;
  recoveryHint: string;
  stale: boolean;
  attentionRequired: boolean;
  shouldRecordSignal: boolean;
  lastDomainStepAt: string;
  runtimeCommand: string;
  awaitingSignal: string | null;
};

export async function runAlphaWorkflowLoop(input: { pool: pg.Pool }): Promise<void> {
  const intervalMs = Number(process.env.ALPHA_WORKFLOW_INTERVAL_MS ?? 30_000);
  const enabled = process.env.ALPHA_WORKFLOW_MONITOR_ENABLED !== 'false';
  // eslint-disable-next-line no-console
  console.log(`Alpha workflow loop every ${Math.round(intervalMs / 1000)}s (enabled=${enabled}).`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (enabled) {
        const result = await runAlphaWorkflowTick({ pool: input.pool });
        if (result.signalled > 0) {
          // eslint-disable-next-line no-console
          console.log(`Alpha workflow monitor signalled ${result.signalled}/${result.inspected} active workflow run(s).`);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('alpha workflow tick error', err);
    }
    await sleep(intervalMs);
  }
}

export async function runAlphaWorkflowTick(input: { pool: pg.Pool; limit?: number; now?: Date; staleAfterMs?: number }) {
  const rows = await withTx(input.pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: null });
    const res = await client.query<AlphaWorkflowRunRow>(
      `SELECT object_id, org_id, trade_id, status, title, payload_json, trace_id, updated_at
       FROM alpha_objects
       WHERE type='workflow_run'
         AND status = ANY($1::text[])
       ORDER BY updated_at ASC
       LIMIT $2`,
      [ACTIVE_WORKFLOW_STATUSES, input.limit ?? 50]
    );
    return res.rows;
  });

  let updated = 0;
  let signalled = 0;
  for (const row of rows) {
    const result = await monitorWorkflowRun(input.pool, row, {
      now: input.now ?? new Date(),
      staleAfterMs: input.staleAfterMs ?? 15 * 60_000
    });
    if (result.updated) updated += 1;
    if (result.signalled) signalled += 1;
  }

  return { inspected: rows.length, updated, signalled };
}

export function buildWorkflowMonitorDecision(
  row: AlphaWorkflowRunRow,
  options: { now: Date; staleAfterMs: number }
): WorkflowMonitorDecision {
  const payload = toRecord(row.payload_json);
  const workflowKind = stringOrDefault(payload.workflow_kind, 'workflow');
  const workflowState = toRecord(payload.workflow_state);
  const workerState = toRecord(payload.workflow_worker);
  const stage = stringOrDefault(workflowState.stage, row.status);
  const lastDomainStepAt = lastDomainWorkflowStepAt(payload.workflow_lifecycle) ?? toIso(row.updated_at);
  const stale = !TERMINAL_WORKFLOW_STATUSES.has(row.status) && options.now.getTime() - new Date(lastDomainStepAt).getTime() > options.staleAfterMs;
  const phase = workflowPhase({
    status: row.status,
    workflowKind,
    stage,
    stale
  });
  const runtimeKind = isWorkflowRunKind(workflowKind) ? workflowKind : 'controlled_execution';
  const runtimeCommand = buildWorkflowRuntimeState({
    kind: runtimeKind,
    status: row.status,
    stage: phase,
    target: workflowRuntimeTargetFrom(payload.target, row.object_id),
    workflowRunId: row.object_id,
    traceId: row.trace_id,
    nowIso: options.now.toISOString(),
    sequence: toArray(payload.workflow_lifecycle).length,
    existing: toRecord(payload.workflow_runtime) as Partial<ReturnType<typeof buildWorkflowRuntimeState>>,
    stale
  });
  const signal = `workflow.${workflowKind}.${phase}`;
  const attentionRequired = row.status === 'blocked' || stale;
  const shouldRecordSignal = workerState.last_signal !== signal || workerState.last_attention_required !== attentionRequired;

  return {
    workflowRunId: row.object_id,
    workflowKind,
    status: row.status,
    phase,
    signal,
    summary: workflowSummary({ title: row.title, workflowKind, stage, status: row.status, phase, stale }),
    recoveryHint: recoveryHint({ workflowKind, status: row.status, phase, stale }),
    stale,
    attentionRequired,
    shouldRecordSignal,
    lastDomainStepAt,
    runtimeCommand: runtimeCommand.command,
    awaitingSignal: runtimeCommand.awaiting_signal
  };
}

async function monitorWorkflowRun(
  pool: pg.Pool,
  row: AlphaWorkflowRunRow,
  options: { now: Date; staleAfterMs: number }
): Promise<{ updated: boolean; signalled: boolean }> {
  const decision = buildWorkflowMonitorDecision(row, options);
  const nowIso = options.now.toISOString();
  const traceId = `trc_wf_${randomUUID().slice(0, 8)}`;
  const patch = workflowMonitorPatch(row, decision, { nowIso, traceId });

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: row.org_id });
    const updated = await client.query(
      `UPDATE alpha_objects
       SET payload_json=payload_json || $1::jsonb,
           trace_id=$2
       WHERE object_id=$3
         AND org_id=$4
         AND type='workflow_run'
         AND status = ANY($5::text[])`,
      [JSON.stringify(patch), traceId, row.object_id, row.org_id, ACTIVE_WORKFLOW_STATUSES]
    );

    if (updated.rowCount && decision.shouldRecordSignal) {
      await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
        row.org_id,
        row.trade_id,
        'system:alpha-workflow-worker',
        'alpha.workflow.run.monitored',
        JSON.stringify({
          workflow_run_id: row.object_id,
          workflow_kind: decision.workflowKind,
          phase: decision.phase,
          status: row.status,
          stale: decision.stale,
          attention_required: decision.attentionRequired,
          trace_id: traceId
        })
      ]);

      await client.query(
        `INSERT INTO alpha_memory_events(org_id, level, trade_id, object_id, kind, signal, payload_json, trace_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          row.org_id,
          row.trade_id ? 'L1' : 'L2',
          row.trade_id,
          row.object_id,
          'workflow.monitor',
          decision.signal,
          JSON.stringify({
            workflow_run_id: row.object_id,
            workflow_kind: decision.workflowKind,
            phase: decision.phase,
            summary: decision.summary,
            recovery_hint: decision.recoveryHint,
            stale: decision.stale,
            attention_required: decision.attentionRequired
          }),
          traceId
        ]
      );

      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        randomUUID(),
        row.org_id,
        row.trade_id,
        'workflow.run.updated',
        traceId,
        'system:alpha-workflow-worker',
        JSON.stringify({
          workflow_run_id: row.object_id,
          workflow_kind: decision.workflowKind,
          status: row.status,
          phase: decision.phase,
          signal: decision.signal,
          stale: decision.stale,
          attention_required: decision.attentionRequired,
          trace_id: traceId
        })
      ]);
    }
  });

  return { updated: true, signalled: decision.shouldRecordSignal };
}

function workflowMonitorPatch(row: AlphaWorkflowRunRow, decision: WorkflowMonitorDecision, input: { nowIso: string; traceId: string }) {
  const payload = toRecord(row.payload_json);
  const workflowState = toRecord(payload.workflow_state);
  const workflowWorker = toRecord(payload.workflow_worker);
  const workflowKind = isWorkflowRunKind(decision.workflowKind) ? decision.workflowKind : 'controlled_execution';
  const runtime = buildWorkflowRuntimeState({
    kind: workflowKind,
    status: row.status,
    stage: decision.phase,
    target: workflowRuntimeTargetFrom(payload.target, row.object_id),
    workflowRunId: row.object_id,
    traceId: input.traceId,
    nowIso: input.nowIso,
    sequence: toArray(payload.workflow_lifecycle).length + (decision.shouldRecordSignal ? 1 : 0),
    existing: toRecord(payload.workflow_runtime) as Partial<ReturnType<typeof buildWorkflowRuntimeState>>,
    stale: decision.stale
  });
  const patch: JsonRecord = {
    workflow_state: {
      ...workflowState,
      status: row.status,
      stage: decision.phase,
      monitor_phase: decision.phase,
      temporal_ready: true,
      temporal_task_queue: stringOrDefault(workflowState.temporal_task_queue, 'traibox-alpha'),
      runtime_command: runtime.command,
      awaiting_signal: runtime.awaiting_signal,
      pause_reason: runtime.pause_reason,
      workflow_id: runtime.workflow_id,
      resume_token: runtime.resume_token,
      runtime_adapter: 'alpha_worker_temporal_bridge',
      recovery_strategy: stringOrDefault(workflowState.recovery_strategy, 'replay_from_structured_events'),
      last_worker_heartbeat_at: input.nowIso
    },
    workflow_runtime: runtime,
    workflow_worker: {
      ...workflowWorker,
      adapter: 'alpha_worker_temporal_bridge',
      last_signal: decision.signal,
      last_attention_required: decision.attentionRequired,
      last_checked_at: input.nowIso,
      last_domain_step_at: decision.lastDomainStepAt,
      summary: decision.summary,
      recovery_hint: decision.recoveryHint,
      stale: decision.stale,
      runtime_command: runtime.command,
      awaiting_signal: runtime.awaiting_signal,
      resume_token: runtime.resume_token
    }
  };

  if (decision.shouldRecordSignal) {
    patch.workflow_lifecycle = [
      ...toArray(payload.workflow_lifecycle),
      {
        at: input.nowIso,
        by: SYSTEM_USER_ID,
        trace_id: input.traceId,
        kind: 'workflow.monitor',
        stage: decision.phase,
        status: row.status,
        payload: {
          signal: decision.signal,
          summary: decision.summary,
          recovery_hint: decision.recoveryHint,
          stale: decision.stale,
          attention_required: decision.attentionRequired,
          runtime_command: runtime.command,
          awaiting_signal: runtime.awaiting_signal,
          resume_token: runtime.resume_token
        },
        replayable: true,
        worker_recorded: true
      }
    ];
  }

  return patch;
}

function workflowPhase(input: { status: string; workflowKind: string; stage: string; stale: boolean }) {
  if (input.stale) return 'recovery_attention';
  if (input.status === 'blocked') return 'blocked';
  if (input.status === 'approval_required') return 'waiting_for_approval';
  if (input.status === 'ready_for_review') return 'waiting_for_review';
  if (input.status === 'in_progress' && input.workflowKind === 'controlled_execution') return 'waiting_for_operator';
  if (input.status === 'in_progress') return 'running';
  return input.stage || input.status;
}

function workflowSummary(input: { title: string; workflowKind: string; stage: string; status: string; phase: string; stale: boolean }) {
  if (input.stale) return `${input.title} needs recovery attention; no domain step changed recently.`;
  if (input.phase === 'waiting_for_approval') return `${input.title} is paused at a human approval gate.`;
  if (input.phase === 'waiting_for_operator') return `${input.title} is released but waiting for a human operator to record execution.`;
  if (input.phase === 'blocked') return `${input.title} is blocked and needs human attention.`;
  return `${input.title} is monitored at ${input.stage || input.status}.`;
}

function recoveryHint(input: { workflowKind: string; status: string; phase: string; stale: boolean }) {
  if (input.stale) return 'Replay structured events, inspect the last workflow step, and resume from the recorded approval or execution gate.';
  if (input.phase === 'waiting_for_approval') return 'Wait for a permitted approver; protected execution remains blocked.';
  if (input.phase === 'waiting_for_operator') return 'Wait for operator confirmation, residual-risk acknowledgement, and idempotency evidence where required.';
  if (input.status === 'blocked') return 'Route the workflow to Operations Center with evidence, risk, and owner context.';
  return `Continue monitoring ${input.workflowKind} with replayable workflow-state updates.`;
}

function lastDomainWorkflowStepAt(value: unknown): string | null {
  const lifecycle = toArray(value);
  for (let index = lifecycle.length - 1; index >= 0; index -= 1) {
    const entry = toRecord(lifecycle[index]);
    if (entry.kind === 'workflow.monitor') continue;
    if (typeof entry.at === 'string') return entry.at;
  }
  return null;
}

function workflowRuntimeTargetFrom(value: unknown, fallbackId: string) {
  const target = toRecord(value);
  if (typeof target.type === 'string' && typeof target.id === 'string') return { type: target.type, id: target.id };
  return { type: 'workflow_run', id: fallbackId };
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function toRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
