'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Fingerprint,
  Link2,
  Loader2,
  Lock,
  Plug,
  ShieldCheck,
  Sparkles,
  Stamp
} from 'lucide-react';
import type { AlphaObject, AuditChainVerificationResponse, BankConsent } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { Button, buttonClassName } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type OpsTab = 'approvals' | 'exceptions' | 'connectors' | 'audit';

const HARD_EXCEPTION_STATUSES = new Set<string>(['rejected', 'cancelled']);
const STALLED_STATUSES = new Set<string>(['pending_input', 'ready_for_review', 'approval_required']);
const DAY_MS = 24 * 3_600_000;

function isException(o: AlphaObject): boolean {
  if (HARD_EXCEPTION_STATUSES.has(o.status)) return true;
  return STALLED_STATUSES.has(o.status) && Date.now() - new Date(o.updated_at).getTime() > DAY_MS;
}

function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function initialsFor(type: string) {
  if (type.includes('payment')) return 'PAY';
  if (type.includes('funding')) return 'FND';
  if (type.includes('counterparty') || type.includes('onboarding')) return 'CTP';
  if (type.includes('passport')) return 'PUB';
  if (type.includes('clearance') || type.includes('screening')) return 'CLR';
  return type.slice(0, 3).toUpperCase();
}

