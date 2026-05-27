import dotenv from 'dotenv';
dotenv.config();

import { assertRuntimeReady, loadProfileFromFile, validateRuntimeEnvironment } from '@traibox/profiles';
import { createPool } from '@traibox/db';

import { runAnchorLoop } from './jobs/anchor.js';
import { runAlphaWorkflowLoop } from './jobs/alpha_workflows.js';
import { runBankSyncLoop } from './jobs/bank_sync.js';

const profilePath = process.env.DEPLOYMENT_PROFILE_PATH ?? 'packages/profiles/profiles/dev.yaml';
const profile = loadProfileFromFile(profilePath);
const runtimeReport = validateRuntimeEnvironment({ profile, target: 'worker' });
assertRuntimeReady(runtimeReport);
const pool = createPool(process.env.DATABASE_URL!);

// eslint-disable-next-line no-console
console.log(
  JSON.stringify({
    level: 'info',
    msg: 'Worker started',
    service: 'traibox-worker',
    profile_id: profile.profile_id,
    region: profile.region,
    runtime_status: runtimeReport.status,
    degraded_mode: runtimeReport.degraded_mode
  })
);

await Promise.all([runAnchorLoop({ pool, profile }), runBankSyncLoop({ pool, profile }), runAlphaWorkflowLoop({ pool })]);
