import type { Profile } from '@traibox/profiles';

export type WorkerJobGates = {
  workflowMonitor: boolean;
  bankSync: boolean;
  anchoring: boolean;
};

export function resolveWorkerJobGates(profile: Profile, env: Record<string, string | undefined> = process.env): WorkerJobGates {
  return {
    workflowMonitor: envEnabled(env.ALPHA_WORKFLOW_MONITOR_ENABLED),
    bankSync: profile.payments.truelayer.enabled && envEnabled(env.WORKER_BANK_SYNC_ENABLED),
    anchoring: profile.ledger.anchoring.enabled && envEnabled(env.WORKER_ANCHORING_ENABLED)
  };
}

function envEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}
