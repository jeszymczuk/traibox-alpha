import { describe, expect, it } from 'vitest';

import {
  ALPHA_OBJECT_TYPES,
  ALPHA_SCENARIOS,
  OBJECT_LIFECYCLE_STATUSES,
  ORIGIN_WORKSPACES,
  PROTECTED_ACTIONS,
  type ApprovalDecisionRequest
} from './index.js';

describe('TRAIBOX alpha contracts', () => {
  it('preserves the shared object lifecycle states', () => {
    expect(OBJECT_LIFECYCLE_STATUSES).toEqual([
      'draft',
      'pending_input',
      'ready_for_review',
      'approval_required',
      'approved',
      'blocked',
      'in_progress',
      'completed',
      'rejected',
      'cancelled',
      'attached',
      'archived'
    ]);
  });

  it('keeps standalone-and-attachable object types first-class', () => {
    expect(ALPHA_OBJECT_TYPES).toEqual(
      expect.arrayContaining([
        'trade_room',
        'document_request',
        'document',
        'clearance_check',
        'counterparty',
        'funding_request',
        'payment_intent',
        'approval',
        'execution_task',
        'external_access_grant',
        'agent_task',
        'ai_eval_result',
        'proof_bundle',
        'readiness_state',
        'memory_event'
      ])
    );
  });

  it('keeps canonical workspaces and protected action gates explicit', () => {
    expect(ORIGIN_WORKSPACES).toEqual(['intelligence', 'trades', 'finance', 'network', 'clearance', 'operations', 'settings']);
    expect(PROTECTED_ACTIONS).toEqual(expect.arrayContaining(['send_payment', 'submit_funding_request', 'share_proof_bundle_externally']));
  });

  it('keeps human approval decisions explicit and auditable', () => {
    const decision = {
      decision: 'approved',
      step_up_verified: true,
      residual_risks_acknowledged: true,
      notes: 'Reviewed evidence and residual risks.'
    } satisfies ApprovalDecisionRequest;

    expect(decision.decision).toBe('approved');
    expect(decision.step_up_verified).toBe(true);
  });

  it('defines the internal alpha scenario fixtures for all approved usage modes', () => {
    expect(ALPHA_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'full_trade_room_loop',
      'standalone_payment',
      'standalone_clearance',
      'counterparty_onboarding_screening',
      'funding_request',
      'document_first'
    ]);
    expect(new Set(ALPHA_SCENARIOS.map((scenario) => scenario.mode))).toEqual(
      new Set(['full_trade_cycle', 'standalone_job', 'composable_workflow'])
    );
  });
});
