import { describe, expect, it } from 'vitest';

import { validateInitialLifecycleState, validateLifecycleTransition } from './object-lifecycle';

describe('object lifecycle domain policy', () => {
  it('guards constrained initial states', () => {
    expect(validateInitialLifecycleState('approval', 'approval_required')).toBeNull();
    expect(validateInitialLifecycleState('approval', 'draft')).toBe('approval must start as approval_required');
    expect(validateInitialLifecycleState('payment_intent', 'attached')).toBe('Objects cannot be created directly in attached state');
    expect(validateInitialLifecycleState('proof_bundle', 'completed')).toBeNull();
  });

  it('allows attach transitions only from non-terminal unattached states', () => {
    expect(validateLifecycleTransition({ type: 'payment_intent', status: 'approval_required' }, 'attached', 'object.attach')).toBeNull();
    expect(validateLifecycleTransition({ type: 'counterparty', status: 'attached' }, 'attached', 'object.link')).toBeNull();
    expect(validateLifecycleTransition({ type: 'counterparty', status: 'attached' }, 'attached', 'object.attach')).toContain('Invalid lifecycle transition');
    expect(validateLifecycleTransition({ type: 'payment_intent', status: 'cancelled' }, 'attached', 'object.attach')).toContain('Invalid lifecycle transition');
  });

  it('enforces typed transition rules for approvals, execution tasks, and document requests', () => {
    expect(validateLifecycleTransition({ type: 'approval', status: 'approval_required' }, 'approved', 'approval.decision')).toBeNull();
    expect(validateLifecycleTransition({ type: 'approval', status: 'approval_required' }, 'completed', 'approval.decision')).toContain('Invalid lifecycle transition');

    expect(validateLifecycleTransition({ type: 'execution_task', status: 'blocked' }, 'in_progress', 'execution.task.status')).toBeNull();
    expect(validateLifecycleTransition({ type: 'execution_task', status: 'blocked' }, 'completed', 'execution.task.status')).toContain('Invalid lifecycle transition');

    expect(validateLifecycleTransition({ type: 'document_request', status: 'pending_input' }, 'completed', 'document_request.submit')).toBeNull();
    expect(validateLifecycleTransition({ type: 'document_request', status: 'completed' }, 'pending_input', 'document_request.submit')).toContain('Invalid lifecycle transition');
  });

  it('keeps approval_required reserved for explicit approval requests', () => {
    expect(validateLifecycleTransition({ type: 'payment_intent', status: 'ready_for_review' }, 'approval_required', 'approval.request')).toBeNull();
    expect(validateLifecycleTransition({ type: 'payment_intent', status: 'ready_for_review' }, 'approval_required', 'manual.status')).toContain('Invalid lifecycle transition');
  });
});
