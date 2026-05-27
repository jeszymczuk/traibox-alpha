import dotenv from 'dotenv';
import pg from 'pg';
import { buildMigrationPreflightReport, listMigrationFiles } from './migration-guardrails.js';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

async function ensureMigrationsTable(client: pg.Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function appliedSet(client: pg.Client): Promise<Set<string>> {
  const res = await client.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(res.rows.map((r) => r.name));
}

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await appliedSet(client);
    const migrations = listMigrationFiles();
    const preflight = buildMigrationPreflightReport({ migrations, applied });
    if (process.env.MIGRATION_DRY_RUN === 'true' || process.env.MIGRATION_PREFLIGHT_ONLY === 'true') {
      process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
      if (preflight.status === 'fail') process.exitCode = 1;
      return;
    }
    if (preflight.status === 'fail') {
      process.stderr.write(`${JSON.stringify(preflight, null, 2)}\n`);
      throw new Error('Migration preflight failed');
    }
    if (preflight.status === 'warn') {
      process.stdout.write(`${JSON.stringify({ migration_preflight: preflight }, null, 2)}\n`);
    }
    for (const m of migrations) {
      if (applied.has(m.name)) continue;
      process.stdout.write(`Applying ${m.name}...\n`);
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [m.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    process.stdout.write('Migrations complete.\n');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
