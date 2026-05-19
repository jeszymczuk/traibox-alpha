'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';

type PartnerState =
  | { status: 'signed_out' }
  | { status: 'signing_in' }
  | { status: 'signed_in'; token: string; partnerId: string };

export default function PartnerPortalPage() {
  const [apiKey, setApiKey] = useState('');
  const [state, setState] = useState<PartnerState>({ status: 'signed_out' });
  const [profile, setProfile] = useState<any>(null);
  const [requests, setRequests] = useState<any[]>([]);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const savedToken = localStorage.getItem('traibox_partner_token');
    const savedPartnerId = localStorage.getItem('traibox_partner_id');
    if (savedToken && savedPartnerId) {
      setState({ status: 'signed_in', token: savedToken, partnerId: savedPartnerId });
    }
  }, []);

  const token = state.status === 'signed_in' ? state.token : null;

  const refresh = async (t: string) => {
    setError(null);
    const p = await api.partnerGetProfile(t);
    setProfile(p);
    const r = await api.partnerListOfferRequests(t, 'pending');
    setRequests(r.items ?? []);
  };

  useEffect(() => {
    if (!token) return;
    void refresh(token);
  }, [token]);

  const signedInPartnerName = useMemo(() => {
    return profile?.display_name ?? profile?.partner_id ?? null;
  }, [profile]);

  const signOut = () => {
    localStorage.removeItem('traibox_partner_token');
    localStorage.removeItem('traibox_partner_id');
    setProfile(null);
    setRequests([]);
    setState({ status: 'signed_out' });
  };

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <header className="h-14 border-b border-black/10 bg-paper/70 backdrop-blur flex items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <div className="font-semibold">TRAIBOX</div>
          <div className="text-sm text-muted">Partner Portal (MVP)</div>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-accent font-medium">
            Back to app
          </Link>
          {state.status === 'signed_in' ? (
            <button className="rounded-xl border border-black/10 px-3 py-2 text-sm" onClick={signOut}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-6">
        {state.status !== 'signed_in' ? (
          <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
            <h1 className="text-xl font-semibold">Sign in</h1>
            <p className="text-sm text-muted mt-1">Use your Partner API key to fetch pending offer requests and submit offers.</p>
            <div className="mt-4 flex gap-2">
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="pk_…"
                className="flex-1 rounded-xl border border-black/10 bg-paper px-3 py-2 text-sm"
              />
              <button
                className="rounded-xl bg-ink text-paper px-3 py-2 text-sm disabled:opacity-50"
                disabled={state.status === 'signing_in' || apiKey.trim().length < 10}
                onClick={async () => {
                  try {
                    setError(null);
                    setState({ status: 'signing_in' });
                    const resp = await api.partnerAuthToken(apiKey.trim());
                    localStorage.setItem('traibox_partner_token', resp.access_token);
                    localStorage.setItem('traibox_partner_id', resp.partner_id);
                    setState({ status: 'signed_in', token: resp.access_token, partnerId: resp.partner_id });
                    setApiKey('');
                  } catch (e: any) {
                    setState({ status: 'signed_out' });
                    setError(e?.message ?? 'Sign-in failed');
                  }
                }}
              >
                Sign in
              </button>
            </div>
            {error ? <div className="mt-3 text-sm text-error">{error}</div> : null}
          </section>
        ) : (
          <>
            <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold">{signedInPartnerName ?? 'Partner'}</h1>
                  <div className="text-sm text-muted mt-1">Partner ID: {state.partnerId}</div>
                </div>
                <button
                  className="rounded-xl border border-black/10 px-3 py-2 text-sm"
                  onClick={async () => {
                    if (!token) return;
                    await refresh(token);
                  }}
                >
                  Refresh
                </button>
              </div>
              <pre className="mt-4 text-xs whitespace-pre-wrap">{JSON.stringify(profile, null, 2)}</pre>
            </section>

            <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
              <h2 className="text-lg font-semibold">Pending offer requests</h2>
              {requests.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No pending requests.</p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {requests.map((r) => (
                    <li key={r.request_id} className="rounded-xl border border-black/10 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-medium text-sm">Request {r.request_id}</div>
                          <div className="text-xs text-muted mt-1 break-all">Trade: {r.trade_id}</div>
                          <div className="text-xs text-muted mt-1">
                            Amount {r.amount} {r.currency} • Tenor {r.tenor_days} days
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            className="rounded-xl border border-black/10 px-3 py-2 text-xs disabled:opacity-50"
                            disabled={busyRequestId === r.request_id}
                            onClick={async () => {
                              if (!token) return;
                              try {
                                setBusyRequestId(r.request_id);
                                setError(null);
                                await api.partnerSubmitOffers(token, r.request_id, {
                                  offers: [
                                    {
                                      apr_bps: 480,
                                      fees: 0,
                                      tenor_days: r.tenor_days,
                                      currency: r.currency,
                                      sustainability_tag: 'none',
                                      sustainability_grade: 'not_sustainable',
                                      explanations: ['Submitted via TRAIBOX Partner Portal']
                                    }
                                  ]
                                });
                                await refresh(token);
                              } catch (e: any) {
                                setError(e?.message ?? 'Submit failed');
                              } finally {
                                setBusyRequestId(null);
                              }
                            }}
                          >
                            Submit standard
                          </button>
                          <button
                            className="rounded-xl bg-accent text-white px-3 py-2 text-xs font-medium disabled:opacity-50"
                            disabled={busyRequestId === r.request_id}
                            onClick={async () => {
                              if (!token) return;
                              try {
                                setBusyRequestId(r.request_id);
                                setError(null);
                                await api.partnerSubmitOffers(token, r.request_id, {
                                  offers: [
                                    {
                                      apr_bps: 450,
                                      fees: 25,
                                      tenor_days: r.tenor_days,
                                      currency: r.currency,
                                      sustainability_tag: 'green_uop',
                                      sustainability_grade: 'eligible',
                                      verification_level: 'self',
                                      sustainable_pricing_delta_bps: -5,
                                      explanations: ['STF-ready (partner declared)', 'Submitted via TRAIBOX Partner Portal']
                                    }
                                  ]
                                });
                                await refresh(token);
                              } catch (e: any) {
                                setError(e?.message ?? 'Submit failed');
                              } finally {
                                setBusyRequestId(null);
                              }
                            }}
                          >
                            Submit green
                          </button>
                        </div>
                      </div>
                      <details className="mt-3">
                        <summary className="text-xs text-muted cursor-pointer">Request payload</summary>
                        <pre className="mt-2 text-xs whitespace-pre-wrap">{JSON.stringify(r, null, 2)}</pre>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
              {error ? <div className="mt-3 text-sm text-error">{error}</div> : null}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

