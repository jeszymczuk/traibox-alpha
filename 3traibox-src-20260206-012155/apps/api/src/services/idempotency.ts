import type pg from 'pg';
import { withTx, setAppContext } from '@traibox/db';

export interface IdempotencyRow {
  status_code: number;
  response_json: unknown;
  request_hash: string;
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
    if (row.request_hash !== input.requestHash) {
      const err = new Error('Idempotency key conflict');
      (err as any).statusCode = 409;
      (err as any).code = 'idempotency_conflict';
      throw err;
    }
    return row;
  });
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

