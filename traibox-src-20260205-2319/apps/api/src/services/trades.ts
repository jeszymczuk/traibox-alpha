import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';

export async function listTrades(pool: pg.Pool, input: { orgId: string; userId: string }) {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const res = await client.query(
      `SELECT t.trade_id, t.title, t.corridor, t.status, t.created_at,
              (SELECT confidence FROM trade_plans p WHERE p.trade_id=t.trade_id ORDER BY created_at DESC LIMIT 1) AS confidence
       FROM trades t
       ORDER BY t.created_at DESC
       LIMIT 50`
    );
    return { trades: res.rows };
  });
}

export async function getTrade(pool: pg.Pool, input: { orgId: string; userId: string; tradeId: string }) {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const trade = await client.query('SELECT trade_id, title, corridor, amount, currency, status, created_at FROM trades WHERE trade_id=$1 LIMIT 1', [
      input.tradeId
    ]);
    const plan = await client.query('SELECT items, parties, terms, checklist, confidence, glass_box, created_at FROM trade_plans WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [
      input.tradeId
    ]);
    const compliance = await client.query('SELECT overall, risk_level, report_id, pdf_url, created_at FROM compliance_reports WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [
      input.tradeId
    ]);
    const offer_request = await client.query('SELECT request_id, status, created_at FROM offer_requests WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [
      input.tradeId
    ]);
    const offers = await client.query('SELECT offer_id, financier_name, apr_bps, fees, tenor_days, currency, sustainability_grade, sustainability_tag, created_at FROM finance_offers WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 20', [
      input.tradeId
    ]);
    const payments = await client.query('SELECT payment_id, scheme, status, iso_status, created_at FROM payments WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 5', [
      input.tradeId
    ]);
    const proofs = await client.query('SELECT bundle_url, root, manifest_sha256, created_at FROM proof_bundles WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [
      input.tradeId
    ]);
    return {
      trade: trade.rows[0] ?? null,
      plan: plan.rows[0] ?? null,
      compliance: compliance.rows[0] ?? null,
      offer_request: offer_request.rows[0] ?? null,
      offers: offers.rows,
      payments: payments.rows,
      proofs: proofs.rows[0] ?? null
    };
  });
}
