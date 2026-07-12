import pg from 'pg';

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({
    connectionString,
    connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
    max: 10,
    statement_timeout: 30_000,
    query_timeout: 30_000
  });
}
