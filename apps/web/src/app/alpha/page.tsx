'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Activity, BrainCircuit, CheckCircle2, FileText, GitMerge, Play, Radio, ShieldCheck, Sparkles } from 'lucide-react';
import { ALPHA_SCENARIOS } from '@traibox/contracts';
import type { AlphaDemoResponse, AlphaObject, AlphaScenarioId, SSEEvent } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { api } from '../../lib/api';
import { Button, buttonClassName } from '../../components/ui/button';
import { Surface } from '../../components/ui/surface';
import { cn } from '../../lib/cn';

const DEFAULT_MESSY_INPUT =
  'Portuguese seller will deliver 100 industrial sensors and remote commissioning services to a Spanish buyer next month; 40% advance, balance after acceptance, funding may be needed.';

export default function InternalAlphaPage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg, refreshOrgs } = useOrgSelection();
  const [orgName, setOrgName] = useState('TRAIBOX Alpha Org');
  const [messyInput, setMessyInput] = useState(DEFAULT_MESSY_INPUT);
  const [scenarioId, setScenarioId] = useState<AlphaScenarioId>('full_trade_room_loop');
  const [demo, setDemo] = useState<AlphaDemoResponse | null>(null);
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [events, setEvents] = useState<Array<SSEEvent>>([]);
  const [intelligenceText, setIntelligenceText] = useState('Prepare a standalone clearance check and suggest how it could attach to the Trade Room.');
  const [intelligenceAnswer, setIntelligenceAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState<'demo' | 'query' | 'ai' | 'org' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || auth.status !== 'authenticated') return;
    const source = new EventSource(api.eventsUrl({ orgId }));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as SSEEvent;
        setEvents((current) => [event, ...current].slice(0, 16));
      } catch {
        // Ignore malformed development events.
      }
    };
    return () => source.close();
  }, [auth.status, orgId]);

  const phaseChecks = useMemo(() => {
    const keys = new Set(demo?.steps.map((step) => step.key) ?? []);
    const isFull = demo?.scenario_id === 'full_trade_room_loop';
    return [
      { label: isFull ? 'Messy input became a Trade Room' : 'Standalone job created independently', ok: isFull ? keys.has('messy_input') : keys.has('standalone_start') || keys.has('document_first') },
      { label: isFull ? 'Document extraction detected a gap' : 'Scenario produced typed workflow artifacts', ok: isFull ? keys.has('gap_detection') : (demo?.objects.length ?? 0) >= 3 },
      { label: 'Readiness and proof were generated', ok: keys.has('readiness_state') && keys.has('proof_bundle') },
      { label: 'Standalone work attached or converted to trade context', ok: keys.has('attachment') },
      { label: 'Operations Center received a digest event', ok: keys.has('operations_center') }
    ];
  }, [demo]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper text-ink p-6">Loading…</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper text-ink p-6">
        <Surface className="max-w-xl mx-auto p-6">
          <h1 className="text-xl font-semibold">Sign in to run the TRAIBOX alpha</h1>
          <p className="text-sm text-muted mt-2">The internal alpha uses your org context so audit, memory, and permissions can be tested realistically.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  async function runDemo() {
    if (!orgId) return;
    setLoading('demo');
    setError(null);
    try {
      const result = await api.runInternalAlphaDemo(orgId, messyInput, scenarioId);
      setDemo(result);
      const queried = await api.queryAlphaObjects(orgId, { limit: 30 });
      setObjects(queried.objects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Demo run failed');
    } finally {
      setLoading(null);
    }
  }

  async function refreshObjects() {
    if (!orgId) return;
    setLoading('query');
    setError(null);
    try {
      const result = await api.queryAlphaObjects(orgId, { limit: 30 });
      setObjects(result.objects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Object query failed');
    } finally {
      setLoading(null);
    }
  }

  async function runIntelligence() {
    if (!orgId) return;
    setLoading('ai');
    setError(null);
    try {
      const result = await api.runAlphaIntelligence(orgId, {
        message: intelligenceText,
        workspace: 'intelligence',
        trade_id: demo?.trade_id ?? null
      });
      setIntelligenceAnswer(result.answer ?? 'Structured output created.');
      await refreshObjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Intelligence request failed');
    } finally {
      setLoading(null);
    }
  }

  return (
    <AppShell
      orgId={orgId}
      orgs={orgs}
      onOrgChange={setOrgId}
      headerRight={
        <div className="text-sm text-muted">
          {selectedOrg ? (
            <span>
              Alpha org: <span className="font-medium text-ink">{selectedOrg.name}</span>
            </span>
          ) : (
            <span>Create or select an org</span>
          )}
        </div>
      }
    >
      <div className="min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_left,rgba(79,143,244,0.18),transparent_34%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]">
        <div className="max-w-7xl mx-auto p-6 space-y-6">
          <section className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
            <Surface className="p-6 overflow-hidden relative">
              <div className="absolute -right-14 -top-14 h-44 w-44 rounded-full bg-accent/10 blur-2xl" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  v1 Internal Alpha Control Room
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight">Make trade ready. Move it forward.</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                  This page exercises the build spine from the approved plan: full Trade Room lifecycle, thin standalone jobs, attach-to-trade composition, governed approvals, proof, memory, query, and Operations Center events.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <Capability icon={<BrainCircuit className="h-4 w-4" />} label="AI-native objects" />
                  <Capability icon={<GitMerge className="h-4 w-4" />} label="Attachable workflows" />
                  <Capability icon={<ShieldCheck className="h-4 w-4" />} label="Human-controlled execution" />
                </div>
              </div>
            </Surface>

            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Organization</h2>
                  <p className="mt-1 text-xs text-muted">Required for RLS, audit, memory, and proof context.</p>
                </div>
                <Activity className="h-5 w-5 text-muted" />
              </div>
              <div className="mt-4 flex gap-2">
                <input
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm"
                  placeholder="Org name"
                />
                <Button
                  disabled={loading === 'org'}
                  onClick={async () => {
                    setLoading('org');
                    try {
                      const created = await api.createOrg(orgName || 'TRAIBOX Alpha Org');
                      await refreshOrgs();
                      setOrgId(created.org_id);
                    } finally {
                      setLoading(null);
                    }
                  }}
                >
                  Create
                </Button>
              </div>
              {error ? <div className="mt-3 rounded-xl border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">{error}</div> : null}
            </Surface>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <Surface className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Demo Success Story</h2>
                  <p className="mt-1 text-xs text-muted">Runs an approved alpha scenario end-to-end against the API.</p>
                </div>
                <Button disabled={!orgId || loading === 'demo'} onClick={runDemo}>
                  <Play className="h-4 w-4" />
                  {loading === 'demo' ? 'Running…' : 'Run story'}
                </Button>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ALPHA_SCENARIOS.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    onClick={() => setScenarioId(scenario.id)}
                    className={cn(
                      'rounded-2xl border px-3 py-3 text-left transition',
                      scenarioId === scenario.id ? 'border-accent/40 bg-accent/10' : 'border-border/10 bg-surface2/50 hover:bg-surface2'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{scenario.title}</div>
                      <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{scenario.mode}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{scenario.summary}</p>
                  </button>
                ))}
              </div>
              <textarea
                value={messyInput}
                onChange={(event) => setMessyInput(event.target.value)}
                className="mt-4 min-h-[150px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 text-sm leading-6"
              />
              {demo ? (
                <>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Metric label="Trade Room" value={demo.trade_id.slice(0, 8)} />
                    <Metric label="Scenario" value={demo.scenario_title} />
                    <Metric label="Readiness" value={`${demo.readiness.overall} · ${Math.round(demo.readiness.score)}%`} />
                    <Metric label="Proof" value={demo.proof_bundle.object_id.slice(0, 8)} />
                    <Metric label="Mode" value={demo.mode} />
                  </div>
                  <div className="mt-4">
                    <Link className={buttonClassName({ variant: 'secondary' })} href={`/trade/${demo.trade_id}`}>
                      Open reference Trade Room
                    </Link>
                  </div>
                </>
              ) : null}
            </Surface>

            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Phase Exit Checks</h2>
                  <p className="mt-1 text-xs text-muted">A compact proof that the alpha spine is coherent.</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div className="mt-4 grid gap-2">
                {phaseChecks.map((check) => (
                  <div key={check.label} className="flex items-center justify-between gap-3 rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                    <span className="text-sm">{check.label}</span>
                    <span className={cn('rounded-full px-2 py-1 text-xs', check.ok ? 'bg-success/10 text-success' : 'bg-border/5 text-muted')}>
                      {check.ok ? 'proved' : 'waiting'}
                    </span>
                  </div>
                ))}
              </div>
            </Surface>
          </section>

          {demo ? (
            <Surface className="p-5">
              <h2 className="font-semibold">Narrative Steps</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {demo.steps.map((step, index) => (
                  <div key={`${step.key}-${index}`} className="rounded-2xl border border-border/10 bg-surface2/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs uppercase tracking-wide text-muted">Step {index + 1}</div>
                      <span className="rounded-full bg-paper px-2 py-1 text-[11px] text-muted">{step.status}</span>
                    </div>
                    <div className="mt-2 font-medium">{step.title}</div>
                    <p className="mt-2 text-xs leading-5 text-muted">{step.summary}</p>
                  </div>
                ))}
              </div>
            </Surface>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Queryable Object Memory</h2>
                  <p className="mt-1 text-xs text-muted">Every material action becomes a typed, queryable artifact.</p>
                </div>
                <Button variant="secondary" disabled={!orgId || loading === 'query'} onClick={refreshObjects}>
                  Refresh
                </Button>
              </div>
              <div className="mt-4 overflow-hidden rounded-2xl border border-border/10">
                <div className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.5fr] bg-surface2 px-3 py-2 text-xs font-medium text-muted">
                  <div>Object</div>
                  <div>Workspace</div>
                  <div>Status</div>
                  <div>Trade</div>
                </div>
                <div className="max-h-[380px] overflow-auto">
                  {objects.length ? (
                    objects.map((object) => (
                      <div key={`${object.object_id}-${object.updated_at}`} className="grid grid-cols-[1.1fr_0.7fr_0.7fr_0.5fr] border-t border-border/10 px-3 py-3 text-xs">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{object.title}</div>
                          <div className="truncate text-muted">{object.type}</div>
                        </div>
                        <div className="text-muted">{object.origin_workspace}</div>
                        <div>{object.status}</div>
                        <div className="text-muted">{object.trade_id ? object.trade_id.slice(0, 6) : 'solo'}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-8 text-center text-sm text-muted">Run the story or refresh after creating objects.</div>
                  )}
                </div>
              </div>
            </Surface>

            <Surface className="p-5">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-5 w-5 text-accent" />
                <h2 className="font-semibold">Trade Intelligence</h2>
              </div>
              <p className="mt-1 text-xs text-muted">Use the AI interface as an operating layer, not a detached chat widget.</p>
              <textarea
                value={intelligenceText}
                onChange={(event) => setIntelligenceText(event.target.value)}
                className="mt-4 min-h-[110px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 text-sm leading-6"
              />
              <Button disabled={!orgId || loading === 'ai'} onClick={runIntelligence} className="mt-3 w-full">
                {loading === 'ai' ? 'Structuring…' : 'Run Intelligence'}
              </Button>
              {intelligenceAnswer ? <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 p-4 text-sm leading-6">{intelligenceAnswer}</div> : null}
            </Surface>
          </section>

          <Surface className="p-5">
            <div className="flex items-center gap-2">
              <Radio className="h-5 w-5 text-accent" />
              <h2 className="font-semibold">Live Operations Events</h2>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {events.length ? (
                events.map((event) => (
                  <div key={event.event_id} className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-medium">{event.type}</span>
                      <span className="text-muted">{new Date(event.ts).toLocaleTimeString()}</span>
                    </div>
                    <pre className="mt-2 max-h-24 overflow-hidden whitespace-pre-wrap text-[11px] leading-4 text-muted">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/20 p-5 text-sm text-muted">
                  <FileText className="mb-3 h-5 w-5" />
                  SSE events will appear here as the alpha story emits structured memory, readiness, approval, proof, and digest events.
                </div>
              )}
            </div>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}

function Capability({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/10 bg-surface2/60 px-3 py-2 text-sm">
      <span className="text-accent">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-surface2/60 p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-sm">{value}</div>
    </div>
  );
}
