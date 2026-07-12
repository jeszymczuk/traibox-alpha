import type pg from 'pg';

export async function withTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function setAppContext(
  client: pg.PoolClient,
  ctx: {
    userId: string;
    orgId?: string | null;
    /**
     * Capital Agent v1.1 principal context (additive; existing callers are
     * unaffected). Company-side requests pass principalId = the org id and
     * principalType = 'company' (decision CA-113). Principal-aware RLS on
     * Capital tables requires both to be set; org-only context sees no
     * Capital rows.
     */
    principalId?: string | null;
    principalType?: 'company' | 'financier' | 'platform_internal' | null;
  }
): Promise<void> {
  await client.query(`SELECT set_config('app.current_user', $1, true)`, [ctx.userId]);
  await client.query(`SELECT set_config('app.current_org', $1, true)`, [ctx.orgId ?? '']);
  if (ctx.principalId !== undefined) {
    await client.query(`SELECT set_config('app.current_principal_id', $1, true)`, [ctx.principalId ?? '']);
  }
  if (ctx.principalType !== undefined) {
    await client.query(`SELECT set_config('app.current_principal_type', $1, true)`, [ctx.principalType ?? '']);
  }
}

