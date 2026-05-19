'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { FileDown, FileText, HandCoins, Receipt, ShieldCheck, WalletCards } from 'lucide-react';

import { AppShell } from '../../../components/shell';
import { useOrgSelection } from '../../../components/use-org';
import { api } from '../../../lib/api';
import { Surface } from '../../../components/ui/surface';
import { Button, buttonClassName } from '../../../components/ui/button';
import { TradeCard } from '../../../components/trade-card';
import { ChatPane } from '../../../components/chat-pane';
import { WorkspaceGrid } from '../../../components/workspace-grid';
import { useTradeWorkflow } from '../../../features/trade/use-trade-workflow';

export default function TradePage({ params }: { params: { tradeId: string } }) {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const tradeId = params.tradeId;

  const wf = useTradeWorkflow({ mode: 'live', enabled: auth.status === 'authenticated' && Boolean(orgId), orgId, tradeId });

  const chatMessages = useMemo(() => {
    if (wf.messages.length > 0) return wf.messages;
    return [{ role: 'assistant', text: 'Describe the trade and TRAIBOX will guide the next steps.' }];
  }, [wf.messages]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper text-ink p-6">Loading…</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper text-ink p-6">
        <Surface className="max-w-xl mx-auto p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="text-sm text-muted mt-2">Please sign in to view this trade.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  const plan = wf.snapshot?.plan ?? null;
  const compliance = wf.snapshot?.compliance ?? null;
  const offers = wf.snapshot?.offers ?? [];
  const reservation = wf.snapshot?.reservation ?? null;
  const latestPayment = Array.isArray(wf.snapshot?.payments) && wf.snapshot.payments.length > 0 ? wf.snapshot.payments[0] : null;

  return (
    <AppShell
      orgId={orgId}
      orgs={orgs}
      onOrgChange={setOrgId}
      headerRight={<div className="text-sm text-muted">{selectedOrg?.name ?? 'Select org'}</div>}
    >
      <div className="p-6 max-w-6xl mx-auto">
        <WorkspaceGrid
          left={
            <ChatPane
              title={wf.title}
              subtitle={wf.subtitle}
              messages={chatMessages}
              placeholder="Ask TRAIBOX…"
              disabled={!orgId}
              onSend={async (text) => {
                await wf.actions.sendChat(text);
              }}
            />
          }
          right={
            <>
              <TradeCard
                icon={<FileText className="h-4 w-4" />}
                title="Trade Plan"
                status={wf.cards.plan.status}
                traceId={undefined}
                primary={{
                  label: plan ? 'Copy plan JSON' : 'Copy example intent',
                  onClick: async () => {
                    try {
                      if (plan) await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
                      else await navigator.clipboard.writeText('Sell 100 cases of wine to Madrid; 50% advance; ship next week');
                    } catch {
                      // ignore
                    }
                  }
                }}
                glassBox={wf.cards.plan.reasons}
              >
                {plan ? (
                  <div className="text-sm space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Items</div>
                      <div className="text-sm font-medium text-right">{Array.isArray(plan.items) ? plan.items.length : 0}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Corridor</div>
                      <div className="text-sm font-medium text-right">{wf.snapshot?.trade?.corridor ?? '—'}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Confidence</div>
                      <div className="text-sm font-medium text-right">
                        {plan.confidence == null ? '—' : `${Math.round(Number(plan.confidence) * 100)}%`}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Plan not found.</p>
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
                  disabled: !orgId || !plan
                }}
                secondary={
                  compliance?.pdf_url && orgId
                    ? {
                        label: 'Download report',
                        icon: <FileDown className="h-4 w-4" />,
                        href: api.downloadUrl(orgId, compliance.pdf_url)
                      }
                    : undefined
                }
              >
                <div className="text-sm space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Overall</div>
                    <div className="text-sm font-medium text-right">{compliance?.overall ?? '—'}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Risk</div>
                    <div className="text-sm font-medium text-right">{compliance?.risk_level ?? '—'}</div>
                  </div>
                </div>
              </TradeCard>

              <TradeCard
                icon={<HandCoins className="h-4 w-4" />}
                title="Finance (PriME + STF)"
                status={wf.cards.finance.status}
                traceId={undefined}
                primary={{
                  label: reservation ? 'Accepted' : wf.cards.finance.recommendedOfferId ? 'Accept recommended' : 'Request offers',
                  onClick: async () => {
                    if (reservation) return;
                    if (wf.cards.finance.recommendedOfferId) return wf.actions.acceptRecommended();
                    return wf.actions.requestOffers();
                  },
                  disabled: !orgId || !plan || Boolean(reservation)
                }}
                glassBox={wf.cards.finance.recommendedReasons}
              >
                <div className="space-y-3">
                  <div className="text-sm">
                    Request status: <span className="font-medium">{wf.snapshot?.offer_request?.status ?? '—'}</span>
                  </div>

                  {reservation ? (
                    <div className="text-xs text-muted">
                      Reservation: {reservation.offer_id} • expires {new Date(reservation.expires_at).toLocaleString()}
                    </div>
                  ) : null}

                  {wf.snapshot?.offer_request?.status === 'pending' && offers.length === 0 ? (
                    <p className="text-sm text-muted">
                      Waiting for partner offers… (request {wf.snapshot?.offer_request?.request_id})
                    </p>
                  ) : null}

                  {offers.length > 0 ? (
                    <ul className="space-y-2">
                      {offers.map((o: any) => {
                        const isRecommended = o.offer_id === wf.cards.finance.recommendedOfferId;
                        const reasons = Array.isArray(o.allocation_json?.reasons)
                          ? o.allocation_json.reasons
                          : Array.isArray(o.explanations)
                            ? o.explanations
                            : [];
                        return (
                          <li key={o.offer_id} className="rounded-xl border border-border/10 bg-surface2/40 p-3 text-sm">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">
                                {o.financier_name}
                                {isRecommended ? <span className="ml-2 text-xs text-accent font-medium">Recommended</span> : null}
                              </div>
                              <div className="text-xs text-muted">{o.sustainability_grade ?? '—'}</div>
                            </div>
                            <div className="text-xs text-muted mt-1">
                              APR {o.apr_bps} bps • Fees {o.fees} • Tenor {o.tenor_days}d
                            </div>
                            {reasons.length > 0 ? (
                              <ul className="mt-2 text-xs text-muted list-disc pl-4">
                                {reasons.slice(0, 3).map((r: string, idx: number) => (
                                  <li key={idx}>{r}</li>
                                ))}
                              </ul>
                            ) : null}
                            <div className="mt-2">
                              <Button
                                variant={isRecommended ? 'primary' : 'secondary'}
                                size="sm"
                                disabled={Boolean(reservation)}
                                onClick={async () => {
                                  if (!orgId) return;
                                  await api.acceptOffer(orgId, o.offer_id);
                                  await wf.actions.refresh();
                                }}
                              >
                                Accept
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">No offers yet.</p>
                  )}
                </div>
              </TradeCard>

              <TradeCard
                icon={<WalletCards className="h-4 w-4" />}
                title="Payments (TrueLayer + fallback)"
                status={wf.cards.payments.status}
                traceId={undefined}
                primary={{
                  label: wf.accounts.length ? 'Compute routes' : 'Connect bank',
                  onClick: async () => {
                    if (wf.accounts.length === 0) return wf.actions.connectBank();
                    return wf.actions.computeRoutes();
                  },
                  disabled: !orgId || !plan
                }}
              >
                <div className="space-y-3">
                  <div className="text-sm text-muted">
                    {wf.accounts.length === 0 ? (
                      <span>No linked bank accounts. Connect via TrueLayer or use manual fallback.</span>
                    ) : (
                      <span>Linked accounts: {wf.accounts.length}</span>
                    )}
                  </div>

                  {wf.accounts.length > 0 ? (
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
                    </div>
                  ) : null}

                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={!wf.selectedAccountId || !orgId} onClick={() => wf.actions.computeRoutes()}>
                      Compute routes
                    </Button>
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

                  <div className="flex gap-2">
                    <Button variant="ink" size="sm" disabled={!wf.selectedAccountId || !wf.selectedRouteId || !orgId} onClick={() => wf.actions.executePayment()}>
                      Execute payment
                    </Button>
                    {wf.lastPayment?.payment_id && String(wf.lastPayment.scheme ?? '').startsWith('MANUAL') ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          if (!orgId) return;
                          await api.completeManualPayment(orgId, wf.lastPayment!.payment_id, 'executed');
                          await wf.actions.refresh();
                        }}
                      >
                        Mark executed
                      </Button>
                    ) : null}
                  </div>

                  {wf.lastPayment?.redirect_url ? (
                    <div className="text-xs text-muted space-y-2">
                      <div className="break-all">Redirect URL: {wf.lastPayment.redirect_url}</div>
                      {/^https?:\/\//.test(wf.lastPayment.redirect_url) ? (
                        <a className={buttonClassName({ variant: 'primary', size: 'sm' })} href={wf.lastPayment.redirect_url} target="_blank" rel="noreferrer">
                          Continue SCA
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {latestPayment?.payment_id ? (
                    <div className="text-xs text-muted">
                      Latest payment: {latestPayment.payment_id} • {latestPayment.status}
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
                  disabled: !orgId
                }}
                secondary={
                  orgId && (wf.lastProofs?.bundle_url || wf.snapshot?.proofs?.bundle_url)
                    ? {
                        label: 'Download ZIP',
                        icon: <FileDown className="h-4 w-4" />,
                        href: api.downloadUrl(orgId, (wf.lastProofs?.bundle_url ?? wf.snapshot?.proofs?.bundle_url) as string)
                      }
                    : undefined
                }
              >
                <div className="space-y-2">
                  <div className="text-xs text-muted break-all">Root: {wf.lastProofs?.root ?? wf.snapshot?.proofs?.root ?? '—'}</div>
                  {wf.lastProofs?.anchor ? (
                    <div className="text-xs text-muted break-all">
                      Anchor: {wf.lastProofs.anchor.status} {wf.lastProofs.anchor.tx_hash ? `• ${wf.lastProofs.anchor.tx_hash}` : ''}
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
