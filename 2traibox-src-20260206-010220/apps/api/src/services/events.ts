import type pg from 'pg';
import type { SSEEvent } from '@traibox/contracts';

export class EventHub {
  private readonly pool: pg.Pool;
  private listener: pg.PoolClient | null = null;
  private subscriptions = new Map<string, Set<(ev: SSEEvent) => void>>();

  constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  async start(): Promise<void> {
    if (this.listener) return;
    this.listener = await this.pool.connect();
    this.listener.on('notification', (msg) => {
      if (!msg.payload) return;
      try {
        const ev = JSON.parse(msg.payload) as SSEEvent;
        this.broadcast(ev);
      } catch {
        // ignore malformed payload
      }
    });
    await this.listener.query('LISTEN trade_events');
  }

  subscribe(filter: { orgId: string; tradeId?: string }, handler: (ev: SSEEvent) => void): { unsubscribe: () => void } {
    const key = subscriptionKey(filter);
    const set = this.subscriptions.get(key) ?? new Set();
    set.add(handler);
    this.subscriptions.set(key, set);
    return {
      unsubscribe: () => {
        const cur = this.subscriptions.get(key);
        if (!cur) return;
        cur.delete(handler);
        if (cur.size === 0) this.subscriptions.delete(key);
      }
    };
  }

  broadcast(ev: SSEEvent): void {
    const keyExact = subscriptionKey({ orgId: ev.org_id, tradeId: ev.trade_id });
    const keyOrgAll = subscriptionKey({ orgId: ev.org_id });
    const targets = new Set<(ev: SSEEvent) => void>();
    for (const k of [keyExact, keyOrgAll]) {
      const set = this.subscriptions.get(k);
      if (!set) continue;
      for (const h of set) targets.add(h);
    }
    for (const h of targets) h(ev);
  }

  async stop(): Promise<void> {
    if (!this.listener) return;
    try {
      await this.listener.query('UNLISTEN trade_events');
    } finally {
      this.listener.release();
      this.listener = null;
    }
  }
}

function subscriptionKey(f: { orgId: string; tradeId?: string }): string {
  return `${f.orgId}:${f.tradeId ?? '*'}`;
}

