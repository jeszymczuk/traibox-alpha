'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { api } from '../../../lib/api';
import { useAuth } from '../../../components/providers';

export default function ManualPaymentPage() {
  const auth = useAuth();
  const sp = useSearchParams();
  const paymentId = sp.get('payment_id') ?? '';
  const orgId = sp.get('org_id') ?? '';
  const tradeId = sp.get('trade_id') ?? '';

  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    localStorage.setItem('traibox_org_id', orgId);
  }, [orgId]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!orgId || !paymentId) return;
    void (async () => {
      try {
        setError(null);
        const d = await api.getPaymentDetails(orgId, paymentId);
        setDetails(d);
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load payment');
      }
    })();
  }, [auth.status, orgId, paymentId]);

  const maskedIban = useMemo(() => {
    const iban = String(details?.creditor_iban ?? '');
    if (!iban) return '';
    if (iban.length <= 8) return iban;
    return `${iban.slice(0, 4)}…${iban.slice(-4)}`;
  }, [details?.creditor_iban]);

  return (
    <div className="min-h-dvh bg-paper text-ink p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <header className="space-y-1">
          <div className="text-xs text-muted">TRAIBOX • Manual Payment</div>
          <h1 className="text-2xl font-semibold">Complete the transfer in your bank</h1>
          <p className="text-sm text-muted">
            Use your bank app/portal to submit the transfer, then mark it as executed here so TRAIBOX can continue the flow.
          </p>
        </header>

        {auth.status === 'loading' ? (
          <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5 text-sm text-muted">Loading…</div>
        ) : auth.status === 'unauthenticated' ? (
          <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5 text-sm">
            <div className="font-medium">Please sign in</div>
            <div className="mt-1 text-muted">You must be authenticated to view or complete this payment.</div>
            <div className="mt-3">
              <Link className="inline-flex rounded-xl bg-accent text-white px-4 py-2 font-medium" href="/login">
                Go to login
              </Link>
            </div>
          </div>
        ) : !orgId || !paymentId ? (
          <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5 text-sm">
            Missing <span className="font-medium">org_id</span> or <span className="font-medium">payment_id</span>.
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5 text-sm">
            <div className="font-medium text-error">Couldn’t load payment</div>
            <div className="mt-1 text-muted">{error}</div>
          </div>
        ) : !details ? (
          <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5 text-sm text-muted">Loading…</div>
        ) : (
          <div className="rounded-2xl bg-white shadow-sm border border-black/5 p-5 space-y-4">
            <div className="text-sm">
              Status: <span className="font-medium">{details.status}</span>
            </div>

            <div className="grid gap-2 text-sm">
              <Row label="Creditor" value={details.creditor_name} />
              <Row label="Creditor IBAN" value={maskedIban} />
              <Row label="Amount" value={`${details.amount} ${details.currency}`} />
              <Row label="Remittance" value={details.remittance ?? '—'} />
              <Row label="End-to-end ID" value={details.e2e_id ?? '—'} />
              <Row label="Payment ID" value={details.payment_id} mono />
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                disabled={busy}
                className="rounded-xl bg-ink text-paper px-3 py-2 text-sm disabled:opacity-50"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.completeManualPayment(orgId, paymentId, 'executed');
                    const d = await api.getPaymentDetails(orgId, paymentId);
                    setDetails(d);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Mark executed
              </button>
              <button
                disabled={busy}
                className="rounded-xl border border-black/10 px-3 py-2 text-sm disabled:opacity-50"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.completeManualPayment(orgId, paymentId, 'failed');
                    const d = await api.getPaymentDetails(orgId, paymentId);
                    setDetails(d);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Mark failed
              </button>
              {tradeId ? (
                <Link className="rounded-xl border border-black/10 px-3 py-2 text-sm" href={`/trade/${tradeId}`}>
                  Back to trade
                </Link>
              ) : null}
            </div>
          </div>
        )}

        <footer className="text-xs text-muted">
          Tip: If you later connect AIS for this account, TRAIBOX can reconcile by matching the end-to-end ID and amount.
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-baseline">
      <div className="text-muted">{label}</div>
      <div className={mono ? 'font-mono text-xs break-all' : 'break-words'}>{value}</div>
    </div>
  );
}
