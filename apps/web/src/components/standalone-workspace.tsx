'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, Bot, CheckCircle2, FileArchive, GitMerge, Play, RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  AlphaObject,
  AlphaObjectType,
  AttachMode,
  CreateAlphaObjectRequest,
  ExecutionTaskStatusRequest,
  ObjectLifecycleStatus,
  OriginWorkspace,
  ProtectedActionKind,
  ReadinessState,
  SSEEvent,
  TradeSummary
} from '@traibox/contracts';

import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { AppShell } from './shell';
import { useOrgSelection } from './use-org';
import { Button, buttonClassName } from './ui/button';
import { Surface } from './ui/surface';
import { ControlledExecutionTaskCard } from './controlled-execution-task';
import { ProtectedActionApprovalCard, type ProtectedActionDecisionInput } from './protected-action-approval';

type WorkspaceTone = 'finance' | 'clearance' | 'network';

type FlowConfig = {
  key: string;
  title: string;
  summary: string;
  primaryLabel: string;
  primary: {
    type: AlphaObjectType;
    status: ObjectLifecycleStatus;
    title: string;
    summary: string;
    payload: Record<string, unknown>;
  };
  extractDocument?: {
    filename: string;
    mime_type: string;
    text: string;
  };
  companions?: Array<(primary: AlphaObject) => { type: AlphaObjectType; body: CreateAlphaObjectRequest }>;
  readinessTarget?: 'primary' | 'last';
  approval?: {
    action: ProtectedActionKind;
    proposedAction: string;
    rationale: string;
  };
  attachMode?: AttachMode;
  attachReason: string;
  proofTitle: string;
  proofOnCreate?: boolean;
};

type CoverageItem = {
  label: string;
  summary: string;
  objectTypes: AlphaObjectType[];
};

type WorkspaceConfig = {
  workspace: OriginWorkspace;
  tone: WorkspaceTone;
  eyebrow: string;
  title: string;
  subtitle: string;
  empty: string;
  flows: FlowConfig[];
  coverage: CoverageItem[];
};

const DEFAULT_TRADE_INPUT =
  'Create a reference Trade Room for Portuguese equipment and remote commissioning services sold to a Spanish buyer; 40% advance, buyer acceptance proof required.';

const ATTACHABLE_WORKFLOW_TYPES: AlphaObjectType[] = [
  'payment_intent',
  'funding_request',
  'funding_offer',
  'payment_route',
  'trade_finance_instrument',
  'clearance_check',
  'trade_passport',
  'counterparty',
  'onboarding_flow',
  'screening_result',
  'matchmaking_result',
  'report',
  'document'
];

const PROOFABLE_WORKFLOW_TYPES: AlphaObjectType[] = [...ATTACHABLE_WORKFLOW_TYPES, 'document_request'];

