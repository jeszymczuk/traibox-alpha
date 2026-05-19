import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import { sha256Hex } from '@traibox/proof';

export async function scoreAllocation(pool: pg.Pool, input: { orgId: string; userId: string; traceId: string; input: any }) {
  const market = input.input.market as string;
  const tradeId = input.input.trade_id as string;
  const policyId = (input.input.policy_id as string) ?? 'fin_v1';
  const candidates = (input.input.candidates as any[]) ?? [];

  const prices = candidates.map((c) => Number(c.price ?? c.terms?.apr_bps ?? 0));
  const slas = candidates.map((c) => Number(c.sla ?? 0));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const minSla = Math.min(...slas);
  const maxSla = Math.max(...slas);

  const normLowerBetter = (v: number, min: number, max: number) => (max === min ? 1 : (max - v) / (max - min));
  const normHigherBetter = (v: number) => Math.max(0, Math.min(1, v));

  const ranking = candidates
    .map((c) => {
      const price = Number(c.price ?? c.terms?.apr_bps ?? 0);
      const sla = Number(c.sla ?? 0);
      const succ = Number(c.success_prob ?? 0.5);
      const risk = Number(c.risk ?? 0.1);
      const esg = Number(c.esg ?? 0.5);

      const score = 0.35 * normLowerBetter(price, minPrice, maxPrice) + 0.15 * normLowerBetter(sla, minSla, maxSla) + 0.2 * normHigherBetter(succ) - 0.1 * normHigherBetter(risk) + 0.05 * normHigherBetter(esg);

      const reasons = [
        `Price ${price}`,
        `SLA ${sla}`,
        `Success ${succ.toFixed(2)}`,
        `Risk ${risk.toFixed(2)}`,
        `ESG ${esg.toFixed(2)}`
      ];
      return { partner_id: c.partner_id, score: Number(score.toFixed(4)), reasons };
    })
    .sort((a, b) => b.score - a.score);

  const recommended = ranking[0]?.partner_id ?? null;
  const inputs_hash = sha256Hex(JSON.stringify({ market, tradeId, policyId, candidates }));

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query(
      'INSERT INTO allocation_decisions(trade_id, org_id, market, policy_id, inputs_hash, winner, ranking_json, reasons_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [tradeId, input.orgId, market, policyId, inputs_hash, recommended ?? 'none', JSON.stringify(ranking), JSON.stringify(ranking[0]?.reasons ?? [])]
    );
  });

  return { ranking, recommended, policy_id: policyId, trace_id: input.traceId };
}

