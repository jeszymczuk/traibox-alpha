'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, BrainCircuit, CheckCircle2, Play, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { AlphaDemoResponse, AlphaObject, AlphaScenarioId, ReadinessState, TradeSummary } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { PilotRecoveryCard } from '../../components/pilot-recovery';
import { Button, buttonClassName } from '../../components/ui/button';
import { Surface } from '../../components/ui/surface';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

const DEFAULT_TRADE_INPUT =
  'Portuguese supplier delivers industrial sensors and remote commissioning services to a Spanish buyer next month; 40% advance, 60% after acceptance, buyer VAT and clearance proof required.';

type TradeContext = {
  trade: TradeSummary;
  objects: AlphaObject[];
  latestReadiness?: ReadinessState;
  proofCount: number;
  pendingApprovals: number;
  attachedCount: number;
};

export default function TradesPage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg, refreshOrgs } = useOrgSelection();
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [readiness, setReadiness] = useState<ReadinessState[]>([]);
  const [messyInput, setMessyInput] = useState(DEFAULT_TRADE_INPUT);
  const [orgName, setOrgName] = useState('TRAIBOX Trade Alpha Org');
  const [demo, setDemo] = useState<AlphaDemoResponse | null>(null);
  const [loading, setLoading] = useState<'refresh' | 'create' | 'story' | 'org' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    const [tradeResult, objectResult] = await Promise.all([api.listTrades(orgId), api.queryAlphaObjects(orgId, { limit: 180 })]);
    setTrades(tradeResult.trades ?? []);
    setObjects(objectResult.objects ?? []);
    setReadiness(objectResult.readiness_states ?? []);
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load Trades workspace'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const tradeContexts = useMemo(() => buildTradeContexts(trades, objects, readiness), [trades, objects, readiness]);
  const cockpit = useMemo(() => {
    const pendingApprovals = objects.filter((object) => object.type === 'approval' && object.status === 'approval_required').length;
    const proofBundles = objects.filter((object) => object.type === 'proof_bundle' && object.status === 'completed').length;
    const blockedReadiness = readiness.filter((state) => ['missing', 'risky', 'blocked'].includes(state.overall)).length;
    const standalone = objects.filter((object) => !object.trade_id && object.type !== 'ai_eval_result').length;
    return { pendingApprovals, proofBundles, blockedReadiness, standalone };
  }, [objects, readiness]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper p-6 text-ink">Loading...</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper p-6 text-ink">
        <Surface className="mx-auto max-w-xl p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="mt-2 text-sm text-muted">Trades need organization context for readiness, execution, memory, and proof.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  async function createOrg() {
    setLoading('org');
    setError(null);
    try {
      const created = await api.createOrg(orgName || 'TRAIBOX Trade Alpha Org');
      await refreshOrgs();
      setOrgId(created.org_id);
      setMessage('Organization created. You can now create a Trade Room with audit and memory context.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create organization');
    } finally {
      setLoading(null);
    }
  }

  async function createTradeRoom() {
    if (!orgId) return;
    setLoading('create');
    setError(null);
    setMessage(null);
    try {
      const parsed = await api.parseTrade(orgId, { intent_text: messyInput, hints: { currency: 'EUR' } });
      await api.createAlphaObject(orgId, 'trade_room', {
        title: 'Trade Room reference context',
        summary: 'Created from the Trades workspace messy-input composer.',
        status: 'in_progress',
        origin_workspace: 'trades',
        trade_id: parsed.trade_id,
        payload: {
          messy_input: messyInput,
          usage_mode: 'full_trade_cycle',
          source: 'trades_workspace',
          parsed_confidence: parsed.confidence
        }
      });
      setMessage('Trade Room created. Open it to continue document extraction, readiness, approval, and proof.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Trade Room');
    } finally {
      setLoading(null);
    }
  }

  async function runReferenceStory() {
    if (!orgId) return;
    setLoading('story');
    setError(null);
    setMessage(null);
    try {
      const result = await api.runInternalAlphaDemo(orgId, messyInput, 'full_trade_room_loop' satisfies AlphaScenarioId);
      setDemo(result);
      setMessage('Full reference story completed: messy input, extraction, readiness, approval, proof, Operations, and attachment.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run full reference story');
    } finally {
      setLoading(null);
    }
  }

  return (
    <AppShell
      orgId={orgId}
      orgs={orgs}
      onOrgChange={setOrgId}
      headerRight={<div className="text-sm text-muted">{selectedOrg?.name ?? 'Select org'}</div>}
    >
      <div className="min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_left,rgba(17,116,102,0.16),transparent_34%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]">
        <div className="mx-auto max-w-7xl space-y-6 p-6">
          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <Surface className="relative overflow-hidden p-6">
              <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-3xl" />
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  Trades workspace
                </div>
                <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight">Turn fragmented trade activity into a Trade Room that can move.</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                  Create the full lifecycle reference flow from messy input, or run the complete internal alpha story to prove readiness, governed execution, proof, Operations updates, and standalone attachment in one pass.
                </p>
                <div className="mt-5 grid gap-2 md:grid-cols-4">
                  <TradeMetric label="Trades" value={String(trades.length)} />
                  <TradeMetric label="Blocked readiness" value={String(cockpit.blockedReadiness)} tone={cockpit.blockedReadiness ? 'warn' : 'success'} />
                  <TradeMetric label="Pending approvals" value={String(cockpit.pendingApprovals)} tone={cockpit.pendingApprovals ? 'warn' : 'neutral'} />
                  <TradeMetric label="Proof bundles" value={String(cockpit.proofBundles)} tone={cockpit.proofBundles ? 'success' : 'neutral'} />
                </div>
              </div>
            </Surface>

            <Surface className="p-5">
              <h2 className="font-semibold">Organization</h2>
              <p className="mt-1 text-xs leading-5 text-muted">RLS, audit, proof, and memory all depend on org context.</p>
              <div className="mt-4 flex gap-2">
                <input
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm"
                  placeholder="Org name"
                />
                <Button disabled={loading === 'org'} onClick={createOrg}>
                  {loading === 'org' ? 'Creating...' : 'Create'}
                </Button>
              </div>
              {selectedOrg ? <p className="mt-3 text-xs text-muted">Selected: {selectedOrg.name}</p> : null}
            </Surface>
          </section>

          {error ? <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">{error}</div> : null}
          {message ? <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">{message}</div> : null}
          {!orgId ? (
            <PilotRecoveryCard
              title="Choose or create an organization before running the pilot story."
              summary="The alpha spine needs org context for RLS, permissions, audit, proof, and Trade Memory. Nothing useful should run without that tenant boundary."
              tone="warn"
              checkpoints={['Org context is required before object creation.', 'RLS and audit records stay scoped to the selected org.', 'Once selected, the same Trade Room flow can be replayed safely.']}
              actions={
                <>
                  <Button disabled={loading === 'org'} onClick={createOrg}>
                    {loading === 'org' ? 'Creating...' : 'Create org'}
                  </Button>
                  <Link className={buttonClassName({ variant: 'secondary' })} href="/settings">
                    Open Settings
                  </Link>
                </>
              }
            />
          ) : error ? (
            <PilotRecoveryCard
              title="The Trades workspace is in degraded mode."
              summary="The recovery path is deliberately narrow: retry the scoped query, confirm org settings, then rerun the reference story. Existing objects remain protected by org context and audit."
              tone="error"
              checkpoints={['Retry does not mutate data.', 'Settings exposes team, roles, policies, and org access.', 'Reference story can rebuild the pilot runway when services recover.']}
              actions={
                <>
                  <Button variant="secondary" disabled={loading === 'refresh'} onClick={() => void refresh()}>
                    <RefreshCw className="h-4 w-4" />
                    Retry
                  </Button>
                  <Link className={buttonClassName({ variant: 'secondary' })} href="/settings">
                    Check Settings
                  </Link>
                </>
              }
            />
          ) : !loading && tradeContexts.length === 0 ? (
            <PilotRecoveryCard
              title="The pilot runway is empty, but ready to launch."
              summary="Start from messy input, or run the full reference story to generate readiness, protected approval, proof, Operations signals, and an attached standalone execution object."
              checkpoints={['Full Trade Room loop is the reference implementation.', 'Standalone execution object attaches into trade context.', 'Operations Center updates from structured events and memory.']}
              actions={
                <>
                  <Button disabled={loading === 'story'} onClick={runReferenceStory}>
                    <Play className="h-4 w-4" />
                    {loading === 'story' ? 'Running...' : 'Run story'}
                  </Button>
                  <Link className={buttonClassName({ variant: 'secondary' })} href="/operations-center">
                    Open Operations
                  </Link>
                </>
              }
            />
          ) : null}

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Surface className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold">Reference Trade Room Composer</h2>
                  <p className="mt-1 text-xs leading-5 text-muted">Start with imperfect trade language. TRAIBOX turns it into a structured workspace.</p>
                </div>
                <BrainCircuit className="h-5 w-5 text-accent" />
              </div>
              <textarea
                value={messyInput}
                onChange={(event) => setMessyInput(event.target.value)}
                className="mt-4 min-h-[150px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 text-sm leading-6"
              />
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={!orgId || loading === 'create'} onClick={createTradeRoom}>
                  {loading === 'create' ? 'Creating...' : 'Create Trade Room'}
                </Button>
                <Button variant="secondary" disabled={!orgId || loading === 'story'} onClick={runReferenceStory}>
                  <Play className="h-4 w-4" />
                  {loading === 'story' ? 'Running...' : 'Run full reference story'}
                </Button>
                <Button variant="ghost" disabled={!orgId || loading === 'refresh'} onClick={() => void refresh()}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
              {demo ? (
                <div className="mt-5 rounded-2xl border border-accent/20 bg-accent/10 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold">{demo.scenario_title}</div>
                      <p className="mt-1 text-xs leading-5 text-muted">
                        Readiness {demo.readiness.overall} · {Math.round(demo.readiness.score)}%. Next pilot path: inspect the Trade Room, verify proof, then open Operations.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={`/trades/${demo.trade_id}`}>
                        Open Trade Room
                      </Link>
                      <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} href="/operations-center">
                        Open Operations
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}
            </Surface>

            <Surface className="p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-accent" />
                <h2 className="font-semibold">Demo Success Story</h2>
              </div>
              <div className="mt-4 grid gap-2 md:grid-cols-2">
                {referenceStorySteps.map((step, index) => {
                  const completed = demo ? demo.steps.some((demoStep) => demoStep.key === step.key) : false;
                  return (
                    <div key={step.key} className={cn('rounded-2xl border px-3 py-3', completed ? 'border-success/20 bg-success/10' : 'border-border/10 bg-surface2/50')}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted">Step {index + 1}</div>
                        {completed ? <CheckCircle2 className="h-4 w-4 text-success" /> : <span className="h-2 w-2 rounded-full bg-border" />}
                      </div>
                      <div className="mt-2 text-sm font-medium">{step.title}</div>
                      <p className="mt-1 text-xs leading-5 text-muted">{step.summary}</p>
                    </div>
                  );
                })}
              </div>
            </Surface>
          </section>

          <Surface className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Trade Hub</h2>
                <p className="mt-1 text-xs text-muted">Each row shows whether the Trade Room has readiness, proof, approvals, and attached standalone work.</p>
              </div>
              <span className="rounded-full bg-surface2 px-3 py-1 text-xs text-muted">Standalone queue: {cockpit.standalone}</span>
            </div>
            <div className="mt-4 grid gap-3">
              {tradeContexts.length ? (
                tradeContexts.map((context) => <TradeHubRow key={context.trade.trade_id} context={context} />)
              ) : (
                <div className="rounded-2xl border border-dashed border-border/20 p-8 text-center text-sm text-muted">
                  No Trade Rooms yet. Create one from messy input or run the full reference story.
                </div>
              )}
            </div>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}

const referenceStorySteps = [
  { key: 'messy_input', title: 'Messy input', summary: 'A rough opportunity becomes structured trade context.' },
  { key: 'document_upload', title: 'Document upload', summary: 'Evidence is classified, stored, and tied to the transaction.' },
  { key: 'data_extraction', title: 'Extraction', summary: 'TRAIBOX extracts fields with confidence and provenance.' },
  { key: 'gap_detection', title: 'Gap and risk detection', summary: 'Missing proof and risks are visible before execution.' },
  { key: 'readiness_state', title: 'Readiness state', summary: 'The system says what is ready, missing, risky, or blocked.' },
  { key: 'clearance_check', title: 'Clearance check', summary: 'EU-first compliance context joins the Trade Room.' },
  { key: 'payment_intent', title: 'Execution object', summary: 'A standalone payment or funding job can attach to the Trade Room.' },
  { key: 'human_approval', title: 'Human approval', summary: 'Protected actions stay gated with evidence and residual risks.' },
  { key: 'proof_bundle', title: 'Proof bundle', summary: 'Trusted proof is generated from typed artifacts and events.' },
  { key: 'operations_center', title: 'Operations update', summary: 'The cockpit knows what changed and what needs attention.' },
  { key: 'attachment', title: 'Attachment integrity', summary: 'Standalone work keeps permissions, audit, memory, and evidence.' }
] as const;

function buildTradeContexts(trades: TradeSummary[], objects: AlphaObject[], readiness: ReadinessState[]): TradeContext[] {
  return trades.map((trade) => {
    const tradeObjects = objects.filter((object) => object.trade_id === trade.trade_id);
    const latestReadiness = readiness.find((state) => state.trade_id === trade.trade_id);
    return {
      trade,
      objects: tradeObjects,
      latestReadiness,
      proofCount: tradeObjects.filter((object) => object.type === 'proof_bundle' && object.status === 'completed').length,
      pendingApprovals: tradeObjects.filter((object) => object.type === 'approval' && object.status === 'approval_required').length,
      attachedCount: tradeObjects.filter((object) => object.status === 'attached' || Boolean(object.payload_json?.attached_to)).length
    };
  });
}

function TradeHubRow({ context }: { context: TradeContext }) {
  const readinessLabel = context.latestReadiness ? `${context.latestReadiness.overall} · ${Math.round(context.latestReadiness.score)}%` : 'No readiness';
  return (
    <div className="grid gap-3 rounded-2xl border border-border/10 bg-surface2/50 p-4 lg:grid-cols-[1.2fr_0.8fr_auto] lg:items-center">
      <div>
        <div className="font-medium">{context.trade.title ?? 'Untitled trade'}</div>
        <div className="mt-1 text-xs text-muted">
          {context.trade.corridor ?? 'No corridor'} · {context.trade.status} · {new Date(context.trade.created_at).toLocaleString()}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        <MiniSignal label="Readiness" value={readinessLabel} active={Boolean(context.latestReadiness)} />
        <MiniSignal label="Objects" value={String(context.objects.length)} active={context.objects.length > 0} />
        <MiniSignal label="Attached" value={String(context.attachedCount)} active={context.attachedCount > 0} />
        <MiniSignal label="Approvals" value={String(context.pendingApprovals)} active={context.pendingApprovals > 0} warn={context.pendingApprovals > 0} />
        <MiniSignal label="Proof" value={String(context.proofCount)} active={context.proofCount > 0} />
      </div>
      <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={`/trades/${context.trade.trade_id}`}>
        Open <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

function TradeMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'neutral' | 'success' | 'warn' }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-paper/60 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={cn('mt-1 text-xl font-semibold', tone === 'success' && 'text-success', tone === 'warn' && 'text-warn')}>{value}</div>
    </div>
  );
}

function MiniSignal({ label, value, active, warn }: { label: string; value: string; active?: boolean; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border/10 bg-paper/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className={cn('mt-1 font-medium', active ? 'text-ink' : 'text-muted', warn && 'text-warn')}>{value}</div>
    </div>
  );
}
