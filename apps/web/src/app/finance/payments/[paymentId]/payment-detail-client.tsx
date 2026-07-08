'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Fingerprint,
  Loader2,
  Lock,
  LockOpen,
  ShieldCheck,
  Wallet,
  X
} from 'lucide-react';
import type { PaymentStatus } from '@traibox/contracts';

import { AppShell } from '../../../../components/shell';
import { useOrgSelection } from '../../../../components/use-org';
import { Button, buttonClassName } from '../../../../components/ui/button';
import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { paymentsConfig } from '../../../../lib/workspace-routes';
import { api } from '../../../../lib/api';
import { cn } from '../../../../lib/cn';

type PaymentDetails = {
  payment_id: string;
  trade_id: string | null;
  scheme: string;
  status: PaymentStatus;
  creditor_name: string;
  creditor_iban: string;
  amount: number;
  currency: string;
  remittance: string | null;
  e2e_id: string | null;
  created_at: string;
};

const LIFECYCLE: Array<{ key: PaymentStatus | 'released'; step: string; nm: string }> = [
  { key: 'created', step: '01 · Prepared', nm: 'Payment drafted' },
  { key: 'pending_sca', step: '02 · Authorize', nm: 'Bank authorization' },
  { key: 'authorized', step: '03 · Authorized', nm: 'Ready to release' },
  { key: 'executing', step: '04 · Executing', nm: 'In flight on the rail' },
  { key: 'executed', step: '05 · Succeeded', nm: 'Settled & proofed' }
];

const STATUS_ORDER: PaymentStatus[] = ['created', 'pending_sca', 'authorized', 'executing', 'executed'];

const STATUS_PILL: Record<string, { cls: string; label: string }> = {
  created: { cls: 'prepared', label: 'Prepared' },
  pending_sca: { cls: 'pending', label: 'Awaiting authorization' },
  authorized: { cls: 'authorized', label: 'Authorized' },
  executing: { cls: 'executing', label: 'Executing' },
  executed: { cls: 'succeeded', label: 'Succeeded' },
  failed: { cls: 'failed', label: 'Failed' },
  returned: { cls: 'failed', label: 'Returned' },
  refunded: { cls: 'prepared', label: 'Refunded' }
};

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en')} ${currency}`;
  }
}

