export type TenantSnapshot = {
  epoch: number;
  visibleOrgId: string | null;
  pendingOrgId: string | null;
};

export class TenantTransitionState {
  private epoch = 0;
  private visibleOrgId: string | null;
  private pendingOrgId: string | null = null;

  constructor(initialOrgId: string | null = null) {
    this.visibleOrgId = initialOrgId;
  }

  snapshot(): TenantSnapshot {
    return { epoch: this.epoch, visibleOrgId: this.visibleOrgId, pendingOrgId: this.pendingOrgId };
  }

  begin(nextOrgId: string | null): TenantSnapshot {
    this.epoch += 1;
    this.visibleOrgId = null;
    this.pendingOrgId = nextOrgId;
    return this.snapshot();
  }

  commit(epoch: number): TenantSnapshot | null {
    if (epoch !== this.epoch) return null;
    this.visibleOrgId = this.pendingOrgId;
    this.pendingOrgId = null;
    return this.snapshot();
  }
}

let requestEpoch = 0;
let requestController = new AbortController();

export function beginTenantRequestTransition(): number {
  requestController.abort(new DOMException('Tenant changed', 'AbortError'));
  requestController = new AbortController();
  requestEpoch += 1;
  return requestEpoch;
}

export function tenantRequestContext(): { epoch: number; signal: AbortSignal } {
  return { epoch: requestEpoch, signal: requestController.signal };
}

export function assertCurrentTenantRequest(epoch: number): void {
  if (epoch !== requestEpoch) throw new DOMException('Tenant response is stale', 'AbortError');
}

export function tenantRenderKey(snapshot: TenantSnapshot): string {
  return `tenant:${snapshot.epoch}:${snapshot.visibleOrgId ?? 'none'}`;
}

export async function executeTenantTransition(input: {
  state: TenantTransitionState;
  nextOrgId: string | null;
  cancelQueries: () => Promise<void>;
  clearQueries: () => void;
  apply: (snapshot: TenantSnapshot) => void;
  persist: (orgId: string | null) => void;
}): Promise<boolean> {
  const started = input.state.begin(input.nextOrgId);
  beginTenantRequestTransition();
  input.apply(started);
  const cancellation = input.cancelQueries();
  input.clearQueries();
  await cancellation.catch(() => undefined);
  const committed = input.state.commit(started.epoch);
  if (!committed) return false;
  input.apply(committed);
  input.persist(committed.visibleOrgId);
  return true;
}

export function resetTenantRequestBoundaryForTests(): void {
  requestController.abort();
  requestController = new AbortController();
  requestEpoch = 0;
}
