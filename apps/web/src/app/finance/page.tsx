'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  ChartPie,
  Check,
  CheckCircle2,
  Circle,
  CircleDollarSign,
  Clock,
  LayoutDashboard,
  Leaf,
  Loader2,
  Lock,
  Package,
  ShieldCheck,
  Sparkles,
  Wallet
} from 'lucide-react';
import type { AlphaObject, BankAccount, FinanceOfferItem, FinanceReservationItem, FundingRequestItem, TradeSummary } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type FinTab = 'overview' | 'funding' | 'escrow';

const INSTRUMENT_TYPES = new Set(['trade_finance_instrument', 'payment_intent']);

function money(amount: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: amount >= 10_000 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en')} ${currency}`;
  }
}

function pct(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 1 : 2)}%`;
}

function shortRef(prefix: string, id: string) {
  return `${prefix}-${id.slice(0, 8).toUpperCase()}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export default function FinancePage() {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [tab, setTab] = useState<FinTab>('overview');
  const [requests, setRequests] = useState<FundingRequestItem[]>([]);
  const [reservations, setReservations] = useState<FinanceReservationItem[]>([]);
  const [instruments, setInstruments] = useState<AlphaObject[]>([]);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [liquid, setLiquid] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    try {
      const [funding, tradeRes, objectRes] = await Promise.all([
        api.listFunding(orgId),
        api.listTrades(orgId),
        api.queryAlphaObjects(orgId, { limit: 180 })
      ]);
      setRequests(funding.requests ?? []);
      setReservations(funding.reservations ?? []);
      setTrades(tradeRes.trades ?? []);
      setInstruments((objectRes.objects ?? []).filter((o) => INSTRUMENT_TYPES.has(o.type)));
      setLastSync(new Date());
      void (async () => {
        try {
          const acctRes = await api.listAccounts(orgId);
          const balances = await Promise.allSettled(
            (acctRes.accounts ?? [])
              .filter((a: BankAccount) => a.currency === 'EUR')
              .map(async (a: BankAccount) => {
                const b = await api.getAccountBalance(orgId, a.account_id);
                return Number(b.balance?.available ?? b.balance?.booked ?? 0);
              })
          );
          setLiquid(
            balances
              .filter((b): b is PromiseFulfilledResult<number> => b.status === 'fulfilled')
              .reduce((s, b) => s + (Number.isFinite(b.value) ? b.value : 0), 0)
          );
        } catch {
          setLiquid(null);
        }
      })();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Finance workspace');
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const reservedOfferIds = new Set(reservations.filter((r) => r.status === 'active').map((r) => r.offer_id));
  const openRequests = requests.filter((r) => !r.offers.some((o) => reservedOfferIds.has(o.offer_id)));
  const awaitingDecision = openRequests.filter((r) => r.offers.length > 0);
  const awaitingOffers = openRequests.filter((r) => r.offers.length === 0);
  const activeFacilities = reservations.filter((r) => r.status === 'active');
  const deployed = activeFacilities.reduce((s, r) => s + (r.amount ?? 0), 0);
  const pendingValue = awaitingDecision.reduce((s, r) => s + r.amount, 0);
  const allOpenOffers = awaitingDecision.flatMap((r) => r.offers);
  const bestOffer = allOpenOffers.length ? allOpenOffers.reduce((a, b) => (a.apr_bps <= b.apr_bps ? a : b)) : null;
  const expiringSoon = allOpenOffers.filter((o) => {
    const d = daysUntil(o.expires_at);
    return d !== null && d <= 1;
  });

  const syncLabel = lastSync ? `live · last sync ${lastSync.toLocaleTimeString('en-GB', { hour12: false })} UTC` : 'connecting…';

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="sub-rail">
        <button type="button" className={cn('sub-tab', tab === 'overview' && 'on')} onClick={() => setTab('overview')}>
          <LayoutDashboard className="h-3.5 w-3.5" /> Overview
        </button>
        <button type="button" className={cn('sub-tab', tab === 'funding' && 'on')} onClick={() => setTab('funding')}>
          <CircleDollarSign className="h-3.5 w-3.5" /> Funding
          {openRequests.length > 0 ? <span className="ct">{openRequests.length}</span> : null}
        </button>
        <button type="button" className={cn('sub-tab', tab === 'escrow' && 'on')} onClick={() => setTab('escrow')}>
          <Lock className="h-3.5 w-3.5" /> Escrow &amp; instruments
          {instruments.length > 0 ? <span className="ct">{instruments.length}</span> : null}
        </button>
        <Link href="/finance/portfolio" className="sub-tab">
          <ChartPie className="h-3.5 w-3.5" /> Portfolio
        </Link>
        <div className="right">{syncLabel}</div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
        {auth.status !== 'authenticated' ? (
          <EmptyBlock icon={<Lock className="h-6 w-6" />} title="Sign in to open Finance" body="Finance needs an authenticated session and an organization.">
            <Link href="/login" className="inline-block">
              <Button>Go to login</Button>
            </Link>
          </EmptyBlock>
        ) : !orgId ? (
          <EmptyBlock
            icon={<Wallet className="h-6 w-6" />}
            title="Select an organization"
            body="Pick an org in the sidebar to load funding, offers and instruments."
          />
        ) : error ? (
          <EmptyBlock icon={<AlertTriangle className="h-6 w-6" />} title="Couldn't load Finance" body={error}>
            <Button onClick={() => void refresh()}>Retry</Button>
          </EmptyBlock>
        ) : (
          <>
            {tab === 'overview' ? (
              <>
                <div className="fin-hero mt-6">
                  <div>
                    <div className="eyebrow">Working capital · live</div>
                    <h2>
                      {activeFacilities.length > 0
                        ? `${money(deployed)} reserved across ${activeFacilities.length} facilit${activeFacilities.length === 1 ? 'y' : 'ies'}.`
                        : 'No working capital deployed yet.'}{' '}
                      {awaitingDecision.length > 0
                        ? `${awaitingDecision.length} request${awaitingDecision.length === 1 ? '' : 's'} awaiting your decision.`
                        : awaitingOffers.length > 0
                          ? `${awaitingOffers.length} request${awaitingOffers.length === 1 ? '' : 's'} awaiting offers.`
                          : ''}
                    </h2>
                    <div className="sub">
                      Your working capital, your financiers, your offers — in one place. TRAIBOX ranks the offers across every financier
                      you&rsquo;ve invited; accepting one is always your decision.
                    </div>
                  </div>
                  <div className="hero-cta">
                    {pendingValue > 0 ? <div className="urgent-meta">{money(pendingValue)} · awaiting your decision</div> : null}
                    <Button
                      onClick={() => {
                        setTab('funding');
                        setFormOpen(true);
                      }}
                    >
                      <Archive className="h-4 w-4" /> New funding request
                    </Button>
                    <Link href="/payments" className="inline-block">
                      <Button variant="secondary">
                        <Wallet className="h-4 w-4" /> Open Payments
                      </Button>
                    </Link>
                  </div>
                </div>

                <div className="metrics-row">
                  <div className="metric">
                    <div className="num">{deployed > 0 ? money(deployed) : '—'}</div>
                    <div className="lbl">
                      Working capital · {activeFacilities.length} facilit{activeFacilities.length === 1 ? 'y' : 'ies'}
                    </div>
                  </div>
                  <div className="metric">
                    <div className="num cyan">{awaitingOffers.length}</div>
                    <div className="lbl">Awaiting financier response</div>
                  </div>
                  <div className="metric">
                    <div className="num good">{bestOffer ? pct(bestOffer.apr_bps) : '—'}</div>
                    <div className="lbl">{bestOffer ? `Lowest indicative · ${bestOffer.financier_name}` : 'Lowest indicative offer'}</div>
                  </div>
                  <div className="metric">
                    <div className={cn('num', expiringSoon.length > 0 && 'warn')}>{expiringSoon.length}</div>
                    <div className="lbl">Expiring offers · next 24h</div>
                  </div>
                </div>

                <div className="fin-sec">
                  Awaiting your decision{' '}
                  <span className="ct">
                    {awaitingDecision.length} request{awaitingDecision.length === 1 ? '' : 's'} with offers
                  </span>
                  <div className="right">
                    <a onClick={() => setTab('funding')}>All funding →</a>
                  </div>
                </div>
                {awaitingDecision.length === 0 ? (
                  <p className="px-1 text-sm text-text-3">Nothing waiting on you. Build a funding request and financier offers will be ranked here.</p>
                ) : (
                  awaitingDecision.slice(0, 3).map((r) => <RequestOpp key={r.request_id} request={r} onOpen={() => setTab('funding')} />)
                )}

                <div className="fin-sec">
                  Money &amp; runway
                  <div className="right">
                    <Link href="/payments" className="text-cyan-text">
                      Open Payments →
                    </Link>
                  </div>
                </div>
                <Link href="/payments" className="cash-pointer">
                  <div className="cp-ic">
                    <Wallet className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="cp-head">
                      {liquid !== null && liquid > 0 ? `${money(liquid)} liquid across your EUR accounts` : 'Connect accounts to see your runway'}
                    </div>
                    <div className="cp-sub">
                      Balances, payments, collections, FX — your day-to-day money operations live in the <b>Payments</b> module.
                    </div>
                  </div>
                  <div className="cp-cta">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>

                <div className="ai-note">
                  <div className="ib">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <b>Financiers are ranked privately for you.</b> Each one sees only the evidence they need to price your request —
                    nothing leaks across them. You confirm the offer you want to accept; AI alone never gates a protected action.{' '}
                    <Link href="/finance/workspace" className="text-cyan-text hover:underline">
                      Governed workspace →
                    </Link>
                  </div>
                </div>
              </>
            ) : null}

            {tab === 'funding' ? (
              <FundingTab
                orgId={orgId}
                requests={openRequests}
                facilities={activeFacilities}
                trades={trades}
                formOpen={formOpen}
                setFormOpen={setFormOpen}
                onRefresh={() => void refresh()}
              />
            ) : null}

            {tab === 'escrow' ? <EscrowTab instruments={instruments} /> : null}
          </>
        )}
      </div>
    </AppShell>
  );
}

