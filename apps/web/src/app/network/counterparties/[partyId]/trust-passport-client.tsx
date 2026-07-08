'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  Building2,
  Eye,
  FileCheck,
  Flag,
  Landmark,
  Link2,
  Loader2,
  Mail,
  Newspaper,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users
} from 'lucide-react';
import type { AlphaObject, NetworkTrustContext, TradeSummary } from '@traibox/contracts';

import { AppShell } from '../../../../components/shell';
import { useOrgSelection } from '../../../../components/use-org';
import { Button, buttonClassName } from '../../../../components/ui/button';
import { ObjectWorkspaceDetail } from '../../../../components/object-workspace';
import { counterpartiesConfig } from '../../../../lib/workspace-routes';
import { api } from '../../../../lib/api';
import { cn } from '../../../../lib/cn';

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

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
}

export function TrustPassportClient({ partyId }: { partyId: string }) {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    try {
      const [objectRes, tradeRes] = await Promise.all([api.queryAlphaObjects(orgId, { limit: 200 }), api.listTrades(orgId)]);
      setObjects(objectRes.objects ?? []);
      setTrades(tradeRes.trades ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load counterparty');
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const object = useMemo(() => objects.find((o) => o.object_id === partyId) ?? null, [objects, partyId]);

  // Fall back to the governed object detail for non-counterparty objects sharing this route.
  if (loaded && object && object.type !== 'counterparty') {
    return <ObjectWorkspaceDetail objectId={partyId} config={{ ...counterpartiesConfig, backHref: '/network', backLabel: 'Network workspace' }} />;
  }

  const payload = (object?.payload_json ?? {}) as Record<string, unknown>;
  const trust = (payload.trust_context ?? null) as NetworkTrustContext | null;
  const related = objects.filter(
    (o) =>
      o.object_id !== partyId &&
      (String((o.payload_json as any)?.counterparty_id ?? '') === partyId ||
        (o.evidence_refs_json ?? []).some((ref: any) => String(ref?.object_id ?? '') === partyId) ||
        (object?.trade_id && o.trade_id === object.trade_id && ['screening_result', 'onboarding_flow', 'trade_passport', 'matchmaking_result'].includes(o.type)))
  );
  const screening = related.find((o) => o.type === 'screening_result') ?? null;
  const passport = related.find((o) => o.type === 'trade_passport') ?? null;
  const onboarding = related.find((o) => o.type === 'onboarding_flow') ?? null;
  const linkedTrade = object?.trade_id ? trades.find((t) => t.trade_id === object.trade_id) ?? null : null;
  const country = String(payload.country ?? payload.jurisdiction ?? '') || null;
  const role = String(payload.role ?? payload.party_role ?? '') || null;
  const sector = String(payload.sector ?? payload.industry ?? '') || null;

  async function buildTrust() {
    if (!orgId) return;
    setBuilding(true);
    setError(null);
    try {
      await api.buildNetworkTrust(orgId, partyId, {
        ...(onboarding ? { onboarding_flow_id: onboarding.object_id } : {}),
        ...(screening ? { screening_result_id: screening.object_id } : {})
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not build trust context');
    } finally {
      setBuilding(false);
    }
  }

  const onboardingPct = trust
    ? Math.round((trust.onboarding.completed_fields.length / Math.max(trust.onboarding.required_fields.length, 1)) * 100)
    : null;

  const drivers: Array<{ label: string; ds: string; score: number; tone?: 'warn' | 'bad' }> = trust
    ? [
        {
          label: 'Screening',
          ds: [
            trust.screening.sanctions ? `Sanctions ${trust.screening.sanctions}` : 'Sanctions pending',
            trust.screening.pep ? `PEP ${trust.screening.pep}` : null,
            trust.screening.adverse_media ? `Adverse media ${trust.screening.adverse_media}` : null
          ]
            .filter(Boolean)
            .join(' · '),
          score: trust.screening.sanctions === 'clear' ? 95 : trust.screening.sanctions ? 40 : 20,
          tone: trust.screening.sanctions === 'clear' ? undefined : 'warn'
        },
        {
          label: 'Onboarding evidence',
          ds: `${trust.onboarding.completed_fields.length} of ${trust.onboarding.required_fields.length} required fields on file`,
          score: onboardingPct ?? 0,
          tone: (onboardingPct ?? 0) >= 80 ? undefined : (onboardingPct ?? 0) >= 40 ? 'warn' : 'bad'
        },
        {
          label: 'Reusability',
          ds: trust.reusable_across_trades ? 'Trust context reusable across trades' : 'Scoped to a single trade so far',
          score: trust.reusable_across_trades ? 90 : 50,
          tone: trust.reusable_across_trades ? undefined : 'warn'
        },
        {
          label: 'Open risk findings',
          ds: trust.risk_findings[0] ?? 'No open risk findings',
          score: Math.max(10, 95 - trust.risk_findings.length * 25),
          tone: trust.risk_findings.length > 0 ? 'warn' : undefined
        }
      ]
    : [];

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <Link href="/network" className="uw-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          All counterparties
        </Link>

        {auth.status !== 'authenticated' ? (
          <div className="pay-empty">
            <div className="ic">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2>Sign in to view this passport</h2>
            <p>Trust passports need an authenticated session.</p>
            <div className="pe-cta">
              <Link href="/login" className={buttonClassName()}>
                Go to login
              </Link>
            </div>
          </div>
        ) : !loaded ? (
          <div className="flex items-center gap-2 py-24 text-sm text-text-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading trust passport…
          </div>
        ) : !object ? (
          <div className="pay-empty">
            <div className="ic">
              <Building2 className="h-6 w-6" />
            </div>
            <h2>Counterparty not found</h2>
            <p>{error ?? 'This object does not exist in the selected organization.'}</p>
          </div>
        ) : (
          <>
            <div className="cp-hero glass-2">
              <div className="cpav">{initialsOf(object.title)}</div>
              <div>
                <div className="eyebrow">
                  <span>Trust passport</span>
                  <span>·</span>
                  <span style={{ color: 'var(--text-4)' }}>CP-{object.object_id.slice(0, 8).toUpperCase()}</span>
                </div>
                <h1>{object.title}</h1>
                <div className="meta">
                  {role ? (
                    <span className="chip role">
                      <Users className="h-3.5 w-3.5" />
                      {role}
                    </span>
                  ) : null}
                  {country ? (
                    <span className="chip">
                      <Flag className="h-3.5 w-3.5" />
                      {country}
                    </span>
                  ) : null}
                  {sector ? (
                    <span className="chip">
                      <Building2 className="h-3.5 w-3.5" />
                      {sector}
                    </span>
                  ) : null}
                  <span className="chip">
                    <Link2 className="h-3.5 w-3.5" />
                    {related.length} linked object{related.length === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <div className="trust-big">
                <div className="num">{trust ? Math.round(trust.score) : '—'}</div>
                <div className="lbl">Trust score</div>
                {trust ? (
                  <div className="trend">
                    <TrendingUp className="h-3.5 w-3.5" />
                    {trust.status.replace(/_/g, ' ')}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="cp-stats">
              <div className="cp-stat">
                <div className="v">{object.status.replace(/_/g, ' ')}</div>
                <div className="lbl">Lifecycle status</div>
              </div>
              <div className="cp-stat">
                <div className={cn('v', screening ? 'good' : 'warn')}>{screening ? 'On file' : 'Missing'}</div>
                <div className="lbl">Screening result</div>
              </div>
              <div className="cp-stat">
                <div className={cn('v', passport ? 'cyan' : '')}>{passport ? 'Published' : '—'}</div>
                <div className="lbl">Trade passport</div>
              </div>
              <div className="cp-stat">
                <div className="v">{onboardingPct !== null ? `${onboardingPct}%` : '—'}</div>
                <div className="lbl">Onboarding evidence</div>
              </div>
            </div>

            <div className="cp-grid">
              <div>
                <div className="cp-sec">
                  <div className="cp-sec-head">
                    <h3>
                      Trust drivers{' '}
                      <span className="ct">{trust ? `computed ${fmtDate(object.updated_at)}` : 'not yet computed'}</span>
                    </h3>
                  </div>
                  {trust ? (
                    <div className="cp-drivers">
                      {drivers.map((d) => (
                        <div key={d.label} className={cn('row', d.tone)}>
                          <div className="info">
                            <div className="lbl">{d.label}</div>
                            <div className="ds">{d.ds}</div>
                          </div>
                          <div className="bar">
                            <div className="fill" style={{ width: `${Math.max(4, Math.min(100, d.score))}%` }} />
                          </div>
                          <div className="num">{Math.round(d.score)}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="ai-note" style={{ marginTop: 0 }}>
                      <div className="ib">
                        <Sparkles className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <b>No trust context yet.</b> Build it from the onboarding and screening evidence on file — the score, gaps and
                        risk findings are computed live, and the passport becomes reusable across trades.
                      </div>
                    </div>
                  )}
                </div>

                {trust && trust.missing_items.length > 0 ? (
                  <div className="cp-sec">
                    <div className="cp-sec-head">
                      <h3>
                        Missing before review <span className="ct">{trust.missing_items.length} item{trust.missing_items.length === 1 ? '' : 's'}</span>
                      </h3>
                    </div>
                    {trust.missing_items.map((item) => (
                      <div key={item} className="cp-comp-row warn">
                        <div className="ic">
                          <FileCheck className="h-4 w-4" />
                        </div>
                        <div className="info">
                          <div className="nm">{item}</div>
                        </div>
                        <div className="when">Required</div>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="cp-sec">
                  <div className="cp-sec-head">
                    <h3>
                      Compliance &amp; evidence <span className="ct">{related.length + 1} objects on record</span>
                    </h3>
                  </div>
                  <div className="cp-comp-row">
                    <div className="ic">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="info">
                      <div className="nm">
                        Sanctions screen · {trust?.screening.sanctions ?? (screening ? screening.status.replace(/_/g, ' ') : 'not run')}
                      </div>
                      <div className="sub">{screening?.summary ?? 'Run screening from the Network workspace to add evidence here.'}</div>
                    </div>
                    <div className="when">{screening ? fmtDate(screening.updated_at) : '—'}</div>
                  </div>
                  {trust?.screening.pep ? (
                    <div className={cn('cp-comp-row', trust.screening.pep === 'clear' ? undefined : 'warn')}>
                      <div className="ic">
                        <Users className="h-4 w-4" />
                      </div>
                      <div className="info">
                        <div className="nm">PEP exposure · {trust.screening.pep}</div>
                      </div>
                      <div className="when">{fmtDate(object.updated_at)}</div>
                    </div>
                  ) : null}
                  {trust?.screening.adverse_media ? (
                    <div className={cn('cp-comp-row', trust.screening.adverse_media === 'clear' ? undefined : 'warn')}>
                      <div className="ic">
                        <Newspaper className="h-4 w-4" />
                      </div>
                      <div className="info">
                        <div className="nm">Adverse media · {trust.screening.adverse_media}</div>
                      </div>
                      <div className="when">{fmtDate(object.updated_at)}</div>
                    </div>
                  ) : null}
                  {passport ? (
                    <div className="cp-comp-row info">
                      <div className="ic">
                        <Landmark className="h-4 w-4" />
                      </div>
                      <div className="info">
                        <div className="nm">Trade passport · {passport.status.replace(/_/g, ' ')}</div>
                        <div className="sub">
                          Visibility {trust?.passport_visibility ?? 'internal'} · {passport.summary ?? 'reusable trust context'}
                        </div>
                      </div>
                      <div className="when">{fmtDate(passport.updated_at)}</div>
                    </div>
                  ) : null}
                </div>

                {related.length > 0 ? (
                  <div className="cp-sec">
                    <div className="cp-sec-head">
                      <h3>
                        Linked activity <span className="ct">{related.length}</span>
                      </h3>
                    </div>
                    {related.slice(0, 6).map((o) => (
                      <Link key={o.object_id} href={`/network/counterparties/${o.object_id}`} className="cp-tx-row">
                        <div className="si">
                          <FileCheck className="h-4 w-4" />
                        </div>
                        <div className="info">
                          <div className="subj">{o.title}</div>
                          <div className="sub">
                            {o.type.replace(/_/g, ' ')} · {o.object_id.slice(0, 8).toUpperCase()}
                          </div>
                        </div>
                        <div className="when">{fmtDate(o.updated_at)}</div>
                        <div className={cn('status', ['completed', 'approved', 'attached'].includes(o.status) ? undefined : 'active')}>
                          {o.status.replace(/_/g, ' ')}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : null}

                {linkedTrade ? (
                  <div className="cp-sec">
                    <div className="cp-sec-head">
                      <h3>Trade history with you</h3>
                    </div>
                    <Link href={`/trades/${linkedTrade.trade_id}`} className="cp-tx-row">
                      <div className="si">
                        <Landmark className="h-4 w-4" />
                      </div>
                      <div className="info">
                        <div className="subj">{linkedTrade.title ?? 'Trade'}</div>
                        <div className="sub">
                          TRX-{linkedTrade.trade_id.slice(0, 8).toUpperCase()}
                          {linkedTrade.corridor ? ` · ${linkedTrade.corridor}` : ''}
                        </div>
                      </div>
                      <div className="when">{fmtDate(linkedTrade.created_at)}</div>
                      <div className={cn('status', linkedTrade.status === 'active' ? 'active' : undefined)}>{linkedTrade.status}</div>
                    </Link>
                  </div>
                ) : null}

                {error ? <div className="mb-4 text-sm text-bad">{error}</div> : null}

                <div className="ai-note">
                  <div className="ib">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <b>Trust evolves with behaviour, not declarations.</b> This score reflects the screening, onboarding evidence and
                    lifecycle state on record — recompute it whenever new evidence lands. You see the score; nobody sees your raw history.
                  </div>
                </div>
              </div>

              <aside className="cp-side">
                <div className="side-card">
                  <h4>Actions</h4>
                  <div className="cp-actions">
                    <Button className="w-full justify-start" disabled={building || !orgId} onClick={() => void buildTrust()}>
                      {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      {trust ? 'Recompute trust context' : 'Build trust context'}
                    </Button>
                    <Link href="/trades" className={cn(buttonClassName({ variant: 'secondary' }), 'w-full justify-start')}>
                      <Plus className="h-4 w-4" /> Start a trade
                    </Link>
                    <Link href="/network" className={cn(buttonClassName({ variant: 'secondary' }), 'w-full justify-start')}>
                      <Mail className="h-4 w-4" /> Open Network workspace
                    </Link>
                    <Link href="/external-access" className={cn(buttonClassName({ variant: 'ghost' }), 'w-full justify-start')}>
                      <Bell className="h-4 w-4" /> Manage external access
                    </Link>
                  </div>
                </div>

                <div className="side-card">
                  <h4>Passport</h4>
                  <div className="kv">
                    <span className="lbl">Visibility</span>
                    <span className="v">{trust?.passport_visibility ?? 'internal'}</span>
                  </div>
                  <div className="kv">
                    <span className="lbl">Reusable</span>
                    <span className="v" style={{ color: trust?.reusable_across_trades ? 'var(--good)' : undefined }}>
                      {trust ? (trust.reusable_across_trades ? 'across trades' : 'single trade') : '—'}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="lbl">Status</span>
                    <span className="v">{trust?.status.replace(/_/g, ' ') ?? object.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="kv">
                    <span className="lbl">Updated</span>
                    <span className="v">{fmtDate(object.updated_at)}</span>
                  </div>
                </div>

                <div className="side-card">
                  <h4>Agents watching</h4>
                  <div className="agent-row">
                    <div className="ib w">
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="nm">Compliance Officer</div>
                      <div className="role">Screening · adverse media</div>
                    </div>
                  </div>
                  <div className="agent-row">
                    <div className="ib">
                      <Eye className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="nm">Risk Analyst</div>
                      <div className="role">Concentration · portfolio fit</div>
                    </div>
                  </div>
                  <div className="agent-row">
                    <div className="ib g">
                      <Mail className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="nm">Concierge</div>
                      <div className="role">Counterparty communications</div>
                    </div>
                  </div>
                </div>

                {trust && trust.risk_findings.length > 0 ? (
                  <div className="side-card">
                    <h4>Risk findings</h4>
                    {trust.risk_findings.map((finding) => (
                      <div key={finding} className="kv">
                        <span className="lbl" style={{ color: 'var(--warn)' }}>
                          {finding}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
