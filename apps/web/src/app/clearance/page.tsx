'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, IdCard, Loader2, Lock, ShieldCheck, ShieldHalf, ShieldX, Sparkles } from 'lucide-react';
import type { AlphaObject, TradeSummary } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { buttonClassName } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type ClrTab = 'overview' | 'screening' | 'checks';

const CLR_TYPES = new Set(['clearance_check', 'screening_result', 'risk_finding', 'trade_passport']);
const BLOCKED_STATUSES = new Set(['blocked', 'failed', 'rejected']);
const ATTENTION_STATUSES = new Set(['blocked', 'failed', 'rejected', 'risky', 'approval_required', 'pending_input', 'ready_for_review']);
const CLEAR_STATUSES = new Set(['completed', 'approved', 'attached', 'passed']);

function tone(status: string): 'good' | 'warn' | 'bad' | 'idle' {
  if (CLEAR_STATUSES.has(status)) return 'good';
  if (BLOCKED_STATUSES.has(status)) return 'bad';
  if (ATTENTION_STATUSES.has(status)) return 'warn';
  return 'idle';
}

function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function ClearancePage() {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [tab, setTab] = useState<ClrTab>('overview');
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void (async () => {
      setError(null);
      try {
        const [objectRes, tradeRes] = await Promise.all([api.queryAlphaObjects(orgId, { limit: 200 }), api.listTrades(orgId)]);
        setObjects((objectRes.objects ?? []).filter((o) => CLR_TYPES.has(o.type)));
        setTrades(tradeRes.trades ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load Clearance');
      } finally {
        setLoaded(true);
      }
    })();
  }, [auth.status, orgId]);

  const checks = objects.filter((o) => o.type === 'clearance_check');
  const screenings = objects.filter((o) => o.type === 'screening_result');
  const risks = objects.filter((o) => o.type === 'risk_finding');
  const passports = objects.filter((o) => o.type === 'trade_passport');
  const attention = objects.filter((o) => ATTENTION_STATUSES.has(o.status) && o.type !== 'trade_passport');
  const cleared = objects.filter((o) => CLEAR_STATUSES.has(o.status));
  const clearScreens = screenings.filter((o) => CLEAR_STATUSES.has(o.status)).length;
  const tradeTitle = (id: string | null | undefined) => (id ? trades.find((t) => t.trade_id === id)?.title ?? null : null);

  const rowHref = (o: AlphaObject) =>
    o.type === 'screening_result' || o.type === 'trade_passport'
      ? `/network/counterparties/${o.object_id}`
      : o.trade_id
        ? `/trades/${o.trade_id}`
        : '/clearance/workspace';

  const renderRows = (list: AlphaObject[]) =>
    list.map((o) => (
      <Link key={o.object_id} href={rowHref(o)} className="clr-row">
        <span className={cn('pip', tone(o.status))} />
        <div>
          <div className="title">
            <span className="id">{o.object_id.slice(0, 8).toUpperCase()}</span>
            {o.title}
          </div>
          <div className="sub">{o.summary ?? tradeTitle(o.trade_id) ?? o.type.replace(/_/g, ' ')}</div>
        </div>
        <span className="meta">{o.type.replace(/_/g, ' ')}</span>
        <span className={cn('status', tone(o.status))}>{o.status.replace(/_/g, ' ')}</span>
        <span className="due">{ago(o.updated_at)}</span>
      </Link>
    ));

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="sub-rail">
        <button type="button" className={cn('sub-tab', tab === 'overview' && 'on')} onClick={() => setTab('overview')}>
          <ShieldHalf className="h-3.5 w-3.5" /> Overview
        </button>
        <button type="button" className={cn('sub-tab', tab === 'screening' && 'on')} onClick={() => setTab('screening')}>
          <ShieldX className="h-3.5 w-3.5" /> Sanctions &amp; screening
          {screenings.length > 0 ? <span className="ct">{screenings.length}</span> : null}
        </button>
        <button type="button" className={cn('sub-tab', tab === 'checks' && 'on')} onClick={() => setTab('checks')}>
          <IdCard className="h-3.5 w-3.5" /> Checks &amp; findings
          {checks.length + risks.length > 0 ? <span className="ct">{checks.length + risks.length}</span> : null}
        </button>
        <Link href="/clearance/workspace" className="sub-tab">
          <ShieldCheck className="h-3.5 w-3.5" /> Governed workspace
        </Link>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
        {auth.status !== 'authenticated' ? (
          <div className="pay-empty">
            <div className="ic">
              <Lock className="h-6 w-6" />
            </div>
            <h2>Sign in to view Clearance</h2>
            <p>Clearance needs an authenticated session and an organization.</p>
            <div className="pe-cta">
              <Link href="/login" className={buttonClassName()}>
                Go to login
              </Link>
            </div>
          </div>
        ) : !orgId ? (
          <div className="pay-empty">
            <div className="ic">
              <ShieldHalf className="h-6 w-6" />
            </div>
            <h2>Select an organization</h2>
            <p>Pick an org in the sidebar to load its clearance state.</p>
          </div>
        ) : !loaded ? (
          <div className="flex items-center gap-2 py-24 text-sm text-text-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading clearance…
          </div>
        ) : error ? (
          <div className="pay-empty">
            <div className="ic">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2>Couldn&rsquo;t load Clearance</h2>
            <p>{error}</p>
          </div>
        ) : (
          <>
            {tab === 'overview' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Clearance</h1>
                    <div className="sub">Compliance checks, sanctions screening, trust passports and risk findings — across all active trades.</div>
                  </div>
                </div>

                {objects.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <ShieldCheck className="h-6 w-6" />
                    </div>
                    <h2>No clearance evidence yet</h2>
                    <p>Run compliance and screening from the governed workspace — checks, findings and passports roll up here.</p>
                    <div className="pe-cta">
                      <Link href="/clearance/workspace" className={buttonClassName()}>
                        Open governed workspace
                      </Link>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="clr-grid">
                      <div className="clr-stat">
                        <div className="lbl">
                          <span className={cn('pip', attention.length > 0 ? 'warn' : 'good')} />
                          Needs attention
                        </div>
                        <div className={cn('num', attention.length > 0 ? 'warn' : 'good')}>{attention.length}</div>
                        <div className="meta">checks, screenings or findings waiting on evidence or review</div>
                      </div>
                      <div className="clr-stat">
                        <div className="lbl">
                          <span className={cn('pip', clearScreens === screenings.length && screenings.length > 0 ? 'good' : screenings.length ? 'warn' : undefined)} />
                          Screenings
                        </div>
                        <div className={cn('num', clearScreens === screenings.length && screenings.length > 0 ? 'good' : undefined)}>
                          {clearScreens} / {screenings.length}
                        </div>
                        <div className="meta">screening results completed &amp; clear</div>
                      </div>
                      <div className="clr-stat">
                        <div className="lbl">
                          <span className={cn('pip', risks.length > 0 ? 'bad' : 'good')} />
                          Risk findings
                        </div>
                        <div className={cn('num', risks.length > 0 ? 'bad' : undefined)}>{risks.length}</div>
                        <div className="meta">open findings from compliance evaluation</div>
                      </div>
                      <div className="clr-stat">
                        <div className="lbl">
                          <span className="pip good" />
                          Trade passports
                        </div>
                        <div className="num">{passports.length}</div>
                        <div className="meta">reusable trust context published</div>
                      </div>
                    </div>

                    {attention.length > 0 ? (
                      <div className="clr-section">
                        <h3>
                          Attention required <span className="ct">{attention.length} item{attention.length === 1 ? '' : 's'}</span>
                        </h3>
                        {renderRows(attention.slice(0, 6))}
                      </div>
                    ) : null}

                    {cleared.length > 0 ? (
                      <div className="clr-section">
                        <h3>
                          Recently cleared <span className="ct">latest {Math.min(cleared.length, 5)}</span>
                        </h3>
                        {renderRows(cleared.slice(0, 5))}
                      </div>
                    ) : null}

                    <div className="ai-note">
                      <div className="ib">
                        <Sparkles className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <b>Evidence-backed, replayable.</b> Every row is a governed object with its own trace id and audit trail — nothing
                        here is a manually ticked box.
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : null}

            {tab === 'screening' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Sanctions &amp; screening</h1>
                    <div className="sub">Screening results across your counterparties — open one to see the passport it feeds.</div>
                  </div>
                </div>
                {screenings.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <ShieldX className="h-6 w-6" />
                    </div>
                    <h2>No screenings yet</h2>
                    <p>Run screening from the governed workspace or a counterparty passport — results land here.</p>
                    <div className="pe-cta">
                      <Link href="/network" className={buttonClassName()}>
                        Open Network
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="clr-section">{renderRows(screenings)}</div>
                )}
              </>
            ) : null}

            {tab === 'checks' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Checks &amp; findings</h1>
                    <div className="sub">Clearance checks and risk findings from compliance evaluation, linked to their trades.</div>
                  </div>
                </div>
                {checks.length + risks.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <IdCard className="h-6 w-6" />
                    </div>
                    <h2>No checks yet</h2>
                    <p>Compliance evaluation on a trade produces clearance checks and risk findings that appear here.</p>
                    <div className="pe-cta">
                      <Link href="/trades" className={buttonClassName()}>
                        Open Trades
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="clr-section">{renderRows([...checks, ...risks])}</div>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
