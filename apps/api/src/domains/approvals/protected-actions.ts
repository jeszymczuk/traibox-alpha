import type { ExecutionActionKind, OrgRole, ProtectedActionKind } from '@traibox/contracts';

export interface ProtectedExecutionPlan {
  kind: string;
  allowedActions: ExecutionActionKind[];
  checklist: string[];
  idempotencyRequired: boolean;
  notice: string;
}

const baseExecutionActions: ExecutionActionKind[] = ['prepare', 'start_controlled_execution', 'mark_ready_for_review', 'mark_blocked', 'cancel'];

export function approvalRoleForProtectedAction(action: ProtectedActionKind | string): OrgRole {
  if (action === 'send_payment' || action === 'submit_funding_request' || action === 'accept_funding_offer') return 'finance';
  if (action === 'change_verified_identity' || action === 'release_escrow_or_conditions' || action === 'make_binding_trade_commitment' || action === 'approve_trade_execution') {
    return 'admin';
  }
  return 'ops';
}

export function labelForApprovalRole(role: OrgRole | string, index: number): string {
  if (role === 'finance') return index === 0 ? 'Finance review' : 'Finance approval';
  if (role === 'ops') return index === 0 ? 'Operations review' : 'Operations approval';
  if (role === 'admin') return index === 0 ? 'Admin control' : 'Admin approval';
  return `Approval step ${index + 1}`;
}

export function remainingRisksForProtectedAction(action: ProtectedActionKind | string): string[] {
  if (action === 'send_payment') return ['wrong beneficiary', 'amount mismatch', 'stale readiness evidence', 'payment cannot be auto-executed'];
  if (action === 'submit_funding_request') return ['external financier receives data', 'missing documents may delay offer', 'terms are not binding until reviewed'];
  if (action === 'accept_funding_offer') return ['binding commercial terms', 'conditions precedent may remain', 'cost of capital requires review'];
  if (action === 'submit_clearance_declaration') return ['regulatory filing consequence', 'rule pack may be incomplete', 'supporting evidence must match declaration'];
  if (action === 'share_proof_bundle_externally') return ['external data disclosure', 'recipient scope must be correct', 'proof may reveal sensitive trade metadata'];
  if (action === 'invite_external_counterparty') return ['external party receives access', 'scope may expose trade context', 'identity must be checked'];
  return ['external consequence', 'permission scope', 'evidence freshness'];
}

export function evidenceRequirementsForProtectedAction(action: ProtectedActionKind | string): string[] {
  if (action === 'send_payment') return ['payment intent', 'counterparty or beneficiary context', 'readiness state', 'policy reference'];
  if (action === 'submit_funding_request') return ['funding request', 'finance-readiness pack', 'required documents', 'policy reference'];
  if (action === 'accept_funding_offer') return ['funding offer', 'funding request', 'conditions', 'approval policy'];
  if (action === 'submit_clearance_declaration') return ['clearance check', 'rule pack', 'supporting evidence', 'readiness state'];
  if (action === 'share_proof_bundle_externally') return ['proof bundle', 'recipient scope', 'artifact manifest', 'sharing policy'];
  if (action === 'invite_external_counterparty') return ['counterparty context', 'access scopes', 'invitation reason', 'permission policy'];
  return ['target object', 'linked evidence', 'policy reference', 'decision rationale'];
}

export function approvalConsequenceForProtectedAction(action: ProtectedActionKind | string): string {
  if (action === 'send_payment') return 'TRAIBOX creates a controlled execution task for payment operation. The payment is not sent automatically.';
  if (action === 'submit_funding_request') {
    return 'TRAIBOX releases a controlled execution task to submit the funding request. Submission still requires operator action or sandbox adapter execution.';
  }
  if (action === 'accept_funding_offer') return 'TRAIBOX creates a controlled execution task for offer acceptance and keeps conditions visible.';
  if (action === 'submit_clearance_declaration') return 'TRAIBOX creates a controlled execution task for clearance declaration submission; no declaration is filed automatically.';
  if (action === 'share_proof_bundle_externally') return 'TRAIBOX creates a controlled sharing task and preserves recipient, scope, and proof manifest in audit.';
  if (action === 'invite_external_counterparty') return 'TRAIBOX creates a scoped external-access task; access remains permission-bound and auditable.';
  return 'TRAIBOX creates a controlled execution task. The protected external action is not performed automatically.';
}

export function executionPlanForProtectedAction(action: ProtectedActionKind | string): ProtectedExecutionPlan {
  if (action === 'send_payment') {
    return {
      kind: 'payment',
      allowedActions: [...baseExecutionActions, 'mark_external_submitted', 'mark_external_completed'],
      checklist: ['Confirm beneficiary', 'Confirm amount and currency', 'Confirm readiness evidence', 'Use idempotency key before external submission'],
      idempotencyRequired: true,
      notice: 'Payment execution remains operator-controlled. TRAIBOX alpha does not send money automatically.'
    };
  }
  if (action === 'submit_funding_request' || action === 'accept_funding_offer') {
    return {
      kind: 'funding',
      allowedActions: [...baseExecutionActions, 'mark_external_submitted', 'mark_external_completed'],
      checklist: ['Confirm finance-readiness pack', 'Confirm recipient financier', 'Confirm conditions and terms', 'Record external reference after submission'],
      idempotencyRequired: true,
      notice: 'Funding execution remains operator-controlled. TRAIBOX alpha does not submit or accept external funding terms automatically.'
    };
  }
  if (action === 'submit_clearance_declaration' || action === 'submit_compliance_declaration') {
    return {
      kind: 'clearance',
      allowedActions: [...baseExecutionActions, 'mark_external_submitted', 'mark_external_completed'],
      checklist: ['Confirm rule pack', 'Confirm supporting evidence', 'Confirm declaration data', 'Record filing or sandbox reference'],
      idempotencyRequired: false,
      notice: 'Clearance execution remains operator-controlled. TRAIBOX alpha does not file declarations automatically.'
    };
  }
  if (action === 'share_proof_bundle_externally' || action === 'send_documents_externally' || action === 'invite_external_counterparty') {
    return {
      kind: 'external_access',
      allowedActions: [...baseExecutionActions, 'mark_external_submitted', 'mark_external_completed'],
      checklist: ['Confirm recipient', 'Confirm access scope', 'Confirm artifact manifest', 'Record external reference or invitation id'],
      idempotencyRequired: false,
      notice: 'External sharing remains operator-controlled and permission-bound. TRAIBOX alpha does not transmit data automatically.'
    };
  }
  return {
    kind: 'generic_protected_action',
    allowedActions: baseExecutionActions,
    checklist: ['Confirm target', 'Confirm evidence', 'Confirm policy', 'Record operator outcome'],
    idempotencyRequired: false,
    notice: 'Protected execution remains operator-controlled. TRAIBOX alpha does not perform external actions automatically.'
  };
}
