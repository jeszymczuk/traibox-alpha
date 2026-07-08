'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Map as MapIcon, Plus, ShieldCheck, Sparkles, Users } from 'lucide-react';
import type { AlphaObject, FinanceReservationItem, FundingRequestItem } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { WorkspaceGuard } from '../../components/workspace-guard';
import { Button, buttonClassName } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type NetTab = 'map' | 'counterparties' | 'financiers';

const BUYER_ROLES = new Set(['buyer', 'importer', 'customer']);

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

function roleOf(object: AlphaObject): string {
  const payload = (object.payload_json ?? {}) as Record<string, unknown>;
  return String(payload.role ?? payload.party_role ?? 'counterparty').toLowerCase();
}

function trustOf(object: AlphaObject): number | null {
  const payload = (object.payload_json ?? {}) as Record<string, unknown>;
  const t = Number(payload.trust_score);
  return Number.isFinite(t) ? Math.round(t) : null;
}

function money(amount: number, currency = 'EUR') {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en')} ${currency}`;
  }
}

export default function NetworkPage() {
  const router = useRouter();
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [tab, setTab] = useState<NetTab>('map');
  const [counterparties, setCounterparties] = useState<AlphaObject[]>([]);
  const [requests, setRequests] = useState<FundingRequestItem[]>([]);
  const [reservations, setReservations] = useState<FinanceReservationItem[]>([]);
  const [minTrust, setMinTrust] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void (async () => {
      setError(null);
      try {
        const [objectRes, funding] = await Promise.all([api.queryAlphaObjects(orgId, { type: 'counterparty', limit: 200 }), api.listFunding(orgId)]);
        setCounterparties(objectRes.objects ?? []);
        setRequests(funding.requests ?? []);
        setReservations(funding.reservations ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load network');
      } finally {
        setLoaded(true);
      }
    })();
  }, [auth.status, orgId]);

  const financiers = useMemo(() => {
    const map = new Map<string, { name: string; offers: number; bestApr: number; reserved: number }>();
    for (const r of requests) {
      for (const o of r.offers) {
        const f = map.get(o.financier_id) ?? { name: o.financier_name, offers: 0, bestApr: Number.POSITIVE_INFINITY, reserved: 0 };
        f.offers += 1;
        f.bestApr = Math.min(f.bestApr, o.apr_bps);
        map.set(o.financier_id, f);
      }
    }
    for (const res of reservations) {
      if (res.status !== 'active') continue;
      const key = [...map.entries()].find(([, v]) => v.name === res.financier_name)?.[0] ?? res.financier_name;
      const f = map.get(key) ?? { name: res.financier_name, offers: 0, bestApr: res.apr_bps, reserved: 0 };
      f.reserved += res.amount ?? 0;
      map.set(key, f);
    }
    return [...map.values()].sort((a, b) => b.reserved - a.reserved || a.bestApr - b.bestApr);
  }, [requests, reservations]);

  const shown = minTrust ? counterparties.filter((c) => (trustOf(c) ?? 0) >= 80) : counterparties;
  const sellers = shown.filter((c) => !BUYER_ROLES.has(roleOf(c)));
  const buyers = shown.filter((c) => BUYER_ROLES.has(roleOf(c)));

  // Radial layout: center you; sellers on the left arc, buyers on the right, financiers along the bottom.
  const W = 1240;
  const H = 660;
  const CX = 620;
  const CY = 300;
  const place = (list: AlphaObject[], startDeg: number, endDeg: number, r: number) =>
    list.slice(0, 6).map((o, i) => {
      const t = list.length === 1 ? 0.5 : i / (Math.min(list.length, 6) - 1);
      const a = ((startDeg + (endDeg - startDeg) * t) * Math.PI) / 180;
      return { o, x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
    });
  const sellerNodes = place(sellers, 150, 210, 400);
  const buyerNodes = place(buyers, -30, 30, 400);
  const financierNodes = financiers.slice(0, 3).map((f, i, arr) => {
    const t = arr.length === 1 ? 0.5 : i / (arr.length - 1);
    return { f, x: CX - 180 + 360 * t, y: 590 };
  });

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="sub-rail">
        <button type="button" className={cn('sub-tab', tab === 'map' && 'on')} onClick={() => setTab('map')}>
          <MapIcon className="h-3.5 w-3.5" /> Map
        </button>
        <button type="button" className={cn('sub-tab', tab === 'counterparties' && 'on')} onClick={() => setTab('counterparties')}>
          <Users className="h-3.5 w-3.5" /> Counterparties
          {counterparties.length > 0 ? <span className="ct">{counterparties.length}</span> : null}
        </button>
        <button type="button" className={cn('sub-tab', tab === 'financiers' && 'on')} onClick={() => setTab('financiers')}>
          <CircleDollarSign className="h-3.5 w-3.5" /> Financiers
          {financiers.length > 0 ? <span className="ct">{financiers.length}</span> : null}
        </button>
        <Link href="/network/workspace" className="sub-tab">
          <ShieldCheck className="h-3.5 w-3.5" /> Governed workspace
        </Link>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
        <WorkspaceGuard authStatus={auth.status} orgId={orgId} loaded={loaded} error={error} module="Network">
            {tab === 'map' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Your network</h1>
                    <div className="sub">Buyers, sellers, financiers, and the trades that connect them. Private to you — nobody sees your map.</div>
                  </div>
                  <div className="actions">
                    <Link href="/network/workspace" className={buttonClassName({ variant: 'secondary' })}>
                      <Plus className="h-4 w-4" /> Onboard counterparty
                    </Link>
                  </div>
                </div>

                {counterparties.length === 0 && financiers.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <Users className="h-6 w-6" />
                    </div>
                    <h2>Your network starts here</h2>
                    <p>Onboard a counterparty or request funding — every relationship you build appears on this private map.</p>
                    <div className="pe-cta">
                      <Link href="/network/workspace" className={buttonClassName()}>
                        Onboard a counterparty
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="map-wrap">
                    <div className="map-controls">
                      <button type="button" className={cn('map-chip', !minTrust && 'on')} onClick={() => setMinTrust(false)}>
                        All connections
                      </button>
                      <button type="button" className={cn('map-chip', minTrust && 'on')} onClick={() => setMinTrust(true)}>
                        <ShieldCheck className="h-3.5 w-3.5" /> Trust ≥ 80
                      </button>
                    </div>
                    <div className="map-legend">
                      <div className="head">Legend</div>
                      <div className="row">
                        <span className="dot you" />
                        You · {selectedOrg?.name ?? 'Your org'}
                      </div>
                      <div className="row">
                        <span className="dot s" />
                        Sellers &amp; suppliers
                      </div>
                      <div className="row">
                        <span className="dot b" />
                        Buyers
                      </div>
                      <div className="row">
                        <span className="dot f" />
                        Financiers
                      </div>
                      <div style={{ height: 6 }} />
                      <div className="row">
                        <span className="swatch capital" />
                        Capital line
                      </div>
                      <div className="row">
                        <span className="swatch rel" />
                        Relationship
                      </div>
                    </div>

                    <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
                      <defs>
                        <radialGradient id="mapCenterGrad" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor="rgba(74,178,234,0.32)" />
                          <stop offset="55%" stopColor="rgba(74,178,234,0.07)" />
                          <stop offset="100%" stopColor="rgba(74,178,234,0)" />
                        </radialGradient>
                      </defs>

                      <circle cx={CX} cy={CY} r="260" fill="url(#mapCenterGrad)" />
                      <circle cx={CX} cy={CY} r="170" fill="none" stroke="rgba(127,127,127,0.09)" strokeDasharray="2 6" />
                      <circle cx={CX} cy={CY} r="300" fill="none" stroke="rgba(127,127,127,0.06)" strokeDasharray="2 6" />

                      <g>
                        {[...sellerNodes, ...buyerNodes].map(({ o, x, y }) => (
                          <line key={`edge-${o.object_id}`} className="map-edge" x1={CX} y1={CY} x2={x} y2={y} />
                        ))}
                        {financierNodes.map(({ f, x, y }) => (
                          <path key={`cap-${f.name}`} className="map-edge capital" d={`M ${x} ${y - 30} Q ${(x + CX) / 2} ${(y + CY) / 2} ${CX} ${CY + 40}`} />
                        ))}
                      </g>

                      <g className="map-node map-center">
                        <circle className="ring" cx={CX} cy={CY} r="52" fill="rgba(74,178,234,0.10)" stroke="rgba(74,178,234,0.55)" strokeWidth="1.5" />
                        <circle cx={CX} cy={CY} r="32" fill="rgba(74,178,234,0.22)" stroke="rgba(255,255,255,0.5)" strokeWidth="1.4" />
                        <text className="initials" x={CX} y={CY - 3}>
                          {initialsOf(selectedOrg?.name ?? 'You')}
                        </text>
                        <text className="sublabel" x={CX} y={CY + 12} fontSize="8">
                          YOU
                        </text>
                        <text className="label" x={CX} y={CY + 75}>
                          {selectedOrg?.name ?? 'Your org'}
                        </text>
                      </g>

                      {sellerNodes.map(({ o, x, y }) => (
                        <g key={o.object_id} className="map-node" onClick={() => router.push(`/network/counterparties/${o.object_id}`)}>
                          <circle className="ring" cx={x} cy={y} r="30" fill="rgba(74,178,234,0.08)" stroke="rgba(74,178,234,0.55)" strokeWidth="1.2" />
                          <circle cx={x} cy={y} r="19" fill="rgba(74,178,234,0.20)" stroke="rgba(74,178,234,0.55)" strokeWidth="1" />
                          <text className="initials" x={x} y={y + 4}>
                            {initialsOf(o.title)}
                          </text>
                          <text className="label" x={x} y={y + 52}>
                            {o.title.length > 22 ? `${o.title.slice(0, 21)}…` : o.title}
                          </text>
                          <text className="sublabel" x={x} y={y + 66}>
                            {roleOf(o)} {trustOf(o) !== null ? `· ${trustOf(o)}` : ''}
                          </text>
                        </g>
                      ))}

                      {buyerNodes.map(({ o, x, y }) => (
                        <g key={o.object_id} className="map-node" onClick={() => router.push(`/network/counterparties/${o.object_id}`)}>
                          <circle className="ring" cx={x} cy={y} r="30" fill="rgba(154,141,242,0.10)" stroke="rgba(154,141,242,0.55)" strokeWidth="1.2" />
                          <circle cx={x} cy={y} r="19" fill="rgba(154,141,242,0.22)" stroke="rgba(154,141,242,0.65)" strokeWidth="1" />
                          <text className="initials" x={x} y={y + 4}>
                            {initialsOf(o.title)}
                          </text>
                          <text className="label" x={x} y={y + 52}>
                            {o.title.length > 22 ? `${o.title.slice(0, 21)}…` : o.title}
                          </text>
                          <text className="sublabel" x={x} y={y + 66} style={{ fill: 'var(--violet)' }}>
                            {roleOf(o)} {trustOf(o) !== null ? `· ${trustOf(o)}` : ''}
                          </text>
                        </g>
                      ))}

                      {financierNodes.map(({ f, x, y }) => (
                        <g key={f.name} className="map-node" onClick={() => setTab('financiers')}>
                          <circle className="ring" cx={x} cy={y - 30} r="26" fill="rgba(126,221,176,0.08)" stroke="rgba(126,221,176,0.55)" strokeWidth="1.2" />
                          <circle cx={x} cy={y - 30} r="16" fill="rgba(126,221,176,0.20)" stroke="rgba(126,221,176,0.55)" strokeWidth="1" />
                          <text className="initials" x={x} y={y - 26}>
                            {initialsOf(f.name)}
                          </text>
                          <text className="label" x={x} y={y + 14}>
                            {f.name}
                          </text>
                          <text className="sublabel" x={x} y={y + 28} style={{ fill: 'var(--good)' }}>
                            financier · {(f.bestApr / 100).toFixed(1)}%
                          </text>
                        </g>
                      ))}
                    </svg>
                  </div>
                )}

                <div className="ai-note">
                  <div className="ib">
                    <Sparkles className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <b>Drawn from your rails.</b> Counterparties come from onboarding and screening; financiers from your funding offers
                    and facilities. Nothing on this map is inferred from other orgs.
                  </div>
                </div>
              </>
            ) : null}

            {tab === 'counterparties' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Counterparties</h1>
                    <div className="sub">Reusable trust context for everyone you trade with — open a passport for the full picture.</div>
                  </div>
                  <div className="actions">
                    <Link href="/network/workspace" className={buttonClassName()}>
                      <Plus className="h-4 w-4" /> Onboard counterparty
                    </Link>
                  </div>
                </div>
                {counterparties.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <Users className="h-6 w-6" />
                    </div>
                    <h2>No counterparties yet</h2>
                    <p>Start onboarding or screening from the governed workspace to create reusable trust context.</p>
                    <div className="pe-cta">
                      <Link href="/network/workspace" className={buttonClassName()}>
                        Open governed workspace
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="net-grid">
                    {counterparties.map((c) => {
                      const buyer = BUYER_ROLES.has(roleOf(c));
                      const trust = trustOf(c);
                      const payload = (c.payload_json ?? {}) as Record<string, unknown>;
                      return (
                        <Link key={c.object_id} href={`/network/counterparties/${c.object_id}`} className="net-card">
                          <div className="head">
                            <div className={cn('av', buyer && 'violet')}>{initialsOf(c.title)}</div>
                            <div className="info">
                              <div className="nm">{c.title}</div>
                              <div className="sub">
                                <span className={cn('role-tag', buyer && 'buy')}>{roleOf(c)}</span>
                                {payload.country ? <span>{String(payload.country)}</span> : null}
                              </div>
                            </div>
                            <div className="trust">{trust ?? '—'}</div>
                          </div>
                          <div className="stats">
                            <div className="stat">
                              <div className="lbl">Status</div>
                              <div className="v">{c.status.replace(/_/g, ' ')}</div>
                            </div>
                            <div className="stat">
                              <div className="lbl">Updated</div>
                              <div className="v">{new Date(c.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </>
            ) : null}

            {tab === 'financiers' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Financiers</h1>
                    <div className="sub">Everyone who has priced or funded your requests — aggregated from your live offer rails.</div>
                  </div>
                </div>
                {financiers.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <CircleDollarSign className="h-6 w-6" />
                    </div>
                    <h2>No financiers yet</h2>
                    <p>Request funding on a trade and every financier who prices it appears here with their track record.</p>
                    <div className="pe-cta">
                      <Link href="/finance" className={buttonClassName()}>
                        Open Financing
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="net-grid">
                    {financiers.map((f) => (
                      <Link key={f.name} href="/finance" className="net-card">
                        <div className="head">
                          <div className="av good">{initialsOf(f.name)}</div>
                          <div className="info">
                            <div className="nm">{f.name}</div>
                            <div className="sub">
                              <span className="role-tag fin">financier</span>
                            </div>
                          </div>
                          <div className="trust" style={{ color: 'var(--good)' }}>
                            {(f.bestApr / 100).toFixed(1)}%
                          </div>
                        </div>
                        <div className="stats">
                          <div className="stat">
                            <div className="lbl">Offers made</div>
                            <div className="v">{f.offers}</div>
                          </div>
                          <div className="stat">
                            <div className="lbl">Reserved with you</div>
                            <div className="v">{f.reserved > 0 ? money(f.reserved) : '—'}</div>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                <div className="preview-banner">
                  <div className="ib">
                    <Sparkles className="h-3 w-3" />
                  </div>
                  <div>
                    <b>Aggregated privately.</b> Financier stats come from offers made to you — no cross-org data.
                  </div>
                </div>
              </>
            ) : null}
        </WorkspaceGuard>
      </div>
    </AppShell>
  );
}
