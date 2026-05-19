import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const migrationsDir = path.join(process.cwd(), 'packages/db/migrations');

function listMigrations(): Array<{ name: string; fullPath: string; sql: string }> {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  return files.map((name) => {
    const fullPath = path.join(migrationsDir, name);
    const sql = readFileSync(fullPath, 'utf8');
    return { name, fullPath, sql };
  });
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
    const migrations = listMigrations();
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

