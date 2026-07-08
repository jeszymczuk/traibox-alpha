'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Circle,
  Clock,
  Fingerprint,
  Lock,
  ShieldCheck
} from 'lucide-react';
import type { AlphaObject } from '@traibox/contracts';

import { AppShell } from '../../../../components/shell';
import { useOrgSelection } from '../../../../components/use-org';
import { WorkspaceGuard } from '../../../../components/workspace-guard';
import { buttonClassName } from '../../../../components/ui/button';
import { api } from '../../../../lib/api';
import { cn } from '../../../../lib/cn';

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString('en')} ${currency}`;
  }
}

function fmtWhen(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

type Condition = { label: string; state: 'met' | 'pending' | 'todo'; meta?: string };

function extractConditions(object: AlphaObject): Condition[] {
  const payload = (object.payload_json ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(payload.conditions) ? (payload.conditions as unknown[]) : [];
  return raw.map((c) => {
    if (typeof c === 'string') {
      // Flat string conditions (current backend shape): pending until the object completes.
      return { label: c, state: ['completed', 'released', 'approved'].includes(object.status) ? 'met' : 'pending' } as Condition;
    }
    const rec = c as Record<string, unknown>;
    const met = Boolean(rec.met ?? rec.satisfied);
    const pending = String(rec.status ?? '') === 'pending';
    return {
      label: String(rec.label ?? rec.title ?? rec.description ?? 'Condition'),
      state: met ? 'met' : pending ? 'pending' : 'todo',
      meta: rec.meta ? String(rec.meta) : undefined
    } as Condition;
  });
}

export function InstrumentDetailClient({ objectId }: { objectId: string }) {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [object, setObject] = useState<AlphaObject | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void (async () => {
      setError(null);
      try {
        const res = await api.queryAlphaObjects(orgId, { limit: 200 });
        setObject((res.objects ?? []).find((o) => o.object_id === objectId) ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load instrument');
      } finally {
        setLoaded(true);
      }
    })();
  }, [auth.status, orgId, objectId]);

  const payload = (object?.payload_json ?? {}) as Record<string, unknown>;
  const amount = Number(payload.amount ?? payload.value ?? NaN);
  const currency = String(payload.currency ?? 'EUR');
  const conditions = object ? extractConditions(object) : [];
  const metCount = conditions.filter((c) => c.state === 'met').length;
  const isDone = object ? ['completed', 'released', 'archived', 'approved'].includes(object.status) : false;
  const auditEntries = object
    ? [
        { nm: `Created · ${object.type.replace(/_/g, ' ')}`, meta: `${fmtWhen(object.created_at)} · ${object.origin_workspace} workspace`, done: true },
        ...(object.evidence_refs_json ?? []).slice(0, 4).map((ref: any) => ({
          nm: `Evidence linked · ${String(ref?.role ?? ref?.type ?? 'object').replace(/_/g, ' ')}`,
          meta: `ref ${String(ref?.object_id ?? '').slice(0, 8) || '—'}`,
          done: true
        })),
        { nm: `Status · ${object.status.replace(/_/g, ' ')}`, meta: `${fmtWhen(object.updated_at)} · trace ${object.trace_id.slice(0, 10)}`, done: isDone }
      ]
    : [];

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <Link href="/finance" className="uw-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to escrow &amp; instruments
        </Link>

        <WorkspaceGuard authStatus={auth.status} orgId={orgId} loaded={loaded} module="Instrument">
        {!object ? (
          <div className="pay-empty">
            <div className="ic">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <h2>Instrument not found</h2>
            <p>{error ?? 'This object does not exist in the selected organization.'}</p>
          </div>
        ) : (
          <>
            <div className="pay-head">
              <div>
                <div className="eyebrow">
                  <span className="id">INS-{object.object_id.slice(0, 8).toUpperCase()}</span>
                  <span className="rail">{object.type.replace(/_/g, ' ')}</span>
                  <span className={cn('fin-pill', isDone ? 'succeeded' : 'executing')}>
                    {conditions.length > 0 ? `${metCount} of ${conditions.length} conditions` : object.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <h2>{object.title}</h2>
                <div className="parties">
                  {object.summary ? <span className="text-[13px] text-text-3">{object.summary}</span> : null}
                  {object.trade_id ? (
                    <span className="mono text-[11px] text-text-3">linked TRX-{object.trade_id.slice(0, 8).toUpperCase()}</span>
                  ) : null}
                </div>
              </div>
              <div className="pay-amount">
                <div className="num">{Number.isFinite(amount) ? money(amount, currency) : '—'}</div>
                <div className="lbl">
                  {currency} · created {fmtWhen(object.created_at)}
                </div>
              </div>
            </div>

            <div className="chrome-strip exec">
              <Lock className="h-4 w-4" />
              <div>
                <b>Execution surface.</b> Conditions are deterministic — each one is verified against a rail event, document, or workflow
                signal. AI explains; AI does not satisfy them.
              </div>
            </div>

            <div className="pay-grid">
              <div>
                <div className="pay-section">
                  <h3>
                    Release conditions{' '}
                    <span className="ct">{conditions.length > 0 ? `${metCount} of ${conditions.length} met · deterministic` : 'none declared yet'}</span>
                  </h3>
                  {conditions.length > 0 ? (
                    <div className="esc-cond" style={{ border: 0, padding: 0, marginBottom: 0 }}>
                      {conditions.map((c, i) => (
                        <div key={i} className={cn('stp', c.state)}>
                          {c.state === 'met' ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : c.state === 'pending' ? (
                            <Clock className="h-4 w-4" />
                          ) : (
                            <Circle className="h-4 w-4" />
                          )}
                          <div>
                            <div style={{ color: c.state === 'todo' ? 'var(--text-2)' : 'var(--text)', fontSize: 13.5 }}>{c.label}</div>
                            {c.meta ? <div className="mono mt-0.5 text-[10.5px] text-text-3">{c.meta}</div> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-text-3">
                      This instrument has no structured release conditions on record — its lifecycle is driven from the linked trade.
                    </p>
                  )}
                </div>

                <div className="pay-section">
                  <h3>
                    Audit trail <span className="ct">{auditEntries.length} entries · trace-linked</span>
                  </h3>
                  <div className="approval-chain">
                    {auditEntries.map((entry, i) => (
                      <div key={i} className="stp">
                        <div
                          className="av"
                          style={entry.done ? { background: 'var(--good-soft)', color: 'var(--good)' } : { background: 'var(--warn-soft)', color: 'var(--warn)' }}
                        >
                          {String(i + 1).padStart(2, '0')}
                        </div>
                        <div className="info">
                          <div className="nm">{entry.nm}</div>
                          <div className="meta">{entry.meta}</div>
                        </div>
                        {entry.done ? <CheckCircle2 className="h-4 w-4 shrink-0 text-good" /> : <Clock className="h-4 w-4 shrink-0 text-warning" />}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ai-note" style={{ marginTop: 18 }}>
                  <div className="ib">
                    <ShieldCheck className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <b>Funds release on facts, not promises.</b> This instrument&rsquo;s state comes from the governed object store — it
                    advances when the linked trade produces the events its conditions require.
                  </div>
                </div>
              </div>

              <aside>
                <div className="pa-side">
                  <div className="pa-eyebrow">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {isDone ? 'Completed' : 'Programmable · automatic'}
                  </div>
                  <h3>{isDone ? 'Instrument settled' : 'Auto-advances'}</h3>
                  <div className="desc">
                    {isDone
                      ? 'All lifecycle steps completed. The record is preserved with its trace ids.'
                      : 'This instrument advances automatically as its trade produces the required events — no action needed on the happy path.'}
                  </div>
                  <div className="pa-amt" style={isDone ? { color: 'var(--good)' } : undefined}>
                    {Number.isFinite(amount) ? money(amount, currency) : object.status.replace(/_/g, ' ')}
                    <span className="lbl">{isDone ? 'settled' : `status · ${object.status.replace(/_/g, ' ')}`}</span>
                  </div>
                  <div className="pa-meta">
                    <span className="lbl">Type</span>
                    <span className="v">{object.type.replace(/_/g, ' ')}</span>
                    <span className="lbl">Workspace</span>
                    <span className="v">{object.origin_workspace}</span>
                    <span className="lbl">Updated</span>
                    <span className="v">{fmtWhen(object.updated_at)}</span>
                  </div>
                  <div className="btn-stack">
                    {object.trade_id ? (
                      <Link href={`/trades/${object.trade_id}`} className={cn(buttonClassName({ variant: 'secondary' }), 'justify-center')}>
                        Open linked trade <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                    <Link href="/finance" className={cn(buttonClassName({ variant: 'ghost' }), 'justify-center')}>
                      All instruments
                    </Link>
                  </div>
                  <div className="trace">
                    <Fingerprint className="h-3 w-3" /> trace {object.trace_id.slice(0, 14)}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
        </WorkspaceGuard>
      </div>
    </AppShell>
  );
}
