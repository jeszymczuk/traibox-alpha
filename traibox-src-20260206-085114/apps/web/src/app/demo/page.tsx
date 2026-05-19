'use client';

import { BadgeCheck, FileDown, FileText, HandCoins, Receipt, ShieldCheck, WalletCards } from 'lucide-react';

import { AppShell } from '../../components/shell';
import { ChatPane } from '../../components/chat-pane';
import { TradeCard } from '../../components/trade-card';
import { WorkspaceGrid } from '../../components/workspace-grid';
import { Button } from '../../components/ui/button';
import { Surface } from '../../components/ui/surface';
import { StatusDot } from '../../components/ui/status';
import { useTradeWorkflow } from '../../features/trade/use-trade-workflow';

export default function DemoPage() {
  const wf = useTradeWorkflow({ mode: 'demo' });
  const orgs = [{ org_id: 'demo-org', name: 'Demo Exporters' }];

  const plan = wf.snapshot?.plan ?? null;
  const compliance = wf.snapshot?.compliance ?? null;
  const offers = wf.snapshot?.offers ?? [];
  const reservation = wf.snapshot?.reservation ?? null;
  const anchor = wf.lastProofs?.anchor ?? null;

  return (
    <AppShell
      orgId="demo-org"
      orgs={orgs}
      onOrgChange={() => {}}
      headerRight={<div className="text-sm text-muted">UI Demo Mode</div>}
    >
      <div className="p-6 max-w-6xl mx-auto">
        <WorkspaceGrid
          left={
            <ChatPane
              title={wf.title}
              subtitle={wf.subtitle}
              messages={wf.messages.length ? wf.messages : [{ role: 'assistant', text: 'Describe a trade and I’ll turn it into a plan.' }]}
              placeholder="Ask TRAIBOX…"
              onSend={(text) => wf.actions.sendChat(text)}
            />
          }
          right={
            <>
              <Surface className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">Happy Path — PT↔ES</div>
                    <div className="text-xs text-muted mt-1">One flow, five cards. Click next to advance.</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => wf.actions.resetDemo()}>
                    Reset
                  </Button>
                </div>

                {wf.demo ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={wf.demo.intentText}
                      onChange={(e) => wf.demo?.setIntentText(e.target.value)}
                      className="w-full rounded-xl border border-border/10 px-3 py-2 bg-surface2 min-h-[88px] text-sm"
                      placeholder="Trade intent…"
                    />
                    <Button
                      onClick={() => wf.actions.runNextCta()}
                      disabled={wf.demo.nextCta.action === 'none' || wf.demo.nextCta.disabled}
                      className="w-full"
                    >
                      {wf.demo.nextCta.label}
                    </Button>
                  </div>
                ) : null}
              </Surface>

              <TradeCard
                icon={<FileText className="h-4 w-4" />}
                title="Trade Plan"
                status={wf.cards.plan.status}
                traceId={undefined}
                primary={{
                  label: plan ? 'Copy plan JSON' : 'Generate plan',
                  onClick: () => {
                    if (!plan) return wf.actions.runNextCta();
                    void navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
                  }
                }}
                glassBox={wf.cards.plan.reasons}
              >
                {plan ? (
                  <div className="text-sm space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Items</div>
                      <div className="text-sm font-medium text-right">{plan.items.length}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Incoterm</div>
                      <div className="text-sm font-medium text-right">{plan.terms?.incoterm ?? '—'}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Confidence</div>
                      <div className="text-sm font-medium text-right">
                        {typeof plan.confidence === 'number' ? `${Math.round(plan.confidence * 100)}%` : '—'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Describe a trade in chat to generate a plan.</p>
                )}
              </TradeCard>

              <TradeCard
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Compliance"
                status={wf.cards.compliance.status}
                traceId={undefined}
                primary={{
                  label: 'Run compliance',
                  onClick: () => wf.actions.runCompliance(),
                  disabled: !plan || Boolean(compliance)
                }}
                secondary={
                  compliance?.pdf_url
                    ? {
                        label: 'Download report',
                        icon: <FileDown className="h-4 w-4" />,
                        onClick: () => window.alert('Demo mode: report download is a placeholder.')
                      }
                    : undefined
                }
              >
                {compliance ? (
                  <div className="text-sm space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Overall</div>
                      <div className="text-sm font-medium text-right">{compliance.overall}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Risk</div>
                      <div className="text-sm font-medium text-right">{compliance.risk_level ?? '—'}</div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Run checks to get a clear answer with evidence.</p>
                )}
              </TradeCard>

              <TradeCard
                icon={<HandCoins className="h-4 w-4" />}
                title="Finance (PriME + STF)"
                status={wf.cards.finance.status}
                traceId={undefined}
                primary={{
                  label: reservation ? 'Accepted' : wf.cards.finance.recommendedOfferId ? 'Accept recommended' : 'Request offers',
                  onClick: () => (wf.cards.finance.recommendedOfferId ? wf.actions.acceptRecommended() : wf.actions.requestOffers()),
                  disabled: !compliance || Boolean(reservation)
                }}
                glassBox={wf.cards.finance.recommendedReasons}
              >
                {offers.length ? (
                  <div className="space-y-2">
                    {offers.map((o) => {
                      const isRec = o.offer_id === wf.cards.finance.recommendedOfferId;
                      const reasons = Array.isArray((o as any).allocation_json?.reasons)
                        ? (o as any).allocation_json.reasons
                        : Array.isArray(o.explanations)
                          ? o.explanations
                          : [];
                      return (
                        <div key={o.offer_id} className="rounded-xl border border-border/10 bg-surface2/40 p-3">
                          <div className="flex items-center justify-between">
                            <div className="font-medium text-sm">
                              {o.financier_name}
                              {isRec ? (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs text-accent font-medium">
                                  <BadgeCheck className="h-4 w-4" /> Recommended
                                </span>
                              ) : null}
                            </div>
                            <span className="text-xs text-muted">{o.sustainability_grade}</span>
                          </div>
                          <div className="text-xs text-muted mt-1">
                            APR {o.apr_bps} bps • Fees {o.fees} • Tenor {o.tenor_days}d
                          </div>
                          {reasons.length ? (
                            <ul className="mt-2 text-xs text-muted list-disc pl-4">
                              {reasons.slice(0, 3).map((r: string, idx: number) => (
                                <li key={idx}>{r}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                    {reservation ? (
                      <div className="text-xs text-muted">
                        Reservation: {reservation.offer_id} • expires {new Date(reservation.expires_at).toLocaleTimeString()}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Request offers and compare terms with “why recommended”.</p>
                )}
              </TradeCard>

              <TradeCard
                icon={<WalletCards className="h-4 w-4" />}
                title="Payments"
                status={wf.cards.payments.status}
                traceId={undefined}
                primary={{
                  label: wf.accounts.length === 0 ? 'Connect bank' : wf.routes.length === 0 ? 'Compute routes' : wf.cards.payments.latestStatusRaw === 'pending_sca' ? 'Complete SCA' : 'Execute payment',
                  onClick: () => {
                    if (wf.accounts.length === 0) return wf.actions.connectBank();
                    if (wf.routes.length === 0) return wf.actions.computeRoutes();
                    if (wf.cards.payments.latestStatusRaw === 'pending_sca') return wf.actions.completeSca();
                    return wf.actions.executePayment();
                  }
                }}
              >
                <div className="space-y-3">
                  {wf.accounts.length ? (
                    <div className="flex gap-2">
                      <select
                        value={wf.selectedAccountId}
                        onChange={(e) => wf.setSelectedAccountId(e.target.value)}
                        className="flex-1 rounded-xl border border-border/10 bg-surface2 px-2 py-2 text-sm"
                      >
                        <option value="">Select account…</option>
                        {wf.accounts.map((a) => (
                          <option key={a.account_id} value={a.account_id}>
                            {a.name ?? a.iban}
                          </option>
                        ))}
                      </select>
                      <div className="inline-flex items-center gap-2 text-xs text-muted">
                        <StatusDot tone={wf.accounts.length ? 'success' : 'neutral'} /> linked
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">Connect a bank to compute routes and execute a payment.</p>
                  )}

                  {wf.routes.length ? (
                    <div className="flex gap-2">
                      <select
                        value={wf.selectedRouteId}
                        onChange={(e) => wf.setSelectedRouteId(e.target.value)}
                        className="flex-1 rounded-xl border border-border/10 bg-surface2 px-2 py-2 text-sm"
                      >
                        <option value="">Select route…</option>
                        {wf.routes.map((r) => (
                          <option key={r.route_id} value={r.route_id}>
                            {r.scheme} • fee {r.fee}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {wf.lastPayment?.redirect_url ? (
                    <div className="text-xs text-muted space-y-2">
                      <div className="break-all">Redirect URL: {wf.lastPayment.redirect_url}</div>
                      <a className="text-accent font-medium text-sm" href={wf.lastPayment.redirect_url} target="_blank" rel="noreferrer">
                        Continue SCA
                      </a>
                    </div>
                  ) : null}

                  {wf.cards.payments.latestPaymentId ? (
                    <div className="text-xs text-muted">
                      Latest payment: {wf.cards.payments.latestPaymentId} • {wf.cards.payments.latestStatusRaw}
                    </div>
                  ) : null}
                </div>
              </TradeCard>

              <TradeCard
                icon={<Receipt className="h-4 w-4" />}
                title="Proofs"
                status={wf.cards.proofs.status}
                traceId={undefined}
                primary={{
                  label: 'Build proof pack',
                  onClick: () => wf.actions.buildProofPack(),
                  disabled: wf.cards.payments.latestStatusRaw !== 'executed'
                }}
                secondary={
                  wf.lastProofs?.bundle_url
                    ? {
                        label: 'Download ZIP',
                        icon: <FileDown className="h-4 w-4" />,
                        onClick: () => window.alert('Demo mode: bundle download is a placeholder.')
                      }
                    : undefined
                }
              >
                <div className="space-y-2">
                  <div className="text-xs text-muted break-all">Root: {wf.lastProofs?.root ?? '—'}</div>
                  {anchor ? (
                    <div className="text-xs text-muted break-all">
                      Anchor: {anchor.status} {anchor.tx_hash ? `• ${anchor.tx_hash}` : ''}
                    </div>
                  ) : null}
                </div>
              </TradeCard>

              <details className="rounded-2xl border border-border/10 bg-surface1/60 px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted select-none">Debug events</summary>
                <ul className="mt-3 space-y-2">
                  {wf.events.slice(0, 25).map((e) => (
                    <li key={e.event_id} className="rounded-xl border border-border/10 bg-surface2/40 p-3 text-xs">
                      <div className="font-medium">{e.type}</div>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(e.data, null, 2)}</pre>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          }
        />
      </div>
    </AppShell>
  );
}

