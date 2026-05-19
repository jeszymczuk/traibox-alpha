import { describe, expect, it } from 'vitest';

import {
  approvalConsequenceForProtectedAction,
  approvalRoleForProtectedAction,
  evidenceRequirementsForProtectedAction,
  executionPlanForProtectedAction,
  labelForApprovalRole,
  remainingRisksForProtectedAction
} from './protected-actions';

describe('protected action domain policy', () => {
  it('routes protected finance actions to finance approval and idempotent controlled execution', () => {
    expect(approvalRoleForProtectedAction('send_payment')).toBe('finance');
    expect(labelForApprovalRole('finance', 0)).toBe('Finance review');
    expect(remainingRisksForProtectedAction('send_payment')).toEqual(expect.arrayContaining(['wrong beneficiary', 'payment cannot be auto-executed']));
    expect(evidenceRequirementsForProtectedAction('send_payment')).toEqual(expect.arrayContaining(['payment intent', 'readiness state']));
    expect(approvalConsequenceForProtectedAction('send_payment')).toContain('payment is not sent automatically');

    const plan = executionPlanForProtectedAction('send_payment');
    expect(plan.kind).toBe('payment');
    expect(plan.idempotencyRequired).toBe(true);
    expect(plan.allowedActions).toEqual(expect.arrayContaining(['mark_external_submitted', 'mark_external_completed']));
    expect(plan.notice).toContain('does not send money automatically');
  });

  it('keeps external sharing and clearance actions operator-controlled without payment idempotency requirements', () => {
    expect(approvalRoleForProtectedAction('share_proof_bundle_externally')).toBe('ops');
    expect(evidenceRequirementsForProtectedAction('share_proof_bundle_externally')).toEqual(expect.arrayContaining(['proof bundle', 'recipient scope']));

    const sharingPlan = executionPlanForProtectedAction('share_proof_bundle_externally');
    expect(sharingPlan.kind).toBe('external_access');
    expect(sharingPlan.idempotencyRequired).toBe(false);
    expect(sharingPlan.notice).toContain('does not transmit data automatically');

    const clearancePlan = executionPlanForProtectedAction('submit_clearance_declaration');
    expect(clearancePlan.kind).toBe('clearance');
    expect(clearancePlan.idempotencyRequired).toBe(false);
    expect(clearancePlan.notice).toContain('does not file declarations automatically');
  });

  it('falls back to generic operator-controlled policy for future protected action extensions', () => {
    expect(approvalRoleForProtectedAction('future_protected_action')).toBe('ops');
    expect(remainingRisksForProtectedAction('future_protected_action')).toEqual(['external consequence', 'permission scope', 'evidence freshness']);

    const plan = executionPlanForProtectedAction('future_protected_action');
    expect(plan.kind).toBe('generic_protected_action');
    expect(plan.idempotencyRequired).toBe(false);
    expect(plan.allowedActions).toEqual(['prepare', 'start_controlled_execution', 'mark_ready_for_review', 'mark_blocked', 'cancel']);
  });
});
