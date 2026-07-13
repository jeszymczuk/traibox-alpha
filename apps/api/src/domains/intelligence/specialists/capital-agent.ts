import type pg from 'pg';
import type { AlphaObject } from '@traibox/contracts';
import { getTrade } from '../../../services/trades';
import { queryAlphaObjects } from '../../../services/alpha';

/**
 * Capital Agent worker: assembles a financing packet from what the org's trade
 * book actually contains. Read-only — every source is an existing RLS-safe
 * service call; composition is pure so it stays hermetically testable.
 *
 * Provenance discipline: the relational finance layer (finance_offers,
 * allocation_decisions via getTrade) and the alpha-object funding layer
 * (funding_request / funding_offer payloads) are disconnected systems whose ids
 * never cross over. The packet labels each side and never joins them.
 */

export type FinancingPacketOffer = {
  offer_id: string;
  financier_name: string;
  apr_bps: number | null;
  tenor_days: number | null;
  currency: string | null;
  sustainability_grade: string | null;
};

export type FinancingPacket = {
  kind: 'financing_packet';
  trade: {
    trade_id: string;
    title: string;
    corridor: string | null;
    amount: number | null;
    currency: string | null;
    status: string;
  } | null;
  offers: FinancingPacketOffer[];
  allocation: { winner: string | null; reasons: string[] } | null;
  funding_requests: Array<{
    object_id: string;
    title: string;
    status: string;
    amount: number | null;
    currency: string | null;
    missing: string[];
  }>;
  evidence_checklist: Array<{ item: string; label: string; present: boolean }>;
  readiness_gaps: string[];
  indicative: { amount: number | null; currency: string | null; tenor_days: number } | null;
  provenance: { relational: string[]; alpha_objects: string[] };
};

type TradeDetail = Awaited<ReturnType<typeof getTrade>>;

/** Evidence a financier expects behind a funding request (finance-readiness pack). */
const EVIDENCE_ITEMS: Array<{ item: string; label: string }> = [
  { item: 'purchase_order', label: 'Purchase order' },
  { item: 'commercial_invoice', label: 'Commercial invoice' },
  { item: 'buyer_tax_id', label: 'Buyer tax / VAT identifier' },
  { item: 'acceptance_proof', label: 'Buyer acceptance proof' },
  { item: 'approval_chain', label: 'Internal approval chain' }
];

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** Pure packet composition — inputs are plain data, no I/O. */
export function composeFinancingPacket(input: {
  tradeDetail: TradeDetail | null;
  fundingObjects: AlphaObject[];
  offerObjects: AlphaObject[];
}): FinancingPacket {
  const detail = input.tradeDetail;
  const trade = detail?.trade
    ? {
        trade_id: String(detail.trade.trade_id),
        title: String(detail.trade.title ?? 'Untitled trade'),
        corridor: str(detail.trade.corridor),
        amount: num(detail.trade.amount),
        currency: str(detail.trade.currency),
        status: String(detail.trade.status ?? 'unknown')
      }
    : null;

  const offers: FinancingPacketOffer[] = (detail?.offers ?? []).map((offer: Record<string, unknown>) => ({
    offer_id: String(offer.offer_id),
    financier_name: String(offer.financier_name ?? 'Unnamed financier'),
    apr_bps: num(offer.apr_bps),
    tenor_days: num(offer.tenor_days),
    currency: str(offer.currency),
    sustainability_grade: str(offer.sustainability_grade)
  }));

  const allocationRow = detail?.allocation as Record<string, unknown> | null | undefined;
  const allocation = allocationRow
    ? {
        winner: str(allocationRow.winner),
        reasons: Array.isArray(allocationRow.reasons_json) ? allocationRow.reasons_json.map((r) => String(r)) : []
      }
    : null;

  const fundingRequests = input.fundingObjects.map((object) => {
    const payload = object.payload_json ?? {};
    return {
      object_id: object.object_id,
      title: object.title,
      status: object.status,
      amount: num(payload.amount),
      currency: str(payload.currency),
      missing: Array.isArray(payload.missing) ? payload.missing.map((m) => String(m)) : []
    };
  });

  // Evidence presence: only claim what the book actually shows. Compliance and a
  // trade plan are visible via getTrade; document items stay "to collect" until a
  // document pipeline can vouch for them.
  const missingAcrossRequests = new Set(fundingRequests.flatMap((request) => request.missing));
  const evidenceChecklist = EVIDENCE_ITEMS.map(({ item, label }) => ({
    item,
    label,
    present: item === 'approval_chain' ? false : !missingAcrossRequests.has(item) && hasEvidenceInTrade(detail, item)
  }));

  const readinessGaps: string[] = [];
  if (!trade) readinessGaps.push('No trade in focus — packet is org-level; focus a trade for offer and plan context.');
  if (trade && !detail?.plan) readinessGaps.push('No trade plan on record for the focused trade.');
  if (trade && !detail?.compliance) readinessGaps.push('No compliance report on record for the focused trade.');
  if (!offers.length && trade) readinessGaps.push('No finance offers captured yet for the focused trade.');
  for (const entry of evidenceChecklist) {
    if (!entry.present) readinessGaps.push(`Evidence to collect: ${entry.label}.`);
  }

  const indicative = trade
    ? { amount: trade.amount, currency: trade.currency, tenor_days: 90 }
    : fundingRequests.length
      ? { amount: fundingRequests[0]!.amount, currency: fundingRequests[0]!.currency, tenor_days: 90 }
      : null;

  return {
    kind: 'financing_packet',
    trade,
    offers,
    allocation,
    funding_requests: fundingRequests,
    evidence_checklist: evidenceChecklist,
    readiness_gaps: readinessGaps,
    indicative,
    provenance: {
      relational: ['trades', 'trade_plans', 'compliance_reports', 'finance_offers', 'allocation_decisions'],
      alpha_objects: ['funding_request', 'funding_offer']
    }
  };
}

