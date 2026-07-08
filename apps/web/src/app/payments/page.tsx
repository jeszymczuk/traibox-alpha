'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  CreditCard,
  Download,
  Landmark,
  LayoutGrid,
  Link2,
  List,
  Lock,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Wallet
} from 'lucide-react';
import type { BankAccount, BankConsent, PaymentListItem, PaymentRoute, PaymentStatus } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { WorkspaceGuard } from '../../components/workspace-guard';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type PayTab = 'home' | 'accounts' | 'send' | 'paid' | 'activity';

type BalanceRow = { available: number | null; booked: number | null; as_of: string | null };

const TAB_LABELS: Array<{ key: PayTab; label: string; icon: React.ReactNode }> = [
  { key: 'home', label: 'Home', icon: <LayoutGrid className="h-3.5 w-3.5" /> },
  { key: 'accounts', label: 'Accounts', icon: <Landmark className="h-3.5 w-3.5" /> },
  { key: 'send', label: 'Send', icon: <Send className="h-3.5 w-3.5" /> },
  { key: 'paid', label: 'Get paid', icon: <Download className="h-3.5 w-3.5" /> },
  { key: 'activity', label: 'Activity', icon: <List className="h-3.5 w-3.5" /> }
];

const STATUS_PILL: Record<PaymentStatus, { cls: string; label: string }> = {
  created: { cls: 'prepared', label: 'Prepared' },
  pending_sca: { cls: 'pending', label: 'Awaiting authorization' },
  authorized: { cls: 'authorized', label: 'Authorized' },
  executing: { cls: 'executing', label: 'Executing' },
  executed: { cls: 'succeeded', label: 'Succeeded' },
  failed: { cls: 'failed', label: 'Failed' },
  returned: { cls: 'failed', label: 'Returned' },
  refunded: { cls: 'prepared', label: 'Refunded' }
};

const ACTION_STATUSES: PaymentStatus[] = ['created', 'pending_sca'];
const FLIGHT_STATUSES: PaymentStatus[] = ['authorized', 'executing'];
const PROBLEM_STATUSES: PaymentStatus[] = ['failed', 'returned'];

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: amount >= 10_000 ? 0 : 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en')} ${currency}`;
  }
}

