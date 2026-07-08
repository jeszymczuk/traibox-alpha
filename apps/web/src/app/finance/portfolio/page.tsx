'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowUpRight, ChartPie, Loader2, Lock, Minus } from 'lucide-react';
import type { FinanceReservationItem, FundingRequestItem, PaymentListItem } from '@traibox/contracts';

import { AppShell } from '../../../components/shell';
import { useOrgSelection } from '../../../components/use-org';
import { Button } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/cn';

const DONUT_COLORS = ['rgba(74,178,234,0.85)', 'rgba(154,141,242,0.85)', 'rgba(91,214,194,0.85)', 'rgba(230,168,71,0.85)', 'rgba(230,137,200,0.85)'];
const CONCENTRATION_CAP = 0.2; // 20% single-name policy cap

function money(amount: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: amount >= 10_000 ? 0 : 2, notation: amount >= 1_000_000 ? 'compact' : 'standard' }).format(amount);
  } catch {
    return `${amount.toLocaleString('en')} ${currency}`;
  }
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

export default function PortfolioPage() {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [requests, setRequests] = useState<FundingRequestItem[]>([]);
  const [reservations, setReservations] = useState<FinanceReservationItem[]>([]);
  const [payments, setPayments] = useState<PaymentListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void (async () => {
      setError(null);
      try {
        const [funding, payRes] = await Promise.all([api.listFunding(orgId), api.listPayments(orgId, 500)]);
        setRequests(funding.requests ?? []);
        setReservations(funding.reservations ?? []);
        setPayments(payRes.payments ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load portfolio');
      } finally {
        setLoaded(true);
      }
    })();
  }, [auth.status, orgId]);

  const facilities = reservations.filter((r) => r.status === 'active');
  const deployed = facilities.reduce((s, f) => s + (f.amount ?? 0), 0);
  const settled = payments.filter((p) => p.status === 'executed');
  const settledTotal = settled.reduce((s, p) => s + p.amount, 0);
  const inFlight = payments.filter((p) => ['authorized', 'executing'].includes(p.status));
  const blendedApr = facilities.length
    ? facilities.reduce((s, f) => s + f.apr_bps * (f.amount ?? 1), 0) / Math.max(facilities.reduce((s, f) => s + (f.amount ?? 1), 0), 1)
    : null;
  const avgTenor = facilities.length ? Math.round(facilities.reduce((s, f) => s + f.tenor_days, 0) / facilities.length) : null;
  const openRequestValue = requests.filter((r) => !r.offers.some((o) => facilities.some((f) => f.offer_id === o.offer_id))).reduce((s, r) => s + r.amount, 0);

  // Composition by financier (facilities), falling back to payment schemes when no facilities exist.
  const composition = useMemo(() => {
    const groups = new Map<string, number>();
    if (facilities.length > 0) {
      for (const f of facilities) groups.set(f.financier_name, (groups.get(f.financier_name) ?? 0) + (f.amount ?? 0));
    } else {
      for (const p of settled) groups.set(p.scheme.replace(/_/g, ' '), (groups.get(p.scheme) ?? 0) + p.amount);
    }
    const total = [...groups.values()].reduce((s, v) => s + v, 0);
    return {
      total,
      slices: [...groups.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, value], i) => ({ name, value, pct: total > 0 ? value / total : 0, color: DONUT_COLORS[i % DONUT_COLORS.length]! }))
    };
  }, [facilities, settled]);

  // Single-name concentration across outbound settled + in-flight payments.
  const concentration = useMemo(() => {
    const groups = new Map<string, number>();
    for (const p of payments) {
      if (['failed', 'returned', 'refunded'].includes(p.status)) continue;
      groups.set(p.creditor_name, (groups.get(p.creditor_name) ?? 0) + p.amount);
    }
    const book = [...groups.values()].reduce((s, v) => s + v, 0);
    const cap = book * CONCENTRATION_CAP;
    return {
      book,
      cap,
      rows: [...groups.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, value], i) => ({ name, value, ofCap: cap > 0 ? value / cap : 0, violet: i % 2 === 1 }))
    };
  }, [payments]);

  // Cumulative deployment curve over the last 9 months from executed payments.
  const curve = useMemo(() => {
    const now = new Date();
    const months: Array<{ label: string; total: number }> = [];
    for (let i = 8; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ label: d.toLocaleDateString('en-GB', { month: 'short' }), total: 0 });
    }
    const startIdx = new Date(now.getFullYear(), now.getMonth() - 8, 1).getTime();
    let running = 0;
    const sorted = [...settled].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (const p of sorted) {
      const t = new Date(p.created_at);
      if (t.getTime() < startIdx) {
        running += p.amount;
        continue;
      }
      const idx = (t.getFullYear() - new Date(startIdx).getFullYear()) * 12 + t.getMonth() - new Date(startIdx).getMonth();
      if (idx >= 0 && idx < months.length) {
        for (let j = idx; j < months.length; j++) months[j]!.total += p.amount;
      }
    }
    for (const m of months) m.total += running;
    const max = Math.max(...months.map((m) => m.total), 1);
    return { months, max };
  }, [settled]);

  const W = 700;
  const H = 232;
  const X0 = 50;
  const X1 = 680;
  const Y0 = 200;
  const Y1 = 20;
  const points = curve.months.map((m, i) => ({
    x: X0 + (i * (X1 - X0)) / Math.max(curve.months.length - 1, 1),
    y: Y0 - (m.total / curve.max) * (Y0 - Y1),
    ...m
  }));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${X1} ${Y0} L ${X0} ${Y0} Z`;

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <Link href="/finance" className="uw-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          Finance
        </Link>

        <div className="page-head" style={{ paddingTop: 0 }}>
          <div>
            <div className="mono mb-1.5 text-[11px] uppercase tracking-wider text-text-3">Trade finance · live</div>
            <h1>Portfolio analytics</h1>
            <div className="sub">Composition, concentration, deployment curve, and your top exposures — computed live from your facilities and payment rails.</div>
          </div>
        </div>

        {auth.status !== 'authenticated' ? (
          <div className="pay-empty">
            <div className="ic">
              <Lock className="h-6 w-6" />
            </div>
            <h2>Sign in to view portfolio analytics</h2>
            <p>Portfolio analytics needs an authenticated session and an organization.</p>
          </div>
        ) : !orgId ? (
          <div className="pay-empty">
            <div className="ic">
              <ChartPie className="h-6 w-6" />
            </div>
            <h2>Select an organization</h2>
            <p>Pick an org in the sidebar to compute its portfolio.</p>
          </div>
        ) : !loaded ? (
          <div className="flex items-center gap-2 py-24 text-sm text-text-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Computing portfolio…
          </div>
        ) : error ? (
          <div className="pay-empty">
            <div className="ic">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2>Couldn&rsquo;t load portfolio</h2>
            <p>{error}</p>
          </div>
        ) : payments.length === 0 && facilities.length === 0 ? (
          <div className="pay-empty">
            <div className="ic">
              <ChartPie className="h-6 w-6" />
            </div>
            <h2>No portfolio yet</h2>
            <p>Once payments settle and funding facilities go live, composition, concentration and the deployment curve are computed here.</p>
            <div className="pe-cta">
              <Link href="/finance" className="inline-block">
                <Button variant="secondary">Open Finance →</Button>
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="pf-grid">
              <div className="pf-stat">
                <div className="v">{deployed > 0 ? money(deployed) : '—'}</div>
                <div className="l">Reserved capital</div>
                <div className={cn('delta', facilities.length === 0 && 'flat')}>
                  {facilities.length > 0 ? <ArrowUpRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                  {facilities.length} facilit{facilities.length === 1 ? 'y' : 'ies'}
                </div>
              </div>
              <div className="pf-stat">
                <div className="v good">{blendedApr !== null ? `${(blendedApr / 100).toFixed(2)}%` : '—'}</div>
                <div className="l">Blended all-in</div>
                <div className="delta flat">
                  <Minus className="h-3 w-3" />
                  weighted by size
                </div>
              </div>
              <div className="pf-stat">
                <div className="v cyan">{settled.length}</div>
                <div className="l">Payments settled</div>
                <div className="delta">
                  <ArrowUpRight className="h-3 w-3" />
                  {money(settledTotal)} total
                </div>
              </div>
              <div className="pf-stat">
                <div className="v">{avgTenor !== null ? `${avgTenor}d` : '—'}</div>
                <div className="l">Avg tenor</div>
                <div className="delta flat">
                  <Minus className="h-3 w-3" />
                  active facilities
                </div>
              </div>
              <div className="pf-stat">
                <div className={cn('v', inFlight.length > 0 && 'warn')}>{inFlight.length}</div>
                <div className="l">In flight</div>
                <div className="delta flat">
                  <Minus className="h-3 w-3" />
                  {money(inFlight.reduce((s, p) => s + p.amount, 0))}
                </div>
              </div>
              <div className="pf-stat">
                <div className="v">{openRequestValue > 0 ? money(openRequestValue) : '—'}</div>
                <div className="l">Pipeline</div>
                <div className="delta flat">
                  <Minus className="h-3 w-3" />
                  open requests
                </div>
              </div>
            </div>

            <div className="pf-row">
              <div className="pf-card">
                <h3>
                  Portfolio composition <span className="ct">{facilities.length > 0 ? 'by financier' : 'by payment scheme'}</span>
                </h3>
                <div className="desc">Where capital sits today, from live {facilities.length > 0 ? 'facilities' : 'settled payments'}.</div>
                {composition.slices.length === 0 ? (
                  <p className="text-sm text-text-3">Nothing to compose yet.</p>
                ) : (
                  <div className="pf-donut-wrap">
                    <div className="pf-donut">
                      <svg viewBox="0 0 200 200" width="170" height="170" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(127,127,127,0.10)" strokeWidth="22" />
                        {(() => {
                          const C = 2 * Math.PI * 70;
                          let offset = 0;
                          return composition.slices.map((s) => {
                            const len = s.pct * C;
                            const el = (
                              <circle
                                key={s.name}
                                cx="100"
                                cy="100"
                                r="70"
                                fill="none"
                                stroke={s.color}
                                strokeWidth="22"
                                strokeDasharray={`${len.toFixed(1)} ${C.toFixed(1)}`}
                                strokeDashoffset={-offset}
                              />
                            );
                            offset += len;
                            return el;
                          });
                        })()}
                      </svg>
                      <div className="center">
                        <div className="num">{money(composition.total)}</div>
                        <div className="lbl">{facilities.length > 0 ? 'Reserved' : 'Settled'}</div>
                      </div>
                    </div>
                    <div className="pf-donut-leg">
                      {composition.slices.map((s) => (
                        <div key={s.name} className="row">
                          <div className="swatch" style={{ background: s.color }} />
                          <div className="nm">{s.name}</div>
                          <div className="val">{money(s.value)}</div>
                          <div className="pct">{Math.round(s.pct * 100)}%</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="pf-card">
                <h3>
                  Single-name concentration <span className="ct">cap {Math.round(CONCENTRATION_CAP * 100)}% per name{concentration.cap > 0 ? ` · ${money(concentration.cap)}` : ''}</span>
                </h3>
                <div className="desc">Top beneficiary exposures vs your concentration cap. The marker is the policy limit.</div>
                {concentration.rows.length === 0 ? (
                  <p className="text-sm text-text-3">No exposures yet.</p>
                ) : (
                  <div className="pf-conc">
                    {concentration.rows.map((r) => (
                      <div key={r.name} className={cn('row', r.ofCap > 0.8 && 'warn')}>
                        <div className="nm">
                          <div className={cn('pfav', r.violet && 'violet')}>{initialsOf(r.name)}</div>
                          <div className="info">
                            <div className="l">{r.name}</div>
                            <div className="s">{money(r.value)}</div>
                          </div>
                        </div>
                        <div className="bar">
                          <div className="fill" style={{ width: `${Math.min(100, Math.round(r.ofCap * 100))}%` }} />
                        </div>
                        <div className="pct">{Math.round(r.ofCap * 100)}%</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pf-deploy">
              <div className="dhead">
                <div>
                  <h3>Capital deployment</h3>
                  <div className="desc">9-month curve · cumulative settled outbound value at month-end</div>
                </div>
                <div className="dlegend">
                  <div className="lg">
                    <span className="sw" style={{ background: 'rgba(74,178,234,0.75)' }} />
                    Settled
                  </div>
                </div>
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <linearGradient id="pfArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(74,178,234,0.35)" />
                    <stop offset="100%" stopColor="rgba(74,178,234,0.02)" />
                  </linearGradient>
                </defs>
                <line x1={X0} y1={Y0} x2={X1} y2={Y0} stroke="rgba(127,127,127,0.18)" />
                {[0.2, 0.4, 0.6, 0.8, 1].map((f) => (
                  <line key={f} x1={X0} y1={Y0 - f * (Y0 - Y1)} x2={X1} y2={Y0 - f * (Y0 - Y1)} stroke="rgba(127,127,127,0.10)" strokeDasharray="3 5" />
                ))}
                <g fontFamily="var(--font-mono)" fontSize="9.5" fill="var(--text-3)" letterSpacing=".04em">
                  {[0, 0.5, 1].map((f) => (
                    <text key={f} x={X0 - 8} y={Y0 - f * (Y0 - Y1) + 4} textAnchor="end">
                      {money(curve.max * f)}
                    </text>
                  ))}
                  {points.map((p) => (
                    <text key={p.label + p.x} x={p.x} y={Y0 + 18} textAnchor="middle">
                      {p.label.toUpperCase()}
                    </text>
                  ))}
                </g>
                <path d={areaPath} fill="url(#pfArea)" />
                <path d={linePath} stroke="rgba(74,178,234,0.95)" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
                <g fill="rgba(74,178,234,0.95)">
                  {points.map((p) => (
                    <circle key={`pt-${p.x}`} cx={p.x} cy={p.y} r="3" />
                  ))}
                </g>
              </svg>
            </div>

            <div className="ai-note">
              <div className="ib">
                <ChartPie className="h-3.5 w-3.5" />
              </div>
              <div>
                <b>Computed from your rails, not reported numbers.</b> Composition comes from live facilities, concentration from actual
                beneficiary flows, and the deployment curve from settled payments — nothing here is a manual estimate.
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
