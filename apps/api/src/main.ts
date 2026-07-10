import dotenv from 'dotenv';
dotenv.config();

import { buildServer } from './server.js';

function startupLog(stage: string, details: Record<string, unknown> = {}) {
  // Never include environment values here: Fly logs must remain safe to share.
  console.log(JSON.stringify({ level: 'info', msg: 'API startup stage', service: 'traibox-api', stage, ...details }));
}

function startupError(source: string, error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      level: 'fatal',
      msg: 'API startup failed',
      service: 'traibox-api',
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
  const port = Number(process.env.API_PORT ?? 3001);
  const host = process.env.API_HOST ?? '0.0.0.0';
  startupLog('bootstrap', { host, port });

  const server = await buildServer({ onStartupStage: startupLog });
  startupLog('server.listen_starting');
  await server.listen({ port, host });
  startupLog('server.listening_complete', { host, port, url: `http://${host}:${port}` });
}

void main().catch((error) => {
  startupError('main', error);
  process.exitCode = 1;
});