export default function OperationsCenterPage() {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [tab, setTab] = useState<OpsTab>('approvals');
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [consents, setConsents] = useState<BankConsent[]>([]);
  const [accountCount, setAccountCount] = useState(0);
  const [audit, setAudit] = useState<AuditChainVerificationResponse | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void (async () => {
      setError(null);
      try {
        const [objectRes, consentRes, acctRes] = await Promise.all([
          api.queryAlphaObjects(orgId, { limit: 200 }),
          api.listBankConsents(orgId).catch(() => ({ consents: [] as BankConsent[], trace_id: '' })),
          api.listAccounts(orgId).catch(() => ({ accounts: [], trace_id: '' }))
        ]);
        setObjects(objectRes.objects ?? []);
        setConsents(consentRes.consents ?? []);
        setAccountCount((acctRes.accounts ?? []).length);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load Operations Center');
      } finally {
        setLoaded(true);
      }
    })();
  }, [auth.status, orgId]);

  const approvals = objects.filter((o) => o.type === 'approval');
  const awaiting = approvals.filter((o) => o.status === 'approval_required');
  const decided = approvals.filter((o) => o.status !== 'approval_required');
  const exceptions = objects.filter(isException);
  const agedExceptions = exceptions.filter((o) => Date.now() - new Date(o.updated_at).getTime() > 3 * DAY_MS);
  const executionTasks = objects.filter((o) => o.type === 'execution_task');

  async function verifyChain() {
    if (!orgId) return;
    setVerifying(true);
    setError(null);
    try {
      setAudit(await api.verifyAuditChain(orgId, 500));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit verification failed');
    } finally {
      setVerifying(false);
    }
  }

  const approvalRow = (o: AlphaObject, dim?: boolean) => (
    <Link key={o.object_id} href="/operations-center/approvals" className={cn('row', o.status === 'approval_required' && 'attn')} style={dim ? { opacity: 0.82 } : undefined}>
      <span className="pip" />
      <div className="av" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>
        {initialsFor(String((o.payload_json as any)?.action ?? o.title))}
      </div>
      <div className="info">
        <div className="nm">
          {o.title} <span className="id">APP-{o.object_id.slice(0, 8).toUpperCase()}</span>
          <span className={cn('fin-pill', o.status === 'approval_required' ? 'pending' : o.status === 'approved' ? 'succeeded' : 'prepared')}>
            {o.status === 'approval_required' ? 'Awaiting decision' : o.status.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="meta">
          {String((o.payload_json as any)?.proposed_action ?? o.summary ?? '').slice(0, 90) || 'Protected action approval'} · {ago(o.created_at)} ago
          {o.trade_id ? ` · TRX-${o.trade_id.slice(0, 8).toUpperCase()}` : ''}
        </div>
      </div>
      <div className="col">
        <span className="lbl">Class</span>
        {String((o.payload_json as any)?.action ?? 'protected action').replace(/_/g, ' ')}
      </div>
      <div className="col amt">
        <ArrowUpRight className="ml-auto h-4 w-4 text-text-3" />
      </div>
    </Link>
  );

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="sub-rail">
        <button type="button" className={cn('sub-tab', tab === 'approvals' && 'on')} onClick={() => setTab('approvals')}>
          <Stamp className="h-3.5 w-3.5" /> Approvals
          {awaiting.length > 0 ? <span className="ct">{awaiting.length}</span> : null}
        </button>
        <button type="button" className={cn('sub-tab', tab === 'exceptions' && 'on')} onClick={() => setTab('exceptions')}>
          <AlertTriangle className="h-3.5 w-3.5" /> Exceptions
          {exceptions.length > 0 ? <span className="ct">{exceptions.length}</span> : null}
        </button>
        <button type="button" className={cn('sub-tab', tab === 'connectors' && 'on')} onClick={() => setTab('connectors')}>
          <Plug className="h-3.5 w-3.5" /> Connectors
          {consents.length > 0 ? <span className="ct">{consents.length}</span> : null}
        </button>
        <button type="button" className={cn('sub-tab', tab === 'audit' && 'on')} onClick={() => setTab('audit')}>
          <Link2 className="h-3.5 w-3.5" /> Audit chain
        </button>
        <Link href="/operations" className="sub-tab">
          <ShieldCheck className="h-3.5 w-3.5" /> Governed workspace
        </Link>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
        {auth.status !== 'authenticated' ? (
          <div className="pay-empty">
            <div className="ic">
              <Lock className="h-6 w-6" />
            </div>
            <h2>Sign in to open Operations Center</h2>
            <p>Operations needs an authenticated session and an organization.</p>
            <div className="pe-cta">
              <Link href="/login" className={buttonClassName()}>
                Go to login
              </Link>
            </div>
          </div>
        ) : !orgId ? (
          <div className="pay-empty">
            <div className="ic">
              <Activity className="h-6 w-6" />
            </div>
            <h2>Select an organization</h2>
            <p>Pick an org in the sidebar to load its queues.</p>
          </div>
        ) : !loaded ? (
          <div className="flex items-center gap-2 py-24 text-sm text-text-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading operations…
          </div>
        ) : (
          <>
            {tab === 'approvals' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Approvals</h1>
                    <div className="sub">
                      Queues are managed here. Decisions happen in context — open any approval to see the full decision surface, then
                      approve, reject, or request more information.
                    </div>
                  </div>
                  <div className="actions">
                    <Link href="/operations-center/approvals" className={buttonClassName()}>
                      Review queue <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </div>
                </div>

                <div className="metrics-row">
                  <div className="metric">
                    <div className={cn('num', awaiting.length > 0 && 'warn')}>{awaiting.length}</div>
                    <div className="lbl">Awaiting decision</div>
                  </div>
                  <div className="metric">
                    <div className="num good">{decided.length}</div>
                    <div className="lbl">Decided</div>
                  </div>
                  <div className="metric">
                    <div className="num cyan">{executionTasks.length}</div>
                    <div className="lbl">Execution tasks</div>
                  </div>
                  <div className="metric">
                    <div className="num">{approvals.length}</div>
                    <div className="lbl">Approvals on record</div>
                  </div>
                </div>

                <div className="chrome-strip adv">
                  <Sparkles className="h-4 w-4" />
                  <div>
                    <b>Operations Center manages queues. It never strips an approval from its context.</b> Every decision opens with the
                    related object, the consequence, the policy basis, and the chain.
                  </div>
                </div>

                {approvals.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <Stamp className="h-6 w-6" />
                    </div>
                    <h2>No approvals yet</h2>
                    <p>Protected actions — payments, offers, overrides — create approval gates that queue here for a human decision.</p>
                  </div>
                ) : (
                  <>
                    {awaiting.length > 0 ? (
                      <>
                        <div className="fin-sec">
                          Awaiting decision <span className="ct">{awaiting.length}</span>
                        </div>
                        <div className="pay-list">{awaiting.slice(0, 6).map((o) => approvalRow(o))}</div>
                      </>
                    ) : null}
                    {decided.length > 0 ? (
                      <>
                        <div className="fin-sec">
                          Recently decided <span className="ct">latest {Math.min(decided.length, 4)}</span>
                        </div>
                        <div className="pay-list">{decided.slice(0, 4).map((o) => approvalRow(o, true))}</div>
                      </>
                    ) : null}
                  </>
                )}
              </>
            ) : null}

            {tab === 'exceptions' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Exceptions</h1>
                    <div className="sub">Items that need a human glance because the deterministic path couldn&rsquo;t take them home.</div>
                  </div>
                </div>

                <div className="metrics-row">
                  <div className="metric">
                    <div className={cn('num', exceptions.length > 0 && 'warn')}>{exceptions.length}</div>
                    <div className="lbl">Open exceptions</div>
                  </div>
                  <div className="metric">
                    <div className={cn('num', agedExceptions.length > 0 && 'warn')}>{agedExceptions.length}</div>
                    <div className="lbl">Aging &gt; 3d</div>
                  </div>
                  <div className="metric">
                    <div className="num good">{objects.filter((o) => ['completed', 'approved'].includes(o.status)).length}</div>
                    <div className="lbl">Resolved objects</div>
                  </div>
                </div>

                {exceptions.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <CheckCircle2 className="h-6 w-6" />
                    </div>
                    <h2>No open exceptions</h2>
                    <p>Rejected, cancelled, or stalled objects (waiting on input for more than a day) surface here for triage.</p>
                  </div>
                ) : (
                  <div className="clr-section">
                    {exceptions.map((o) => (
                      <Link key={o.object_id} href={o.trade_id ? `/trades/${o.trade_id}` : '/operations'} className="clr-row">
                        <span className={cn('pip', HARD_EXCEPTION_STATUSES.has(o.status) ? 'bad' : 'warn')} />
                        <div>
                          <div className="title">
                            <span className="id">EXC-{o.object_id.slice(0, 8).toUpperCase()}</span>
                            {o.title}
                          </div>
                          <div className="sub">{o.summary ?? o.type.replace(/_/g, ' ')}</div>
                        </div>
                        <span className="meta">{o.type.replace(/_/g, ' ')}</span>
                        <span className={cn('status', HARD_EXCEPTION_STATUSES.has(o.status) ? 'bad' : 'warn')}>{o.status.replace(/_/g, ' ')}</span>
                        <span className="due">{ago(o.updated_at)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </>
            ) : null}

            {tab === 'connectors' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Connectors</h1>
                    <div className="sub">Bank consents and rails connected to this organization — live from the providers.</div>
                  </div>
                </div>

                <div className="metrics-row">
                  <div className="metric">
                    <div className="num cyan">{accountCount}</div>
                    <div className="lbl">Accounts connected</div>
                  </div>
                  <div className="metric">
                    <div className="num good">{consents.filter((c) => c.status === 'granted').length}</div>
                    <div className="lbl">Consents active</div>
                  </div>
                  <div className="metric">
                    <div className="num">{consents.length}</div>
                    <div className="lbl">Consents on record</div>
                  </div>
                </div>

                {consents.length === 0 ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <Plug className="h-6 w-6" />
                    </div>
                    <h2>No connectors yet</h2>
                    <p>Connect a bank from Payments — consents and their health show up here.</p>
                    <div className="pe-cta">
                      <Link href="/payments" className={buttonClassName()}>
                        Open Payments
                      </Link>
                    </div>
                  </div>
                ) : (
                  <div className="clr-section">
                    {consents.map((c) => (
                      <Link key={c.consent_id} href="/payments" className="clr-row">
                        <span className={cn('pip', c.status === 'granted' ? 'good' : 'warn')} />
                        <div>
                          <div className="title">
                            <span className="id">{c.consent_id.slice(0, 8).toUpperCase()}</span>
                            {c.provider} · {c.type}
                          </div>
                          <div className="sub">{c.expires_at ? `expires ${new Date(c.expires_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'no expiry recorded'}</div>
                        </div>
                        <span className="meta">bank consent</span>
                        <span className={cn('status', c.status === 'granted' ? 'good' : 'warn')}>{c.status}</span>
                        <span className="due" />
                      </Link>
                    ))}
                  </div>
                )}
              </>
            ) : null}

            {tab === 'audit' ? (
              <>
                <div className="page-head">
                  <div>
                    <h1>Audit chain</h1>
                    <div className="sub">Cryptographic integrity of the governed event chain — verified on demand against the ledger.</div>
                  </div>
                  <div className="actions">
                    <Button disabled={verifying} onClick={() => void verifyChain()}>
                      {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                      {verifying ? 'Verifying…' : 'Verify chain now'}
                    </Button>
                  </div>
                </div>

                {error ? <div className="mb-4 text-sm text-bad">{error}</div> : null}

                {!audit ? (
                  <div className="pay-empty">
                    <div className="ic">
                      <Link2 className="h-6 w-6" />
                    </div>
                    <h2>Run a verification</h2>
                    <p>Checks up to 500 chained events hash-by-hash and reports any break in the chain of custody.</p>
                  </div>
                ) : (
                  <>
                    <div className="clr-grid">
                      <div className="clr-stat">
                        <div className="lbl">
                          <span className={cn('pip', audit.valid ? 'good' : 'bad')} />
                          Chain integrity
                        </div>
                        <div className={cn('num', audit.valid ? 'good' : 'bad')}>{audit.valid ? 'INTACT' : 'BROKEN'}</div>
                        <div className="meta">{audit.failures.length} failure{audit.failures.length === 1 ? '' : 's'} detected</div>
                      </div>
                      <div className="clr-stat">
                        <div className="lbl">
                          <span className="pip good" />
                          Events checked
                        </div>
                        <div className="num">{audit.checked_events}</div>
                        <div className="meta">
                          {audit.first_event_at ? `${new Date(audit.first_event_at).toLocaleDateString('en-GB')} → ` : ''}
                          {audit.last_event_at ? new Date(audit.last_event_at).toLocaleDateString('en-GB') : ''}
                        </div>
                      </div>
                      <div className="clr-stat">
                        <div className="lbl">
                          <span className="pip" />
                          Head hash
                        </div>
                        <div className="num" style={{ fontSize: 14, wordBreak: 'break-all' }}>
                          {audit.head_hash ? `${audit.head_hash.slice(0, 18)}…` : '—'}
                        </div>
                        <div className="meta">sha256 chain head</div>
                      </div>
                    </div>
                    <div className="ai-note">
                      <div className="ib">
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <b>Verified against the ledger, not a cache.</b> Every governed event carries the hash of its predecessor; this
                        check recomputes the chain end-to-end.
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : null}
          </>
        )}
      </div>
    </AppShell>
  );
}