function maskIban(iban: string) {
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ••••••• ${clean.slice(-4)}`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

function shortId(id: string) {
  return `PAY-${id.slice(0, 8).toUpperCase()}`;
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function PaymentsPage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [tab, setTab] = useState<PayTab>('home');
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [balances, setBalances] = useState<Record<string, BalanceRow>>({});
  const [consents, setConsents] = useState<BankConsent[]>([]);
  const [payments, setPayments] = useState<PaymentListItem[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendOpen, setSendOpen] = useState(false);

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [acctRes, payRes, consentRes] = await Promise.all([
        api.listAccounts(orgId),
        api.listPayments(orgId, 200),
        api.listBankConsents(orgId).catch(() => ({ consents: [] as BankConsent[], trace_id: '' }))
      ]);
      const accts = acctRes.accounts ?? [];
      setAccounts(accts);
      setPayments(payRes.payments ?? []);
      setConsents(consentRes.consents ?? []);
      const balanceEntries = await Promise.allSettled(
        accts.map(async (a) => {
          const res = await api.getAccountBalance(orgId, a.account_id);
          return [a.account_id, res.balance] as const;
        })
      );
      const next: Record<string, BalanceRow> = {};
      for (const entry of balanceEntries) {
        if (entry.status !== 'fulfilled' || !entry.value[1]) continue;
        const [id, b] = entry.value;
        next[id] = { available: num(b.available), booked: num(b.booked), as_of: b.as_of ?? null };
      }
      setBalances(next);
      setLastSync(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Payments workspace');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const currencyTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const a of accounts) {
      const b = balances[a.account_id];
      const v = b?.available ?? b?.booked;
      if (v === null || v === undefined) continue;
      totals.set(a.currency, (totals.get(a.currency) ?? 0) + v);
    }
    return [...totals.entries()].sort((x, y) => y[1] - x[1]);
  }, [accounts, balances]);

  const heroCurrency = currencyTotals.find(([c]) => c === 'EUR')?.[0] ?? currencyTotals[0]?.[0] ?? 'EUR';
  const heroTotal = currencyTotals.find(([c]) => c === heroCurrency)?.[1] ?? 0;

  const actionRequired = payments.filter((p) => ACTION_STATUSES.includes(p.status));
  const inFlight = payments.filter((p) => FLIGHT_STATUSES.includes(p.status));
  const settled = payments.filter((p) => p.status === 'executed');
  const problems = payments.filter((p) => PROBLEM_STATUSES.includes(p.status));

  const expiringConsents = useMemo(() => {
    const cutoff = Date.now() + 14 * 24 * 60 * 60 * 1000;
    return consents.filter((c) => {
      if (c.status !== 'granted' || !c.expires_at) return false;
      const t = new Date(c.expires_at).getTime();
      return Number.isFinite(t) && t < cutoff && t > Date.now();
    });
  }, [consents]);

  const attention: Array<{ tone: 'warn' | 'info' | 'bad'; icon: React.ReactNode; title: string; meta: string; action: string; go: () => void }> = [];
  for (const c of expiringConsents) {
    const days = Math.max(0, Math.round((new Date(c.expires_at!).getTime() - Date.now()) / 86_400_000));
    attention.push({
      tone: 'warn',
      icon: <AlertTriangle className="h-4 w-4" />,
      title: `${c.provider} consent expires in ${days} day${days === 1 ? '' : 's'}`,
      meta: 'Reconnect to keep balances and payment rails live',
      action: 'Reconnect',
      go: () => setTab('accounts')
    });
  }
  for (const p of actionRequired.slice(0, 3)) {
    attention.push({
      tone: 'info',
      icon: <ShieldCheck className="h-4 w-4" />,
      title: `${p.creditor_name} · ${money(p.amount, p.currency)} — waiting for authorization`,
      meta: `${p.scheme} · ${shortId(p.payment_id)}`,
      action: 'Review',
      go: () => setTab('send')
    });
  }
  for (const p of problems.slice(0, 2)) {
    attention.push({
      tone: 'bad',
      icon: <AlertTriangle className="h-4 w-4" />,
      title: `${p.creditor_name} · ${money(p.amount, p.currency)} ${p.status === 'returned' ? 'was returned' : 'failed'}`,
      meta: `${p.scheme} · ${shortId(p.payment_id)}${p.return_reason ? ` · ${p.return_reason}` : ''}`,
      action: 'Inspect',
      go: () => setTab('activity')
    });
  }

  const syncLabel = lastSync
    ? `live · last sync ${lastSync.toLocaleTimeString('en-GB', { hour12: false })} UTC`
    : 'connecting…';

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="sub-rail">
        {TAB_LABELS.map((t) => (
          <button key={t.key} type="button" className={cn('sub-tab', tab === t.key && 'on')} onClick={() => setTab(t.key)}>
            {t.icon}
            {t.label}
            {t.key === 'accounts' && accounts.length > 0 ? <span className="ct">{accounts.length}</span> : null}
            {t.key === 'send' && actionRequired.length > 0 ? <span className="ct">{actionRequired.length}</span> : null}
            {t.key === 'activity' && payments.length > 0 ? <span className="ct">{payments.length}</span> : null}
          </button>
        ))}
        <div className="right">{syncLabel}</div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
        <WorkspaceGuard authStatus={auth.status} orgId={orgId} error={error} onRetry={() => void refresh()} module="Payments">
            {tab === 'home' ? (
              <HomeTab
                orgName={selectedOrg?.name ?? 'Your'}
                heroTotal={heroTotal}
                heroCurrency={heroCurrency}
                currencyTotals={currencyTotals}
                accounts={accounts}
                payments={payments}
                attention={attention}
                actionRequired={actionRequired}
                inFlight={inFlight}
                setTab={setTab}
                onNewPayment={() => {
                  setTab('send');
                  setSendOpen(true);
                }}
              />
            ) : null}
            {tab === 'accounts' ? (
              <AccountsTab
                orgId={orgId!}
                accounts={accounts}
                balances={balances}
                consents={consents}
                expiringConsents={expiringConsents}
                loading={loading}
                onRefresh={() => void refresh()}
              />
            ) : null}
            {tab === 'send' ? (
              <SendTab
                orgId={orgId!}
                accounts={accounts}
                actionRequired={actionRequired}
                inFlight={inFlight}
                settled={settled}
                problems={problems}
                sendOpen={sendOpen}
                setSendOpen={setSendOpen}
                onRefresh={() => void refresh()}
              />
            ) : null}
            {tab === 'paid' ? <GetPaidTab settled={settled} /> : null}
            {tab === 'activity' ? <ActivityTab payments={payments} /> : null}
        </WorkspaceGuard>
      </div>
    </AppShell>
  );
}

/* ———————————————————————— Home ———————————————————————— */

function HomeTab({
  orgName,
  heroTotal,
  heroCurrency,
  currencyTotals,
  accounts,
  payments,
  attention,
  actionRequired,
  inFlight,
  setTab,
  onNewPayment
}: {
  orgName: string;
  heroTotal: number;
  heroCurrency: string;
  currencyTotals: Array<[string, number]>;
  accounts: BankAccount[];
  payments: PaymentListItem[];
  attention: Array<{ tone: 'warn' | 'info' | 'bad'; icon: React.ReactNode; title: string; meta: string; action: string; go: () => void }>;
  actionRequired: PaymentListItem[];
  inFlight: PaymentListItem[];
  setTab: (t: PayTab) => void;
  onNewPayment: () => void;
}) {
  const [int, frac] = heroTotal.toFixed(2).split('.');
  const symbol = heroCurrency === 'EUR' ? '€' : heroCurrency === 'USD' ? '$' : heroCurrency === 'GBP' ? '£' : heroCurrency;
  const recent = payments.slice(0, 5);

  return (
    <>
      <div className="pay-h-hero">
        <div>
          <div className="eyebrow">
            <span className="dot" />
            {orgName}&rsquo;s money · all accounts
          </div>
          <div className="pay-bal-big">
            <span className="ccy">{symbol}</span>
            {Number(int).toLocaleString('en')}
            <span className="cents">.{frac}</span>
          </div>
          <div className="trend">
            <span className="mono text-xs">
              {accounts.length} account{accounts.length === 1 ? '' : 's'} · {currencyTotals.length || 1}{' '}
              {currencyTotals.length === 1 ? 'currency' : 'currencies'} · {payments.length} payment{payments.length === 1 ? '' : 's'} on record
            </span>
          </div>
        </div>
        <div className="hero-actions">
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setTab('paid')}>
              <Download className="h-4 w-4" /> Get paid
            </Button>
            <Button onClick={onNewPayment}>
              <Send className="h-4 w-4" /> Send money
            </Button>
          </div>
        </div>
      </div>

      <div className="pay-qa-grid">
        <button type="button" className="pay-qa send" onClick={onNewPayment}>
          <div className="qa-ic">
            <Send className="h-4 w-4" />
          </div>
          <div className="qa-body">
            <div className="nm">Send money</div>
            <div className="ds">SEPA Instant, standard or manual — the best route, picked for you</div>
          </div>
        </button>
        <button type="button" className="pay-qa receive" onClick={() => setTab('paid')}>
          <div className="qa-ic">
            <Download className="h-4 w-4" />
          </div>
          <div className="qa-body">
            <div className="nm">Get paid</div>
            <div className="ds">Payment requests and inbound collections, tracked for you</div>
          </div>
        </button>
        <button type="button" className="pay-qa move" onClick={() => setTab('accounts')}>
          <div className="qa-ic">
            <Landmark className="h-4 w-4" />
          </div>
          <div className="qa-body">
            <div className="nm">Connect account</div>
            <div className="ds">Add a bank via Open Banking or register a manual account</div>
          </div>
        </button>
        <div className="pay-qa card" aria-disabled>
          <div className="qa-ic">
            <CreditCard className="h-4 w-4" />
          </div>
          <div className="qa-body">
            <div className="nm">
              Issue a card <span className="fin-pill prepared ml-1">Planned</span>
            </div>
            <div className="ds">Per-person budgets and instant digital cards</div>
          </div>
        </div>
      </div>

      {attention.length > 0 ? (
        <section className="glass-1 rounded-2xl p-4">
          <div className="flex items-center gap-3 text-sm font-medium">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-hairline bg-warn-soft text-warning">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            Needs your attention
            <span className="ct mono ml-auto text-[10px] uppercase tracking-wider text-text-4">{attention.length} items</span>
          </div>
          <div className="mt-3 space-y-1">
            {attention.map((a, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-glass2">
                <span
                  className={cn(
                    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-hairline',
                    a.tone === 'warn' && 'bg-warn-soft text-warning',
                    a.tone === 'info' && 'bg-cyan-soft text-cyan-text',
                    a.tone === 'bad' && 'bg-bad-soft text-bad'
                  )}
                >
                  {a.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{a.title}</div>
                  <div className="mono truncate text-[11px] text-text-3">{a.meta}</div>
                </div>
                <Button size="sm" variant="secondary" onClick={a.go}>
                  {a.action}
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : accounts.length > 0 ? (
        <div className="pay-ready green">
          <div className="rd-ic">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="rd-body">
            <b>All clear.</b> No consents expiring, no payments waiting on you, nothing failed.
          </div>
        </div>
      ) : null}

      <div className="pay-sec">
        Accounts{' '}
        <span className="ct">
          {accounts.length} connected{accounts.length > 0 ? ' · live' : ''}
        </span>
        <div className="right">
          <a onClick={() => setTab('accounts')}>Manage accounts →</a>
        </div>
      </div>
      {currencyTotals.length > 0 ? (
        <div className="pay-ccy-strip">
          {currencyTotals.map(([ccy, total]) => (
            <div key={ccy} className="pay-ccy-card">
              <div className={cn('flag', ccy.toLowerCase())}>{ccy}</div>
              <div className="info">
                <div className="ccy">{ccy}</div>
                <div className="amt">{money(total, ccy)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <button type="button" className="acct-add" onClick={() => setTab('accounts')}>
          <div className="aa-ic">
            <Plus className="h-5 w-5" />
          </div>
          <div className="aa-info">
            <div className="nm">Connect your first account</div>
            <div className="ds">Open Banking (AIS+PIS) or a manual account — balances appear here</div>
          </div>
        </button>
      )}

      <div className="grid gap-7 lg:grid-cols-2">
        <div>
          <div className="pay-sec">
            Action queue{' '}
            <span className="ct">
              {actionRequired.length + inFlight.length === 0
                ? 'nothing pending'
                : `${actionRequired.length} need you · ${inFlight.length} in flight`}
            </span>
            <div className="right">
              <a onClick={() => setTab('send')}>All outbound →</a>
            </div>
          </div>
          {actionRequired.length + inFlight.length === 0 ? (
            <p className="px-1 text-sm text-text-3">No outbound payments waiting. Start one with “Send money”.</p>
          ) : (
            <div className="pay-act">
              {[...actionRequired, ...inFlight].slice(0, 5).map((p) => (
                <Link key={p.payment_id} href={`/finance/payments/${p.payment_id}`} className="pay-act-row">
                  <div className="dir out">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </div>
                  <div className="info">
                    <div className="nm">{p.creditor_name}</div>
                    <div className="meta">
                      {fmtTime(p.created_at)} · {p.scheme} · {shortId(p.payment_id)}
                    </div>
                  </div>
                  <div className="right">
                    <div className="amt out">−{money(p.amount, p.currency)}</div>
                    <div className={cn('status', FLIGHT_STATUSES.includes(p.status) && 'live')}>{STATUS_PILL[p.status].label}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="pay-sec">
            Recent movement <span className="ct">latest {recent.length || '—'}</span>
            <div className="right">
              <a onClick={() => setTab('activity')}>All activity →</a>
            </div>
          </div>
          {recent.length === 0 ? (
            <p className="px-1 text-sm text-text-3">No payments yet. Your executed and in-flight payments show up here.</p>
          ) : (
            <div className="pay-act">
              {recent.map((p) => (
                <Link key={p.payment_id} href={`/finance/payments/${p.payment_id}`} className="pay-act-row">
                  <div className="dir out">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </div>
                  <div className="info">
                    <div className="nm">{p.creditor_name}</div>
                    <div className="meta">
                      {fmtTime(p.created_at)} · {p.scheme} · {maskIban(p.creditor_iban)}
                    </div>
                  </div>
                  <div className="right">
                    <div className="amt out">−{money(p.amount, p.currency)}</div>
                    <div className={cn('status', p.status === 'executing' && 'live')}>{STATUS_PILL[p.status].label}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="ai-note" style={{ marginTop: 32 }}>
        <div className="ib">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div>
          <b>Live from your rails.</b> Balances, consents and payment states on this screen come straight from connected providers —
          nothing here is simulated. {inFlight.length > 0 ? `${inFlight.length} payment${inFlight.length === 1 ? ' is' : 's are'} moving right now.` : ''}
        </div>
      </div>
    </>
  );
}

/* ———————————————————————— Accounts ———————————————————————— */

function AccountsTab({
  orgId,
  accounts,
  balances,
  consents,
  expiringConsents,
  loading,
  onRefresh
}: {
  orgId: string;
  accounts: BankAccount[];
  balances: Record<string, BalanceRow>;
  consents: BankConsent[];
  expiringConsents: BankConsent[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const [connectOpen, setConnectOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [manual, setManual] = useState({ iban: '', currency: 'EUR', name: '', bank_name: '' });

  const total = accounts.reduce((sum, a) => {
    const b = balances[a.account_id];
    const v = b?.available ?? b?.booked;
    return a.currency === 'EUR' && v !== null && v !== undefined ? sum + v : sum;
  }, 0);

  async function connectProvider(provider: string) {
    setBusy(provider);
    setNotice(null);
    try {
      const res = await api.linkBank(orgId, { type: 'AIS', provider });
      if (res?.auth_url && !res.auth_url.endsWith('/')) {
        window.location.href = res.auth_url;
        return;
      }
      setNotice(`Consent created for ${provider}. Accounts will appear after the provider grants access.`);
      onRefresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not start bank consent');
    } finally {
      setBusy(null);
    }
  }

  async function addManual() {
    setBusy('manual');
    setNotice(null);
    try {
      await api.createManualAccount(orgId, {
        iban: manual.iban,
        currency: manual.currency,
        name: manual.name || undefined,
        bank_name: manual.bank_name || undefined
      });
      setManual({ iban: '', currency: 'EUR', name: '', bank_name: '' });
      setConnectOpen(false);
      onRefresh();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not create manual account');
    } finally {
      setBusy(null);
    }
  }

  const healthy = consents.filter((c) => c.status === 'granted').length;

  return (
    <>
      <div className="pay-page-head">
        <div className="pph-body">
          <h1>Accounts</h1>
          <div className="pph-sub">
            {accounts.length} connected{total > 0 ? (
              <>
                {' '}
                · <b className="font-medium text-text-2">{money(total, 'EUR')}</b> in EUR accounts
              </>
            ) : null}{' '}
            · synced from your providers.
          </div>
        </div>
        <div className="pph-actions flex gap-2">
          <Button variant="secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Sync now
          </Button>
          <Button onClick={() => setConnectOpen((v) => !v)}>
            <Plus className="h-4 w-4" /> Connect account
          </Button>
        </div>
      </div>

      {accounts.length === 0 && !connectOpen ? (
        <div className="pay-empty">
          <div className="ic">
            <Landmark className="h-6 w-6" />
          </div>
          <h2>Connect your first account</h2>
          <p>Link a bank or register a manual account to bring your money to life inside TRAIBOX — and unlock everything that depends on it.</p>
          <div className="pe-unlocks">
            {['Real-time balances', 'Send & receive payments', 'Multi-currency wallets', 'Funding readiness', 'Payment routing', 'Cash-flow alerts'].map(
              (item) => (
                <div key={item} className="item">
                  <Check className="h-3.5 w-3.5" />
                  {item}
                </div>
              )
            )}
          </div>
          <div className="pe-cta">
            <Button onClick={() => setConnectOpen(true)}>
              <Plus className="h-4 w-4" /> Connect account
            </Button>
          </div>
        </div>
      ) : null}

      {accounts.length > 0 ? (
        <>
          <div className={cn('pay-ready', expiringConsents.length > 0 ? 'warn' : 'green')}>
            <div className="rd-ic">
              {expiringConsents.length > 0 ? <AlertTriangle className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            </div>
            <div className="rd-body">
              <b>
                {accounts.length} account{accounts.length === 1 ? '' : 's'}{' '}
                {expiringConsents.length > 0 ? 'need attention.' : 'healthy.'}
              </b>{' '}
              {healthy} active consent{healthy === 1 ? '' : 's'}
              {expiringConsents.length > 0 ? ` · ${expiringConsents.length} expiring within 14 days` : ''}.
              <div className="checks">
                {consents.slice(0, 4).map((c) => (
                  <span key={c.consent_id} className={c.status === 'granted' ? 'ok' : 'warn'}>
                    {c.status === 'granted' ? (
                      <Check className="h-3 w-3 text-good" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-warning" />
                    )}
                    {c.provider} · {c.status}
                    {c.expires_at ? ` · exp ${new Date(c.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="pay-sec">
            Operating accounts <span className="ct">{accounts.length} rails</span>
          </div>
          <div className="acct-list">
            {accounts.map((a, i) => {
              const b = balances[a.account_id];
              const v = b?.available ?? b?.booked;
              const toneCls = a.provider_id === 'manual' ? 'sweep' : a.type === 'escrow' ? 'escrow' : i === 0 ? 'primary' : 'fx';
              return (
                <div key={a.account_id} className={cn('acct-row', toneCls)}>
                  <div className="ar-ic">
                    {a.type === 'escrow' ? <Lock className="h-4 w-4" /> : a.provider_id === 'manual' ? <Wallet className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
                  </div>
                  <div className="ar-info">
                    <div className="nm">
                      {a.bank_name || a.name || a.provider_id}
                      {i === 0 ? <span className="pri-pill">PRIMARY</span> : null}
                    </div>
                    <div className="iban">
                      {maskIban(a.iban)} · {a.currency} · {a.provider_id}
                      {a.status ? ` · ${a.status}` : ''}
                    </div>
                  </div>
                  <div className="ar-bal">
                    {v !== null && v !== undefined ? (
                      <>
                        <div className="amt">{money(v, a.currency)}</div>
                        {b && b.booked !== null && b.available !== null && b.booked !== b.available ? (
                          <div className="avail">Booked · {money(b.booked, a.currency)}</div>
                        ) : (
                          <div className="avail">Available</div>
                        )}
                      </>
                    ) : (
                      <div className="avail">No balance yet</div>
                    )}
                  </div>
                  <div className="ar-sync">
                    <span className="dot" />
                    {b?.as_of ? fmtTime(b.as_of) : '—'}
                  </div>
                </div>
              );
            })}
            <button type="button" className="acct-add" onClick={() => setConnectOpen((vv) => !vv)}>
              <div className="aa-ic">
                <Plus className="h-5 w-5" />
              </div>
              <div className="aa-info">
                <div className="nm">Connect another account</div>
                <div className="ds">Open Banking (AIS+PIS) via TrueLayer · or register a manual account</div>
              </div>
            </button>
          </div>
        </>
      ) : null}

      {connectOpen ? (
        <>
          <div className="pay-sec" style={{ marginTop: 36 }}>
            Connect a provider <span className="ct">Open Banking · adapter framework</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              { id: 'truelayer', name: 'TrueLayer', ds: 'Open Banking · 4,200+ banks · AIS+PIS' },
              { id: 'revolut', name: 'Revolut Business', ds: 'Multi-currency · 30+ countries' },
              { id: 'wise', name: 'Wise Business', ds: '38 currencies · low-cost FX' },
              { id: 'bpi', name: 'Banco BPI', ds: 'PT · SEPA Instant' }
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy !== null}
                onClick={() => void connectProvider(p.id)}
                className="glass-1 flex flex-col items-start gap-2 rounded-xl border border-hairline p-3.5 text-left transition hover:border-cyan disabled:opacity-50"
              >
                <span className="mono rounded-md border border-hairline bg-glass2 px-2 py-1 text-[11px] uppercase text-text-2">
                  {busy === p.id ? '…' : p.name.split(' ')[0]}
                </span>
                <span className="text-[13px] font-medium">{p.name}</span>
                <span className="text-[11px] leading-snug text-text-3">{p.ds}</span>
              </button>
            ))}
          </div>

          <div className="pay-sec" style={{ marginTop: 28 }}>
            Or register a manual account <span className="ct">no Open Banking required</span>
          </div>
          <div className="glass-1 rounded-2xl p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="IBAN">
                <input
                  className="input-glass"
                  value={manual.iban}
                  onChange={(e) => setManual({ ...manual, iban: e.target.value })}
                  placeholder="PT50 0010 0000 1234 5678 9012 3"
                />
              </Field>
              <Field label="Currency">
                <input
                  className="input-glass"
                  value={manual.currency}
                  onChange={(e) => setManual({ ...manual, currency: e.target.value.toUpperCase() })}
                  maxLength={3}
                />
              </Field>
              <Field label="Account name (optional)">
                <input className="input-glass" value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Operating" />
              </Field>
              <Field label="Bank name (optional)">
                <input
                  className="input-glass"
                  value={manual.bank_name}
                  onChange={(e) => setManual({ ...manual, bank_name: e.target.value })}
                  placeholder="Banco BPI"
                />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button disabled={busy !== null || manual.iban.replace(/\s+/g, '').length < 8} onClick={() => void addManual()}>
                {busy === 'manual' ? 'Adding…' : 'Add manual account'}
              </Button>
              <Button variant="ghost" onClick={() => setConnectOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {notice ? <div className="ai-note"><div className="ib"><Sparkles className="h-3.5 w-3.5" /></div><div>{notice}</div></div> : null}

      <div className="ai-note">
        <div className="ib">
          <ShieldCheck className="h-3.5 w-3.5" />
        </div>
        <div>
          <b>Read-only until you say otherwise.</b> Adding an account starts with balances only. Sending payments needs a separate,
          explicit consent from your bank — we ask the first time. Consents auto-refresh every 90 days; we warn you 14 days before expiry.
        </div>
      </div>
    </>
  );
}

