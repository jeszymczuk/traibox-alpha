import type pg from 'pg';
import { withTx, setAppContext } from '@traibox/db';

export interface IdempotencyRow {
  status_code: number;
  response_json: unknown;
  request_hash: string;
}

export async function lockIdempotencyTransaction(
  client: pg.PoolClient,
  input: { orgId: string; route: string; key: string }
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify([input.orgId, input.route, input.key])]);
}

export async function getIdempotentResponseInTransaction(
  client: pg.PoolClient,
  input: { orgId: string; route: string; key: string; requestHash: string }
): Promise<IdempotencyRow | null> {
  const res = await client.query<IdempotencyRow>(
    `SELECT status_code, response_json, request_hash
       FROM idempotency_keys
      WHERE org_id=$1 AND key=$2 AND route=$3 AND expires_at > now()
      LIMIT 1`,
    [input.orgId, input.key, input.route]
  );
  const row = res.rows[0];
  if (!row) return null;
  assertRequestHash(row, input.requestHash);
  return row;
}

export async function putIdempotentResponseInTransaction(
  client: pg.PoolClient,
  input: {
    orgId: string;
    route: string;
    key: string;
    requestHash: string;
    statusCode: number;
    responseJson: unknown;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO idempotency_keys(org_id, key, route, request_hash, status_code, response_json, expires_at)
     VALUES($1,$2,$3,$4,$5,$6, now() + interval '24 hours')
     ON CONFLICT (org_id, key, route) DO NOTHING`,
    [input.orgId, input.key, input.route, input.requestHash, input.statusCode, JSON.stringify(input.responseJson)]
  );
}

export async function getIdempotentResponse(
  pool: pg.Pool,
  input: { orgId: string; userId: string; route: string; key: string; requestHash: string }
): Promise<IdempotencyRow | null> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query<IdempotencyRow>(
      `SELECT status_code, response_json, request_hash
       FROM idempotency_keys
       WHERE org_id=$1 AND key=$2 AND route=$3 AND expires_at > now()
       LIMIT 1`,
      [input.orgId, input.key, input.route]
    );
    const row = res.rows[0];
    if (!row) return null;
    assertRequestHash(row, input.requestHash);
    return row;
  });
}

function assertRequestHash(row: IdempotencyRow, requestHash: string): void {
  if (row.request_hash === requestHash) return;
  const err = new Error('Idempotency key conflict');
  (err as any).statusCode = 409;
  (err as any).code = 'idempotency_conflict';
  throw err;
}

export async function putIdempotentResponse(
  pool: pg.Pool,
  input: {
    orgId: string;
    userId: string;
    route: string;
    key: string;
    requestHash: string;
    statusCode: number;
    responseJson: unknown;
  }
): Promise<void> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query(
      `INSERT INTO idempotency_keys(org_id, key, route, request_hash, status_code, response_json, expires_at)
       VALUES($1,$2,$3,$4,$5,$6, now() + interval '24 hours')
       ON CONFLICT (org_id, key, route) DO NOTHING`,
      [input.orgId, input.key, input.route, input.requestHash, input.statusCode, JSON.stringify(input.responseJson)]
    );
  });
}
