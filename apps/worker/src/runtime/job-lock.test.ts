import { describe, expect, it, vi } from 'vitest';

import { withJobLock } from './job-lock';

function poolWithLock(acquired: boolean, unlockError?: Error) {
  const release = vi.fn();
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ acquired }] })
    .mockImplementationOnce(async () => {
      if (unlockError) throw unlockError;
      return { rows: [{ pg_advisory_unlock: true }] };
    });
  return {
    pool: { connect: vi.fn().mockResolvedValue({ query, release }) } as any,
    query,
    release
  };
}

describe('worker advisory job locks', () => {
  it('runs a tick only when the distributed lock is acquired', async () => {
    const { pool, query, release } = poolWithLock(true);
    const run = vi.fn().mockResolvedValue({ processed: 2 });

    await expect(withJobLock(pool, 'workflow-monitor', run)).resolves.toEqual({ acquired: true, value: { processed: 2 } });
    expect(run).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('skips duplicate ticks when another worker owns the lock', async () => {
    const { pool, query, release } = poolWithLock(false);
    const run = vi.fn();

    await expect(withJobLock(pool, 'workflow-monitor', run)).resolves.toEqual({ acquired: false, value: null });
    expect(run).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(undefined);
  });

  it('destroys the pooled connection if releasing the lock fails', async () => {
    const unlockError = new Error('unlock failed');
    const { pool, release } = poolWithLock(true, unlockError);

    await expect(withJobLock(pool, 'workflow-monitor', async () => 'ok')).rejects.toThrow('unlock failed');
    expect(release).toHaveBeenCalledWith(unlockError);
  });

  it('releases the lock and preserves the original tick failure', async () => {
    const { pool, query, release } = poolWithLock(true);

    await expect(
      withJobLock(pool, 'workflow-monitor', async () => {
        throw new Error('tick failed');
      })
    ).rejects.toThrow('tick failed');
    expect(query).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledWith(undefined);
  });
});
