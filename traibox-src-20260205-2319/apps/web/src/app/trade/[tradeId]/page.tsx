'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '../../../components/shell';
import { useAuth } from '../../../components/providers';
import { api } from '../../../lib/api';
import Link from 'next/link';

export default function TradePage({ params }: { params: { tradeId: string } }) {
  const auth = useAuth();
  const tradeId = params.tradeId;
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<Array<any>>([]);
  const [trade, setTrade] = useState<any>(null);
  const [events, setEvents] = useState<Array<any>>([]);
  const [accounts, setAccounts] = useState<Array<any>>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [routes, setRoutes] = useState<Array<any>>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [payment, setPayment] = useState<any>(null);
  const [proofs, setProofs] = useState<any>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    void (async () => {
      const list = await api.listOrgs();
      setOrgs(list.orgs ?? []);
      const saved = localStorage.getItem('traibox_org_id');
      if (saved) setOrgId(saved);
    })();
  }, [auth.status]);

  const refreshTrade = useCallback(async (oid: string) => {
    const r = await api.getTrade(oid, tradeId);
    setTrade(r);
  }, [tradeId]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!orgId) return;
    localStorage.setItem('traibox_org_id', orgId);
    void (async () => {
      await refreshTrade(orgId);
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
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [auth.status, orgId, tradeId, refreshTrade]);

  const selectedOrg = useMemo(() => orgs.find((o) => o.org_id === orgId) ?? null, [orgs, orgId]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper text-ink p-6">Loading…</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper text-ink p-6">
        <div className="max-w-xl mx-auto rounded-2xl bg-white shadow-sm border border-black/5 p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="text-sm text-muted mt-2">Please sign in to view this trade.</p>
          <Link className="inline-flex mt-4 rounded-xl bg-accent text-white px-4 py-2 font-medium" href="/login">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId} headerRight={<div className="text-sm text-muted">{selectedOrg?.name ?? 'Select org'}</div>}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
          <h1 className="text-xl font-semibold">{trade?.trade?.title ?? 'Trade'}</h1>
          <div className="text-sm text-muted mt-1">{trade?.trade?.corridor ?? ''}</div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card title="Plan">
            <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(trade?.plan, null, 2)}</pre>
          </Card>

          <Card title="Compliance">
            {!orgId ? (
              <p className="text-sm text-muted">Select an org.</p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  Status:{' '}
                  <span className="font-medium">{trade?.compliance?.overall ?? '—'}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded-xl bg-ink text-paper px-3 py-2 text-sm"
                    onClick={async () => {
                      await api.runCompliance(orgId, { trade_id: tradeId });
                      await refreshTrade(orgId);
                    }}
                  >
                    Run compliance
                  </button>
                  {trade?.compliance?.pdf_url ? (
                    <a
                      className="rounded-xl border border-black/10 px-3 py-2 text-sm"
                      href={api.downloadUrl(orgId, trade.compliance.pdf_url)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Download report
                    </a>
                  ) : null}
                </div>
              </div>
            )}
          </Card>

          <Card title="Finance">
            {!orgId ? (
              <p className="text-sm text-muted">Select an org.</p>
            ) : (
              <div className="space-y-3">
                <div className="text-sm">
                  Request status:{' '}
                  <span className="font-medium">{trade?.offer_request?.status ?? '—'}</span>
                </div>
                <button
                  className="rounded-xl bg-ink text-paper px-3 py-2 text-sm"
                  onClick={async () => {
                    await api.requestOffers(orgId, { trade_id: tradeId, amount: 12000, tenor_days: 30, sustainable: { enabled: true, path: 'uop', minimum_grade: 'eligible' } });
                    await refreshTrade(orgId);
                  }}
                >
                  Request offers
                </button>
                {trade?.offer_request?.status === 'pending' && (!Array.isArray(trade?.offers) || trade.offers.length === 0) ? (
                  <p className="text-sm text-muted">
                    Waiting for partner offers… (request {trade.offer_request.request_id})
                  </p>
                ) : null}
                {Array.isArray(trade?.offers) && trade.offers.length > 0 ? (
                  <ul className="space-y-2">
                    {trade.offers.map((o: any) => (
                      <li key={o.offer_id} className="rounded-xl border border-black/10 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <div className="font-medium">{o.financier_name}</div>
                          <div className="text-xs text-muted">{o.sustainability_grade ?? '—'}</div>
                        </div>
                        <div className="text-xs text-muted mt-1">
                          APR {o.apr_bps} bps • Fees {o.fees}
                        </div>
                        <div className="mt-2">
                          <button
                            className="rounded-xl border border-black/10 px-3 py-2 text-xs"
                            onClick={async () => {
                              await api.acceptOffer(orgId, o.offer_id);
                              await refreshTrade(orgId);
                            }}
                          >
                            Accept
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No offers yet.</p>
                )}
              </div>
            )}
          </Card>

          <Card title="Payments">
            {!orgId ? (
              <p className="text-sm text-muted">Select an org.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-xl bg-ink text-paper px-3 py-2 text-sm"
                    onClick={async () => {
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
                      if (a.accounts?.[0]?.account_id) setSelectedAccountId(a.accounts[0].account_id);
                    }}
                  >
                    Connect bank
                  </button>
                  <button
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm"
                    onClick={async () => {
                      const iban = window.prompt('IBAN for the sending account (manual)', 'PT50');
                      if (!iban) return;
                      const bankName = window.prompt('Bank name (optional)', 'Manual');
                      await api.createManualAccount(orgId, { iban, currency: 'EUR', name: 'Manual EUR', bank_name: bankName ?? undefined });
                      const a = await api.listAccounts(orgId);
                      setAccounts(a.accounts ?? []);
                      const created = (a.accounts ?? []).find((x: any) => (x.provider_id ?? '') === 'manual');
                      if (created?.account_id) setSelectedAccountId(created.account_id);
                    }}
                  >
                    Add manual account
                  </button>
                  <select
                    value={selectedAccountId}
                    onChange={(e) => setSelectedAccountId(e.target.value)}
                    className="flex-1 rounded-xl border border-black/10 bg-paper px-2 py-2 text-sm"
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
                  <button
                    disabled={!selectedAccountId}
                    className="rounded-xl border border-black/10 px-3 py-2 text-sm disabled:opacity-50"
                    onClick={async () => {
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
                  </button>
                  <select
                    value={selectedRouteId}
                    onChange={(e) => setSelectedRouteId(e.target.value)}
                    className="flex-1 rounded-xl border border-black/10 bg-paper px-2 py-2 text-sm"
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
                  <button
                    disabled={!selectedAccountId || !selectedRouteId}
                    className="rounded-xl bg-ink text-paper px-3 py-2 text-sm disabled:opacity-50"
                    onClick={async () => {
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
                  </button>
                  {payment?.payment_id && String(payment.scheme ?? '').startsWith('MANUAL') ? (
                    <button
                      className="rounded-xl border border-black/10 px-3 py-2 text-sm"
                      onClick={async () => {
                        await api.completeManualPayment(orgId, payment.payment_id, 'executed');
                        await refreshTrade(orgId);
                      }}
                    >
                      Mark executed
                    </button>
                  ) : null}
                </div>

                {payment?.redirect_url ? (
                  <div className="text-xs text-muted space-y-2">
                    <div className="break-all">Redirect URL: {payment.redirect_url}</div>
                    {/^https?:\/\//.test(payment.redirect_url) ? (
                      <a className="inline-flex rounded-xl bg-accent text-white px-3 py-2 text-sm font-medium" href={payment.redirect_url} target="_blank" rel="noreferrer">
                        Continue SCA
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {Array.isArray(trade?.payments) && trade.payments.length > 0 ? (
                  <div className="text-xs text-muted">
                    Latest payment: {trade.payments[0].payment_id} • {trade.payments[0].status}
                  </div>
                ) : null}
              </div>
            )}
          </Card>

          <Card title="Proofs">
            {!orgId ? (
              <p className="text-sm text-muted">Select an org.</p>
            ) : (
              <div className="space-y-3">
                <button
                  className="rounded-xl bg-ink text-paper px-3 py-2 text-sm"
                  onClick={async () => {
                    const r = await api.getProofs(orgId, tradeId);
                    setProofs(r);
                  }}
                >
                  Build proof pack
                </button>
                {proofs?.bundle_url ? (
                  <div className="space-y-2">
                    <a className="text-sm text-accent font-medium" href={api.downloadUrl(orgId, proofs.bundle_url)} target="_blank" rel="noreferrer">
                      Download bundle ZIP
                    </a>
                    <div className="text-xs text-muted break-all">Root: {proofs.root}</div>
                    {proofs.anchor ? (
                      <div className="text-xs text-muted break-all">
                        Anchor: {proofs.anchor.status} {proofs.anchor.tx_hash ? `• ${proofs.anchor.tx_hash}` : ''}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        </section>

        <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
          <h2 className="text-lg font-semibold">Recent events</h2>
          <ul className="mt-3 space-y-2">
            {events.map((e) => (
              <li key={e.event_id} className="rounded-xl border border-black/10 p-3 text-xs">
                <div className="font-medium">{e.type}</div>
                <pre className="whitespace-pre-wrap">{JSON.stringify(e.data, null, 2)}</pre>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
      <div className="font-semibold">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}
