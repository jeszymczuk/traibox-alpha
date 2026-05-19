import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import type { UTGPartnerFeaturesRequest, UTGPartnerFeaturesResponse, UTGRecallRequest, UTGRecallResponse, UTGEdge, UTGNode } from '@traibox/contracts';

export async function utgRecall(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; body: UTGRecallRequest }
): Promise<UTGRecallResponse> {
  const { orgId, userId, traceId } = input;
  const tradeId = input.body.trade_id;

  const { trade, plan, offers, payments } = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const trade = await client.query(
      'SELECT trade_id, title, corridor, amount, currency, status, created_at FROM trades WHERE trade_id=$1 LIMIT 1',
      [tradeId]
    );
    const plan = await client.query(
      'SELECT items, parties, terms, confidence, glass_box, created_at FROM trade_plans WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1',
      [tradeId]
    );
    const offers = await client.query(
      'SELECT offer_id, financier_id, financier_name, apr_bps, sustainability_grade, sustainability_tag, allocation_json, created_at FROM finance_offers WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 10',
      [tradeId]
    );
    const payments = await client.query(
      'SELECT payment_id, scheme, status, created_at FROM payments WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 10',
      [tradeId]
    );
    return { trade: trade.rows[0] ?? null, plan: plan.rows[0] ?? null, offers: offers.rows, payments: payments.rows };
  });

  if (!trade) {
    const e: any = new Error('Trade not found');
    e.statusCode = 404;
    e.code = 'not_found';
    throw e;
  }

  const nodes: UTGNode[] = [];
  const edges: UTGEdge[] = [];

  const tradeNodeId = String(trade.trade_id);
  nodes.push({
    id: tradeNodeId,
    label: 'Trade',
    props: {
      trade_id: trade.trade_id,
      title: trade.title,
      corridor: trade.corridor,
      status: trade.status,
      amount: trade.amount,
      currency: trade.currency,
      created_at: trade.created_at
    }
  });

  if (trade.corridor) {
    const corridorId = `corridor:${trade.corridor}`;
    nodes.push({ id: corridorId, label: 'Corridor', props: { code: trade.corridor } });
    edges.push({ from: tradeNodeId, to: corridorId, type: 'SHIPS_TO', props: { code: trade.corridor } });
  }

  const items: any[] = Array.isArray(plan?.items) ? plan.items : [];
  items.forEach((it, idx) => {
    const id = `product:${idx}:${String(it.hs_code ?? it.name ?? 'unknown')}`;
    nodes.push({ id, label: 'Product', props: { name: it.name, hs_code: it.hs_code, nace_code: it.nace_code, qty: it.qty, unit: it.unit } });
    edges.push({ from: tradeNodeId, to: id, type: 'INVOLVES', props: { idx } });
  });

  const parties: any[] = Array.isArray(plan?.parties) ? plan.parties : [];
  parties.forEach((p, idx) => {
    const stable = String(p.lei ?? p.name ?? p.country ?? idx);
    const id = `entity:${String(p.role ?? 'other')}:${stable}`;
    nodes.push({ id, label: 'Entity', props: { role: p.role, name: p.name, country: p.country, lei: p.lei } });
    edges.push({ from: id, to: tradeNodeId, type: 'PARTICIPATES_AS', props: { role: p.role } });
  });

  offers.forEach((o: any) => {
    const providerId = `provider:finance:${String(o.financier_id ?? o.financier_name ?? 'unknown')}`;
    if (!nodes.some((n) => n.id === providerId)) {
      nodes.push({ id: providerId, label: 'Provider', props: { partner_id: o.financier_id, domain: 'finance', name: o.financier_name } });
    }
    edges.push({ from: tradeNodeId, to: providerId, type: 'MATCHED', props: { score: o.allocation_json?.score, reasons: o.allocation_json?.reasons } });
  });

  payments.forEach((p: any) => {
    const paymentId = `payment:${String(p.payment_id)}`;
    nodes.push({ id: paymentId, label: 'Payment', props: { payment_id: p.payment_id, scheme: p.scheme, status: p.status, created_at: p.created_at } });
    edges.push({ from: tradeNodeId, to: paymentId, type: 'PAYMENT', props: { scheme: p.scheme } });
  });

  // Keep it bounded for UI. We do not implement hops-based traversal yet (Postgres stub).
  const limit = typeof input.body.limit_nodes === 'number' && input.body.limit_nodes > 0 ? input.body.limit_nodes : 200;
  const boundedNodes = nodes.slice(0, limit);
  const allowed = new Set(boundedNodes.map((n) => n.id));
  const boundedEdges = edges.filter((e) => allowed.has(e.from) && allowed.has(e.to));

  return { nodes: boundedNodes, edges: boundedEdges, trace_id: traceId };
}

export async function utgPartnerFeatures(
  pool: pg.Pool,
  input: { orgId: string; userId: string; traceId: string; body: UTGPartnerFeaturesRequest }
): Promise<UTGPartnerFeaturesResponse> {
  const { orgId, userId, traceId } = input;
  const tradeId = input.body.trade_id;

  const { corridor, partnersById } = await withTx(pool, async (client) => {
    await setAppContext(client, { userId, orgId });
    const trade = await client.query('SELECT corridor FROM trades WHERE trade_id=$1 LIMIT 1', [tradeId]);
    const corridor = (trade.rows[0]?.corridor as string | null | undefined) ?? null;

    const partnerIds = input.body.partner_ids.filter(Boolean);
    const uuidPartnerIds = partnerIds.filter(isUuidLike);
    const partners = uuidPartnerIds.length
      ? await client.query(
          'SELECT partner_id, display_name, domains, corridors, rails, stf_ready FROM partners WHERE partner_id = ANY($1::uuid[])',
          [uuidPartnerIds]
        )
      : { rows: [] as any[] };
    const byId = new Map<string, any>();
    for (const p of partners.rows) byId.set(String(p.partner_id), p);
    return { corridor, partnersById: byId };
  });

  const features = input.body.partner_ids.map((pid) => {
    const p = partnersById.get(pid) ?? null;
    const corridors: string[] = Array.isArray(p?.corridors) ? p.corridors : [];
    const rails: string[] = Array.isArray(p?.rails) ? p.rails : [];
    const domains: string[] = Array.isArray(p?.domains) ? p.domains : [];

    const fit = corridor && corridors.includes(corridor) ? 1 : corridor ? 0.4 : 0.5;
    const capability =
      input.body.domain === 'payments'
        ? rails.length > 0
          ? 0.9
          : 0.4
        : domains.includes(String(input.body.domain))
          ? 0.9
          : 0.5;
    const performance = 0.6;
    const trust = 0.8;
    const esg = p?.stf_ready ? 0.9 : 0.4;
    const net_proximity = 0.0;

    const reasons: string[] = [];
    if (corridor && corridors.includes(corridor)) reasons.push(`Corridor ${corridor}`);
    if (p?.stf_ready) reasons.push('STF-ready');
    if (input.body.domain === 'payments' && rails.includes('SEPA_INSTANT')) reasons.push('SEPA Instant');
    if (input.body.domain && domains.includes(String(input.body.domain))) reasons.push(`Supports ${input.body.domain}`);
    if (!p) reasons.push('Unknown partner (stub features)');

    return { partner_id: pid, fit, capability, performance, trust, esg, net_proximity, reasons };
  });

  return { features, trace_id: traceId };
}

function isUuidLike(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}