/* ———————————————————————— Opportunity row ———————————————————————— */

function RequestOpp({ request, onOpen }: { request: FundingRequestItem; onOpen?: () => void }) {
  const best = request.offers[0] ?? null;
  const sustainable = Boolean((request.sustainable as any)?.enabled);
  const soonest = request.offers
    .map((o) => daysUntil(o.expires_at))
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b)[0];
  const financierCount = new Set(request.offers.map((o) => o.financier_id)).size;
  return (
    <div className={cn('opp', request.offers.length > 0 ? 'new' : 'review')} onClick={onOpen}>
      <div>
        <span className="pip" />
      </div>
      <div className="opp-body">
        <div>
          <div className="opp-head">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-cyan-soft text-cyan-text">
              <Package className="h-3.5 w-3.5" />
            </span>
            <span className="ttl">{request.trade_title || 'Funding request'}</span>
            <span className="id">{shortRef('REQ', request.request_id)}</span>
            <span className={cn('tag', request.offers.length > 0 ? 'new' : 'review')}>
              {request.offers.length > 0 ? `${request.offers.length} OFFER${request.offers.length === 1 ? '' : 'S'}` : 'AWAITING OFFERS'}
            </span>
            {sustainable ? (
              <span className="slf">
                <Leaf className="h-3 w-3" />
                SLF
              </span>
            ) : null}
          </div>
          <div className="opp-parties">
            Requested {fmtDate(request.created_at)} · Net {request.tenor_days}
          </div>
          <div className="opp-meta">
            {best ? (
              <>
                <div className="item">
                  <span className="lbl">Best offer</span>
                  <span className="v" style={{ color: 'var(--good)' }}>
                    {best.financier_name} · {pct(best.apr_bps)} all-in
                  </span>
                </div>
                <div className="item">
                  <span className="lbl">Ranked across</span>
                  <span className="v">
                    {financierCount} financier{financierCount === 1 ? '' : 's'}
                  </span>
                </div>
              </>
            ) : (
              <div className="item">
                <span className="lbl">Status</span>
                <span className="v">{request.status}</span>
              </div>
            )}
            {soonest !== undefined && soonest <= 2 ? (
              <span className={cn('deadline', soonest <= 0 ? 'bad' : 'warn')}>
                <Clock className="h-3 w-3" />
                {soonest <= 0 ? 'best offer expiring' : `offers expire in ${soonest}d`}
              </span>
            ) : null}
          </div>
        </div>
        <div className="opp-right">
          <div className="opp-value">{money(request.amount, request.currency)}</div>
          <div className="opp-risk">
            <div className="terms">
              {best ? (
                <>
                  <div className="all-in">{pct(best.apr_bps)} all-in</div>
                  <div>
                    fees {money(best.fees, best.currency)} · {best.tenor_days}d
                  </div>
                </>
              ) : (
                <div>tenor {request.tenor_days}d</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ———————————————————————— Funding tab ———————————————————————— */

function FundingTab({
  orgId,
  requests,
  facilities,
  trades,
  formOpen,
  setFormOpen,
  onRefresh
}: {
  orgId: string;
  requests: FundingRequestItem[];
  facilities: FinanceReservationItem[];
  trades: TradeSummary[];
  formOpen: boolean;
  setFormOpen: (v: boolean) => void;
  onRefresh: () => void;
}) {
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function accept(offer: FinanceOfferItem) {
    setAccepting(offer.offer_id);
    setNotice(null);
    try {
      const res = await api.acceptOffer(orgId, offer.offer_id);
      setNotice(
        `Offer accepted — funds reserved with ${offer.financier_name} until ${new Date(res.reservation.expires_at).toLocaleTimeString('en-GB', { hour12: false })}.`
      );
      onRefresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not accept offer');
    } finally {
      setAccepting(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Funding</h1>
          <div className="sub">Your financing requests, financier offers, and active facilities — best offer ranked privately for you.</div>
        </div>
        <div className="actions">
          <Button onClick={() => setFormOpen(!formOpen)}>
            <Archive className="h-4 w-4" /> New funding request
          </Button>
        </div>
      </div>

      <div className="chrome-strip adv">
        <Sparkles className="h-4 w-4" />
        <div>
          <b>Financiers ranked privately for you.</b> Each one sees only the evidence they need to price your request — nothing leaks
          across them. You confirm the offer you want to accept.
        </div>
      </div>

      {formOpen ? (
        <RequestForm
          orgId={orgId}
          trades={trades}
          onDone={() => {
            setFormOpen(false);
            onRefresh();
          }}
        />
      ) : null}

      {notice ? (
        <div className="ai-note" style={{ marginTop: 0, marginBottom: 14 }}>
          <div className="ib">
            <Check className="h-3.5 w-3.5" />
          </div>
          <div>{notice}</div>
        </div>
      ) : null}

      {requests.length === 0 && facilities.length === 0 && !formOpen ? (
        <EmptyBlock
          icon={<CircleDollarSign className="h-6 w-6" />}
          title="No funding activity yet"
          body="Build a financing request from one of your trades — invited financiers price it privately and their offers are ranked here."
        >
          <Button onClick={() => setFormOpen(true)}>
            <Archive className="h-4 w-4" /> New funding request
          </Button>
        </EmptyBlock>
      ) : null}

      {requests.length > 0 ? (
        <>
          <div className="fin-sec">
            Your requests <span className="ct">{requests.filter((r) => r.offers.length > 0).length} awaiting your decision</span>
          </div>
          {requests.map((r) => (
            <div key={r.request_id}>
              <RequestOpp request={r} onOpen={() => setOpenRequest(openRequest === r.request_id ? null : r.request_id)} />
              {openRequest === r.request_id && r.offers.length > 0 ? (
                <div className="offer-stack" style={{ marginTop: -4, paddingLeft: 28 }}>
                  {r.offers.map((o, i) => (
                    <div key={o.offer_id} className={cn('offer-row', i === 0 && 'best')}>
                      <span className="pip" />
                      <div className="av">{initials(o.financier_name)}</div>
                      <div className="info">
                        <div className="nm">
                          {o.financier_name}
                          {i === 0 ? <span className="tag">BEST</span> : null}
                          {o.sustainability_tag !== 'none' ? <span className="tag">{o.sustainability_tag.toUpperCase()}</span> : null}
                        </div>
                        <div className="meta">
                          {o.verification_level ? `${o.verification_level} · ` : ''}
                          expires {o.expires_at ? fmtDate(o.expires_at) : '—'}
                        </div>
                      </div>
                      <div className="col">
                        <span className="lbl">All-in</span>
                        {pct(o.apr_bps)}
                      </div>
                      <div className="col">
                        <span className="lbl">Fees</span>
                        {money(o.fees, o.currency)}
                      </div>
                      <div>
                        <Button size="sm" disabled={accepting !== null} onClick={() => void accept(o)}>
                          {accepting === o.offer_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Accept'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </>
      ) : null}

      {facilities.length > 0 ? (
        <>
          <div className="fin-sec">
            Active facilities{' '}
            <span className="ct">
              {facilities.length} reserved · {money(facilities.reduce((s, f) => s + (f.amount ?? 0), 0))}
            </span>
          </div>
          {facilities.map((f) => (
            <div key={f.reservation_id} className="opp ready">
              <div>
                <span className="pip" />
              </div>
              <div className="opp-body">
                <div>
                  <div className="opp-head">
                    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-hairline bg-good-soft text-good">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </span>
                    <span className="ttl">{f.trade_title || f.financier_name}</span>
                    <span className="id">{shortRef('FAC', f.reservation_id)}</span>
                    <span className="tag ready">RESERVED</span>
                  </div>
                  <div className="opp-parties">
                    {f.financier_name} · {pct(f.apr_bps)} all-in · Net {f.tenor_days}
                  </div>
                  <div className="opp-meta">
                    <div className="item">
                      <span className="lbl">Reservation</span>
                      <span className="v mono">{f.financier_ref ?? '—'}</span>
                    </div>
                    <div className="item">
                      <span className="lbl">Holds until</span>
                      <span className="v">
                        {new Date(f.expires_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="opp-right">
                  <div className="opp-value">{f.amount ? money(f.amount, f.currency) : '—'}</div>
                  <div className="opp-risk">
                    <div className="terms">
                      <div className="all-in">{pct(f.apr_bps)} all-in</div>
                      <div>fees {money(f.fees, f.currency)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}

function RequestForm({ orgId, trades, onDone }: { orgId: string; trades: TradeSummary[]; onDone: () => void }) {
  const [form, setForm] = useState({ trade_id: trades[0]?.trade_id ?? '', amount: '', tenor_days: '60', sustainable: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(form.amount);
  const tenorNum = Number(form.tenor_days);
  const ready = form.trade_id && amountNum > 0 && Number.isInteger(tenorNum) && tenorNum > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.requestOffers(orgId, {
        trade_id: form.trade_id,
        amount: amountNum,
        tenor_days: tenorNum,
        ...(form.sustainable ? { sustainable: { enabled: true } } : {})
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create funding request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="glass-2 mb-6 rounded-2xl p-5">
      <div className="text-sm font-medium">New funding request</div>
      {trades.length === 0 ? (
        <p className="mt-3 text-sm text-text-3">
          Funding requests are built from a trade.{' '}
          <Link href="/trades" className="text-cyan-text underline-offset-2 hover:underline">
            Create a trade first →
          </Link>
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="block md:col-span-3">
              <span className="mono mb-1.5 block text-[10.5px] uppercase tracking-wider text-text-3">Trade</span>
              <select className="input-glass" value={form.trade_id} onChange={(e) => setForm({ ...form, trade_id: e.target.value })}>
                {trades.map((t) => (
                  <option key={t.trade_id} value={t.trade_id}>
                    {t.title || t.trade_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mono mb-1.5 block text-[10.5px] uppercase tracking-wider text-text-3">Amount (EUR)</span>
              <input
                className="input-glass mono"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="312400"
              />
            </label>
            <label className="block">
              <span className="mono mb-1.5 block text-[10.5px] uppercase tracking-wider text-text-3">Tenor (days)</span>
              <input className="input-glass mono" inputMode="numeric" value={form.tenor_days} onChange={(e) => setForm({ ...form, tenor_days: e.target.value })} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm text-text-2">
              <input
                type="checkbox"
                checked={form.sustainable}
                onChange={(e) => setForm({ ...form, sustainable: e.target.checked })}
                className="h-4 w-4 accent-[var(--good)]"
              />
              <Leaf className="h-3.5 w-3.5 text-good" /> Sustainability-linked
            </label>
          </div>
          {error ? <div className="mt-3 text-sm text-bad">{error}</div> : null}
          <div className="mt-4 flex gap-2">
            <Button disabled={!ready || busy} onClick={() => void submit()}>
              {busy ? 'Requesting offers…' : 'Request offers'}
            </Button>
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ———————————————————————— Escrow tab ———————————————————————— */

function EscrowTab({ instruments }: { instruments: AlphaObject[] }) {
  const active = instruments.filter((o) => !['completed', 'released', 'archived'].includes(o.status));
  const done = instruments.filter((o) => ['completed', 'released', 'archived'].includes(o.status));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Escrow &amp; smart instruments</h1>
          <div className="sub">
            Funds held until the conditions of a trade are met. Releases happen on facts — shipment confirmed, document signed, milestone
            accepted — not on someone&rsquo;s say-so.
          </div>
        </div>
      </div>

      <div className="chrome-strip exec">
        <Lock className="h-4 w-4" />
        <div>
          <b>Funds release on facts, not promises.</b> Each condition is checked against the real event — a shipment scan, a signed
          document, a confirmed milestone. We can explain a condition; we never tick one for you.
        </div>
      </div>

      {instruments.length === 0 ? (
        <EmptyBlock
          icon={<Lock className="h-6 w-6" />}
          title="No instruments yet"
          body="Payment intents and trade-finance instruments created from your trades appear here with their release conditions."
        >
          <Link href="/trades" className="inline-block">
            <Button variant="secondary">Open Trades →</Button>
          </Link>
        </EmptyBlock>
      ) : (
        <>
          {active.length > 0 ? (
            <>
              <div className="fin-sec">
                Active instruments <span className="ct">{active.length}</span>
              </div>
              <div className="esc-grid">
                {active.map((o) => (
                  <InstrumentCard key={o.object_id} object={o} />
                ))}
              </div>
            </>
          ) : null}
          {done.length > 0 ? (
            <>
              <div className="fin-sec">
                Completed <span className="ct">{done.length}</span>
              </div>
              <div className="esc-grid">
                {done.map((o) => (
                  <InstrumentCard key={o.object_id} object={o} dim />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </>
  );
}

function InstrumentCard({ object, dim }: { object: AlphaObject; dim?: boolean }) {
  const payload = (object.payload_json ?? {}) as Record<string, unknown>;
  const amount = Number(payload.amount ?? payload.value ?? NaN);
  const currency = String(payload.currency ?? 'EUR');
  const conditions = Array.isArray(payload.conditions) ? (payload.conditions as any[]) : [];
  const inner = (
    <>
      <div className="head">
        <div className="ib">{object.type === 'payment_intent' ? <Wallet className="h-4 w-4" /> : <Lock className="h-4 w-4" />}</div>
        <div className="info">
          <div className="nm">
            {object.title} <span className="id">{shortRef('INS', object.object_id)}</span>
          </div>
          <div className="meta">
            {object.type.replace(/_/g, ' ')} · {object.status.replace(/_/g, ' ')}
            {object.trade_id ? ' · linked to trade' : ''}
          </div>
        </div>
      </div>
      {Number.isFinite(amount) ? (
        <div className="amt">
          <span className="ccy">{currency}</span>
          {amount.toLocaleString('en', { minimumFractionDigits: 2 })}
        </div>
      ) : null}
      {conditions.length > 0 ? (
        <div className="esc-cond">
          {conditions.slice(0, 4).map((c, i) => {
            const met = Boolean(c?.met ?? c?.satisfied);
            const pending = String(c?.status ?? '') === 'pending';
            return (
              <div key={i} className={cn('stp', met ? 'met' : pending ? 'pending' : 'todo')}>
                {met ? <CheckCircle2 className="h-3.5 w-3.5" /> : pending ? <Clock className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                {String(c?.label ?? c?.title ?? c?.description ?? 'Condition')}
              </div>
            );
          })}
        </div>
      ) : object.summary ? (
        <div className="esc-cond">
          <div className="stp todo">
            <Circle className="h-3.5 w-3.5" />
            {object.summary}
          </div>
        </div>
      ) : null}
      <div className="esc-foot">
        <span>Updated {fmtDate(object.updated_at)}</span>
        <span className={cn('fin-pill', ['completed', 'released'].includes(object.status) ? 'succeeded' : 'executing')}>
          {object.status.replace(/_/g, ' ')}
        </span>
      </div>
    </>
  );
  const cls = cn('esc-card', dim && 'opacity-75');
  return object.trade_id ? (
    <Link href={`/trades/${object.trade_id}`} className={cls} style={{ display: 'block' }}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/* ———————————————————————— Shared ———————————————————————— */

function EmptyBlock({ icon, title, body, children }: { icon: React.ReactNode; title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="pay-empty">
      <div className="ic">{icon}</div>
      <h2>{title}</h2>
      <p>{body}</p>
      {children ? <div className="pe-cta">{children}</div> : null}
    </div>
  );
}
