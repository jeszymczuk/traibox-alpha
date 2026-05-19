import dotenv from 'dotenv';
import pg from 'pg';
import { execSync } from 'node:child_process';
import { URL } from 'node:url';

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const url = new URL(connectionString);
const host = url.hostname;
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset DB in production');
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`Refusing to reset non-local DB host: ${host}`);

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }

  execSync('node --loader tsx packages/db/src/migrate.ts', { stdio: 'inherit' });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

