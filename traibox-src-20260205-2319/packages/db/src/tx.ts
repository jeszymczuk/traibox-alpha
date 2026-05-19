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

export async function setAppContext(client: pg.PoolClient, ctx: { userId: string; orgId?: string | null }): Promise<void> {
  await client.query(`SELECT set_config('app.current_user', $1, true)`, [ctx.userId]);
  await client.query(`SELECT set_config('app.current_org', $1, true)`, [ctx.orgId ?? '']);
}

