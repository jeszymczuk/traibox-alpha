import { describe, expect, it } from 'vitest';

import { buildWorkflowRuntimeState, workflowRuntimeCommandFor } from './workflow-runtime';

describe('workflow runtime contract', () => {
  it('pauses approval-chain workflows at human approval signals', () => {
    const runtime = buildWorkflowRuntimeState({
      kind: 'approval_chain',
      status: 'approval_required',
      stage: 'approval_requested',
      target: { type: 'payment_intent', id: 'payment-1' },
      workflowRunId: 'workflow-1',
      traceId: 'trace-1',
      nowIso: '2026-05-25T10:00:00.000Z'
    });

    expect(runtime).toMatchObject({
      adapter: 'temporal_alpha_bridge',
      mode: 'local_durable_simulation',
      workflow_id: 'traibox-approval_chain-payment-intent-payment-1',
      workflow_run_id: 'workflow-1',
      workflow_type: 'ApprovalChainWorkflow',
      command: 'await_signal',
      awaiting_signal: 'approval_decision',
      protected_action_lock: true,
      recovery_policy: expect.objectContaining({
        deterministic_replay_required: true,
        resume_strategy: 'replay_from_structured_events'
      })
    });
    expect(runtime.resume_token).toBe('traibox-approval_chain-payment-intent-payment-1:0:await_signal');
  });

  it('keeps controlled execution behind an operator signal instead of auto-running', () => {
    expect(
      workflowRuntimeCommandFor({
        kind: 'controlled_execution',
        status: 'in_progress'
      })
    ).toEqual({
      command: 'await_signal',
      awaitingSignal: 'operator_execution_update',
      pauseReason: 'Execution is released but waits for an operator confirmation signal.'
    });
  });

  it('moves stale workflows into recovery mode with deterministic resume context', () => {
    const runtime = buildWorkflowRuntimeState({
      kind: 'controlled_execution',
      status: 'in_progress',
      stage: 'recovery_attention',
      target: { type: 'execution_task', id: 'task-1' },
      workflowRunId: 'workflow-2',
      traceId: 'trace-2',
      nowIso: '2026-05-25T10:05:00.000Z',
      sequence: 4,
      stale: true
    });

    expect(runtime).toMatchObject({
      command: 'recover',
      awaiting_signal: 'workflow_recovery_review',
      pause_reason: 'No domain workflow step changed inside the stale window.',
      resume_token: 'traibox-controlled_execution-execution-task-task-1:4:recover'
    });
  });
});
