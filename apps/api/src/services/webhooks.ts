import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import type { SSEEvent } from '@traibox/contracts';

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export async function handlePaymentWebhook(
  pool: pg.Pool,
  input: {
    providerId: string;
    paymentIdOrRef: string;
    status: string;
    iso_status?: string;
    return_reason?: string;
    payload: any;
    signatureOk: boolean;
    dedupeKey: string;
    traceId: string;
  }
): Promise<{ ok: boolean }> {
  const type =
    input.status === 'executed'
      ? 'payment.completed'
      : input.status === 'failed'
        ? 'payment.failed'
        : input.status === 'returned'
          ? 'payment.returned'
          : input.status === 'refunded'
            ? 'payment.refunded'
            : input.status === 'executing' || input.status === 'authorized'
              ? 'payment.executing'
              : null;

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: null });

    const res = await client.query(
      'SELECT payment_id, org_id, trade_id, scheme, status FROM payments WHERE payment_id::text = $1 OR provider_ref = $1 LIMIT 1',
      [input.paymentIdOrRef]
    );
    const row = res.rows[0] as { payment_id: string; org_id: string; trade_id: string | null; scheme: string; status: string } | undefined;
    if (!row) return;

    const orgId = row.org_id;
    const tradeId = row.trade_id;
    const paymentId = row.payment_id;

    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId });

    const ins = await client.query<{ event_id: string }>(
      `INSERT INTO webhook_events(org_id, provider_id, topic, payload, signature_ok, dedupe_key)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, provider_id, topic, dedupe_key) DO NOTHING
       RETURNING event_id`,
      [orgId, input.providerId, 'payments', JSON.stringify(input.payload ?? {}), input.signatureOk, input.dedupeKey]
    );
    if (ins.rowCount === 0) return;

    const canUpdateStatus = ['pending_sca', 'authorized', 'executing', 'executed', 'failed', 'returned', 'refunded'].includes(input.status);
    if (canUpdateStatus) {
      await client.query('UPDATE payments SET status=$1, iso_status=$2, return_reason=$3 WHERE payment_id=$4', [
        input.status,
        input.iso_status ?? null,
        input.return_reason ?? null,
        paymentId
      ]);
      await client.query('INSERT INTO payment_attempts(org_id, payment_id, status, code, raw) VALUES($1,$2,$3,$4,$5)', [
        orgId,
        paymentId,
        input.status,
        null,
        JSON.stringify({ webhook: true, iso_status: input.iso_status ?? null, return_reason: input.return_reason ?? null })
      ]);
    }

    if (type) {
      const ev: SSEEvent = {
        event_id: crypto.randomUUID(),
        type,
        ts: new Date().toISOString(),
        org_id: orgId,
        trade_id: tradeId ?? undefined,
        trace_id: input.traceId,
        actor: `system:webhook:${input.providerId}`,
        data: { payment_id: paymentId, iso_status: input.iso_status, return_reason: input.return_reason, trace_id: input.traceId }
      };
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        ev.event_id,
        ev.org_id,
        ev.trade_id ?? null,
        ev.type,
        ev.trace_id,
        ev.actor ?? null,
        JSON.stringify(ev.data ?? {})
      ]);
    }

    await client.query('UPDATE webhook_events SET processed_at=now() WHERE event_id=$1', [ins.rows[0]?.event_id]);
  });

  return { ok: true };
}

export async function handleConsentWebhook(
  pool: pg.Pool,
  input: { providerId: string; consentId: string; status: string; payload: any; signatureOk: boolean; dedupeKey: string; traceId: string }
): Promise<{ ok: boolean }> {
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: null });
    const res = await client.query('SELECT org_id FROM bank_consents WHERE consent_id=$1 LIMIT 1', [input.consentId]);
    const row = res.rows[0] as { org_id: string } | undefined;
    if (!row) return;

    await setAppContext(client, { userId: SYSTEM_USER_ID, orgId: row.org_id });

    const ins = await client.query<{ event_id: string }>(
      `INSERT INTO webhook_events(org_id, provider_id, topic, payload, signature_ok, dedupe_key)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (org_id, provider_id, topic, dedupe_key) DO NOTHING
       RETURNING event_id`,
      [row.org_id, input.providerId, 'consents', JSON.stringify(input.payload ?? {}), input.signatureOk, input.dedupeKey]
    );
    if (ins.rowCount === 0) return;

    await client.query('UPDATE bank_consents SET status=$1 WHERE consent_id=$2', [input.status, input.consentId]);

    const ev: SSEEvent = {
      event_id: crypto.randomUUID(),
      type: 'banks.consent.updated',
      ts: new Date().toISOString(),
      org_id: row.org_id,
      trade_id: undefined,
      trace_id: input.traceId,
      actor: `system:webhook:${input.providerId}`,
      data: { consent_id: input.consentId, status: input.status, trace_id: input.traceId }
    };
    await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
      ev.event_id,
      ev.org_id,
      null,
      ev.type,
      ev.trace_id,
      ev.actor ?? null,
      JSON.stringify(ev.data ?? {})
    ]);

    await client.query('UPDATE webhook_events SET processed_at=now() WHERE event_id=$1', [ins.rows[0]?.event_id]);
  });
  return { ok: true };
}
