'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  FileArchive,
  Filter,
  GitMerge,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles
} from 'lucide-react';
import type { AlphaMemoryEvent, AlphaObject, AlphaObjectType, ReadinessState, ReplayStep, TradeSummary } from '@traibox/contracts';

import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { AppShell } from './shell';
import { useOrgSelection } from './use-org';
import { Button, buttonClassName } from './ui/button';
import { StatusChip, type StatusTone } from './ui/status';
import { Surface } from './ui/surface';

export type ObjectRouteConfig = {
  eyebrow: string;
  title: string;
  description: string;
  workspace: 'intelligence' | 'trades' | 'finance' | 'network' | 'clearance' | 'operations' | 'settings';
  types: AlphaObjectType[];
  detailBase?: string;
  emptyTitle: string;
  emptyBody: string;
  primaryHref: string;
  primaryLabel: string;
  accent?: 'blue' | 'green' | 'amber' | 'red';
};

export function ObjectWorkspaceList({ config }: { config: ObjectRouteConfig }) {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [readiness, setReadiness] = useState<ReadinessState[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.queryAlphaObjects(orgId, { limit: 250 });
      setObjects(result.objects.filter((object) => config.types.includes(object.type)));
      setReadiness(result.readiness_states);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workspace queue');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth.status === 'authenticated' && orgId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  if (auth.status !== 'authenticated') return <WorkspaceAccessState status={auth.status} />;

  const normalizedSearch = search.trim().toLowerCase();
  const visible = objects.filter((object) => {
    if (status !== 'all' && object.status !== status) return false;
    if (!normalizedSearch) return true;
    return `${object.title} ${object.summary ?? ''} ${object.type} ${object.status}`.toLowerCase().includes(normalizedSearch);
  });
  const active = objects.filter((object) => !['completed', 'cancelled', 'archived', 'rejected'].includes(object.status));
  const blocked = objects.filter((object) => object.status === 'blocked' || object.status === 'approval_required');
  const attached = objects.filter((object) => Boolean(object.trade_id));

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId} headerRight={<span className="text-xs text-muted">{selectedOrg?.name ?? 'Select org'}</span>}>
      <WorkspaceBackground accent={config.accent}>
        <WorkspaceHero config={config} loading={loading} onRefresh={refresh} />
        {error ? <Alert tone="error">{error}</Alert> : null}
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total records" value={objects.length} icon={<Activity className="h-4 w-4" />} />
          <Metric label="Needs attention" value={blocked.length} icon={<ShieldAlert className="h-4 w-4" />} />
          <Metric label="Active work" value={active.length} icon={<Sparkles className="h-4 w-4" />} />
          <Metric label="Trade attached" value={attached.length} icon={<GitMerge className="h-4 w-4" />} />
        </section>

        <Surface className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border/10 p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold">Workspace queue</h2>
              <p className="mt-1 text-xs text-muted">Queryable, permission-aware records with readiness and trade context.</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="flex min-w-56 items-center gap-2 rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm">
                <Search className="h-4 w-4 text-muted" />
                <input
                  aria-label="Search workspace records"
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search records"
                />
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm">
                <Filter className="h-4 w-4 text-muted" />
                <select aria-label="Filter by status" className="bg-transparent outline-none" value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="all">All statuses</option>
                  {[...new Set(objects.map((object) => object.status))].map((value) => (
                    <option key={value} value={value}>{humanize(value)}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="divide-y divide-border/10">
            {visible.length ? visible.map((object) => {
              const state = readiness.find((candidate) => candidate.object_id === object.object_id);
              return <ObjectQueueRow key={object.object_id} object={object} readiness={state} detailHref={config.detailBase ? `${config.detailBase}/${object.object_id}` : undefined} />;
            }) : <EmptyState title={config.emptyTitle} body={config.emptyBody} href={config.primaryHref} label={config.primaryLabel} />}
          </div>
        </Surface>
      </WorkspaceBackground>
    </AppShell>
  );
}

export function ObjectWorkspaceDetail({
  objectId,
  config,
  tradeIdMode = false
}: {
  objectId: string;
  config: ObjectRouteConfig & { backHref: string; backLabel: string };
  tradeIdMode?: boolean;
}) {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [readiness, setReadiness] = useState<ReadinessState[]>([]);
  const [memory, setMemory] = useState<AlphaMemoryEvent[]>([]);
  const [replay, setReplay] = useState<ReplayStep[]>([]);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setLoading('refresh');
    setError(null);
    try {
      const [result, replayResult, tradeResult] = await Promise.all([
        api.queryAlphaObjects(orgId, { limit: 300 }),
        api.queryAlphaReplay(orgId, tradeIdMode ? { trade_id: objectId, limit: 100, include_audit: true } : { object_id: objectId, limit: 100, include_audit: true }),
        api.listTrades(orgId)
      ]);
      setObjects(result.objects);
      setReadiness(result.readiness_states);
      setMemory(result.memory_events);
      setReplay(replayResult.steps);
      setTrades(tradeResult.trades);
      if (!selectedTradeId && tradeResult.trades[0]?.trade_id) setSelectedTradeId(tradeResult.trades[0].trade_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load record');
    } finally {
      setLoading(null);
    }
  }

  useEffect(() => {
    if (auth.status === 'authenticated' && orgId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId, objectId, tradeIdMode]);

  if (auth.status !== 'authenticated') return <WorkspaceAccessState status={auth.status} />;
  const object = tradeIdMode
    ? objects.find((candidate) => candidate.type === 'proof_bundle' && candidate.trade_id === objectId) ?? objects.find((candidate) => candidate.trade_id === objectId)
    : objects.find((candidate) => candidate.object_id === objectId);
  const state = readiness.find((candidate) => candidate.object_id === objectId || (object?.trade_id && candidate.trade_id === object.trade_id));
  const related = object ? relatedObjectsFor(object, objects) : [];
  const relatedMemory = memory.filter((event) => event.object_id === objectId || (object?.trade_id && event.trade_id === object.trade_id));

  async function evaluateReadiness() {
    if (!orgId) return;
    setLoading('readiness');
    try {
      const result = await api.evaluateAlphaReadiness(orgId, { object_id: objectId, context: { source: 'workspace_detail' } });
      setMessage(`Readiness updated: ${humanize(result.readiness.overall)} at ${Math.round(result.readiness.score)}%.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not evaluate readiness');
    } finally {
      setLoading(null);
    }
  }

  async function generateProof() {
    if (!orgId || !object) return;
    setLoading('proof');
    try {
      const result = await api.generateAlphaProofBundle(orgId, { trade_id: object.trade_id ?? undefined, object_ids: [objectId], title: `${object.title} proof bundle` });
      setMessage(`Proof bundle ${result.proof_bundle.object_id.slice(0, 8)} generated with evidence lineage.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate proof');
    } finally {
      setLoading(null);
    }
  }

  async function attachToTrade() {
    if (!orgId || !object || !selectedTradeId) return;
    setLoading('attach');
    try {
      await api.attachAlphaObject(orgId, { object_id: objectId, target: { type: 'trade_room', id: selectedTradeId }, mode: 'attach', reason: 'Attach from workspace detail with evidence, audit, replay, and memory preserved.' });
      setMessage('Record attached to Trade Room with its audit and memory context preserved.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach record');
    } finally {
      setLoading(null);
    }
  }

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId} headerRight={<span className="text-xs text-muted">{selectedOrg?.name ?? 'Select org'}</span>}>
      <WorkspaceBackground accent={config.accent}>
        <Link href={config.backHref} className="inline-flex items-center gap-2 text-xs font-medium text-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> {config.backLabel}
        </Link>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {message ? <Alert tone="success">{message}</Alert> : null}
        {!object && loading ? <DetailSkeleton /> : !object ? (
          <EmptyState title="Record not found" body="This object may belong to another organization, have been archived, or use a different identifier." href={config.backHref} label={config.backLabel} />
        ) : (
          <>
            <Surface className="relative overflow-hidden p-5 md:p-6">
              <div className={cn('absolute -right-12 -top-20 h-64 w-64 rounded-full blur-3xl', glowClass(config.accent))} />
              <div className="relative grid gap-5 xl:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusChip tone={toneForStatus(object.status)} label={humanize(object.status)} />
                    <span className="rounded-full border border-border/10 bg-surface2 px-2 py-1 text-[11px] text-muted">{humanize(object.type)}</span>
                    <span className="font-mono text-[11px] text-muted">{object.object_id.slice(0, 12)}</span>
                  </div>
                  <h1 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">{object.title}</h1>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{object.summary ?? config.description}</p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button disabled={Boolean(loading)} onClick={evaluateReadiness}><CheckCircle2 className="h-4 w-4" /> Evaluate readiness</Button>
                    <Button variant="secondary" disabled={Boolean(loading)} onClick={generateProof}><FileArchive className="h-4 w-4" /> Generate proof</Button>
                    {object.trade_id ? <Link className={buttonClassName({ variant: 'secondary' })} href={`/trades/${object.trade_id}`}>Open Trade Room <ArrowUpRight className="h-4 w-4" /></Link> : null}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 xl:w-72">
                  <MiniFact label="Workspace" value={humanize(object.origin_workspace)} />
                  <MiniFact label="Evidence" value={object.evidence_refs_json.length} />
                  <MiniFact label="Memory" value={relatedMemory.length} />
                  <MiniFact label="Replay steps" value={replay.length} />
                </div>
              </div>
            </Surface>

            {!object.trade_id ? (
              <Surface className="p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">Compose into a Trade Room</h2>
                    <p className="mt-1 text-xs text-muted">Attach this standalone record without losing permissions, evidence, audit, replay, or memory.</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <select className="rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm" value={selectedTradeId} onChange={(event) => setSelectedTradeId(event.target.value)}>
                      <option value="">Select Trade Room</option>
                      {trades.map((trade) => <option key={trade.trade_id} value={trade.trade_id}>{trade.title ?? trade.trade_id.slice(0, 8)}</option>)}
                    </select>
                    <Button disabled={!selectedTradeId || Boolean(loading)} onClick={attachToTrade}><GitMerge className="h-4 w-4" /> Attach</Button>
                  </div>
                </div>
              </Surface>
            ) : null}

            <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <ReadinessPanel state={state} />
                <ObjectPayloadPanel object={object} />
                <RelatedObjectsPanel objects={related} />
              </div>
              <div className="space-y-4">
                <EvidencePanel object={object} />
                <MemoryPanel events={relatedMemory} />
                <ReplayPanel steps={replay} />
              </div>
            </section>
          </>
        )}
      </WorkspaceBackground>
    </AppShell>
  );
}

function WorkspaceHero({ config, loading, onRefresh }: { config: ObjectRouteConfig; loading: boolean; onRefresh: () => void }) {
  return (
    <Surface className="relative overflow-hidden p-5 md:p-7">
      <div className={cn('absolute -right-12 -top-20 h-72 w-72 rounded-full blur-3xl', glowClass(config.accent))} />
      <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{config.eyebrow}</div>
          <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight md:text-4xl">{config.title}</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{config.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={loading} onClick={onRefresh}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh</Button>
          <Link className={buttonClassName()} href={config.primaryHref}>{config.primaryLabel} <ArrowUpRight className="h-4 w-4" /></Link>
        </div>
      </div>
    </Surface>
  );
}

function ObjectQueueRow({ object, readiness, detailHref }: { object: AlphaObject; readiness?: ReadinessState; detailHref?: string }) {
  return (
    <article className="grid gap-3 p-4 transition hover:bg-border/[0.025] md:grid-cols-[1fr_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip tone={toneForStatus(object.status)} label={humanize(object.status)} />
          <span className="text-[11px] font-medium uppercase tracking-[0.15em] text-muted">{humanize(object.type)}</span>
          {object.trade_id ? <span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] text-accent">Trade attached</span> : null}
        </div>
        <h3 className="mt-2 truncate font-semibold">{object.title}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{object.summary ?? 'Typed TRAIBOX object with evidence, audit, and memory context.'}</p>
      </div>
      <div className="flex items-center gap-3 md:justify-end">
        {readiness ? <div className="text-right"><div className="font-mono text-sm font-semibold">{Math.round(readiness.score)}%</div><div className="text-[10px] text-muted">{humanize(readiness.overall)}</div></div> : null}
        {detailHref ? <Link aria-label={`Open ${object.title}`} className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={detailHref}>Inspect <ArrowUpRight className="h-3.5 w-3.5" /></Link> : null}
      </div>
    </article>
  );
}

function ReadinessPanel({ state }: { state?: ReadinessState }) {
  return (
    <Surface className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div><h2 className="font-semibold">Readiness</h2><p className="mt-1 text-xs text-muted">What is ready, missing, risky, or blocked.</p></div>
        <div className="text-right"><div className="font-mono text-2xl font-semibold">{state ? `${Math.round(state.score)}%` : '—'}</div><div className="text-[10px] uppercase tracking-[0.15em] text-muted">{state ? humanize(state.overall) : 'Not evaluated'}</div></div>
      </div>
      {state ? (
        <div className="mt-4 space-y-3">
          <div className="h-2 overflow-hidden rounded-full bg-surface2"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, Math.min(100, state.score))}%` }} /></div>
          <SignalList title="Missing proof" values={state.missing_items} empty="No missing proof detected." tone="warn" />
          <SignalList title="Risk findings" values={state.risk_findings} empty="No active risk findings." tone="error" />
          <SignalList title="Next actions" values={state.next_actions} empty="Ready for governed execution." tone="accent" />
        </div>
      ) : <p className="mt-4 rounded-xl border border-dashed border-border/15 p-4 text-sm text-muted">Run readiness to create a structured state and next-best action.</p>}
    </Surface>
  );
}

function ObjectPayloadPanel({ object }: { object: AlphaObject }) {
  const entries = Object.entries(object.payload_json).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value)).slice(0, 12);
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Structured record</h2>
      <p className="mt-1 text-xs text-muted">Canonical fields available to workflows and TRAIBOX intelligence.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {entries.length ? entries.map(([key, value]) => <MiniFact key={key} label={humanize(key)} value={String(value)} />) : <p className="text-sm text-muted">No scalar structured fields are available yet.</p>}
      </div>
    </Surface>
  );
}

function RelatedObjectsPanel({ objects }: { objects: AlphaObject[] }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Related workflow objects</h2>
      <div className="mt-4 space-y-2">
        {objects.length ? objects.slice(0, 8).map((object) => (
          <div key={object.object_id} className="flex items-center justify-between gap-3 rounded-xl border border-border/10 bg-surface2/60 px-3 py-2">
            <div className="min-w-0"><div className="truncate text-sm font-medium">{object.title}</div><div className="text-[10px] text-muted">{humanize(object.type)} · {object.object_id.slice(0, 8)}</div></div>
            <StatusChip tone={toneForStatus(object.status)} label={humanize(object.status)} />
          </div>
        )) : <p className="text-sm text-muted">No related objects detected yet.</p>}
      </div>
    </Surface>
  );
}

function EvidencePanel({ object }: { object: AlphaObject }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Evidence and provenance</h2>
      <p className="mt-1 text-xs text-muted">Evidence remains attached through standalone and composed workflows.</p>
      <div className="mt-4 space-y-2">
        {object.evidence_refs_json.length ? object.evidence_refs_json.slice(0, 8).map((ref, index) => (
          <pre key={index} className="overflow-x-auto rounded-xl border border-border/10 bg-surface2/60 p-3 text-[10px] leading-5 text-muted">{JSON.stringify(ref, null, 2)}</pre>
        )) : <p className="rounded-xl border border-dashed border-border/15 p-4 text-sm text-muted">No evidence references yet. Generate or attach proof before protected execution.</p>}
      </div>
    </Surface>
  );
}

function MemoryPanel({ events }: { events: AlphaMemoryEvent[] }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Trade Memory</h2>
      <p className="mt-1 text-xs text-muted">Structured signals used for query, explanation, and future recommendations.</p>
      <div className="mt-4 space-y-2">
        {events.length ? events.slice(0, 8).map((event) => (
          <div key={event.memory_event_id} className="rounded-xl border border-border/10 bg-surface2/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium">{humanize(event.signal)}</span><span className="font-mono text-[10px] text-muted">{event.level}</span></div>
            <div className="mt-1 text-[10px] text-muted">{new Date(event.created_at).toLocaleString()}</div>
          </div>
        )) : <p className="text-sm text-muted">No memory signals recorded for this record yet.</p>}
      </div>
    </Surface>
  );
}

function ReplayPanel({ steps }: { steps: ReplayStep[] }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Replay trail</h2>
      <p className="mt-1 text-xs text-muted">Deterministic history across objects, events, audit, memory, readiness, and proof.</p>
      <div className="mt-4 space-y-2">
        {steps.length ? steps.slice(0, 10).map((step) => (
          <div key={step.step_id} className="relative border-l border-border/15 pl-4">
            <span className="absolute -left-1 top-1.5 h-2 w-2 rounded-full bg-accent" />
            <div className="text-xs font-medium">{step.title}</div>
            <div className="mt-1 text-[10px] text-muted">{humanize(step.source)} · {new Date(step.occurred_at).toLocaleString()}</div>
          </div>
        )) : <p className="text-sm text-muted">Replay steps will appear as the workflow advances.</p>}
      </div>
    </Surface>
  );
}

function WorkspaceBackground({ accent, children }: { accent?: ObjectRouteConfig['accent']; children: ReactNode }) {
  return <div className={cn('min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_left,rgba(79,143,244,0.10),transparent_28%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]', accent === 'green' && 'bg-[radial-gradient(circle_at_top_left,rgba(47,176,110,0.10),transparent_28%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]', accent === 'amber' && 'bg-[radial-gradient(circle_at_top_left,rgba(227,160,8,0.10),transparent_28%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]')}><div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">{children}</div></div>;
}

function WorkspaceAccessState({ status }: { status: 'loading' | 'unauthenticated' }) {
  return <div className="grid min-h-dvh place-items-center bg-paper p-5"><Surface className="max-w-lg p-6"><h1 className="text-xl font-semibold">{status === 'loading' ? 'Opening workspace…' : 'Sign in to TRAIBOX'}</h1><p className="mt-2 text-sm text-muted">{status === 'loading' ? 'Loading organization-scoped records and permissions.' : 'This workspace requires organization-scoped access.'}</p>{status === 'unauthenticated' ? <Link className={cn(buttonClassName(), 'mt-4')} href="/login">Go to login</Link> : null}</Surface></div>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return <Surface className="p-4"><div className="flex items-center justify-between gap-3"><div><div className="text-xs text-muted">{label}</div><div className="mt-2 font-mono text-2xl font-semibold">{value}</div></div><div className="rounded-xl bg-surface2 p-2 text-accent">{icon}</div></div></Surface>;
}

function MiniFact({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-xl border border-border/10 bg-surface2/60 px-3 py-2"><div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div><div className="mt-1 truncate text-sm font-medium">{value}</div></div>;
}

function SignalList({ title, values, empty, tone }: { title: string; values: string[]; empty: string; tone: 'warn' | 'error' | 'accent' }) {
  return <div><div className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted">{title}</div><div className="mt-1.5 flex flex-wrap gap-1.5">{values.length ? values.slice(0, 8).map((value) => <span key={value} className={cn('rounded-full px-2 py-1 text-[11px]', tone === 'warn' && 'bg-warn/10 text-warn', tone === 'error' && 'bg-error/10 text-error', tone === 'accent' && 'bg-accent/10 text-accent')}>{humanize(value)}</span>) : <span className="text-xs text-muted">{empty}</span>}</div></div>;
}

function EmptyState({ title, body, href, label }: { title: string; body: string; href: string; label: string }) {
  return <div className="p-8 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface2 text-accent"><Bot className="h-5 w-5" /></div><h2 className="mt-4 font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{body}</p><Link className={cn(buttonClassName(), 'mt-5')} href={href}>{label}</Link></div>;
}

function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return <div className={cn('rounded-2xl border px-4 py-3 text-sm', tone === 'error' ? 'border-error/20 bg-error/10 text-error' : 'border-success/20 bg-success/10 text-success')}>{children}</div>;
}

function DetailSkeleton() {
  return <Surface className="animate-pulse p-6"><div className="h-4 w-32 rounded bg-surface2" /><div className="mt-4 h-9 w-2/3 rounded bg-surface2" /><div className="mt-3 h-4 w-1/2 rounded bg-surface2" /></Surface>;
}

function relatedObjectsFor(object: AlphaObject, objects: AlphaObject[]) {
  const evidenceIds = new Set(object.evidence_refs_json.map((ref) => isRecord(ref) ? String(ref.object_id ?? '') : '').filter(Boolean));
  return objects.filter((candidate) => candidate.object_id !== object.object_id && (evidenceIds.has(candidate.object_id) || Boolean(object.trade_id && candidate.trade_id === object.trade_id))).slice(0, 20);
}

function toneForStatus(status: string): StatusTone {
  if (['completed', 'approved', 'attached'].includes(status)) return 'success';
  if (['blocked', 'rejected', 'cancelled'].includes(status)) return 'error';
  if (['approval_required', 'pending_input', 'ready_for_review'].includes(status)) return 'warn';
  if (status === 'in_progress') return 'loading';
  return 'neutral';
}

function glowClass(accent?: ObjectRouteConfig['accent']) {
  if (accent === 'green') return 'bg-success/15';
  if (accent === 'amber') return 'bg-warn/15';
  if (accent === 'red') return 'bg-error/15';
  return 'bg-accent/15';
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
