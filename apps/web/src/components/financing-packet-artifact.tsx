'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Circle, FileText, Maximize2, ShieldCheck, X } from 'lucide-react';
import { api } from '../lib/api';

/**
 * Financing-packet artifact: inline expandable card in the chat stream with a
 * pop-out right sheet. Data arrives on the SSE `artifact` frame and is persisted
 * inside the chat transcript in localStorage — every field is optional and
 * render-guarded so old/partial transcripts never crash the page.
 */

type PacketOffer = {
  offer_id?: string;
  financier_name?: string;
  apr_bps?: number | null;
  tenor_days?: number | null;
  currency?: string | null;
  sustainability_grade?: string | null;
};

type Packet = {
  trade?: { trade_id?: string; title?: string; corridor?: string | null; amount?: number | null; currency?: string | null; status?: string } | null;
  offers?: PacketOffer[];
  allocation?: { winner?: string | null; reasons?: string[] } | null;
  funding_requests?: Array<{ object_id?: string; title?: string; status?: string; amount?: number | null; currency?: string | null }>;
  evidence_checklist?: Array<{ item?: string; label?: string; present?: boolean }>;
  readiness_gaps?: string[];
  indicative?: { amount?: number | null; currency?: string | null; tenor_days?: number } | null;
};

export type FinancingPacketArtifactData = {
  kind?: string;
  agent?: string;
  packet?: Packet;
  funding_request_id?: string;
  agent_task_id?: string;
  proposed_action?: { kind?: string; object_id?: string; trade_id?: string | null } | null;
};

function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '—';
  return `${amount.toLocaleString()} ${currency ?? ''}`.trim();
}

function PacketBody({ packet, dense }: { packet: Packet; dense: boolean }) {
  const offers = packet.offers ?? [];
  const checklist = packet.evidence_checklist ?? [];
  const gaps = packet.readiness_gaps ?? [];
  return (
    <>
      {packet.trade ? (
        <div className="af-row af-trade">
          <span className="af-row-main">{packet.trade.title ?? 'Trade'}</span>
          <span className="af-row-meta">
            {packet.trade.corridor ?? ''} · {money(packet.trade.amount, packet.trade.currency)}
          </span>
        </div>
      ) : (
        <div className="af-row af-trade">
          <span className="af-row-main">Org funding book</span>
          <span className="af-row-meta">no trade in focus</span>
        </div>
      )}
      {packet.indicative ? (
        <div className="af-indicative">
          Indicative: <strong>{money(packet.indicative.amount, packet.indicative.currency)}</strong>
          {packet.indicative.tenor_days ? <> · {packet.indicative.tenor_days} days</> : null}
        </div>
      ) : null}

      {offers.length > 0 ? (
        <section className="af-section">
          <h4 className="af-h">Offers on record</h4>
          {offers.slice(0, dense ? 3 : 20).map((offer, i) => (
            <div className="af-row" key={offer.offer_id ?? i}>
              <span className="af-row-main">{offer.financier_name ?? 'Financier'}</span>
              <span className="af-row-meta">
                {offer.apr_bps != null ? `${(offer.apr_bps / 100).toFixed(2)}%` : '—'} · {offer.tenor_days ?? '—'}d
                {offer.sustainability_grade ? ` · ${offer.sustainability_grade}` : ''}
              </span>
            </div>
          ))}
        </section>
      ) : null}

      {checklist.length > 0 ? (
        <section className="af-section">
          <h4 className="af-h">Evidence pack</h4>
          {checklist.map((entry, i) => (
            <div className="af-row" key={entry.item ?? i}>
              <span className="af-row-main af-check">
                {entry.present ? <CheckCircle2 className="af-ic ok" /> : <Circle className="af-ic todo" />}
                {entry.label ?? entry.item}
              </span>
              <span className="af-row-meta">{entry.present ? 'on record' : 'to collect'}</span>
            </div>
          ))}
        </section>
      ) : null}

      {gaps.length > 0 ? (
        dense ? (
          <details className="af-gaps">
            <summary>
              {gaps.length} gap{gaps.length === 1 ? '' : 's'} to close
            </summary>
            <ul>
              {gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
          </details>
        ) : (
          <section className="af-section">
            <h4 className="af-h">Gaps to close</h4>
            <ul className="af-gaps-list">
              {gaps.map((gap, i) => (
                <li key={i}>{gap}</li>
              ))}
            </ul>
          </section>
        )
      ) : null}
    </>
  );
}

export function FinancingPacketArtifact({ data, orgId }: { data: FinancingPacketArtifactData; orgId: string | null }) {
  const [open, setOpen] = useState(false);
  const [approval, setApproval] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const openerRef = useRef<HTMLButtonElement | null>(null);

  // Pop-out sheet: Escape closes and focus returns to the opener.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        openerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const packet = data.packet;
  if (!packet) return null;
  const action = data.proposed_action;

  const requestApproval = async () => {
    if (!orgId || !action?.kind || !action.object_id || approval === 'sending' || approval === 'sent') return;
    setApproval('sending');
    try {
      await api.requestAlphaApproval(orgId, {
        target: { type: 'funding_request', id: action.object_id },
        protected_action: action.kind as never,
        proposed_action: 'Submit the assembled financing packet as a funding request.',
        rationale: 'The Capital Agent prepared this packet; submission is a protected action that needs your explicit approval.',
        evidence_refs: [{ object_id: action.object_id, role: 'funding_request' }]
      });
      setApproval('sent');
    } catch {
      setApproval('error');
    }
  };

  const approvalButton =
    action?.kind === 'submit_funding_request' ? (
      <button type="button" className="af-approve" onClick={() => void requestApproval()} disabled={approval === 'sending' || approval === 'sent'}>
        <ShieldCheck className="af-ic" />
        {approval === 'sent' ? 'Approval requested — check your queue' : approval === 'sending' ? 'Requesting…' : approval === 'error' ? 'Request failed — try again' : 'Request approval to submit'}
      </button>
    ) : null;

  return (
    <>
      <div className="af-card cs-reveal">
        <header className="af-head">
          <span className="af-badge">
            <FileText className="af-ic" />
          </span>
          <span className="af-title">Financing packet</span>
          <button
            type="button"
            ref={openerRef}
            className="af-open"
            title="Open packet"
            aria-label="Open the financing packet in a panel"
            onClick={() => setOpen(true)}
          >
            <Maximize2 className="af-ic" />
          </button>
        </header>
        <div className="af-body">
          <PacketBody packet={packet} dense />
          {approvalButton}
        </div>
      </div>

      {open ? (
        <div
          className="af-scrim"
          onClick={() => {
            setOpen(false);
            openerRef.current?.focus();
          }}
        >
          <aside
            className="af-sheet"
            role="dialog"
            aria-label="Financing packet"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="af-head">
              <span className="af-badge">
                <FileText className="af-ic" />
              </span>
              <span className="af-title">Financing packet</span>
              {data.funding_request_id ? <span className="af-id">{data.funding_request_id.slice(0, 8)}</span> : null}
              <button
                type="button"
                className="af-open"
                title="Close"
                aria-label="Close the packet panel"
                onClick={() => {
                  setOpen(false);
                  openerRef.current?.focus();
                }}
              >
                <X className="af-ic" />
              </button>
            </header>
            <div className="af-body af-sheet-body scroll-thin">
              <PacketBody packet={packet} dense={false} />
              {approvalButton}
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
