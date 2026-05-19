import type { AlphaObjectType, ObjectLifecycleStatus } from '@traibox/contracts';

type LifecycleObject = {
  type: string;
  status: string;
};

const terminalLifecycleStates = new Set<ObjectLifecycleStatus>(['completed', 'rejected', 'cancelled', 'archived']);

const constrainedInitialStates: Partial<Record<AlphaObjectType, ObjectLifecycleStatus[]>> = {
  approval: ['approval_required'],
  document_request: ['pending_input'],
  execution_task: ['in_progress'],
  external_access_grant: ['approved'],
  proof_bundle: ['completed']
};

const allowedTransitionsByType: Partial<Record<AlphaObjectType, Partial<Record<ObjectLifecycleStatus, ObjectLifecycleStatus[]>>>> = {
  approval: {
    approval_required: ['approved', 'rejected']
  },
  document_request: {
    pending_input: ['completed', 'blocked', 'cancelled'],
    in_progress: ['completed', 'blocked', 'cancelled'],
    blocked: ['pending_input', 'cancelled']
  },
  execution_task: {
    in_progress: ['ready_for_review', 'blocked', 'completed', 'cancelled'],
    ready_for_review: ['in_progress', 'blocked', 'completed', 'cancelled'],
    blocked: ['in_progress', 'cancelled']
  },
  external_access_grant: {
    approved: ['cancelled', 'archived']
  }
};

export function validateInitialLifecycleState(type: AlphaObjectType, status: ObjectLifecycleStatus): string | null {
  if (status === 'attached') return 'Objects cannot be created directly in attached state';
  if (status === 'archived') return 'Objects cannot be created directly in archived state';

  const allowed = constrainedInitialStates[type];
  if (allowed && !allowed.includes(status)) {
    return `${type} must start as ${allowed.join(' or ')}`;
  }

  return null;
}

export function validateLifecycleTransition(object: LifecycleObject, nextStatus: ObjectLifecycleStatus, action: string): string | null {
  const currentStatus = object.status as ObjectLifecycleStatus;
  const type = object.type as AlphaObjectType;

  if (currentStatus === nextStatus) {
    if (currentStatus === 'attached' && action !== 'object.link') {
      return `Invalid lifecycle transition for ${object.type}: ${currentStatus} -> ${nextStatus}`;
    }
    return null;
  }

  if (nextStatus === 'attached') {
    if (['rejected', 'cancelled', 'archived', 'attached'].includes(currentStatus)) {
      return `Invalid lifecycle transition for ${type}: ${currentStatus} -> ${nextStatus}`;
    }
    return null;
  }

  if (terminalLifecycleStates.has(currentStatus)) {
    return `Invalid lifecycle transition for ${type}: ${currentStatus} -> ${nextStatus}`;
  }

  const allowed = allowedTransitionsByType[type]?.[currentStatus];
  if (allowed && !allowed.includes(nextStatus)) {
    return `Invalid lifecycle transition for ${type}: ${currentStatus} -> ${nextStatus}`;
  }

  if (nextStatus === 'approval_required' && action !== 'approval.request') {
    return `Invalid lifecycle transition for ${type}: ${currentStatus} -> ${nextStatus}`;
  }

  return null;
}
