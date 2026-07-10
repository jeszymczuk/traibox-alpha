import dotenv from 'dotenv';
dotenv.config();

import { assertRuntimeReady, loadProfileFromFile, validateRuntimeEnvironment } from '@traibox/profiles';
import { createPool } from '@traibox/db';

import { runAnchorLoop } from './jobs/anchor.js';
import { runAlphaWorkflowLoop } from './jobs/alpha_workflows.js';
import { runBankSyncLoop } from './jobs/bank_sync.js';

function startupLog(stage: string, details: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level: 'info', msg: 'Worker startup stage', service: 'traibox-worker', stage, ...details }));
}

function startupError(source: string, error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'Worker startup failed',
      service: 'traibox-worker',
      source,
      error_name: normalized.name,
      error_message: normalized.message,
      error_stack: normalized.stack
    })
  );
}

process.once('uncaughtException', (error) => {
  startupError('uncaughtException', error);
  process.exitCode = 1;
});
process.once('unhandledRejection', (reason) => {
  startupError('unhandledRejection', reason);
  process.exitCode = 1;
});

async function main() {
  const profilePath = process.env.DEPLOYMENT_PROFILE_PATH ?? 'packages/profiles/profiles/dev.yaml';
  startupLog('runtime.profile_loading', { profile_path: profilePath });
  const profile = loadProfileFromFile(profilePath);
  const runtimeReport = validateRuntimeEnvironment({ profile, target: 'worker' });
  assertRuntimeReady(runtimeReport);
  startupLog('runtime.validated', {
    profile_id: profile.profile_id,
    region: profile.region,
    runtime_status: runtimeReport.status,
    degraded_mode: runtimeReport.degraded_mode
  });

  const pool = createPool(process.env.DATABASE_URL!);
  startupLog('database.pool_created');
  startupLog('loops.starting');
  await Promise.all([runAnchorLoop({ pool, profile }), runBankSyncLoop({ pool, profile }), runAlphaWorkflowLoop({ pool })]);
}

void main().catch((error) => {
  startupError('main', error);
  process.exitCode = 1;
});
