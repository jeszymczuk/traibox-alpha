import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from './api';
import { clearClientSessionState, rememberCsrfToken } from './client-session';
import {
  beginTenantRequestTransition,
  executeTenantTransition,
  resetTenantRequestBoundaryForTests,
  tenantRenderKey,
  TenantTransitionState,
  type TenantSnapshot
} from './tenant-transition';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('central tenant transition boundary', () => {
  beforeEach(() => resetTenantRequestBoundaryForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    clearClientSessionState();
    resetTenantRequestBoundaryForTests();
  });

  it('tears down A before exposing B and changes the subtree render key', async () => {
    const state = new TenantTransitionState('org-a');
    const applied: TenantSnapshot[] = [];
    const cancelQueries = vi.fn(async () => undefined);
    const clearQueries = vi.fn();
    const persist = vi.fn();

    await expect(
      executeTenantTransition({ state, nextOrgId: 'org-b', cancelQueries, clearQueries, apply: (value) => applied.push(value), persist })
    ).resolves.toBe(true);

    expect(applied.map(({ visibleOrgId, pendingOrgId }) => [visibleOrgId, pendingOrgId])).toEqual([
      [null, 'org-b'],
      ['org-b', null]
    ]);
    expect(applied.some(({ visibleOrgId }) => visibleOrgId === 'org-a')).toBe(false);
    expect(tenantRenderKey(applied[0]!)).not.toBe(tenantRenderKey(applied[1]!));
    expect(cancelQueries).toHaveBeenCalledOnce();
    expect(clearQueries).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith('org-b');
  });

  it('clears the authenticated tenant on A-to-null', async () => {
    const state = new TenantTransitionState('org-a');
    const applied: TenantSnapshot[] = [];
    const persist = vi.fn();

    await executeTenantTransition({
      state,
      nextOrgId: null,
      cancelQueries: async () => undefined,
      clearQueries: vi.fn(),
      apply: (value) => applied.push(value),
      persist
    });

    expect(applied.at(-1)).toMatchObject({ visibleOrgId: null, pendingOrgId: null });
    expect(persist).toHaveBeenCalledWith(null);
  });

  it('allows only the latest overlapping transition to commit', async () => {
    const state = new TenantTransitionState('org-a');
    const firstCancellation = deferred<void>();
    const applied: TenantSnapshot[] = [];
    const persisted: Array<string | null> = [];

    const first = executeTenantTransition({
      state,
      nextOrgId: 'org-b',
      cancelQueries: () => firstCancellation.promise,
      clearQueries: vi.fn(),
      apply: (value) => applied.push(value),
      persist: (value) => persisted.push(value)
    });
    const second = executeTenantTransition({
      state,
      nextOrgId: 'org-c',
      cancelQueries: async () => undefined,
      clearQueries: vi.fn(),
      apply: (value) => applied.push(value),
      persist: (value) => persisted.push(value)
    });

    await expect(second).resolves.toBe(true);
    firstCancellation.resolve();
    await expect(first).resolves.toBe(false);
    expect(state.snapshot().visibleOrgId).toBe('org-c');
    expect(persisted).toEqual(['org-c']);
  });

  it('rejects a delayed A response after a transition has begun', async () => {
    const pending = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(() => pending.promise));
    const request = api.listTrades('org-a');

    beginTenantRequestTransition();
    pending.resolve(new Response(JSON.stringify({ trades: [] }), { status: 200 }));

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not deliver a delayed A stream event under a later tenant epoch', async () => {
    const delayedRead = deferred<ReadableStreamReadResult<Uint8Array>>();
    const response = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: { getReader: () => ({ read: () => delayedRead.promise }) }
    } as unknown as Response;
    const transport = vi.fn(async () => response);
    vi.stubGlobal('fetch', transport);
    rememberCsrfToken('test-csrf');
    const onEvent = vi.fn();
    const request = api.streamAlphaIntelligence('org-a', { message: 'A-only context' }, onEvent);
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());

    beginTenantRequestTransition();
    delayedRead.resolve({ done: false, value: new TextEncoder().encode('data: {"tenant":"org-a"}\n\n') });

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(onEvent).not.toHaveBeenCalled();
  });
});