function hasEvidenceInTrade(detail: TradeDetail | null, item: string): boolean {
  if (!detail) return false;
  // The relational layer can vouch for plan/compliance-backed context only.
  if (item === 'purchase_order' || item === 'commercial_invoice') {
    const checklist = (detail.plan as Record<string, unknown> | null)?.checklist;
    return Array.isArray(checklist) && checklist.some((entry) => String(entry).toLowerCase().includes(item.replace('_', ' ').split(' ')[1] ?? item));
  }
  if (item === 'buyer_tax_id') return false;
  if (item === 'acceptance_proof') return Boolean(detail.proofs);
  return false;
}

/**
 * Gather + compose. onStep fires per tool so the caller can stream progress and
 * append replay entries. All reads run under the caller's org context (each
 * service opens its own RLS-scoped tx).
 */
export async function buildFinancingPacket(
  pool: pg.Pool,
  actor: { orgId: string; userId: string },
  ctx: { tradeId?: string | null },
  onStep: (step: { tool: string; label: string }) => void | Promise<void>
): Promise<FinancingPacket> {
  await onStep({ tool: 'memory.query', label: 'Reading funding book (funding requests & offers)' });
  const [fundingObjects, offerObjects] = await Promise.all([
    queryAlphaObjects(pool, { ...actor, traceId: 'trc_agent_read', query: { type: 'funding_request', limit: 20 } }).then((r) => r.objects),
    queryAlphaObjects(pool, { ...actor, traceId: 'trc_agent_read', query: { type: 'funding_offer', limit: 20 } }).then((r) => r.objects)
  ]);

  let tradeDetail: TradeDetail | null = null;
  if (ctx.tradeId) {
    await onStep({ tool: 'readiness.evaluate', label: 'Reading focused trade: plan, compliance, offers, allocation' });
    tradeDetail = await getTrade(pool, { ...actor, tradeId: ctx.tradeId });
  }

  await onStep({ tool: 'funding.prepare', label: 'Assembling the financing packet' });
  const packet = composeFinancingPacket({ tradeDetail, fundingObjects, offerObjects });

  await onStep({ tool: 'attachments.suggest', label: 'Building the evidence checklist' });
  return packet;
}

/** Compact grounding block embedded in the LLM prompt (never user-visible verbatim). */
export function packetGrounding(packet: FinancingPacket): string {
  return [
    'GROUNDING DATA (the trader\'s actual trade book — base every number and claim on this):',
    '```json',
    JSON.stringify(
      {
        trade: packet.trade,
        offers: packet.offers,
        allocation: packet.allocation,
        funding_requests: packet.funding_requests,
        evidence_checklist: packet.evidence_checklist,
        readiness_gaps: packet.readiness_gaps,
        indicative: packet.indicative
      },
      null,
      1
    ),
    '```'
  ].join('\n');
}

/** Deterministic markdown narrative — the honest fallback when the LLM sidecar is down. */
export function packetToMarkdown(packet: FinancingPacket): string {
  const lines: string[] = ['# Financing Packet'];
  if (packet.trade) {
    lines.push(
      `**Trade:** ${packet.trade.title} (${packet.trade.corridor ?? 'corridor n/a'}) — ` +
        `${packet.trade.amount != null ? `${packet.trade.amount.toLocaleString()} ${packet.trade.currency ?? ''}` : 'amount n/a'} · status ${packet.trade.status}`
    );
  } else {
    lines.push('**Scope:** org-level funding book (no trade in focus).');
  }
  if (packet.offers.length) {
    lines.push('', '## Offers on record');
    for (const offer of packet.offers) {
      lines.push(`- **${offer.financier_name}** — ${offer.apr_bps != null ? `${(offer.apr_bps / 100).toFixed(2)}% APR` : 'APR n/a'}, ${offer.tenor_days ?? '—'} days${offer.sustainability_grade ? `, grade ${offer.sustainability_grade}` : ''}`);
    }
  }
  if (packet.funding_requests.length) {
    lines.push('', '## Funding requests in the book');
    for (const request of packet.funding_requests) {
      lines.push(`- ${request.title} — status ${request.status}${request.amount != null ? `, ${request.amount.toLocaleString()} ${request.currency ?? ''}` : ''}`);
    }
  }
  lines.push('', '## Evidence checklist');
  for (const entry of packet.evidence_checklist) {
    lines.push(`- ${entry.present ? '✓' : '○'} ${entry.label}`);
  }
  if (packet.readiness_gaps.length) {
    lines.push('', '## Gaps to close');
    for (const gap of packet.readiness_gaps) lines.push(`- ${gap}`);
  }
  lines.push('', '_Submitting the funding request is a protected action — it needs your explicit approval._');
  return lines.join('\n');
}
