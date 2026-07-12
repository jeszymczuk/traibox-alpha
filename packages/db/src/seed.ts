import dotenv from 'dotenv';
import pg from 'pg';
import { URL } from 'node:url';

dotenv.config();

// Idempotent local-dev seed: a FIXED-uuid org owned by the dev user, so the dev
// stack always has a stable org to select. Without this, every `db:reset` (or a
// test-suite run against the dev DB) leaves the org to be recreated with a fresh
// random uuid, stranding any saved org selection in the web app.
// Safe to run repeatedly — everything is an upsert.

const DEV_USER_ID = process.env.DEV_USER_ID ?? '00000000-0000-0000-0000-0000000000aa';
const DEV_ORG_ID = process.env.DEV_ORG_ID ?? '00000000-0000-0000-0000-0000000000cc';
const DEV_ORG_NAME = process.env.DEV_ORG_NAME ?? 'TRAIBOX Dev Org';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const url = new URL(connectionString);
const host = url.hostname;
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed DB in production');
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error(`Refusing to seed non-local DB host: ${host}`);

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO app_users(user_id, email, display_name)
       VALUES ($1, 'dev@local', 'Dev User')
       ON CONFLICT (user_id) DO NOTHING`,
      [DEV_USER_ID]
    );
    await client.query(
      `INSERT INTO orgs(org_id, name, country)
       VALUES ($1, $2, 'PT')
       ON CONFLICT (org_id) DO UPDATE SET name = EXCLUDED.name`,
      [DEV_ORG_ID, DEV_ORG_NAME]
    );
    await client.query(
      `INSERT INTO org_members(org_id, user_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (org_id, user_id) DO NOTHING`,
      [DEV_ORG_ID, DEV_USER_ID]
    );
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`Seeded dev org "${DEV_ORG_NAME}" (${DEV_ORG_ID}) owned by dev user (${DEV_USER_ID}).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