export function StandaloneWorkspace({ config }: { config: WorkspaceConfig }) {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [readiness, setReadiness] = useState<ReadinessState[]>([]);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState<string>('');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    const [objectResult, tradeResult] = await Promise.all([
      api.queryAlphaObjects(orgId, { limit: 140 }),
      api.listTrades(orgId)
    ]);
    setObjects(objectResult.objects ?? []);
    setReadiness(objectResult.readiness_states ?? []);
    setTrades(tradeResult.trades ?? []);
    if (!selectedTradeId && tradeResult.trades?.[0]?.trade_id) {
      setSelectedTradeId(tradeResult.trades[0].trade_id);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load workspace'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId, config.workspace]);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    const source = new EventSource(api.eventsUrl({ orgId }));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as SSEEvent;
        setEvents((current) => [event, ...current].slice(0, 12));
        if (['object.created', 'object.attached', 'approval.requested', 'proof.bundle.ready', 'readiness.evaluated'].includes(event.type)) {
          void refresh().catch(() => undefined);
        }
      } catch {
        // Ignore transient development SSE messages.
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId, config.workspace]);

  const workspaceObjects = useMemo(() => objects.filter((object) => object.origin_workspace === config.workspace), [config.workspace, objects]);
  const workspaceObjectIds = useMemo(() => new Set(workspaceObjects.map((object) => object.object_id)), [workspaceObjects]);
  const approvalObjects = useMemo(
    () =>
      objects.filter(
        (object) =>
          object.type === 'approval' &&
          (approvalTargetId(object) ? workspaceObjectIds.has(approvalTargetId(object)!) : false)
      ),
    [objects, workspaceObjectIds]
  );
  const executionTaskObjects = useMemo(() => {
    const relatedIds = new Set([...workspaceObjectIds, ...approvalObjects.map((object) => object.object_id)]);
    return objects.filter((object) => {
      if (object.type !== 'execution_task') return false;
      const targetId = payloadTargetId(object);
      if (targetId && relatedIds.has(targetId)) return true;
      return evidenceObjectIds(object).some((objectId) => relatedIds.has(objectId));
    });
  }, [approvalObjects, objects, workspaceObjectIds]);
  const proofObjects = useMemo(
    () =>
      objects.filter(
        (object) =>
          object.type === 'proof_bundle' &&
          object.evidence_refs_json.some((ref) => typeof ref === 'object' && ref !== null && workspaceObjectIds.has(String((ref as { object_id?: unknown }).object_id ?? '')))
      ),
    [objects, workspaceObjectIds]
  );
  const queueObjects = useMemo(
    () => uniqueObjects([...approvalObjects, ...executionTaskObjects, ...workspaceObjects, ...proofObjects]),
    [approvalObjects, executionTaskObjects, proofObjects, workspaceObjects]
  );
  const metrics = useMemo(() => {
    const standalone = workspaceObjects.filter((object) => !object.trade_id);
    const attached = workspaceObjects.filter((object) => Boolean(object.trade_id));
    const approvals = queueObjects.filter((object) => object.type === 'approval' || object.status === 'approval_required');
    const proofs = queueObjects.filter((object) => object.type === 'proof_bundle' && object.status === 'completed');
    return { standalone, attached, approvals, proofs };
  }, [queueObjects, workspaceObjects]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper p-6 text-ink">Loading...</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper p-6 text-ink">
        <Surface className="mx-auto max-w-xl p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="mt-2 text-sm text-muted">Standalone workflows need organization context for audit, permissions, memory, and proof.</p>
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
    setLoading('reference-trade');
    setError(null);
    try {
      const result = await api.parseTrade(orgId, { intent_text: DEFAULT_TRADE_INPUT, hints: { currency: 'EUR' } });
      setSelectedTradeId(result.trade_id);
      setLastMessage('Reference Trade Room created. Standalone objects can now attach into broader trade context.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create reference Trade Room');
    } finally {
      setLoading(null);
    }
  }

  async function createFlow(flow: FlowConfig) {
    if (!orgId) return;
    setLoading(flow.key);
    setError(null);
    setLastMessage(null);
    try {
      const createdObjects: AlphaObject[] = [];
      let primary: AlphaObject;

      if (flow.extractDocument) {
        const extraction = await api.extractAlphaDocument(orgId, {
          filename: flow.extractDocument.filename,
          mime_type: flow.extractDocument.mime_type,
          text: flow.extractDocument.text,
          origin_workspace: config.workspace,
          trade_id: null
        });
        primary = extraction.document;
        createdObjects.push(extraction.document, extraction.extraction_result);
      } else {
        primary = (
          await api.createAlphaObject(orgId, flow.primary.type, {
            title: flow.primary.title,
            summary: flow.primary.summary,
            status: flow.primary.status,
            origin_workspace: config.workspace,
            payload: flow.primary.payload
          })
        ).object;
        createdObjects.push(primary);
      }

      for (const companion of flow.companions ?? []) {
        const companionSpec = companion(primary);
        const companionObject = (await api.createAlphaObject(orgId, companionSpec.type, companionSpec.body)).object;
        createdObjects.push(companionObject);
      }

      const readinessTarget = (flow.readinessTarget === 'last' ? createdObjects[createdObjects.length - 1] : primary) ?? primary;
      await api.evaluateAlphaReadiness(orgId, {
        object_id: readinessTarget.object_id,
        context: { workspace: config.workspace, standalone_flow: flow.key }
      });

      if (flow.approval) {
        const approvalChain = approvalChainForAction(flow.approval.action);
        await api.requestAlphaApproval(orgId, {
          target: { type: primary.type, id: primary.object_id },
          protected_action: flow.approval.action,
          proposed_action: flow.approval.proposedAction,
          rationale: flow.approval.rationale,
          step_up_required: true,
          policy_refs: ['protected-actions-alpha-v1'],
          evidence_refs: createdObjects.map((object) => ({ object_id: object.object_id, role: object.type })),
          approval_chain: approvalChain.steps,
          current_approval_step: approvalChain.current
        });
      }

      if (flow.proofOnCreate) {
        await api.generateAlphaProofBundle(orgId, {
          object_ids: createdObjects.map((object) => object.object_id),
          title: flow.proofTitle
        });
      }

      setLastMessage(
        `${flow.title} created as a standalone workflow with readiness${flow.approval ? ' and approval gating' : ''}${flow.proofOnCreate ? ' and proof' : ''}.`
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create standalone workflow');
    } finally {
      setLoading(null);
    }
  }

  async function attachObject(object: AlphaObject) {
    if (!orgId || !selectedTradeId) return;
    setLoading(`attach-${object.object_id}`);
    setError(null);
    try {
      const flow = config.flows.find((candidate) => candidate.primary.type === object.type);
      const mode = attachModeForObject(config, object);
      const attached = await api.attachAlphaObject(orgId, {
        object_id: object.object_id,
        target: { type: 'trade_room', id: selectedTradeId },
        mode,
        reason: flow?.attachReason ?? `Attach ${object.type.replaceAll('_', ' ')} to selected Trade Room.`
      });
      await api.generateAlphaProofBundle(orgId, {
        trade_id: selectedTradeId,
        object_ids: [attached.object.object_id],
        title: flow?.proofTitle ?? `${object.title} attachment proof bundle`
      });
      setLastMessage(`${object.title} ${mode === 'link' ? 'linked' : 'attached'} to Trade Room with proof generated.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach object to Trade Room');
    } finally {
      setLoading(null);
    }
  }

  async function generateStandaloneProof(object: AlphaObject) {
    if (!orgId) return;
    setLoading(`proof-${object.object_id}`);
    setError(null);
    try {
      await api.generateAlphaProofBundle(orgId, {
        trade_id: object.trade_id ?? undefined,
        object_ids: [object.object_id],
        title: `${object.title} proof bundle`
      });
      setLastMessage(`Proof bundle generated for ${object.title}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate proof bundle');
    } finally {
      setLoading(null);
    }
  }

  async function decideApproval(approval: AlphaObject, decision: 'approved' | 'rejected', input: ProtectedActionDecisionInput) {
    if (!orgId) return;
    setLoading(`approval-${approval.object_id}`);
    setError(null);
    try {
      await api.decideAlphaApproval(orgId, approval.object_id, {
        decision,
        notes: input.notes,
        step_up_verified: input.stepUpVerified,
        residual_risks_acknowledged: input.residualRisksAcknowledged,
        approval_step: input.approvalStep
      });
      setLastMessage(decision === 'approved' ? 'Protected action approved and moved into controlled execution.' : 'Protected action rejected and recorded.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record approval decision');
    } finally {
      setLoading(null);
    }
  }

  async function updateExecutionTask(taskId: string, body: ExecutionTaskStatusRequest) {
    if (!orgId) return;
    setLoading(`execution-${taskId}`);
    setError(null);
    try {
      await api.updateExecutionTaskStatus(orgId, taskId, body);
      setLastMessage('Controlled execution task updated and recorded in audit.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update execution task');
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
      <div className={cn('min-h-[calc(100dvh-56px)]', workspaceBackground(config.tone))}>
        <div className="mx-auto max-w-7xl space-y-5 p-6">
          <Surface className="relative overflow-hidden p-6">
            <div className={cn('absolute -right-20 -top-20 h-56 w-56 rounded-full blur-2xl', workspaceGlow(config.tone))} />
            <div className="relative grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
                  <Activity className="h-3.5 w-3.5 text-accent" />
                  {config.eyebrow}
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight">{config.title}</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{config.subtitle}</p>
                <div className="mt-5 grid gap-2 sm:grid-cols-3">
                  <Capability icon={<Play className="h-4 w-4" />} label="Start standalone" />
                  <Capability icon={<GitMerge className="h-4 w-4" />} label="Attach, link, convert" />
                  <Capability icon={<FileArchive className="h-4 w-4" />} label="Proof by default" />
                </div>
              </div>
              <Surface className="bg-paper/70 p-4 shadow-none">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">Attach target</h2>
                    <p className="mt-1 text-xs text-muted">Composable workflows need a Trade Room when the standalone job becomes transaction context.</p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={!orgId || loading === 'reference-trade'} onClick={createReferenceTrade}>
                    {loading === 'reference-trade' ? 'Creating...' : 'Create reference Trade Room'}
                  </Button>
                </div>
                <select
                  value={selectedTradeId}
                  onChange={(event) => setSelectedTradeId(event.target.value)}
                  className="mt-3 w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm"
                >
                  <option value="">No Trade Room selected</option>
                  {trades.map((trade) => (
                    <option key={trade.trade_id} value={trade.trade_id}>
                      {trade.title ?? 'Untitled trade'} · {trade.trade_id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                {selectedTradeId ? (
                  <Link className="mt-3 inline-flex text-xs font-medium text-accent" href={`/trade/${selectedTradeId}`}>
                    Open selected Trade Room
                  </Link>
                ) : null}
                <div className="mt-4 rounded-xl border border-border/10 bg-surface2/50 p-3">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Composition contract</div>
                  <div className="mt-2 grid gap-1.5 text-xs text-muted">
                    <span>Attach execution artifacts to one Trade Room.</span>
                    <span>Link reusable trust context across many trades.</span>
                    <span>Convert document-first work into transaction context.</span>
                  </div>
                </div>
              </Surface>
            </div>
          </Surface>

          {error ? <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">{error}</div> : null}
          {lastMessage ? <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">{lastMessage}</div> : null}

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric icon={<Activity className="h-4 w-4" />} label="Standalone" value={metrics.standalone.length} />
            <Metric icon={<GitMerge className="h-4 w-4" />} label="Trade-bound" value={metrics.attached.length} />
            <Metric icon={<ShieldCheck className="h-4 w-4" />} label="Approval-gated" value={metrics.approvals.length} />
            <Metric icon={<FileArchive className="h-4 w-4" />} label="Proof bundles" value={metrics.proofs.length} />
          </section>

          <StandaloneCoveragePanel coverage={config.coverage} objects={uniqueObjects([...workspaceObjects, ...proofObjects])} />

          <section className="grid gap-4 lg:grid-cols-3">
            {config.flows.map((flow) => (
              <Surface key={flow.key} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{flow.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted">{flow.summary}</p>
                  </div>
                  <Bot className="h-5 w-5 text-muted" />
                </div>
                <Button className="mt-5 w-full" disabled={!orgId || loading === flow.key} onClick={() => createFlow(flow)}>
                  {loading === flow.key ? 'Creating...' : flow.primaryLabel}
                </Button>
              </Surface>
            ))}
          </section>

          {approvalObjects.length ? (
            <Surface className="p-5">
              <h2 className="font-semibold">Protected Approval Gates</h2>
              <p className="mt-1 text-xs text-muted">Standalone jobs can be created here, but protected actions remain blocked until a human decides with evidence and risk acknowledgement.</p>
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {approvalObjects.slice(0, 4).map((approval) => (
                  <ProtectedActionApprovalCard
                    key={approval.object_id}
                    approval={approval}
                    loading={loading === `approval-${approval.object_id}`}
                    onDecide={(decision, input) => decideApproval(approval, decision, input)}
                  />
                ))}
              </div>
            </Surface>
          ) : null}

          {executionTaskObjects.length ? (
            <Surface className="p-5">
              <h2 className="font-semibold">Controlled Execution Tasks</h2>
              <p className="mt-1 text-xs text-muted">
                Approved standalone protected actions move here. TRAIBOX tracks the task, but the external step still requires a human operator.
              </p>
              <div className="mt-4 grid gap-3 xl:grid-cols-2">
                {executionTaskObjects.slice(0, 4).map((task) => (
                  <ControlledExecutionTaskCard
                    key={`${task.object_id}-${task.updated_at}`}
                    task={task}
                    loading={loading === `execution-${task.object_id}`}
                    onUpdate={updateExecutionTask}
                  />
                ))}
              </div>
            </Surface>
          ) : null}

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Standalone Object Queue</h2>
                  <p className="mt-1 text-xs text-muted">Typed objects from this workspace. Each can stay standalone or attach into trade context.</p>
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
                {queueObjects.length ? (
                  queueObjects.map((object) => (
                    <ObjectRow
                      key={`${object.object_id}-${object.updated_at}`}
                      object={object}
                      canAttach={Boolean(selectedTradeId) && !object.trade_id && ATTACHABLE_WORKFLOW_TYPES.includes(object.type)}
                      canProof={PROOFABLE_WORKFLOW_TYPES.includes(object.type)}
                      attachMode={attachModeForObject(config, object)}
                      loading={loading}
                      onAttach={() => attachObject(object)}
                      onProof={() => generateStandaloneProof(object)}
                    />
                  ))
                ) : (
                  <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-5 text-sm text-muted">{config.empty}</p>
                )}
              </div>
            </Surface>

            <div className="space-y-4">
              <Surface className="p-5">
                <h2 className="font-semibold">Readiness Signals</h2>
                <div className="mt-4 space-y-2">
                  {readiness.length ? (
                    readiness.slice(0, 5).map((state) => (
                      <div key={state.readiness_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">{state.overall}</div>
                          <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{Math.round(state.score)}%</span>
                        </div>
                        <p className="mt-1 text-xs leading-5 text-muted">{state.next_actions[0] ?? state.missing_items[0] ?? 'Ready for review.'}</p>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">Create a workflow to produce readiness.</p>
                  )}
                </div>
              </Surface>

              <Surface className="p-5">
                <h2 className="font-semibold">Live Signals</h2>
                <div className="mt-4 space-y-2">
                  {events.length ? (
                    events.slice(0, 6).map((event) => (
                      <div key={event.event_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">{event.type}</div>
                          <span className="text-[10px] text-muted">{new Date(event.ts).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">SSE events from this workflow will appear here.</p>
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

export const financeWorkspaceConfig: WorkspaceConfig = {
  workspace: 'finance',
  tone: 'finance',
  eyebrow: 'Finance Workspace · standalone execution',
  title: 'Start with money movement, attach when the trade is ready.',
  subtitle:
    'Create payment intents and funding requests independently, run readiness, keep protected actions gated by approval, then attach the workflow into a Trade Room with proof.',
  empty: 'No Finance jobs yet. Create a payment intent or funding request to start.',
  coverage: [
    {
      label: 'Payment Intent',
      summary: 'Standalone payment job with protected-action approval before money movement.',
      objectTypes: ['payment_intent']
    },
    {
      label: 'Funding Request',
      summary: 'Finance-readiness request with missing proof, approval gate, and attach path.',
      objectTypes: ['funding_request']
    },
    {
      label: 'Payment Route',
      summary: 'Route and beneficiary readiness can be prepared before execution.',
      objectTypes: ['payment_route']
    },
    {
      label: 'Proof Bundle',
      summary: 'Finance artifacts can generate standalone or trade-bound proof.',
      objectTypes: ['proof_bundle']
    }
  ],
  flows: [
    {
      key: 'payment-intent',
      title: 'Standalone Payment Intent',
      summary: 'Prepare a payment intent without forcing a full transaction first. TRAIBOX marks the protected action and creates a human approval gate.',
      primaryLabel: 'Create payment intent',
      primary: {
        type: 'payment_intent',
        status: 'approval_required',
        title: 'Standalone payment intent: supplier advance',
        summary: 'Finance-created payment intent awaiting protected-action approval.',
        payload: {
          amount: 19200,
          currency: 'EUR',
          beneficiary: 'Lusitania Automation Lda',
          purpose: '40% supplier advance',
          protected_action: 'send_payment',
          route_status: 'not_selected'
        }
      },
      approval: {
        action: 'send_payment',
        proposedAction: 'Approve supplier advance payment after beneficiary and readiness checks pass.',
        rationale: 'Sending payment is externally consequential and requires explicit human approval.'
      },
      attachReason: 'Attach standalone payment intent to the selected Trade Room execution path.',
      proofTitle: 'Standalone payment attachment proof bundle'
    },
    {
      key: 'funding-request',
      title: 'Funding Request',
      summary: 'Create a finance-readiness request, identify missing proof, and block submission behind a governed approval gate.',
      primaryLabel: 'Create funding request',
      primary: {
        type: 'funding_request',
        status: 'pending_input',
        title: 'Standalone funding request: working capital',
        summary: 'Funding request created before final trade execution.',
        payload: {
          amount: 42000,
          currency: 'EUR',
          tenor_days: 90,
          missing: ['purchase_order', 'buyer_acceptance_terms'],
          protected_action: 'submit_funding_request'
        }
      },
      companions: [
        (primary) => ({
          type: 'document',
          body: {
            title: 'Finance-readiness pack',
            summary: 'Required documents identified for lender review.',
            status: 'pending_input',
            origin_workspace: 'finance',
            payload: {
              required_documents: ['purchase_order', 'invoice', 'buyer_acceptance_terms'],
              present_documents: ['invoice']
            },
            evidence_refs: [{ object_id: primary.object_id, role: 'funding_request' }]
          }
        })
      ],
      approval: {
        action: 'submit_funding_request',
        proposedAction: 'Submit funding request to sandbox financier after missing documents are provided.',
        rationale: 'Submitting funding requests externally must remain human-controlled.'
      },
      attachReason: 'Attach funding request and finance-readiness context to the selected Trade Room.',
      proofTitle: 'Funding request attachment proof bundle'
    },
    {
      key: 'payment-route',
      title: 'Payment Route Readiness',
      summary: 'Prepare a thin payment route and beneficiary check as standalone finance mechanics before execution.',
      primaryLabel: 'Create route check',
      primary: {
        type: 'payment_route',
        status: 'ready_for_review',
        title: 'Payment route check: SEPA instant fallback',
        summary: 'Route and beneficiary context prepared before a protected payment is sent.',
        payload: {
          scheme: 'SEPA_INSTANT',
          fallback: 'manual_bank_transfer',
          beneficiary_check: 'needs_review',
          risks: ['beneficiary_iban_proof_missing']
        }
      },
      attachReason: 'Attach route and beneficiary readiness to the selected Trade Room payment path.',
      proofTitle: 'Payment route readiness proof bundle'
    }
  ]
};

export const clearanceWorkspaceConfig: WorkspaceConfig = {
  workspace: 'clearance',
  tone: 'clearance',
  eyebrow: 'Clearance Workspace · compliance and reports',
  title: 'Run clearance as a job, not just a tab inside a trade.',
  subtitle:
    'Create standalone compliance, sustainability, Trade Passport, and report artifacts that can later become transaction evidence inside a Trade Room.',
  empty: 'No Clearance jobs yet. Create a clearance check or report workflow to start.',
  coverage: [
    {
      label: 'Clearance Check',
      summary: 'Compliance or sustainability check can start without a Trade Room.',
      objectTypes: ['clearance_check']
    },
    {
      label: 'Document Upload',
      summary: 'Document-first evidence can be extracted, queried, and converted later.',
      objectTypes: ['document', 'extraction_result']
    },
    {
      label: 'Trade Passport',
      summary: 'Reusable passport context can link into transaction readiness.',
      objectTypes: ['trade_passport']
    },
    {
      label: 'Report And Proof',
      summary: 'Reports and proof bundles preserve evidence for export or attachment.',
      objectTypes: ['report', 'proof_bundle']
    }
  ],
  flows: [
    {
      key: 'clearance-check',
      title: 'Standalone Clearance Check',
      summary: 'Run an EU-first clearance check with explicit missing evidence and a readiness state before a full transaction exists.',
      primaryLabel: 'Create clearance check',
      primary: {
        type: 'clearance_check',
        status: 'pending_input',
        title: 'Standalone EU clearance check',
        summary: 'Clearance check with origin and sustainability evidence gaps.',
        payload: {
          corridor: 'PT-ES',
          ruleset: 'EU-alpha',
          missing: ['origin_statement', 'buyer_tax_id'],
          risks: ['Rules evidence incomplete']
        }
      },
      companions: [
        (primary) => ({
          type: 'report',
          body: {
            title: 'Clearance gap report',
            summary: 'Report generated from standalone clearance context.',
            status: 'ready_for_review',
            origin_workspace: 'clearance',
            payload: {
              report_type: 'clearance_gap_report',
              missing: ['origin_statement', 'buyer_tax_id']
            },
            evidence_refs: [{ object_id: primary.object_id, role: 'clearance_check' }]
          }
        })
      ],
      attachReason: 'Attach standalone clearance check to the selected Trade Room readiness path.',
      proofTitle: 'Standalone clearance attachment proof bundle'
    },
    {
      key: 'document-first',
      title: 'Document-First Upload',
      summary: 'Upload and extract evidence before a Trade Room exists, then convert it into transaction context later.',
      primaryLabel: 'Upload and extract document',
      primary: {
        type: 'document',
        status: 'pending_input',
        title: 'Document-first commercial evidence',
        summary: 'Document-first workflow started from Clearance before a transaction exists.',
        payload: {
          document_first: true,
          suggested_workflows: ['trade_room', 'clearance_check', 'proof_bundle']
        }
      },
      extractDocument: {
        filename: 'document-first-commercial-pack.txt',
        mime_type: 'text/plain',
        text:
          'Commercial pack. Seller: Lusitania Automation Lda. Buyer: Iberica Components SL. Amount EUR 48000. Corridor PT-ES. Missing origin statement and buyer acceptance proof. Suggested action: create Trade Room or clearance check.'
      },
      attachMode: 'convert',
      attachReason: 'Convert document-first evidence into the selected Trade Room without losing extraction, audit, or memory context.',
      proofTitle: 'Document-first conversion proof bundle'
    },
    {
      key: 'trade-passport',
      title: 'Trade Passport Review',
      summary: 'Create a Trade Passport review artifact that records trust context, missing identifiers, and report readiness.',
      primaryLabel: 'Create passport review',
      primary: {
        type: 'trade_passport',
        status: 'ready_for_review',
        title: 'Trade Passport review: Iberica Components',
        summary: 'Passport visibility and evidence review for reusable clearance context.',
        payload: {
          counterparty: 'Iberica Components SL',
          visibility: 'internal',
          identifiers: ['tax_id_pending'],
          reusable_across_trades: true
        }
      },
      attachMode: 'link',
      attachReason: 'Link reusable Trade Passport context to the selected Trade Room.',
      proofTitle: 'Trade Passport link proof bundle'
    },
    {
      key: 'report-generation',
      title: 'Standalone Report',
      summary: 'Generate a thin clearance report independently, with explicit evidence requirements and proof-ready output.',
      primaryLabel: 'Create report',
      primary: {
        type: 'report',
        status: 'ready_for_review',
        title: 'Standalone clearance readiness report',
        summary: 'Report created from a standalone clearance job and ready to attach or export.',
        payload: {
          report_type: 'clearance_readiness',
          corridor: 'PT-ES',
          findings: ['origin_statement_missing', 'buyer_vat_pending'],
          recommended_next_action: 'request_missing_evidence'
        }
      },
      attachReason: 'Attach standalone clearance report as Trade Room evidence.',
      proofTitle: 'Standalone report proof bundle',
      proofOnCreate: true
    }
  ]
};

export const networkWorkspaceConfig: WorkspaceConfig = {
  workspace: 'network',
  tone: 'network',
  eyebrow: 'Network Workspace · counterparties and trust',
  title: 'Build counterparty trust once, reuse it across trades.',
  subtitle:
    'Onboard counterparties, run screenings, and preserve trust context as standalone Network memory that can link into one or many Trade Rooms.',
  empty: 'No Network objects yet. Create an onboarding or screening workflow to start.',
  coverage: [
    {
      label: 'Counterparty',
      summary: 'Reusable business profile with identifiers and trust context.',
      objectTypes: ['counterparty']
    },
    {
      label: 'Onboarding',
      summary: 'Structured onboarding flow can collect missing counterparty evidence.',
      objectTypes: ['onboarding_flow']
    },
    {
      label: 'Screening',
      summary: 'Screening results stay reusable and permission-aware across trades.',
      objectTypes: ['screening_result']
    },
    {
      label: 'Matchmaking',
      summary: 'Curated network matches can become execution or finance context.',
      objectTypes: ['matchmaking_result']
    }
  ],
  flows: [
    {
      key: 'counterparty-onboarding',
      title: 'Counterparty Onboarding',
      summary: 'Create a reusable buyer profile, onboarding flow, and screening result without requiring an immediate transaction.',
      primaryLabel: 'Create onboarding flow',
      primary: {
        type: 'counterparty',
        status: 'pending_input',
        title: 'Counterparty: Iberica Components SL',
        summary: 'Network-created buyer profile with reusable trade context.',
        payload: {
          role: 'buyer',
          country: 'ES',
          identifiers_missing: ['lei'],
          reusable_across_trades: true
        }
      },
      companions: [
        (primary) => ({
          type: 'onboarding_flow',
          body: {
            title: 'Onboarding flow: Iberica Components SL',
            summary: 'Collecting business identifiers and authorized contact evidence.',
            status: 'in_progress',
            origin_workspace: 'network',
            payload: {
              required_fields: ['registration_number', 'lei', 'authorized_contact'],
              completed_fields: ['registration_number']
            },
            evidence_refs: [{ object_id: primary.object_id, role: 'counterparty' }]
          }
        }),
        (primary) => ({
          type: 'screening_result',
          body: {
            title: 'Screening result: Iberica Components SL',
            summary: 'Sanctions clear; LEI still missing.',
            status: 'ready_for_review',
            origin_workspace: 'network',
            payload: {
              sanctions: 'clear',
              pep: 'clear',
              adverse_media: 'none_found',
              missing: ['lei']
            },
            evidence_refs: [{ object_id: primary.object_id, role: 'counterparty' }]
          }
        })
      ],
      readinessTarget: 'last',
      attachMode: 'link',
      attachReason: 'Link reusable counterparty trust context to the selected Trade Room.',
      proofTitle: 'Counterparty onboarding link proof bundle'
    },
    {
      key: 'screening-only',
      title: 'Standalone Screening',
      summary: 'Run a reusable screening result without onboarding a full counterparty flow first.',
      primaryLabel: 'Create screening',
      primary: {
        type: 'screening_result',
        status: 'ready_for_review',
        title: 'Screening result: Atlantic Components Lda',
        summary: 'Standalone screening result ready to link into trade or counterparty context.',
        payload: {
          sanctions: 'clear',
          pep: 'clear',
          adverse_media: 'review_recommended',
          confidence: 0.82,
          reusable_across_trades: true
        }
      },
      attachMode: 'link',
      attachReason: 'Link standalone screening result to the selected Trade Room trust context.',
      proofTitle: 'Standalone screening link proof bundle'
    },
    {
      key: 'matchmaking',
      title: 'Curated Matchmaking Result',
      summary: 'Capture a thin matchmaking result as Network intelligence that can later link to a transaction or counterparty record.',
      primaryLabel: 'Create match result',
      primary: {
        type: 'matchmaking_result',
        status: 'ready_for_review',
        title: 'Match result: sandbox financier candidate',
        summary: 'Curated Network match for funding and payment support.',
        payload: {
          match_type: 'financier',
          corridor: 'PT-ES',
          confidence: 0.74,
          reasons: ['EUR corridor support', 'working capital appetite', 'SME trade history fit']
        }
      },
      attachMode: 'link',
      attachReason: 'Link Network match result to the selected Trade Room as execution context.',
      proofTitle: 'Network match link proof bundle'
    }
  ]
};

function StandaloneCoveragePanel({ coverage, objects }: { coverage: CoverageItem[]; objects: AlphaObject[] }) {
  return (
    <Surface className="overflow-hidden p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="font-semibold">Standalone Workflow Coverage</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
            Alpha proof of modular use: each job can start independently, remain queryable, and later attach, link, or convert into Trade Room context.
          </p>
        </div>
        <span className="rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
          {coverage.filter((item) => objects.some((object) => item.objectTypes.includes(object.type))).length} of {coverage.length} exercised
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {coverage.map((item) => {
          const matches = objects.filter((object) => item.objectTypes.includes(object.type));
          const standalone = matches.filter((object) => !object.trade_id).length;
          const attached = matches.filter((object) => Boolean(object.trade_id)).length;
          const proofed = matches.some((object) => object.type === 'proof_bundle' || object.evidence_refs_json.length > 0);
          return (
            <div
              key={item.label}
              className={cn(
                'rounded-2xl border px-3 py-3',
                matches.length ? 'border-success/20 bg-success/10' : 'border-border/10 bg-surface2/50'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{item.label}</div>
                {matches.length ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Activity className="h-4 w-4 text-muted" />}
              </div>
              <p className="mt-1 min-h-[40px] text-xs leading-5 text-muted">{item.summary}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <IntegrityPill label={`${matches.length} object(s)`} />
                <IntegrityPill label={`${standalone} standalone`} />
                <IntegrityPill label={`${attached} trade-bound`} />
                {proofed ? <IntegrityPill label="proof-ready" /> : null}
              </div>
            </div>
          );
        })}
      </div>
    </Surface>
  );
}

function ObjectRow({
  object,
  canAttach,
  canProof,
  attachMode,
  loading,
  onAttach,
  onProof
}: {
  object: AlphaObject;
  canAttach: boolean;
  canProof: boolean;
  attachMode: AttachMode;
  loading: string | null;
  onAttach: () => void;
  onProof: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium">{object.title}</div>
            <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{object.status}</span>
          </div>
          <div className="mt-1 text-xs text-muted">
            {object.type.replaceAll('_', ' ')} · {object.trade_id ? `trade ${object.trade_id.slice(0, 8)}` : 'standalone'}
          </div>
          {!object.trade_id ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              <IntegrityPill label={`Mode: ${attachMode}`} />
              <IntegrityPill label="Audit preserved" />
              <IntegrityPill label="Memory preserved" />
              <IntegrityPill label="Proof-ready" />
            </div>
          ) : null}
          {object.summary ? <p className="mt-2 text-xs leading-5 text-muted">{object.summary}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {object.trade_id ? (
            <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={`/trade/${object.trade_id}`}>
              Open Trade
            </Link>
          ) : null}
          {canAttach ? (
            <Button size="sm" variant="secondary" disabled={loading === `attach-${object.object_id}`} onClick={onAttach}>
              {loading === `attach-${object.object_id}` ? 'Composing...' : attachButtonLabel(attachMode)}
            </Button>
          ) : null}
          {canProof ? (
            <Button size="sm" variant="ghost" disabled={loading === `proof-${object.object_id}`} onClick={onProof}>
              {loading === `proof-${object.object_id}` ? 'Proofing...' : 'Proof'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function IntegrityPill({ label }: { label: string }) {
  return <span className="rounded-full border border-border/10 bg-paper px-2 py-1 text-[10px] text-muted">{label}</span>;
}

function attachModeForObject(config: WorkspaceConfig, object: AlphaObject): AttachMode {
  const flow = config.flows.find((candidate) => candidate.primary.type === object.type || candidate.key === String(object.payload_json?.standalone_flow ?? ''));
  if (flow?.attachMode) return flow.attachMode;
  if (object.type === 'counterparty' || object.type === 'screening_result' || object.type === 'trade_passport' || object.type === 'matchmaking_result') return 'link';
  if (object.type === 'document' || object.type === 'extraction_result') return 'convert';
  return 'attach';
}

function attachButtonLabel(mode: AttachMode) {
  if (mode === 'link') return 'Link';
  if (mode === 'convert') return 'Convert';
  return 'Attach';
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Surface className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted">{icon}</div>
        <CheckCircle2 className="h-4 w-4 text-success" />
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

function workspaceBackground(tone: WorkspaceTone) {
  if (tone === 'finance') return 'bg-[radial-gradient(circle_at_top_left,rgba(24,132,92,0.18),transparent_32%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]';
  if (tone === 'clearance') return 'bg-[radial-gradient(circle_at_top_right,rgba(37,99,235,0.18),transparent_32%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]';
  return 'bg-[radial-gradient(circle_at_top_left,rgba(196,118,44,0.18),transparent_32%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]';
}

function workspaceGlow(tone: WorkspaceTone) {
  if (tone === 'finance') return 'bg-success/10';
  if (tone === 'clearance') return 'bg-accent/10';
  return 'bg-warn/10';
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
  if (action === 'change_verified_identity' || action === 'release_escrow_or_conditions' || action === 'make_binding_trade_commitment' || action === 'approve_trade_execution') {
    return {
      current: 'admin_control',
      steps: [{ key: 'admin_control', label: 'Admin control', required_role: 'admin' as const, status: 'approval_required' as const }]
    };
  }
  return {
    current: 'ops_review',
    steps: [{ key: 'ops_review', label: 'Operations review', required_role: 'ops' as const, status: 'approval_required' as const }]
  };
}

function approvalTargetId(object: AlphaObject) {
  const target = object.payload_json?.target;
  if (typeof target === 'object' && target !== null && 'id' in target) {
    const id = (target as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function payloadTargetId(object: AlphaObject) {
  const target = object.payload_json?.target;
  if (typeof target === 'object' && target !== null && 'id' in target) {
    const id = (target as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function evidenceObjectIds(object: AlphaObject) {
  return object.evidence_refs_json
    .map((ref) => {
      if (typeof ref === 'object' && ref !== null && 'object_id' in ref) {
        const id = (ref as { object_id?: unknown }).object_id;
        return typeof id === 'string' ? id : null;
      }
      return null;
    })
    .filter((id): id is string => Boolean(id));
}

function uniqueObjects(objects: AlphaObject[]) {
  const seen = new Set<string>();
  return objects.filter((object) => {
    if (seen.has(object.object_id)) return false;
    seen.add(object.object_id);
    return true;
  });
}
