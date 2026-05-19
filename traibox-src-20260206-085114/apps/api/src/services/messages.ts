import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { SSEEvent } from '@traibox/contracts';
import { setAppContext, withTx } from '@traibox/db';

export async function listTradeMessages(
  pool: pg.Pool,
  input: { orgId: string; userId: string; tradeId: string; limit?: number }
) {
  const limit = Math.max(1, Math.min(500, Number(input.limit ?? 200)));
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      `SELECT message_id, role, text, attachments, created_at
       FROM trade_messages
       WHERE trade_id=$1
       ORDER BY created_at ASC
       LIMIT $2`,
      [input.tradeId, limit]
    );
    return { messages: res.rows };
  });
}

export async function createUserTradeMessage(
  pool: pg.Pool,
  input: { orgId: string; userId: string; tradeId: string; traceId: string; text: string }
) {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });

    const row = await client.query(
      `INSERT INTO trade_messages(trade_id, org_id, user_id, role, text)
       VALUES ($1,$2,$3,'user',$4)
       RETURNING message_id, role, text, attachments, created_at`,
      [input.tradeId, input.orgId, input.userId, input.text]
    );

    const msg = row.rows[0] ?? null;

    const ev: SSEEvent = {
      event_id: randomUUID(),
      type: 'trade.message.created',
      ts: new Date().toISOString(),
      org_id: input.orgId,
      trade_id: input.tradeId,
      trace_id: input.traceId,
      actor: `user:${input.userId}`,
      data: { message_id: msg?.message_id, role: msg?.role, created_at: msg?.created_at }
    };

    await client.query(
      'INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [ev.event_id, input.orgId, input.tradeId, ev.type, input.traceId, ev.actor, JSON.stringify(ev.data)]
    );

    return { message: msg };
  });
}

