'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  Bot,
  BrainCircuit,
  CheckCircle2,
  FileArchive,
  FileText,
  GitMerge,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import type {
  AgentTaskResponse,
  AlphaObject,
  AlphaObjectType,
  AttachMode,
  IntelligenceRunResponse,
  OriginWorkspace,
  ProtectedActionKind,
  ReadinessState,
  SSEEvent,
  TradeSummary
} from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { Button, buttonClassName } from '../../components/ui/button';
import { Surface } from '../../components/ui/surface';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

const DEFAULT_PROMPT =
  'Prepare a payment intent for a 40% supplier advance, identify approval gates, and suggest how it should attach to the Trade Room.';

const DEFAULT_DOCUMENT =
  'Purchase Order PO-9912. Seller Lusitania Automation Lda. Buyer Iberica Components SL. Buyer VAT ESB12345678. Amount EUR 48000. Incoterm DAP. Payment terms 40% advance and 60% after acceptance. Acceptance proof signed by buyer operations lead.';

const DEFAULT_AGENT_OBJECTIVE =
  'Review selected trade artifacts, identify what is missing or risky, prepare the next governed execution step, and do not execute protected actions.';

const WORKSPACE_OPTIONS: OriginWorkspace[] = ['intelligence', 'trades', 'finance', 'network', 'clearance'];

const ATTACHABLE_TYPES: AlphaObjectType[] = [
  'trade_plan',
  'document',
  'extraction_result',
  'clearance_check',
  'trade_passport',
  'counterparty',
  'screening_result',
  'onboarding_flow',
  'funding_request',
  'payment_intent',
  'agent_task',
  'agent_work_result',
  'report',
  'risk_finding',
  'readiness_state'
];

