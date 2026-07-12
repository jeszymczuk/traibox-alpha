import { describe, expect, it } from 'vitest';

import { parseProfileYaml } from '@traibox/profiles';
import { resolveWorkerJobGates } from './job-gates';

describe('worker job gates', () => {
  it('keeps every job disabled unless the operator explicitly enables it', () => {
    const profile = parseProfileYaml(`
profile_id: pilot
region: eu
payments:
  active_provider: truelayer
  truelayer:
    enabled: true
ledger:
  anchoring:
    enabled: true
`);

    expect(resolveWorkerJobGates(profile, {})).toEqual({ workflowMonitor: false, bankSync: false, anchoring: false });
  });

  it('requires both the deployment profile and operator gate for provider jobs', () => {
    const profile = parseProfileYaml(`
profile_id: staging
region: eu
payments:
  active_provider: manual
  truelayer:
    enabled: false
ledger:
  anchoring:
    enabled: false
`);
    const env = {
      ALPHA_WORKFLOW_MONITOR_ENABLED: 'true',
      WORKER_BANK_SYNC_ENABLED: 'true',
      WORKER_ANCHORING_ENABLED: 'true'
    };

    expect(resolveWorkerJobGates(profile, env)).toEqual({ workflowMonitor: true, bankSync: false, anchoring: false });
  });
});
