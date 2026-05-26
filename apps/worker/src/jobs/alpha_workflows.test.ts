import { describe, expect, it } from 'vitest';

import { buildWorkflowMonitorDecision, type AlphaWorkflowRunRow } from './alpha_workflows';

const baseWorkflow: AlphaWorkflowRunRow = {
  object_id: 'workflow-1',
  org_id: 'org-1',
  trade_id: 'trade-1',
  status: 'approval_required',
  title: 'Approval workflow: send_payment',
  payload_json: {
    workflow_kind: 'approval_chain',
    workflow_state: {
      stage: 'approval_requested'
    },
    workflow_lifecycle: [
      {
        at: '2026-05-19T09:00:00.000Z',
        kind: 'approval_chain.started',
        stage: 'approval_requested'
      }
    ]
  },
  trace_id: 'trace-1',
  updated_at: '2026-05-19T09:00:00.000Z'
};
const basePayload = baseWorkflow.payload_json as Record<string, unknown>;

describe('alpha workflow monitor decisions', () => {
  it('keeps approval-chain workflows paused at explicit human approval gates', () => {
    expect(
      buildWorkflowMonitorDecision(baseWorkflow, {
        now: new Date('2026-05-19T09:03:00.000Z'),
        staleAfterMs: 15 * 60_000
      })
    ).toMatchObject({
      workflowRunId: 'workflow-1',
      workflowKind: 'approval_chain',
      phase: 'waiting_for_approval',
      signal: 'workflow.approval_chain.waiting_for_approval',
      stale: false,
      attentionRequired: false,
      shouldRecordSignal: true,
      runtimeCommand: 'await_signal',
      awaitingSignal: 'approval_decision'
    });
  });

  it('treats controlled execution as waiting for a human operator, not auto-execution', () => {
    expect(
      buildWorkflowMonitorDecision(
        {
          ...baseWorkflow,
          status: 'in_progress',
          title: 'Execution workflow: Execute approved action',
          payload_json: {
            workflow_kind: 'controlled_execution',
            workflow_state: { stage: 'execution_task_created' },
            workflow_lifecycle: [{ at: '2026-05-19T09:05:00.000Z', kind: 'controlled_execution.started' }]
          }
        },
        {
          now: new Date('2026-05-19T09:08:00.000Z'),
          staleAfterMs: 15 * 60_000
        }
      )
    ).toMatchObject({
      phase: 'waiting_for_operator',
      signal: 'workflow.controlled_execution.waiting_for_operator',
      runtimeCommand: 'await_signal',
      awaitingSignal: 'operator_execution_update',
      recoveryHint: 'Wait for operator confirmation, residual-risk acknowledgement, and idempotency evidence where required.'
    });
  });

  it('raises recovery attention when no non-monitor workflow step changed recently', () => {
    expect(
      buildWorkflowMonitorDecision(
        {
          ...baseWorkflow,
          payload_json: {
            ...basePayload,
            workflow_worker: {
              last_signal: 'workflow.approval_chain.waiting_for_approval',
              last_attention_required: false
            },
            workflow_lifecycle: [
              { at: '2026-05-19T09:00:00.000Z', kind: 'approval_chain.started' },
              { at: '2026-05-19T09:12:00.000Z', kind: 'workflow.monitor' }
            ]
          }
        },
        {
          now: new Date('2026-05-19T09:20:01.000Z'),
          staleAfterMs: 15 * 60_000
        }
      )
    ).toMatchObject({
      phase: 'recovery_attention',
      signal: 'workflow.approval_chain.recovery_attention',
      stale: true,
      attentionRequired: true,
      shouldRecordSignal: true,
      runtimeCommand: 'recover',
      awaitingSignal: 'workflow_recovery_review',
      lastDomainStepAt: '2026-05-19T09:00:00.000Z'
    });
  });

  it('does not record duplicate monitoring signals when signal and attention state are unchanged', () => {
    expect(
      buildWorkflowMonitorDecision(
        {
          ...baseWorkflow,
          payload_json: {
            ...basePayload,
            workflow_worker: {
              last_signal: 'workflow.approval_chain.waiting_for_approval',
              last_attention_required: false
            }
          }
        },
        {
          now: new Date('2026-05-19T09:02:00.000Z'),
          staleAfterMs: 15 * 60_000
        }
      )
    ).toMatchObject({
      phase: 'waiting_for_approval',
      shouldRecordSignal: false
    });
  });
});