export default function IntelligencePage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [documentText, setDocumentText] = useState(DEFAULT_DOCUMENT);
  const [agentObjective, setAgentObjective] = useState(DEFAULT_AGENT_OBJECTIVE);
  const [originWorkspace, setOriginWorkspace] = useState<OriginWorkspace>('intelligence');
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState('');
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [readiness, setReadiness] = useState<ReadinessState[]>([]);
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);
  const [intelligenceRun, setIntelligenceRun] = useState<IntelligenceRunResponse | null>(null);
  const [agentRun, setAgentRun] = useState<AgentTaskResponse | null>(null);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    const [query, tradeList] = await Promise.all([api.queryAlphaObjects(orgId, { limit: 140 }), api.listTrades(orgId)]);
    setObjects(query.objects ?? []);
    setReadiness(query.readiness_states ?? []);
    setTrades(tradeList.trades ?? []);
    if (!selectedTradeId && tradeList.trades?.[0]?.trade_id) {
      setSelectedTradeId(tradeList.trades[0].trade_id);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load Intelligence workspace'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    const source = new EventSource(api.eventsUrl({ orgId }));
    source.onmessage = (incoming) => {
      try {
        const event = JSON.parse(incoming.data) as SSEEvent;
        setEvents((current) => [event, ...current].slice(0, 16));
        if (['object.created', 'object.attached', 'agent.task.completed', 'ai.eval.completed', 'proof.bundle.ready', 'readiness.evaluated'].includes(event.type)) {
          void refresh().catch(() => undefined);
        }
      } catch {
        // Ignore transient dev-server messages while hot reload is active.
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const selectedObjects = useMemo(
    () => objects.filter((object) => selectedObjectIds.includes(object.object_id)),
    [objects, selectedObjectIds]
  );

  const latestObjects = useMemo(() => {
    const intelligenceObjects = objects.filter((object) => object.origin_workspace === 'intelligence');
    const contextualObjects = selectedTradeId ? objects.filter((object) => object.trade_id === selectedTradeId) : [];
    return uniqueObjects([...intelligenceObjects, ...contextualObjects, ...objects.slice(0, 20)]).slice(0, 36);
  }, [objects, selectedTradeId]);

  const metrics = useMemo(() => {
    const aiObjects = objects.filter((object) => ['agent_task', 'agent_work_result'].includes(object.type) || object.origin_workspace === 'intelligence');
    const proofBundles = objects.filter((object) => object.type === 'proof_bundle' && object.status === 'completed');
    const tradeBound = aiObjects.filter((object) => Boolean(object.trade_id));
    return { aiObjects, proofBundles, tradeBound };
  }, [objects]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper p-6 text-ink">Loading...</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper p-6 text-ink">
        <Surface className="mx-auto max-w-xl p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="mt-2 text-sm text-muted">Intelligence needs organization context for permissions, memory, proof, and replay.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  async function createReferenceTrade() {
    if (!orgId) return;
    setLoading('trade');
    setError(null);
    try {
      const result = await api.parseTrade(orgId, {
        intent_text:
          'Portuguese supplier delivers industrial sensors and commissioning services to a Spanish buyer. Payment is 40% advance and 60% after acceptance. Buyer proof and clearance checks are required.',
        hints: { currency: 'EUR' }
      });
      setSelectedTradeId(result.trade_id);
      setMessage('Reference Trade Room created for Intelligence context.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create reference Trade Room');
    } finally {
      setLoading(null);
    }
  }

  async function runIntelligence() {
    if (!orgId) return;
    setLoading('intelligence');
    setError(null);
    setMessage(null);
    try {
      const result = await api.runAlphaIntelligence(orgId, {
        message: prompt,
        workspace: originWorkspace,
        trade_id: selectedTradeId || null,
        object_ids: selectedObjectIds
      });
      setIntelligenceRun(result);
      setSelectedObjectIds((current) => uniqueIds([...result.created_objects.map((object) => object.object_id), ...current]));
      setMessage('Copilot structured the request into canonical TRAIBOX objects with suggested actions.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Intelligence run failed');
    } finally {
      setLoading(null);
    }
  }

  async function extractDocument() {
    if (!orgId) return;
    setLoading('document');
    setError(null);
    setMessage(null);
    try {
      const result = await api.extractAlphaDocument(orgId, {
        filename: 'intelligence-document.txt',
        text: documentText,
        trade_id: selectedTradeId || null,
        origin_workspace: 'intelligence'
      });
      await api.evaluateAlphaReadiness(orgId, {
        object_id: result.extraction_result.object_id,
        context: { source: 'intelligence_document_first', missing_fields: result.missing_fields }
      });
      setSelectedObjectIds((current) => uniqueIds([result.document.object_id, result.extraction_result.object_id, ...current]));
      setMessage(`Document extracted with ${Object.keys(result.extracted_fields).length} field(s) and ${result.missing_fields.length} gap(s).`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document extraction failed');
    } finally {
      setLoading(null);
    }
  }

  async function launchAgent() {
    if (!orgId) return;
    setLoading('agent');
    setError(null);
    setMessage(null);
    try {
      const approvalGates = inferApprovalGates(selectedObjects);
      const result = await api.launchAlphaAgentTask(orgId, {
        objective: agentObjective,
        input_objects: selectedObjectIds,
        trade_id: selectedTradeId || null,
        permitted_tools: ['readiness.evaluate', 'attachments.suggest', 'proof.prepare', 'approvals.request'],
        data_access: ['selected_objects', 'trade_room_memory_l1', 'organization_memory_l2', 'audit_replay'],
        write_permissions: ['create_agent_task', 'create_agent_work_result', 'create_memory_event', 'recommend_next_action', 'create_approval_request'],
        approval_gates: approvalGates,
        time_budget_seconds: 60
      });
      setAgentRun(result);
      setSelectedObjectIds((current) => uniqueIds([result.work_result.object_id, ...(result.task.task_object_id ? [result.task.task_object_id] : []), ...current]));
      setMessage('Governed agent task completed with scoped permissions and replay log.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Agent task failed');
    } finally {
      setLoading(null);
    }
  }

  async function evaluateObject(object: AlphaObject) {
    if (!orgId) return;
    setLoading(`readiness-${object.object_id}`);
    setError(null);
    try {
      await api.evaluateAlphaReadiness(orgId, {
        object_id: object.object_id,
        trade_id: object.trade_id ?? undefined,
        context: { source: 'intelligence_workspace' }
      });
      setMessage(`Readiness evaluated for ${object.title}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Readiness evaluation failed');
    } finally {
      setLoading(null);
    }
  }

  async function requestApproval(object: AlphaObject) {
    if (!orgId) return;
    const protectedAction = protectedActionFor(object);
    if (!protectedAction) return;
    setLoading(`approval-${object.object_id}`);
    setError(null);
    try {
      const approvalChain = approvalChainForAction(protectedAction);
      await api.requestAlphaApproval(orgId, {
        target: { type: object.type, id: object.object_id },
        protected_action: protectedAction,
        proposed_action: approvalCopyFor(protectedAction, object),
        rationale: 'TRAIBOX Intelligence can prepare protected actions, but execution requires explicit human approval.',
        step_up_required: true,
        policy_refs: ['protected-actions-alpha-v1'],
        evidence_refs: [{ object_id: object.object_id, role: object.type }],
        approval_chain: approvalChain.steps,
        current_approval_step: approvalChain.current
      });
      setMessage(`Approval requested for ${object.title}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval request failed');
    } finally {
      setLoading(null);
    }
  }

  async function attachObject(object: AlphaObject) {
    if (!orgId || !selectedTradeId) return;
    setLoading(`attach-${object.object_id}`);
    setError(null);
    try {
      const mode = attachModeFor(object);
      const attached = await api.attachAlphaObject(orgId, {
        object_id: object.object_id,
        target: { type: 'trade_room', id: selectedTradeId },
        mode,
        reason: `Intelligence suggested this ${object.type.replaceAll('_', ' ')} should become Trade Room context.`
      });
      await api.generateAlphaProofBundle(orgId, {
        trade_id: selectedTradeId,
        object_ids: [attached.object.object_id],
        title: `${object.title} Intelligence attachment proof`
      });
      setMessage(`${object.title} ${mode === 'link' ? 'linked' : mode === 'convert' ? 'converted' : 'attached'} to Trade Room with proof.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Attach failed');
    } finally {
      setLoading(null);
    }
  }

  async function generateProof(object: AlphaObject) {
    if (!orgId) return;
    setLoading(`proof-${object.object_id}`);
    setError(null);
    try {
      await api.generateAlphaProofBundle(orgId, {
        trade_id: object.trade_id ?? (selectedTradeId || undefined),
        object_ids: [object.object_id],
        title: `${object.title} Intelligence proof bundle`
      });
      setMessage(`Proof generated for ${object.title}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Proof generation failed');
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
      <div className="min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_left,rgba(79,143,244,0.18),transparent_32%),radial-gradient(circle_at_75%_20%,rgba(196,118,44,0.12),transparent_28%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]">
        <div className="mx-auto max-w-7xl space-y-5 p-6">
          <Surface className="relative overflow-hidden p-6">
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-2xl" />
            <div className="relative grid gap-5 xl:grid-cols-[1.25fr_0.75fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                  Intelligence Workspace
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight">TRAIBOX AI should operate the work, not just chat about it.</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                  Use Copilot to create typed trade objects, extract documents, launch governed scoped agents, inspect replay and model usage, then attach useful work into Trade Room context with proof.
                </p>
                <div className="mt-5 grid gap-2 sm:grid-cols-4">
                  <Capability icon={<BrainCircuit className="h-4 w-4" />} label="Structured Copilot" />
                  <Capability icon={<FileText className="h-4 w-4" />} label="Document-first" />
                  <Capability icon={<Bot className="h-4 w-4" />} label="Scoped agents" />
                  <Capability icon={<GitMerge className="h-4 w-4" />} label="Attach and prove" />
                </div>
              </div>

              <Surface className="bg-paper/70 p-4 shadow-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Trade Context</h2>
                    <p className="mt-1 text-xs text-muted">Start standalone, or give Intelligence a Trade Room when context is already known.</p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={!orgId || loading === 'trade'} onClick={createReferenceTrade}>
                    {loading === 'trade' ? 'Creating...' : 'Create reference'}
                  </Button>
                </div>
                <select
                  value={selectedTradeId}
                  onChange={(event) => setSelectedTradeId(event.target.value)}
                  className="mt-3 w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm"
                >
                  <option value="">Standalone mode</option>
                  {trades.map((trade) => (
                    <option key={trade.trade_id} value={trade.trade_id}>
                      {trade.title ?? 'Untitled trade'} · {trade.trade_id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                {selectedTradeId ? (
                  <Link className="mt-3 inline-flex text-xs font-medium text-accent" href={`/trades/${selectedTradeId}`}>
                    Open selected Trade Room
                  </Link>
                ) : null}
              </Surface>
            </div>
          </Surface>

          {error ? <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">{error}</div> : null}
          {message ? <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">{message}</div> : null}

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric icon={<BrainCircuit className="h-4 w-4" />} label="AI Objects" value={metrics.aiObjects.length} />
            <Metric icon={<Bot className="h-4 w-4" />} label="Selected Context" value={selectedObjectIds.length} />
            <Metric icon={<GitMerge className="h-4 w-4" />} label="Trade-bound AI" value={metrics.tradeBound.length} />
            <Metric icon={<FileArchive className="h-4 w-4" />} label="Proof Bundles" value={metrics.proofBundles.length} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1fr_0.92fr]">
            <Surface className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Action Composer</h2>
                  <p className="mt-1 text-xs text-muted">Copilot returns canonical objects, suggested actions, trace IDs, and AI observability metadata.</p>
                </div>
                <select
                  value={originWorkspace}
                  onChange={(event) => setOriginWorkspace(event.target.value as OriginWorkspace)}
                  className="rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-xs"
                >
                  {WORKSPACE_OPTIONS.map((workspace) => (
                    <option key={workspace} value={workspace}>
                      {workspace}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                className="mt-4 min-h-[150px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 text-sm leading-6"
              />
              <Button className="mt-3 w-full" disabled={!orgId || loading === 'intelligence'} onClick={runIntelligence}>
                <Play className="h-4 w-4" />
                {loading === 'intelligence' ? 'Structuring...' : 'Run Copilot'}
              </Button>

              {intelligenceRun ? (
                <div className="mt-4 rounded-2xl border border-accent/20 bg-accent/10 p-4">
                  <div className="flex items-start gap-2">
                    <BrainCircuit className="mt-0.5 h-4 w-4 text-accent" />
                    <div>
                      <div className="text-sm font-medium">Copilot answer</div>
                      <p className="mt-1 text-sm leading-6">{intelligenceRun.answer}</p>
                      <div className="mt-2 text-xs text-muted">Trace {intelligenceRun.trace_id}</div>
                    </div>
                  </div>
                  <CopilotStructuredOutputs run={intelligenceRun} />
                </div>
              ) : null}
            </Surface>

            <Surface className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Document-First Intake</h2>
                  <p className="mt-1 text-xs text-muted">Paste document content and let TRAIBOX classify, extract, create evidence, and evaluate gaps.</p>
                </div>
                <FileText className="h-5 w-5 text-muted" />
              </div>
              <textarea
                value={documentText}
                onChange={(event) => setDocumentText(event.target.value)}
                className="mt-4 min-h-[150px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 text-sm leading-6"
              />
              <Button className="mt-3 w-full" variant="secondary" disabled={!orgId || loading === 'document'} onClick={extractDocument}>
                {loading === 'document' ? 'Extracting...' : 'Extract document'}
              </Button>
            </Surface>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Surface className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Governed Agent Task</h2>
                  <p className="mt-1 text-xs text-muted">Alpha agents are scoped, permissioned, replayable tasks. They prepare and recommend, but do not execute protected actions.</p>
                </div>
                <ShieldCheck className="h-5 w-5 text-muted" />
              </div>
              <textarea
                value={agentObjective}
                onChange={(event) => setAgentObjective(event.target.value)}
                className="mt-4 min-h-[120px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 text-sm leading-6"
              />
              <Button className="mt-3 w-full" disabled={!orgId || loading === 'agent'} onClick={launchAgent}>
                <Bot className="h-4 w-4" />
                {loading === 'agent' ? 'Running scoped task...' : 'Launch governed agent'}
              </Button>
            </Surface>

            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Replay And Eval Visibility</h2>
                  <p className="mt-1 text-xs text-muted">Shows prompt/model metadata, replay steps, blockers, risks, and human decision state.</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <ObservabilityCard run={intelligenceRun} />
                <AgentReplayCard run={agentRun} />
              </div>
            </Surface>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Queryable Context Objects</h2>
                  <p className="mt-1 text-xs text-muted">Select objects for agent context, readiness, approval, proof, or attachment.</p>
                </div>
                <Button
                  variant="secondary"
                  disabled={!orgId || loading === 'refresh'}
                  onClick={async () => {
                    setLoading('refresh');
                    try {
                      await refresh();
                    } finally {
                      setLoading(null);
                    }
                  }}
                >
                  <RefreshCw className={cn('h-4 w-4', loading === 'refresh' ? 'animate-spin' : '')} />
                  Refresh
                </Button>
              </div>
              <div className="mt-4 space-y-2">
                {latestObjects.length ? (
                  latestObjects.map((object) => (
                    <ContextObjectRow
                      key={`${object.object_id}-${object.updated_at}`}
                      object={object}
                      selected={selectedObjectIds.includes(object.object_id)}
                      loading={loading}
                      canAttach={Boolean(selectedTradeId) && !object.trade_id && ATTACHABLE_TYPES.includes(object.type)}
                      canApprove={Boolean(protectedActionFor(object))}
                      onSelect={() => {
                        setSelectedObjectIds((current) =>
                          current.includes(object.object_id) ? current.filter((id) => id !== object.object_id) : [object.object_id, ...current]
                        );
                      }}
                      onReadiness={() => evaluateObject(object)}
                      onApproval={() => requestApproval(object)}
                      onAttach={() => attachObject(object)}
                      onProof={() => generateProof(object)}
                    />
                  ))
                ) : (
                  <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-5 text-sm text-muted">Run Copilot or extract a document to create context.</p>
                )}
              </div>
            </Surface>

            <div className="space-y-4">
              <Surface className="p-5">
                <h2 className="font-semibold">Readiness Signals</h2>
                <div className="mt-4 space-y-2">
                  {readiness.length ? (
                    readiness.slice(0, 6).map((state) => (
                      <div key={state.readiness_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">{state.overall}</div>
                          <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{Math.round(state.score)}%</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted">{state.next_actions[0] ?? state.missing_items[0] ?? 'Ready for review.'}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">No readiness signals yet.</p>
                  )}
                </div>
              </Surface>

              <Surface className="p-5">
                <h2 className="font-semibold">Live Intelligence Signals</h2>
                <div className="mt-4 space-y-2">
                  {events.length ? (
                    events.slice(0, 7).map((event) => (
                      <div key={event.event_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">{event.type}</div>
                          <span className="text-[10px] text-muted">{new Date(event.ts).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">Waiting for structured intelligence events.</p>
                  )}
                </div>
              </Surface>
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function ContextObjectRow({
  object,
  selected,
  loading,
  canAttach,
  canApprove,
  onSelect,
  onReadiness,
  onApproval,
  onAttach,
  onProof
}: {
  object: AlphaObject;
  selected: boolean;
  loading: string | null;
  canAttach: boolean;
  canApprove: boolean;
  onSelect: () => void;
  onReadiness: () => void;
  onApproval: () => void;
  onAttach: () => void;
  onProof: () => void;
}) {
  return (
    <div className={cn('rounded-2xl border p-3', selected ? 'border-accent/30 bg-accent/10' : 'border-border/10 bg-surface2/50')}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <label className="flex min-w-0 gap-3">
          <input type="checkbox" checked={selected} onChange={onSelect} className="mt-1 h-4 w-4 rounded border-border/20" />
          <span className="min-w-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{object.title}</span>
              <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{object.status}</span>
            </span>
            <span className="mt-1 block text-xs text-muted">
              {object.type.replaceAll('_', ' ')} · {object.origin_workspace} · {object.trade_id ? `trade ${object.trade_id.slice(0, 8)}` : 'standalone'}
            </span>
            {object.summary ? <span className="mt-2 block text-xs leading-5 text-muted">{object.summary}</span> : null}
          </span>
        </label>
        <div className="flex shrink-0 flex-wrap gap-2">
          {object.trade_id ? (
            <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={`/trades/${object.trade_id}`}>
              Open Trade
            </Link>
          ) : null}
          <Button size="sm" variant="ghost" disabled={loading === `readiness-${object.object_id}`} onClick={onReadiness}>
            Ready
          </Button>
          {canApprove ? (
            <Button size="sm" variant="secondary" disabled={loading === `approval-${object.object_id}`} onClick={onApproval}>
              Approve Gate
            </Button>
          ) : null}
          {canAttach ? (
            <Button size="sm" variant="secondary" disabled={loading === `attach-${object.object_id}`} onClick={onAttach}>
              Attach
            </Button>
          ) : null}
          {object.type !== 'proof_bundle' ? (
            <Button size="sm" variant="ghost" disabled={loading === `proof-${object.object_id}`} onClick={onProof}>
              Proof
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ObservabilityCard({ run }: { run: IntelligenceRunResponse | null }) {
  const observability = run?.structured_outputs.find((output) => output.kind === 'ai_observability');
  const evalPayload = run?.eval_result?.payload_json;
  const evalChecks = Array.isArray(evalPayload?.checks) ? evalPayload.checks : [];
  return (
    <div className="rounded-2xl border border-border/10 bg-surface2/50 p-4">
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold">Copilot Eval Log</h3>
      </div>
      {observability ? (
        <dl className="mt-3 space-y-2 text-xs">
          <InfoLine label="Model" value={String(observability.model ?? 'unknown')} />
          <InfoLine label="Prompt" value={String(observability.prompt_version ?? 'unknown')} />
          <InfoLine label="Confidence" value={`${Math.round(Number(observability.confidence ?? 0) * 100)}%`} />
          <InfoLine label="Replayable" value={observability.replayable ? 'yes' : 'no'} />
          {evalPayload ? (
            <>
              <InfoLine label="Eval suite" value={String(evalPayload.suite ?? 'unknown')} />
              <InfoLine label="Eval status" value={`${String(evalPayload.status ?? 'unknown')} · ${Math.round(Number(evalPayload.score ?? 0))}%`} />
              <InfoLine label="Outcome" value={String(evalPayload.final_outcome ?? 'pending')} />
            </>
          ) : null}
        </dl>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted">Run Copilot to see model, prompt, confidence, context, and policy constraints.</p>
      )}
      {evalChecks.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {evalChecks.slice(0, 5).map((check, index) => (
            <span key={index} className="rounded-full bg-paper px-2 py-1 text-[11px] text-muted">
              {String(check.case ?? 'eval').replaceAll('_', ' ')} · {String(check.status ?? 'pending')}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopilotStructuredOutputs({ run }: { run: IntelligenceRunResponse }) {
  const classification = findOutput(run, 'workflow_classification');
  const readiness = findOutput(run, 'readiness_preview');
  const execution = findOutput(run, 'execution_plan');
  const agentDraft = findOutput(run, 'agent_task_draft');
  const nextSteps = recordList(execution?.next_steps).slice(0, 3);
  const missingItems = stringList(readiness?.likely_missing_items).slice(0, 3);
  const risks = stringList(readiness?.likely_risks).slice(0, 3);
  const tools = stringList(agentDraft?.permitted_tools).slice(0, 4);
  const gates = stringList(agentDraft?.approval_gates).slice(0, 4);

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div className="rounded-2xl border border-border/10 bg-paper/75 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          <Activity className="h-3.5 w-3.5 text-accent" />
          Workflow
        </div>
        <dl className="mt-3 space-y-2 text-xs">
          <InfoLine label="Type" value={String(classification?.object_type ?? 'object')} />
          <InfoLine label="Mode" value={String(classification?.usage_mode ?? 'standalone')} />
          <InfoLine label="Confidence" value={confidenceLabel(classification?.confidence)} />
        </dl>
        {classification?.reason ? <p className="mt-3 text-xs leading-5 text-muted">{String(classification.reason)}</p> : null}
      </div>

      <div className="rounded-2xl border border-border/10 bg-paper/75 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          <ShieldCheck className="h-3.5 w-3.5 text-accent" />
          Execution
        </div>
        <dl className="mt-3 space-y-2 text-xs">
          <InfoLine label="Protected" value={String(execution?.protected_action ?? 'none')} />
          <InfoLine label="Approval" value={execution?.human_approval_required ? 'required' : 'not required'} />
        </dl>
        {nextSteps.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {nextSteps.map((step, index) => (
              <span key={index} className="rounded-full bg-surface2 px-2 py-1 text-[11px] text-muted">
                {String(step.label ?? step.action ?? 'next step')}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border/10 bg-paper/75 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          <FileText className="h-3.5 w-3.5 text-accent" />
          Readiness Preview
        </div>
        <SignalList label="Likely gaps" values={missingItems} fallback="No immediate gaps predicted." />
        <SignalList label="Likely risks" values={risks} fallback="No immediate risks predicted." />
      </div>

      <div className="rounded-2xl border border-border/10 bg-paper/75 p-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
          <Bot className="h-3.5 w-3.5 text-accent" />
          Agent Draft
        </div>
        <SignalList label="Tools" values={tools} fallback="No scoped tools proposed." />
        <SignalList label="Gates" values={gates} fallback="No protected gates inferred." />
        <p className="mt-2 text-xs text-muted">
          Protected actions blocked: {agentDraft?.protected_actions_blocked ? 'yes' : 'no'}
        </p>
      </div>
    </div>
  );
}

function AgentReplayCard({ run }: { run: AgentTaskResponse | null }) {
  const evalPayload = run?.eval_result?.payload_json;
  const evalChecks = Array.isArray(evalPayload?.checks) ? evalPayload.checks : [];
  return (
    <div className="rounded-2xl border border-border/10 bg-surface2/50 p-4">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold">Agent Replay</h3>
      </div>
      {run ? (
        <div className="mt-3 space-y-3">
          <dl className="space-y-2 text-xs">
            <InfoLine label="Model" value={run.task.result.model_usage.model} />
            <InfoLine label="Prompt" value={run.task.result.model_usage.prompt_version} />
            <InfoLine label="Decision" value={run.task.result.human_decision ?? 'pending'} />
            <InfoLine label="Next" value={run.task.result.recommended_next_action} />
            {evalPayload ? (
              <>
                <InfoLine label="Eval suite" value={String(evalPayload.suite ?? 'unknown')} />
                <InfoLine label="Eval status" value={`${String(evalPayload.status ?? 'unknown')} · ${Math.round(Number(evalPayload.score ?? 0))}%`} />
              </>
            ) : null}
          </dl>
          {evalChecks.length ? (
            <div className="flex flex-wrap gap-1.5">
              {evalChecks.slice(0, 5).map((check, index) => (
                <span key={index} className="rounded-full bg-paper px-2 py-1 text-[11px] text-muted">
                  {String(check.case ?? 'eval').replaceAll('_', ' ')} · {String(check.status ?? 'pending')}
                </span>
              ))}
            </div>
          ) : null}
          <div className="space-y-1">
            {run.task.replay_log.slice(0, 4).map((entry, index) => (
              <pre key={index} className="max-h-20 overflow-hidden rounded-xl bg-paper p-2 text-[11px] leading-4 text-muted">
                {JSON.stringify(entry, null, 2)}
              </pre>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-muted">Launch a governed agent to see replay steps, blockers, risks, opportunities, and model usage.</p>
      )}
    </div>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Surface className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted">{icon}</div>
        <span className="rounded-full bg-accent/10 px-2 py-1 text-[10px] text-accent">live</span>
      </div>
      <div className="mt-4 text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
    </Surface>
  );
}

function Capability({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/10 bg-surface2/60 px-3 py-2 text-sm">
      <span className="text-accent">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[0.35fr_0.65fr] gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}

function SignalList({ label, values, fallback }: { label: string; values: string[]; fallback: string }) {
  return (
    <div className="mt-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</div>
      {values.length ? (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span key={value} className="rounded-full bg-surface2 px-2 py-1 text-[11px] text-muted">
              {value}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-xs leading-5 text-muted">{fallback}</p>
      )}
    </div>
  );
}

function findOutput(run: IntelligenceRunResponse, kind: string) {
  return run.structured_outputs.find((output) => output.kind === kind);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function confidenceLabel(value: unknown) {
  const confidence = Number(value ?? 0);
  return Number.isFinite(confidence) ? `${Math.round(confidence * 100)}%` : 'unknown';
}

function protectedActionFor(object: AlphaObject): ProtectedActionKind | null {
  if (object.type === 'payment_intent') return 'send_payment';
  if (object.type === 'funding_request') return 'submit_funding_request';
  if (object.type === 'funding_offer') return 'accept_funding_offer';
  if (object.type === 'clearance_check') return 'submit_clearance_declaration';
  if (object.type === 'proof_bundle') return 'share_proof_bundle_externally';
  return null;
}

function approvalCopyFor(action: ProtectedActionKind, object: AlphaObject) {
  if (action === 'send_payment') return `Approve prepared payment execution for ${object.title}.`;
  if (action === 'submit_funding_request') return `Approve submission of funding request for ${object.title}.`;
  if (action === 'accept_funding_offer') return `Approve acceptance of funding offer for ${object.title}.`;
  if (action === 'submit_clearance_declaration') return `Approve clearance declaration submission for ${object.title}.`;
  if (action === 'share_proof_bundle_externally') return `Approve external proof bundle sharing for ${object.title}.`;
  return `Approve protected action for ${object.title}.`;
}

function approvalChainForAction(action: ProtectedActionKind) {
  if (action === 'send_payment' || action === 'submit_funding_request' || action === 'accept_funding_offer') {
    return {
      current: 'finance_review',
      steps: [
        { key: 'finance_review', label: 'Finance review', required_role: 'finance' as const, status: 'approval_required' as const },
        { key: 'ops_release', label: 'Operations release', required_role: 'ops' as const, status: 'pending_input' as const }
      ]
    };
  }
  return {
    current: 'ops_review',
    steps: [{ key: 'ops_review', label: 'Operations review', required_role: 'ops' as const, status: 'approval_required' as const }]
  };
}

function attachModeFor(object: AlphaObject): AttachMode {
  if (['counterparty', 'screening_result', 'trade_passport', 'agent_work_result', 'agent_task'].includes(object.type)) return 'link';
  if (['document', 'extraction_result', 'trade_plan'].includes(object.type)) return 'convert';
  return 'attach';
}

function inferApprovalGates(objects: AlphaObject[]): ProtectedActionKind[] {
  const gates = objects.map(protectedActionFor).filter(Boolean) as ProtectedActionKind[];
  return uniqueIds(gates) as ProtectedActionKind[];
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values));
}

function uniqueObjects(values: AlphaObject[]) {
  const seen = new Set<string>();
  return values.filter((object) => {
    if (seen.has(object.object_id)) return false;
    seen.add(object.object_id);
    return true;
  });
}