function maskIban(iban: string) {
  const clean = iban.replace(/\s+/g, '');
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)} ${clean.slice(4, 8)} ••••••• ${clean.slice(-4)}`;
}

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '??'
  );
}

export function PaymentDetailClient({ paymentId }: { paymentId: string }) {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [payment, setPayment] = useState<PaymentDetails | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'release' | 'fail' | null>(null);
  const [verb, setVerb] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    try {
      const details = (await api.getPaymentDetails(orgId, paymentId)) as PaymentDetails;
      setPayment(details);
      setNotFound(false);
    } catch {
      // Not a rail payment — this route also serves payment_intent alpha objects.
      setNotFound(true);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId, paymentId]);

  const statusIdx = useMemo(() => (payment ? STATUS_ORDER.indexOf(payment.status) : -1), [payment]);
  const isProblem = payment ? ['failed', 'returned', 'refunded'].includes(payment.status) : false;
  const canComplete = payment ? payment.scheme === 'MANUAL_TRANSFER' && ['created', 'pending_sca', 'authorized'].includes(payment.status) : false;

  async function complete(status: 'executed' | 'failed') {
    if (!orgId || !payment) return;
    setBusy(true);
    setError(null);
    try {
      await api.completeManualPayment(orgId, payment.payment_id, status);
      setModal(null);
      setVerb('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update payment');
    } finally {
      setBusy(false);
    }
  }

  if (loaded && notFound) {
    return <ObjectWorkspaceDetail objectId={paymentId} config={{ ...paymentsConfig, backHref: '/finance', backLabel: 'Finance workspace' }} />;
  }

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <Link href="/payments" className="uw-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to payments
        </Link>

        {auth.status !== 'authenticated' ? (
          <div className="pay-empty">
            <div className="ic">
              <Lock className="h-6 w-6" />
            </div>
            <h2>Sign in to view this payment</h2>
            <p>Payment details need an authenticated session.</p>
            <div className="pe-cta">
              <Link href="/login" className={buttonClassName()}>
                Go to login
              </Link>
            </div>
          </div>
        ) : !orgId ? (
          <div className="pay-empty">
            <div className="ic">
              <Wallet className="h-6 w-6" />
            </div>
            <h2>Select an organization</h2>
            <p>Pick an org in the sidebar to load this payment.</p>
          </div>
        ) : !loaded || !payment ? (
          <div className="flex items-center gap-2 py-24 text-sm text-text-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading payment…
          </div>
        ) : (
          <>
            <div className="pay-head">
              <div>
                <div className="eyebrow">
                  <span className="id">PAY-{payment.payment_id.slice(0, 8).toUpperCase()}</span>
                  <span className="rail">{payment.scheme.replace(/_/g, ' ')}</span>
                  <span className={cn('fin-pill', STATUS_PILL[payment.status]?.cls ?? 'prepared')}>{STATUS_PILL[payment.status]?.label ?? payment.status}</span>
                </div>
                <h2>
                  {payment.creditor_name}
                  {payment.remittance ? ` · ${payment.remittance}` : ''}
                </h2>
                <div className="parties">
                  <div className="flex items-center gap-2">
                    <div className="av">OP</div>
                    Operating account
                  </div>
                  <span className="arrow">
                    <ArrowRight className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="av buy">{initialsOf(payment.creditor_name)}</div>
                    {payment.creditor_name}
                  </div>
                  {payment.trade_id ? (
                    <span className="mono text-[11px] text-text-3">linked to TRX-{payment.trade_id.slice(0, 8).toUpperCase()}</span>
                  ) : null}
                </div>
              </div>
              <div className="pay-amount">
                <div className="num">{money(payment.amount, payment.currency)}</div>
                <div className="lbl">
                  {payment.currency} · created{' '}
                  {new Date(payment.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>

            <div className="pay-life">
              {LIFECYCLE.map((ls, i) => {
                const state = isProblem
                  ? i <= 1
                    ? 'done'
                    : i === 2
                      ? 'bad'
                      : 'todo'
                  : i < statusIdx
                    ? 'done'
                    : i === statusIdx
                      ? payment.status === 'executed'
                        ? 'done'
                        : 'current'
                      : 'todo';
                return (
                  <div key={ls.key} className={cn('ls', state)}>
                    <div className="step">{isProblem && state === 'bad' ? `0${i + 1} · ${STATUS_PILL[payment.status]?.label}` : ls.step}</div>
                    <div className="nm">{isProblem && state === 'bad' ? 'Rail rejected the payment' : ls.nm}</div>
                    <div className="meta">{i === 0 ? new Date(payment.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''}</div>
                  </div>
                );
              })}
            </div>

            <div className="chrome-strip exec">
              <Lock className="h-4 w-4" />
              <div>
                <b>Execution surface.</b> Completing a payment is a protected action — typed-verb confirmation required. The rail is the
                authority on settlement; TRAIBOX summarizes, it never executes on its own.
              </div>
            </div>

            <div className="pay-grid">
              <div>
                <div className="pay-section">
                  <h3>
                    Beneficiary <span className="ct">as instructed at execution</span>
                  </h3>
                  <div className="pay-row">
                    <span className="lbl">Legal name</span>
                    <span className="v">{payment.creditor_name}</span>
                  </div>
                  <div className="pay-row">
                    <span className="lbl">IBAN</span>
                    <span className="v">{maskIban(payment.creditor_iban)}</span>
                  </div>
                  <div className="pay-row">
                    <span className="lbl">Remittance</span>
                    <span className="v">{payment.remittance ?? '—'}</span>
                  </div>
                  <div className="pay-row">
                    <span className="lbl">End-to-end ID</span>
                    <span className="v">{payment.e2e_id ?? '—'}</span>
                  </div>
                </div>

                <div className="pay-section">
                  <h3>
                    Route <span className="ct">{payment.scheme.replace(/_/g, ' ')}</span>
                  </h3>
                  <div className="pay-route">
                    <div className="hop">
                      <div className="av">OP</div>
                      Operating account
                    </div>
                    <ArrowRight className="arrow h-4 w-4" />
                    <div className="hop">
                      <div className="av" style={{ background: 'var(--violet-soft)', color: 'var(--violet)' }}>
                        {payment.scheme === 'MANUAL_TRANSFER' ? 'MAN' : 'SEPA'}
                      </div>
                      {payment.scheme.replace(/_/g, ' ')}
                    </div>
                    <ArrowRight className="arrow h-4 w-4" />
                    <div className="hop">
                      <div className="av" style={{ background: 'var(--good-soft)', color: 'var(--good)' }}>
                        {initialsOf(payment.creditor_name)}
                      </div>
                      {payment.creditor_name}
                    </div>
                  </div>
                  <div className="pay-row">
                    <span className="lbl">Rail</span>
                    <span className="v">{payment.scheme.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="pay-row">
                    <span className="lbl">Status</span>
                    <span className={cn('v', payment.status === 'executed' ? 'good' : isProblem ? 'warn' : undefined)}>
                      {STATUS_PILL[payment.status]?.label ?? payment.status}
                    </span>
                  </div>
                  <div className="pay-row">
                    <span className="lbl">Total</span>
                    <span className="v" style={{ fontSize: 14 }}>
                      {money(payment.amount, payment.currency)}
                    </span>
                  </div>
                </div>

                {payment.trade_id ? (
                  <div className="pay-section">
                    <h3>Linked context</h3>
                    <div className="pay-row">
                      <span className="lbl">Trade</span>
                      <span className="v">
                        <Link href={`/trades/${payment.trade_id}`} className="text-cyan-text hover:underline">
                          TRX-{payment.trade_id.slice(0, 8).toUpperCase()} →
                        </Link>
                      </span>
                    </div>
                    <div className="pay-row">
                      <span className="lbl">Proofs</span>
                      <span className="v">
                        <Link href={`/trades/${payment.trade_id}/proof`} className="text-cyan-text hover:underline">
                          Ledger proof bundle →
                        </Link>
                      </span>
                    </div>
                  </div>
                ) : null}

                {error ? <div className="mb-3 text-sm text-bad">{error}</div> : null}

                <div className="ai-note" style={{ marginTop: 18 }}>
                  <div className="ib">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    {canComplete ? (
                      <>
                        <b>Waiting on the bank leg.</b> This manual transfer needs to be submitted in your bank, then marked executed here
                        so TRAIBOX can reconcile by end-to-end ID and continue the flow.
                      </>
                    ) : payment.status === 'executed' ? (
                      <>
                        <b>Settled.</b> The rail accepted this payment; the record above is what was instructed and is preserved in the
                        audit chain.
                      </>
                    ) : (
                      <>
                        <b>Live record.</b> This page reflects the payment&rsquo;s state on the rail — it updates as the lifecycle
                        progresses.
                      </>
                    )}
                  </div>
                </div>
              </div>

              <aside>
                <div className="pa-side">
                  {canComplete ? (
                    <>
                      <div className="pa-eyebrow">
                        <Lock className="h-3.5 w-3.5" />
                        Protected action · typed-verb
                      </div>
                      <h3>Complete transfer</h3>
                      <div className="desc">
                        Marks {money(payment.amount, payment.currency)} to {payment.creditor_name} as executed on the manual rail. Final —
                        the audit chain records your confirmation.
                      </div>
                      <div className="pa-amt">
                        {money(payment.amount, payment.currency)}
                        <span className="lbl">{payment.currency} · disbursement</span>
                      </div>
                      <div className="pa-meta">
                        <span className="lbl">Beneficiary</span>
                        <span className="v">{payment.creditor_name}</span>
                        <span className="lbl">IBAN</span>
                        <span className="v">••••{payment.creditor_iban.replace(/\s+/g, '').slice(-4)}</span>
                        <span className="lbl">Rail</span>
                        <span className="v">{payment.scheme.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="btn-stack">
                        <Button className="btn-danger-glow justify-center" onClick={() => setModal('release')}>
                          <LockOpen className="h-4 w-4" /> Mark executed · type &ldquo;RELEASE&rdquo;
                        </Button>
                        <Button variant="secondary" className="justify-center" onClick={() => setModal('fail')}>
                          <X className="h-4 w-4" /> Mark failed
                        </Button>
                      </div>
                      <div className="trace">
                        <Fingerprint className="h-3 w-3" /> {payment.e2e_id ? `e2e ${payment.e2e_id.slice(0, 13)}…` : `pay ${payment.payment_id.slice(0, 8)}`}
                      </div>
                    </>
                  ) : payment.status === 'executed' ? (
                    <>
                      <div className="pa-eyebrow">
                        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--good)' }} />
                        Settled
                      </div>
                      <h3>Payment succeeded</h3>
                      <div className="desc">The rail confirmed settlement. Everything above is preserved in the audit chain.</div>
                      <div className="pa-amt" style={{ color: 'var(--good)' }}>
                        {money(payment.amount, payment.currency)}
                        <span className="lbl">settled</span>
                      </div>
                      <div className="btn-stack">
                        {payment.trade_id ? (
                          <Link href={`/trades/${payment.trade_id}`} className={cn(buttonClassName({ variant: 'secondary' }), 'justify-center')}>
                            Open trade <ArrowUpRight className="h-3.5 w-3.5" />
                          </Link>
                        ) : null}
                        <Link href="/payments" className={cn(buttonClassName({ variant: 'ghost' }), 'justify-center')}>
                          All payments
                        </Link>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="pa-eyebrow">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {isProblem ? 'Needs attention' : 'On the rail'}
                      </div>
                      <h3>{STATUS_PILL[payment.status]?.label ?? payment.status}</h3>
                      <div className="desc">
                        {isProblem
                          ? 'The rail rejected or returned this payment. Review the details and start a corrected payment if needed.'
                          : 'This payment is progressing on the rail — no action needed from you right now.'}
                      </div>
                      <div className="btn-stack">
                        <Link href="/payments" className={cn(buttonClassName({ variant: 'secondary' }), 'justify-center')}>
                          Back to payments
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              </aside>
            </div>

            {modal ? (
              <div className="pa-overlay" onClick={() => !busy && setModal(null)}>
                <div className="pa-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="pa-modal-head">
                    <div className="ico-wrap">
                      {modal === 'release' ? <LockOpen className="h-5 w-5" /> : <X className="h-5 w-5" />}
                    </div>
                    <h2>{modal === 'release' ? 'Mark payment as executed' : 'Mark payment as failed'}</h2>
                    <div className="sub">
                      {modal === 'release'
                        ? 'Confirms the bank transfer was submitted and completed. TRAIBOX reconciles and continues the trade flow.'
                        : 'Records that the transfer did not complete. The payment leaves the queue and the trade flow is notified.'}
                    </div>
                  </div>
                  <div className="pa-summary">
                    <div className="row">
                      <span className="lbl">Amount</span>
                      <span className="v amt">{money(payment.amount, payment.currency)}</span>
                    </div>
                    <div className="row">
                      <span className="lbl">Beneficiary</span>
                      <span className="v">{payment.creditor_name}</span>
                    </div>
                    <div className="row">
                      <span className="lbl">IBAN</span>
                      <span className="v">{maskIban(payment.creditor_iban)}</span>
                    </div>
                  </div>
                  <div className="pa-consequence">
                    <AlertTriangle className="h-4 w-4" />
                    <div>
                      <b>This is final.</b> The status change is written to the audit chain and cannot be undone from this screen.
                    </div>
                  </div>
                  <div className="pa-verb">
                    <label className="pa-verb-lbl">
                      Type <code>{modal === 'release' ? 'RELEASE' : 'FAIL'}</code> to confirm
                    </label>
                    <input
                      className={cn('pa-verb-input', verb.toUpperCase() === (modal === 'release' ? 'RELEASE' : 'FAIL') && 'match')}
                      value={verb}
                      onChange={(e) => setVerb(e.target.value)}
                      autoFocus
                      spellCheck={false}
                    />
                  </div>
                  <div className="pa-actions">
                    <Button variant="secondary" disabled={busy} onClick={() => setModal(null)}>
                      Cancel
                    </Button>
                    <Button
                      className={modal === 'release' ? 'btn-danger-glow' : undefined}
                      variant={modal === 'release' ? undefined : 'danger'}
                      disabled={busy || verb.toUpperCase() !== (modal === 'release' ? 'RELEASE' : 'FAIL')}
                      onClick={() => void complete(modal === 'release' ? 'executed' : 'failed')}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : modal === 'release' ? 'Release' : 'Mark failed'}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
