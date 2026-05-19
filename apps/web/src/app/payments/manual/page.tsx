'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { api } from '../../../lib/api';
import { useAuth } from '../../../components/providers';
import { Surface } from '../../../components/ui/surface';
import { Button, buttonClassName } from '../../../components/ui/button';

export default function ManualPaymentPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-paper text-ink p-6">Loading manual payment…</div>}>
      <ManualPaymentContent />
    </Suspense>
  );
}

function ManualPaymentContent() {
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
          <Surface className="p-5 text-sm text-muted">Loading…</Surface>
        ) : auth.status === 'unauthenticated' ? (
          <Surface className="p-5 text-sm">
            <div className="font-medium">Please sign in</div>
            <div className="mt-1 text-muted">You must be authenticated to view or complete this payment.</div>
            <div className="mt-3">
              <Link className={buttonClassName()} href="/login">
                Go to login
              </Link>
            </div>
          </Surface>
        ) : !orgId || !paymentId ? (
          <Surface className="p-5 text-sm">
            Missing <span className="font-medium">org_id</span> or <span className="font-medium">payment_id</span>.
          </Surface>
        ) : error ? (
          <Surface className="p-5 text-sm">
            <div className="font-medium text-error">Couldn’t load payment</div>
            <div className="mt-1 text-muted">{error}</div>
          </Surface>
        ) : !details ? (
          <Surface className="p-5 text-sm text-muted">Loading…</Surface>
        ) : (
          <Surface className="p-5 space-y-4">
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
              <Button
                disabled={busy}
                variant="ink"
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
              </Button>
              <Button
                disabled={busy}
                variant="secondary"
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
              </Button>
              {tradeId ? (
                <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={`/trade/${tradeId}`}>
                  Back to trade
                </Link>
              ) : null}
            </div>
          </Surface>
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
