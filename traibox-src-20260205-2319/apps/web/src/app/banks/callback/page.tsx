'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '../../../lib/api';
import Link from 'next/link';

export default function BanksCallbackPage() {
  const sp = useSearchParams();
  const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const code = sp.get('code') ?? '';
  const state = sp.get('state') ?? undefined;
  const error = sp.get('error') ?? undefined;
  const decoded = useMemo(() => parseOauthState(state ?? null), [state]);
  const consentId = sp.get('consent_id') ?? decoded?.consent_id ?? '';
  const tradeId = sp.get('trade_id') ?? decoded?.trade_id ?? undefined;

  const orgId = useMemo(() => (typeof window === 'undefined' ? null : window.localStorage.getItem('traibox_org_id')), []);

  useEffect(() => {
    if (error) {
      setStatus('error');
      setMessage(error);
      return;
    }
    if (!orgId) {
      setStatus('error');
      setMessage('Missing org context (select an org first).');
      return;
    }
    if (!consentId || !code) return;

    setStatus('working');
    void (async () => {
      try {
        await api.exchangeBankConsent(orgId, { consent_id: consentId, code, state });
        setStatus('done');
        setMessage('Bank connected.');
        if (tradeId) window.location.href = `/trade/${tradeId}`;
        else window.location.href = `/`;
      } catch (e: any) {
        setStatus('error');
        setMessage(e?.message ?? 'Failed to exchange code');
      }
    })();
  }, [code, consentId, error, orgId, state, tradeId]);

  return (
    <div className="min-h-dvh flex items-center justify-center bg-paper text-ink">
      <div className="w-full max-w-md rounded-2xl border border-black/10 bg-white shadow-sm p-6 space-y-3">
        <div className="text-lg font-semibold">Connecting bank…</div>
        <div className="text-sm text-muted">
          Status: <span className="font-medium text-ink">{status}</span>
        </div>
        {message ? <div className="text-sm">{message}</div> : null}
        <div className="pt-2">
          <Link className="text-accent font-medium text-sm" href="/">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function parseOauthState(state: string | null): { consent_id: string; trade_id?: string } | null {
  if (!state) return null;
  try {
    const b64 = state.replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(b64 + pad);
    const obj = JSON.parse(json) as any;
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.consent_id !== 'string' || obj.consent_id.length < 10) return null;
    const tradeId = typeof obj.trade_id === 'string' && obj.trade_id.length > 10 ? obj.trade_id : undefined;
    return { consent_id: obj.consent_id, trade_id: tradeId };
  } catch {
    return null;
  }
}