/* ———————————————————————— Send ———————————————————————— */

function SendTab({
  orgId,
  accounts,
  actionRequired,
  inFlight,
  settled,
  problems,
  sendOpen,
  setSendOpen,
  onRefresh
}: {
  orgId: string;
  accounts: BankAccount[];
  actionRequired: PaymentListItem[];
  inFlight: PaymentListItem[];
  settled: PaymentListItem[];
  problems: PaymentListItem[];
  sendOpen: boolean;
  setSendOpen: (v: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="pay-page-head">
        <div className="pph-body">
          <h1>Send money</h1>
          <div className="pph-sub">
            {actionRequired.length > 0 ? (
              <b className="font-medium text-warning">
                {actionRequired.length} payment{actionRequired.length === 1 ? ' needs' : 's need'} you.{' '}
              </b>
            ) : null}
            Pay suppliers, expenses and finance obligations across your accounts. Every payment is safety-checked — you confirm before
            money moves.
          </div>
        </div>
        <div className="pph-actions">
          <Button onClick={() => setSendOpen(!sendOpen)}>
            <Plus className="h-4 w-4" /> New payment
          </Button>
        </div>
      </div>

      {sendOpen ? <SendForm orgId={orgId} accounts={accounts} onDone={() => { setSendOpen(false); onRefresh(); }} /> : null}

      {actionRequired.length === 0 && inFlight.length === 0 && settled.length === 0 && problems.length === 0 && !sendOpen ? (
        <div className="pay-empty">
          <div className="ic">
            <Send className="h-6 w-6" />
          </div>
          <h2>No outbound payments yet</h2>
          <p>
            Start your first payment and TRAIBOX will compute the best route, verify the details, and hold execution for your explicit
            approval.
          </p>
          <div className="pe-cta">
            <Button onClick={() => setSendOpen(true)}>
              <Plus className="h-4 w-4" /> New payment
            </Button>
          </div>
        </div>
      ) : null}

      {actionRequired.length > 0 ? (
        <>
          <div className="pay-sec">
            Action required <span className="ct">{actionRequired.length} awaiting authorization</span>
          </div>
          <PaymentRows payments={actionRequired} rowCls="attn" />
        </>
      ) : null}

      {inFlight.length > 0 ? (
        <>
          <div className="pay-sec">
            In flight <span className="ct">live · {inFlight.length} moving</span>
          </div>
          <PaymentRows payments={inFlight} rowCls="exec" />
        </>
      ) : null}

      {settled.length > 0 ? (
        <>
          <div className="pay-sec">
            Recently settled <span className="ct">latest {Math.min(settled.length, 5)}</span>
          </div>
          <PaymentRows payments={settled.slice(0, 5)} rowCls="done" />
        </>
      ) : null}

      {problems.length > 0 ? (
        <>
          <div className="pay-sec">
            Failed or returned <span className="ct">{problems.length}</span>
          </div>
          <PaymentRows payments={problems} rowCls="dead" />
        </>
      ) : null}
    </>
  );
}

function PaymentRows({ payments, rowCls }: { payments: PaymentListItem[]; rowCls: string }) {
  return (
    <div className="pay-list">
      {payments.map((p) => (
        <Link key={p.payment_id} href={`/finance/payments/${p.payment_id}`} className={cn('row', rowCls)}>
          <span className="pip" />
          <div className="av">{initials(p.creditor_name) || '??'}</div>
          <div className="info">
            <div className="nm">
              {p.creditor_name} <span className="id">{shortId(p.payment_id)}</span>
              <span className={cn('fin-pill', STATUS_PILL[p.status].cls)}>{STATUS_PILL[p.status].label}</span>
            </div>
            <div className="meta">
              {p.scheme} · created {fmtTime(p.created_at)}
              {p.remittance ? ` · ${p.remittance}` : ''}
            </div>
          </div>
          <div className="col">
            <span className="lbl">IBAN</span>
            {maskIban(p.creditor_iban)}
          </div>
          <div className="col amt">
            {money(p.amount, p.currency)}
            <span className="lbl" style={{ textAlign: 'right' }}>
              {p.currency}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function SendForm({ orgId, accounts, onDone }: { orgId: string; accounts: BankAccount[]; onDone: () => void }) {
  const [form, setForm] = useState({
    from_account_id: accounts[0]?.account_id ?? '',
    creditor_name: '',
    creditor_iban: '',
    amount: '',
    currency: accounts[0]?.currency ?? 'EUR',
    remittance: '',
    urgency: 'standard' as 'standard' | 'instant'
  });
  const [routes, setRoutes] = useState<PaymentRoute[] | null>(null);
  const [routeId, setRouteId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'routes' | 'execute' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ payment_id: string; status: string; redirect_url?: string } | null>(null);

  const amountNum = Number(form.amount);
  const formReady =
    form.from_account_id && form.creditor_name.trim().length > 1 && form.creditor_iban.replace(/\s+/g, '').length >= 8 && amountNum > 0;

  async function checkRoutes() {
    setBusy('routes');
    setError(null);
    try {
      const res = await api.routes(orgId, {
        from_account_id: form.from_account_id,
        to_iban: form.creditor_iban.replace(/\s+/g, ''),
        amount: amountNum,
        currency: form.currency,
        urgency: form.urgency
      });
      setRoutes(res.routes ?? []);
      setRouteId(res.routes?.find((r) => r.recommended)?.route_id ?? res.routes?.[0]?.route_id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not compute routes');
    } finally {
      setBusy(null);
    }
  }

  async function execute() {
    if (!routeId) return;
    setBusy('execute');
    setError(null);
    try {
      const payment = await api.executePayment(orgId, {
        route_id: routeId,
        from_account_id: form.from_account_id,
        creditor_name: form.creditor_name.trim(),
        creditor_iban: form.creditor_iban.replace(/\s+/g, ''),
        amount: amountNum,
        currency: form.currency,
        remittance: form.remittance || undefined,
        e2e_id: crypto.randomUUID()
      });
      setResult({ payment_id: payment.payment_id, status: payment.status, redirect_url: payment.redirect_url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed to start');
    } finally {
      setBusy(null);
    }
  }

  if (result) {
    return (
      <div className="glass-2 mb-6 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-hairline bg-good-soft text-good">
            <Check className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-medium">
              Payment created · <span className={cn('fin-pill', STATUS_PILL[result.status as PaymentStatus]?.cls ?? 'prepared')}>{result.status}</span>
            </div>
            <div className="mono mt-1 text-[11px] text-text-3">{shortId(result.payment_id)}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {result.redirect_url ? (
            <a href={result.redirect_url} className="inline-block">
              <Button>Continue authorization →</Button>
            </a>
          ) : null}
          {result.status === 'pending_sca' && !result.redirect_url ? (
            <Link href={`/payments/manual?payment_id=${result.payment_id}&org_id=${orgId}`} className="inline-block">
              <Button variant="secondary">Complete manually</Button>
            </Link>
          ) : null}
          <Link href={`/finance/payments/${result.payment_id}`} className="inline-block">
            <Button variant="secondary">Open payment</Button>
          </Link>
          <Button variant="ghost" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-2 mb-6 rounded-2xl p-5">
      <div className="text-sm font-medium">New payment</div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="From account">
          <select
            className="input-glass"
            value={form.from_account_id}
            onChange={(e) => {
              const acct = accounts.find((a) => a.account_id === e.target.value);
              setForm({ ...form, from_account_id: e.target.value, currency: acct?.currency ?? form.currency });
              setRoutes(null);
            }}
          >
            {accounts.length === 0 ? <option value="">No accounts — connect one first</option> : null}
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {(a.bank_name || a.name || a.provider_id) ?? 'Account'} · {maskIban(a.iban)} · {a.currency}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Urgency">
          <select
            className="input-glass"
            value={form.urgency}
            onChange={(e) => {
              setForm({ ...form, urgency: e.target.value as 'standard' | 'instant' });
              setRoutes(null);
            }}
          >
            <option value="standard">Standard</option>
            <option value="instant">Instant</option>
          </select>
        </Field>
        <Field label="Beneficiary name">
          <input
            className="input-glass"
            value={form.creditor_name}
            onChange={(e) => setForm({ ...form, creditor_name: e.target.value })}
            placeholder="Aço Beira S.A."
          />
        </Field>
        <Field label="Beneficiary IBAN">
          <input
            className="input-glass mono"
            value={form.creditor_iban}
            onChange={(e) => {
              setForm({ ...form, creditor_iban: e.target.value });
              setRoutes(null);
            }}
            placeholder="PT50 0010 0000 1234 5678 9012 3"
          />
        </Field>
        <Field label={`Amount (${form.currency})`}>
          <input
            className="input-glass mono"
            inputMode="decimal"
            value={form.amount}
            onChange={(e) => {
              setForm({ ...form, amount: e.target.value });
              setRoutes(null);
            }}
            placeholder="18420.00"
          />
        </Field>
        <Field label="Remittance (optional)">
          <input
            className="input-glass"
            value={form.remittance}
            onChange={(e) => setForm({ ...form, remittance: e.target.value })}
            placeholder="INV-2026-04417"
          />
        </Field>
      </div>

      {routes ? (
        <div className="mt-4">
          <div className="mono text-[10.5px] uppercase tracking-wider text-text-3">Route</div>
          <div className="mt-2 grid gap-2 md:grid-cols-3">
            {routes.map((r) => (
              <button
                key={r.route_id}
                type="button"
                onClick={() => setRouteId(r.route_id)}
                className={cn(
                  'glass-1 rounded-xl border p-3 text-left transition',
                  routeId === r.route_id ? 'border-cyan' : 'border-hairline hover:border-hairline-strong'
                )}
              >
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  {r.scheme}
                  {r.recommended ? <span className="fin-pill verified">Recommended</span> : null}
                </div>
                <div className="mono mt-1 text-[11px] text-text-3">
                  fee {money(r.fee, form.currency)} · ~{r.eta_minutes} min
                </div>
              </button>
            ))}
            {routes.length === 0 ? <div className="text-sm text-text-3">No routes available for this account.</div> : null}
          </div>
        </div>
      ) : null}

      {error ? <div className="mt-3 text-sm text-bad">{error}</div> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {!routes ? (
          <Button disabled={!formReady || busy !== null} onClick={() => void checkRoutes()}>
            {busy === 'routes' ? 'Checking routes…' : 'Check routes'}
          </Button>
        ) : (
          <Button disabled={!routeId || busy !== null} onClick={() => void execute()}>
            {busy === 'execute' ? 'Starting payment…' : `Send ${amountNum > 0 ? money(amountNum, form.currency) : ''}`}
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ———————————————————————— Get paid ———————————————————————— */

function GetPaidTab({ settled }: { settled: PaymentListItem[] }) {
  return (
    <>
      <div className="pay-page-head">
        <div className="pph-body">
          <h1>Get paid</h1>
          <div className="pph-sub">
            Payment requests, invoices and inbound collections — buyers pay you in two taps, and overdue follow-ups are tracked for you.
          </div>
        </div>
      </div>

      <div className="col-grid">
        <div className="col-stat good">
          <div className="lbl">Outbound settled · all time</div>
          <div className="num">{settled.length}</div>
          <div className="sub">payments executed through TRAIBOX rails</div>
        </div>
        <div className="col-stat">
          <div className="lbl">Payment links</div>
          <div className="num">—</div>
          <div className="sub">collections go live with the pilot cohort</div>
        </div>
        <div className="col-stat">
          <div className="lbl">Overdue tracked</div>
          <div className="num">—</div>
          <div className="sub">auto-reminders included</div>
        </div>
      </div>

      <div className="pay-empty">
        <div className="ic">
          <Link2 className="h-6 w-6" />
        </div>
        <h2>Collections are next on the rails</h2>
        <p>
          Payment requests and shareable pay-links are part of the pilot rollout. Inbound settlement already reconciles automatically
          when the payer uses your connected accounts.
        </p>
        <div className="pe-unlocks">
          {['Shareable pay-links', 'Invoice payment requests', 'Partial payment tracking', 'Automatic reminders', 'Trade-linked receipts', 'Proof-bundled settlement'].map(
            (item) => (
              <div key={item} className="item">
                <Check className="h-3.5 w-3.5" />
                {item}
              </div>
            )
          )}
        </div>
      </div>
    </>
  );
}

/* ———————————————————————— Activity ———————————————————————— */

function ActivityTab({ payments }: { payments: PaymentListItem[] }) {
  const [filter, setFilter] = useState<'all' | 'action' | 'flight' | 'settled' | 'failed'>('all');
  const filtered = payments.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'action') return ACTION_STATUSES.includes(p.status);
    if (filter === 'flight') return FLIGHT_STATUSES.includes(p.status);
    if (filter === 'settled') return p.status === 'executed';
    return PROBLEM_STATUSES.includes(p.status) || p.status === 'refunded';
  });

  return (
    <>
      <div className="pay-page-head">
        <div className="pph-body">
          <h1>Activity</h1>
          <div className="pph-sub">Every payment on record, straight from the ledger — filter by lifecycle state.</div>
        </div>
        <div className="pph-actions flex flex-wrap gap-1.5">
          {(
            [
              ['all', 'All'],
              ['action', 'Needs you'],
              ['flight', 'In flight'],
              ['settled', 'Settled'],
              ['failed', 'Failed']
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'mono rounded-lg border px-3 py-1.5 text-[11px] uppercase tracking-wider transition',
                filter === key ? 'border-cyan bg-cyan-soft text-cyan-text' : 'border-hairline bg-glass1 text-text-3 hover:text-text'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="pay-empty">
          <div className="ic">
            <List className="h-6 w-6" />
          </div>
          <h2>{payments.length === 0 ? 'No activity yet' : 'Nothing in this filter'}</h2>
          <p>
            {payments.length === 0
              ? 'Payments you send show up here with their full lifecycle — prepared, authorized, executing, settled.'
              : 'Try another lifecycle filter.'}
          </p>
        </div>
      ) : (
        <div className="pay-act">
          {filtered.map((p) => (
            <Link key={p.payment_id} href={`/finance/payments/${p.payment_id}`} className="pay-act-row">
              <div className={cn('dir', p.status === 'refunded' ? 'in' : 'out')}>
                {p.status === 'refunded' ? <ArrowDownLeft className="h-3.5 w-3.5" /> : <ArrowUpRight className="h-3.5 w-3.5" />}
              </div>
              <div className="info">
                <div className="nm">{p.creditor_name}</div>
                <div className="meta">
                  {fmtTime(p.created_at)} · {p.scheme} · {maskIban(p.creditor_iban)} · {shortId(p.payment_id)}
                </div>
              </div>
              <div className="right">
                <div className={cn('amt', p.status === 'refunded' ? 'in' : 'out')}>
                  {p.status === 'refunded' ? '+' : '−'}
                  {money(p.amount, p.currency)}
                </div>
                <div className={cn('status', p.status === 'executing' && 'live')}>{STATUS_PILL[p.status].label}</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/* ———————————————————————— Shared bits ———————————————————————— */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mono mb-1.5 block text-[10.5px] uppercase tracking-wider text-text-3">{label}</span>
      {children}
    </label>
  );
}
