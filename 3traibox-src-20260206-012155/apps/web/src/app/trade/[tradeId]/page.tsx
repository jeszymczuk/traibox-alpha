'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileDown, FileText, HandCoins, Receipt, ShieldCheck, WalletCards } from 'lucide-react';

import { AppShell } from '../../../components/shell';
import { useOrgSelection } from '../../../components/use-org';
import { api } from '../../../lib/api';
import { Surface } from '../../../components/ui/surface';
import { Button, buttonClassName } from '../../../components/ui/button';
import { TradeCard } from '../../../components/trade-card';
import { ChatPane } from '../../../components/chat-pane';
import { WorkspaceGrid } from '../../../components/workspace-grid';

export default function TradePage({ params }: { params: { tradeId: string } }) {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const tradeId = params.tradeId;
  const [trade, setTrade] = useState<any>(null);
  const [events, setEvents] = useState<Array<any>>([]);
  const [messages, setMessages] = useState<Array<any>>([]);
  const [accounts, setAccounts] = useState<Array<any>>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [routes, setRoutes] = useState<Array<any>>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [payment, setPayment] = useState<any>(null);
  const [proofs, setProofs] = useState<any>(null);

  const refreshTrade = useCallback(async (oid: string) => {
    const r = await api.getTrade(oid, tradeId);
    setTrade(r);
  }, [tradeId]);

  const refreshMessages = useCallback(async (oid: string) => {
    const r = await api.listTradeMessages(oid, tradeId, 200);
    setMessages(r.messages ?? []);
  }, [tradeId]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!orgId) return;
    void (async () => {
      await refreshTrade(orgId);
      await refreshMessages(orgId);
      const a = await api.listAccounts(orgId);
      setAccounts(a.accounts ?? []);
      if (!selectedAccountId && a.accounts?.[0]?.account_id) setSelectedAccountId(a.accounts[0].account_id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId, tradeId]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!orgId) return;
    const url = api.eventsUrl({ orgId, tradeId });
    const es = new EventSource(url);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data);
        setEvents((prev) => [ev, ...prev].slice(0, 200));
        const t = String(ev?.type ?? '');
        if (
          t === 'plan.generated' ||
          t.startsWith('compliance.') ||
          t === 'offers.ready' ||
          t.startsWith('payment.') ||
          t.startsWith('ledger.')
        ) {
          void refreshTrade(orgId);
        }
        if (t === 'trade.message.created') {
          void refreshMessages(orgId);
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [auth.status, orgId, tradeId, refreshTrade, refreshMessages]);

  const chatMessages = useMemo(() => {
    const base = Array.isArray(messages) ? messages : [];
    if (base.length > 0) return base;
    return [{ role: 'assistant', text: 'Describe the trade and TRAIBOX will guide the next steps.' }];
  }, [messages]);

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

  const plan = trade?.plan ?? null;
  const planReasons = (plan?.glass_box?.reasons as string[] | undefined) ?? [];

  const complianceOverall = String(trade?.compliance?.overall ?? '');
  const complianceStatus =
    complianceOverall === 'passed'
      ? { label: 'Passed', tone: 'success' as const }
      : complianceOverall === 'warnings'
        ? { label: 'Warnings', tone: 'warn' as const }
        : complianceOverall === 'failed'
          ? { label: 'Failed', tone: 'error' as const }
          : { label: 'Idle', tone: 'neutral' as const };

  const offerRequestStatus = String(trade?.offer_request?.status ?? '');
  const offersCount = Array.isArray(trade?.offers) ? trade.offers.length : 0;
  const allocationRanking = Array.isArray(trade?.allocation?.ranking_json) ? trade.allocation.ranking_json : [];
  const recommendedOfferId = allocationRanking?.[0]?.offer_id ?? null;
  const recommendedReasons = Array.isArray(allocationRanking?.[0]?.reasons) ? allocationRanking[0].reasons : [];

  const financeStatus =
    trade?.reservation
      ? { label: 'Accepted', tone: 'success' as const }
      : offersCount > 0
        ? { label: 'Offers ready', tone: 'success' as const }
        : offerRequestStatus === 'pending'
          ? { label: 'Requesting', tone: 'loading' as const }
          : { label: 'Idle', tone: 'neutral' as const };

  const latestPayment = Array.isArray(trade?.payments) && trade.payments.length > 0 ? trade.payments[0] : null;
  const paymentStatusRaw = String(latestPayment?.status ?? '');
  const paymentStatus =
    paymentStatusRaw === 'executed'
      ? { label: 'Executed', tone: 'success' as const }
      : paymentStatusRaw === 'pending_sca' || paymentStatusRaw === 'executing' || paymentStatusRaw === 'authorized'
        ? { label: paymentStatusRaw.replaceAll('_', ' '), tone: 'loading' as const }
        : paymentStatusRaw === 'failed' || paymentStatusRaw === 'returned'
          ? { label: paymentStatusRaw, tone: 'error' as const }
          : { label: latestPayment ? paymentStatusRaw : 'Idle', tone: latestPayment ? ('neutral' as const) : ('neutral' as const) };

  const proofsStatus = trade?.proofs?.bundle_url
    ? { label: 'Ready', tone: 'success' as const }
    : { label: 'Idle', tone: 'neutral' as const };

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
              title={trade?.trade?.title ?? 'Trade workspace'}
              subtitle={trade?.trade?.corridor ? `Corridor ${trade.trade.corridor}` : 'Chat-first workspace'}
              messages={chatMessages}
              placeholder="Ask TRAIBOX…"
              disabled={!orgId}
              onSend={async (text) => {
                if (!orgId) return;
                await api.postTradeMessage(orgId, tradeId, text);
                await refreshMessages(orgId);
              }}
            />
          }
          right={
            <>
              <TradeCard
            icon={<FileText className="h-4 w-4" />}
            title="Trade Plan"
            status={plan ? { label: 'Ready', tone: 'success' } : { label: 'Idle', tone: 'neutral' }}
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
              },
              disabled: false
            }}
            glassBox={planReasons}
          >
            {plan ? (
              <div className="text-sm space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Items</div>
                  <div className="text-sm font-medium text-right">
                    {Array.isArray(plan.items) ? plan.items.length : 0}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Corridor</div>
                  <div className="text-sm font-medium text-right">{trade?.trade?.corridor ?? '—'}</div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-muted">Confidence</div>
                  <div className="text-sm font-medium text-right">
                    {typeof plan.confidence === 'number' ? `${Math.round(plan.confidence * 100)}%` : '—'}
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
            status={complianceStatus}
            traceId={undefined}
            primary={{
              label: 'Run compliance',
              onClick: async () => {
                if (!orgId) return;
                await api.runCompliance(orgId, { trade_id: tradeId });
                await refreshTrade(orgId);
              },
              disabled: !orgId || !plan
            }}
            secondary={
              trade?.compliance?.pdf_url && orgId
                ? {
                    label: 'Download report',
                    icon: <FileDown className="h-4 w-4" />,
                    href: api.downloadUrl(orgId, trade.compliance.pdf_url)
                  }
                : undefined
            }
            glassBox={undefined}
          >
            <div className="text-sm space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted">Overall</div>
                <div className="text-sm font-medium text-right">{trade?.compliance?.overall ?? '—'}</div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted">Risk</div>
                <div className="text-sm font-medium text-right">{trade?.compliance?.risk_level ?? '—'}</div>
              </div>
            </div>
          </TradeCard>

          <TradeCard
            icon={<HandCoins className="h-4 w-4" />}
            title="Finance (PriME + STF)"
            status={financeStatus}
            traceId={undefined}
            primary={{
              label: trade?.reservation ? 'Accepted' : recommendedOfferId ? 'Accept recommended' : 'Request offers',
              onClick: async () => {
                if (!orgId) return;
                if (trade?.reservation) return;
                if (recommendedOfferId) {
                  await api.acceptOffer(orgId, recommendedOfferId);
                  await refreshTrade(orgId);
                  return;
                }
                await api.requestOffers(orgId, {
                  trade_id: tradeId,
                  amount: 12000,
                  tenor_days: 30,
                  sustainable: { enabled: true, path: 'uop', minimum_grade: 'eligible' }
                });
                await refreshTrade(orgId);
              },
              disabled: !orgId || !plan || Boolean(trade?.reservation)
            }}
            glassBox={recommendedReasons}
          >
            <div className="space-y-3">
              <div className="text-sm">
                Request status: <span className="font-medium">{trade?.offer_request?.status ?? '—'}</span>
              </div>

              {trade?.reservation ? (
                <div className="text-xs text-muted">
                  Reservation: {trade.reservation.offer_id} • expires {new Date(trade.reservation.expires_at).toLocaleString()}
                </div>
              ) : null}

              {offerRequestStatus === 'pending' && offersCount === 0 ? (
                <p className="text-sm text-muted">
                  Waiting for partner offers… (request {trade?.offer_request?.request_id})
                </p>
              ) : null}

              {offersCount > 0 ? (
                <ul className="space-y-2">
                  {trade.offers.map((o: any) => {
                    const isRecommended = o.offer_id === recommendedOfferId;
                    const reasons = Array.isArray(o.allocation_json?.reasons) ? o.allocation_json.reasons : Array.isArray(o.explanations) ? o.explanations : [];
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
                            onClick={async () => {
                              if (!orgId) return;
                              await api.acceptOffer(orgId, o.offer_id);
                              await refreshTrade(orgId);
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
            title="Payments"
            status={paymentStatus}
            traceId={undefined}
            primary={{
              label: 'Connect bank',
              onClick: async () => {
                if (!orgId) return;
                const resp = await api.linkBank(orgId, {
                  type: 'AIS',
                  provider: 'truelayer',
                  trade_id: tradeId,
                  redirect_url: `${window.location.origin}/banks/callback`
                });
                if (typeof resp?.auth_url === 'string' && resp.auth_url.includes('truelayer')) {
                  window.location.href = resp.auth_url;
                  return;
                }
                const a = await api.listAccounts(orgId);
                setAccounts(a.accounts ?? []);
                if (!selectedAccountId && a.accounts?.[0]?.account_id) setSelectedAccountId(a.accounts[0].account_id);
              },
              disabled: !orgId
            }}
            secondary={{
              label: 'Add manual',
              onClick: async () => {
                if (!orgId) return;
                const iban = window.prompt('IBAN for the sending account (manual)', 'PT50');
                if (!iban) return;
                const bankName = window.prompt('Bank name (optional)', 'Manual');
                await api.createManualAccount(orgId, { iban, currency: 'EUR', name: 'Manual EUR', bank_name: bankName ?? undefined });
                const a = await api.listAccounts(orgId);
                setAccounts(a.accounts ?? []);
                const created = (a.accounts ?? []).find((x: any) => (x.provider_id ?? '') === 'manual');
                if (created?.account_id) setSelectedAccountId(created.account_id);
              }
            }}
            glassBox={undefined}
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="flex-1 rounded-xl border border-border/10 bg-surface2 px-2 py-2 text-sm"
                >
                  <option value="">Select account…</option>
                  {accounts.map((a) => (
                    <option key={a.account_id} value={a.account_id}>
                      {a.name ?? a.iban}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!selectedAccountId || !orgId}
                  onClick={async () => {
                    if (!orgId) return;
                    const r = await api.routes(orgId, {
                      trade_id: tradeId,
                      from_account_id: selectedAccountId,
                      to_iban: 'ES9121000418450200051332',
                      amount: 120,
                      currency: 'EUR',
                      urgency: 'instant'
                    });
                    setRoutes(r.routes ?? []);
                    const rec = (r.routes ?? []).find((x: any) => x.recommended)?.route_id;
                    if (rec) setSelectedRouteId(rec);
                  }}
                >
                  Compute routes
                </Button>
                <select
                  value={selectedRouteId}
                  onChange={(e) => setSelectedRouteId(e.target.value)}
                  className="flex-1 rounded-xl border border-border/10 bg-surface2 px-2 py-2 text-sm"
                >
                  <option value="">Select route…</option>
                  {routes.map((r) => (
                    <option key={r.route_id} value={r.route_id}>
                      {r.scheme} • fee {r.fee}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="ink"
                  size="sm"
                  disabled={!selectedAccountId || !selectedRouteId || !orgId}
                  onClick={async () => {
                    if (!orgId) return;
                    const p = await api.executePayment(orgId, {
                      trade_id: tradeId,
                      route_id: selectedRouteId,
                      from_account_id: selectedAccountId,
                      creditor_name: 'ACME SL',
                      creditor_iban: 'ES9121000418450200051332',
                      amount: 120,
                      currency: 'EUR',
                      remittance: 'TRAIBOX demo',
                      e2e_id: crypto.randomUUID()
                    });
                    setPayment(p);
                    await refreshTrade(orgId);
                  }}
                >
                  Execute payment
                </Button>
                {payment?.payment_id && String(payment.scheme ?? '').startsWith('MANUAL') ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      if (!orgId) return;
                      await api.completeManualPayment(orgId, payment.payment_id, 'executed');
                      await refreshTrade(orgId);
                    }}
                  >
                    Mark executed
                  </Button>
                ) : null}
              </div>

              {payment?.redirect_url ? (
                <div className="text-xs text-muted space-y-2">
                  <div className="break-all">Redirect URL: {payment.redirect_url}</div>
                  {/^https?:\/\//.test(payment.redirect_url) ? (
                    <a className={buttonClassName({ variant: 'primary', size: 'sm' })} href={payment.redirect_url} target="_blank" rel="noreferrer">
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
            status={proofsStatus}
            traceId={undefined}
            primary={{
              label: 'Build proof pack',
              onClick: async () => {
                if (!orgId) return;
                const r = await api.getProofs(orgId, tradeId);
                setProofs(r);
                await refreshTrade(orgId);
              },
              disabled: !orgId
            }}
            secondary={
              orgId && (proofs?.bundle_url || trade?.proofs?.bundle_url)
                ? {
                    label: 'Download ZIP',
                    icon: <FileDown className="h-4 w-4" />,
                    href: api.downloadUrl(orgId, (proofs?.bundle_url ?? trade?.proofs?.bundle_url) as string)
                  }
                : undefined
            }
            glassBox={undefined}
          >
            <div className="space-y-2">
              <div className="text-xs text-muted break-all">
                Root: {proofs?.root ?? trade?.proofs?.root ?? '—'}
              </div>
              {proofs?.anchor ? (
                <div className="text-xs text-muted break-all">
                  Anchor: {proofs.anchor.status} {proofs.anchor.tx_hash ? `• ${proofs.anchor.tx_hash}` : ''}
                </div>
              ) : null}
            </div>
          </TradeCard>
          <details className="rounded-2xl border border-border/10 bg-surface1/60 px-4 py-3">
            <summary className="cursor-pointer text-xs text-muted select-none">Debug events</summary>
            <ul className="mt-3 space-y-2">
              {events.slice(0, 25).map((e) => (
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
