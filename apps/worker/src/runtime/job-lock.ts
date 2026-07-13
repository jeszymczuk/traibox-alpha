import type pg from 'pg';

export type JobLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false; value: null };

/**
 * Keep a session-scoped Postgres advisory lock while a job tick runs. This
 * prevents rolling deployments or accidental scaling from processing the same
 * workflow/provider queue concurrently.
 */
export async function withJobLock<T>(pool: pg.Pool, jobName: string, run: () => Promise<T>): Promise<JobLockResult<T>> {
  const client = await pool.connect();
  const lockName = `traibox.worker.${jobName}`;
  let acquired = false;
  let operationFailed = false;
  let releaseError: Error | undefined;

  try {
    const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS acquired', [lockName]);
    acquired = result.rows[0]?.acquired === true;
    if (!acquired) return { acquired: false, value: null };
    return { acquired: true, value: await run() };
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    if (acquired) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockName]);
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // Destroy a connection when unlock failed so a pooled session can never
    // retain the advisory lock indefinitely.
    client.release(releaseError);
    if (releaseError && !operationFailed) throw releaseError;
  }
}
