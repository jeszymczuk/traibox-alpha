import { describe, expect, it } from 'vitest';

import {
  agentRuntimePolicyViolations,
  buildAgentReplayLog,
  buildAgentRuntimePolicy,
  buildCopilotStructuredOutputs,
  enhancedSuggestedActionsFor
} from './agent-runtime';

describe('governed intelligence runtime', () => {
  it('normalizes legacy tool names and blocks protected execution by policy', () => {
    const policy = buildAgentRuntimePolicy({
      objective: 'Prepare payment execution but do not send money.',
      inputObjectTypes: ['payment_intent'],
      permittedTools: ['read_trade_context', 'prepare_payment_intent', 'request_approval'],
      dataAccess: ['selected_objects', 'trade_context'],
      writePermissions: ['agent_work_result', 'memory_event'],
      timeBudgetSeconds: 999
    });

    expect(policy.effective_tools).toEqual(['memory.query', 'payment.prepare', 'approvals.request']);
    expect(policy.effective_write_permissions).toEqual(['create_agent_work_result', 'create_memory_event']);
    expect(policy.approval_gates).toContain('send_payment');
    expect(policy.time_budget_seconds).toBe(120);
    expect(policy.can_execute_protected_actions).toBe(false);
    expect(policy.protected_actions_blocked).toBe(true);
  });

  it('reports denied capabilities and required write-scope gaps', () => {
    const policy = buildAgentRuntimePolicy({
      objective: 'Run a broad agent.',
      permittedTools: ['wire.money.now'],
      dataAccess: ['all_tenants'],
      writePermissions: ['external_submit']
    });

    expect(agentRuntimePolicyViolations(policy)).toEqual([
      'Denied tools requested: wire.money.now',
      'Denied data access requested: all_tenants',
      'Denied write permissions requested: external_submit',
      'create_agent_task write permission is required',
      'create_agent_work_result write permission is required'
    ]);
  });

  it('builds replay logs with normalized scope, context, gates, and runtime metadata', () => {
    const policy = buildAgentRuntimePolicy({
      objective: 'Review payment intent.',
      inputObjectTypes: ['payment_intent'],
      writePermissions: ['create_agent_task', 'create_agent_work_result']
    });

    expect(
      buildAgentReplayLog({
        policy,
        objectiveHash: 'hash-1',
        inputObjects: [{ object_id: 'payment-1', type: 'payment_intent', status: 'approval_required', trade_id: null }],
        traceId: 'trace-1',
        at: '2026-05-19T09:00:00.000Z'
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ step: 'task.accepted', objective_hash: 'hash-1' }),
        expect.objectContaining({ step: 'scope.normalized', scope_version: 'agent-scope-alpha-v2' }),
        expect.objectContaining({ step: 'context.bound', object_count: 1 }),
        expect.objectContaining({ step: 'protected_actions.blocked_without_human_approval', gates: ['send_payment'] }),
        expect.objectContaining({ step: 'runtime.ready', runtime: 'deterministic_alpha_agent' })
      ])
    );
  });

  it('creates stronger Copilot structured outputs for workflow execution', () => {
    const suggested = enhancedSuggestedActionsFor('payment_intent', { object_id: 'payment-1' });
    const outputs = buildCopilotStructuredOutputs({
      objectType: 'payment_intent',
      objectId: 'payment-1',
      status: 'approval_required',
      workspace: 'intelligence',
      tradeId: 'trade-1',
      message: 'Prepare a payment intent.',
      contextObjectIds: ['document-1'],
      suggestedActions: suggested,
      aiObservability: { kind: 'ai_observability', confidence: 0.82, replayable: true },
      evalObjectId: 'eval-1',
      evalPayload: { suite: 'intelligence-copilot-alpha-v1', status: 'pass' }
    });

    expect(outputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'workflow_classification', object_type: 'payment_intent', usage_mode: 'trade_bound' }),
        expect.objectContaining({ kind: 'readiness_preview', likely_missing_items: expect.arrayContaining(['beneficiary_verification']) }),
        expect.objectContaining({ kind: 'execution_plan', protected_action: 'send_payment', human_approval_required: true }),
        expect.objectContaining({ kind: 'agent_task_draft', approval_gates: ['send_payment'], protected_actions_blocked: true }),
        expect.objectContaining({ kind: 'ai_eval_result', object_id: 'eval-1' })
      ])
    );
  });
});
