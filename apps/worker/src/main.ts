import dotenv from 'dotenv';
dotenv.config();

import { assertRuntimeReady, loadProfileFromFile, validateRuntimeEnvironment } from '@traibox/profiles';
import { createPool } from '@traibox/db';

import { resolveWorkerJobGates } from './runtime/job-gates.js';

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
  process.exit(1);
});
process.once('unhandledRejection', (reason) => {
  startupError('unhandledRejection', reason);
  process.exit(1);
});

async function main() {
  startupLog('bootstrap');
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
  const abortController = new AbortController();
  const requestShutdown = (signal: string) => {
    startupLog('shutdown.requested', { signal });
    abortController.abort();
  };
  const onSigterm = () => requestShutdown('SIGTERM');
  const onSigint = () => requestShutdown('SIGINT');
  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);

  try {
    startupLog('database.connecting');
    await pool.query('SELECT 1');
    startupLog('database.connected');

    const gates = resolveWorkerJobGates(profile);
    startupLog('jobs.configured', {
      workflow_monitor_enabled: gates.workflowMonitor,
      bank_sync_enabled: gates.bankSync,
      anchoring_enabled: gates.anchoring
    });
    startupLog('jobs.importing');
    const [{ runAnchorLoop }, { runAlphaWorkflowLoop }, { runBankSyncLoop }] = await Promise.all([
      import('./jobs/anchor.js'),
      import('./jobs/alpha_workflows.js'),
      import('./jobs/bank_sync.js')
    ]);
    startupLog('jobs.imported');
    startupLog('loops.starting');
    await Promise.all([
      runAnchorLoop({ pool, profile, enabled: gates.anchoring, signal: abortController.signal }),
      runBankSyncLoop({ pool, profile, enabled: gates.bankSync, signal: abortController.signal }),
      runAlphaWorkflowLoop({ pool, enabled: gates.workflowMonitor, signal: abortController.signal })
    ]);
    startupLog('loops.stopped');
  } finally {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
    abortController.abort();
    startupLog('database.closing');
    await pool.end();
    startupLog('shutdown.complete');
  }
}

void main().catch((error) => {
  startupError('main', error);
  process.exitCode = 1;
});
