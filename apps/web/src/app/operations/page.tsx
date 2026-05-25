'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Circle,
  Clock3,
  FileArchive,
  FileText,
  GitMerge,
  ListChecks,
  Play,
  RefreshCw,
  ShieldCheck
} from 'lucide-react';
import type { AlphaMemoryEvent, AlphaObject, ExecutionTaskStatusRequest, ReadinessState, SSEEvent, TradeBrainEvalRun } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { PilotRecoveryCard } from '../../components/pilot-recovery';
import { Button, buttonClassName } from '../../components/ui/button';
import { Surface } from '../../components/ui/surface';
import { ProtectedActionApprovalCard, type ProtectedActionDecisionInput } from '../../components/protected-action-approval';
import { ControlledExecutionTaskCard } from '../../components/controlled-execution-task';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

export default function OperationsPage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [readiness, setReadiness] = useState<ReadinessState[]>([]);
  const [memory, setMemory] = useState<AlphaMemoryEvent[]>([]);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [evalRuns, setEvalRuns] = useState<TradeBrainEvalRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [approvalLoading, setApprovalLoading] = useState<string | null>(null);
  const [executionLoading, setExecutionLoading] = useState<string | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [result, evalHistory] = await Promise.all([api.queryAlphaObjects(orgId, { limit: 200 }), api.listTradeBrainEvalRuns(orgId, { limit: 12 })]);
      setObjects(result.objects ?? []);
      setReadiness(result.readiness_states ?? []);
      setMemory(result.memory_events ?? []);
      setEvalRuns(evalHistory.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Operations Center');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    const source = new EventSource(api.eventsUrl({ orgId }));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as SSEEvent;
        setEvents((current) => [event, ...current].slice(0, 24));
        if (
          event.type === 'approval.requested' ||
          event.type === 'approval.decided' ||
          event.type === 'workflow.run.created' ||
          event.type === 'workflow.run.updated' ||
          event.type === 'execution.task.created' ||
          event.type === 'execution.task.updated' ||
          event.type === 'external_access.granted' ||
          event.type === 'document_request.created' ||
          event.type === 'document_request.submitted' ||
          event.type === 'agent.task.completed' ||
          event.type === 'ai.eval.completed' ||
          event.type === 'ai.eval.trade_brain.persisted' ||
          event.type === 'proof.bundle.ready' ||
          event.type === 'ledger.bundle.ready' ||
          event.type === 'ledger.bundle.verified' ||
          event.type === 'ledger.export.ready' ||
          event.type === 'operations.digest.ready' ||
          event.type === 'readiness.evaluated'
        ) {
          void refresh();
        }
      } catch {
        // Development SSE can be noisy while hot reloading.
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const cockpit = useMemo(() => buildCockpit(objects, readiness, memory, events), [objects, readiness, memory, events]);
  const qualityTrends = useMemo(() => buildQualityTrends(cockpit.aiEvalResults, evalRuns, readiness, cockpit.proofs), [cockpit.aiEvalResults, cockpit.proofs, evalRuns, readiness]);
  const hasPilotSignals = objects.length > 0 || readiness.length > 0 || memory.length > 0 || events.length > 0;

  async function decideApproval(approval: AlphaObject, decision: 'approved' | 'rejected', input: ProtectedActionDecisionInput) {
    if (!orgId) return;
    setApprovalLoading(approval.object_id);
    setError(null);
    setMessage(null);
    try {
      await api.decideAlphaApproval(orgId, approval.object_id, {
        decision,
        notes: input.notes,
        step_up_verified: input.stepUpVerified,
        residual_risks_acknowledged: input.residualRisksAcknowledged,
        approval_step: input.approvalStep
      });
      setMessage(decision === 'approved' ? 'Protected action approved and controlled execution task created.' : 'Protected action rejected and recorded in audit.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record approval decision');
    } finally {
      setApprovalLoading(null);
    }
  }

  async function updateExecutionTask(taskId: string, body: ExecutionTaskStatusRequest) {
    if (!orgId) return;
    setExecutionLoading(taskId);
    setError(null);
    setMessage(null);
    try {
      await api.updateExecutionTaskStatus(orgId, taskId, body);
      setMessage('Controlled execution task updated and recorded in audit.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update execution task');
    } finally {
      setExecutionLoading(null);
    }
  }

  async function runEvalGate() {
    if (!orgId) return;
    setEvalLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.runTradeBrainEval(orgId, { suite_id: 'all', persist: true });
      setMessage(`Trade Brain eval gate ${result.run.status}: ${result.run.passed}/${result.run.case_count} cases, score ${Math.round(result.run.score)}%.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not run Trade Brain eval gate');
    } finally {
      setEvalLoading(false);
    }
  }

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper text-ink p-6">Loading…</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper text-ink p-6">
        <Surface className="max-w-xl mx-auto p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="text-sm text-muted mt-2">Operations Center needs organization context for permissions, memory, and audit.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  return (
    <AppShell
      orgId={orgId}
      orgs={orgs}
      onOrgChange={setOrgId}
      headerRight={<div className="text-sm text-muted">{selectedOrg?.name ?? 'Select org'}</div>}
    >
      <div className="min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_right,rgba(196,118,44,0.16),transparent_30%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]">
        <div className="mx-auto max-w-7xl space-y-5 p-6">
          <Surface className="relative overflow-hidden p-6">
            <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-warn/10 blur-2xl" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
                  <Activity className="h-3.5 w-3.5 text-warn" />
                  Intelligence Cockpit
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight">What should we do first today?</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                  Operations Center pulls readiness changes, approvals, protected actions, agent work, proof bundles, and Trade Memory into one cockpit.
                </p>
              </div>
              <Button disabled={!orgId || loading} onClick={refresh}>
                <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
                Refresh
              </Button>
            </div>
            {error ? <div className="relative mt-4 rounded-xl border border-error/20 bg-error/10 px-3 py-2 text-sm text-error">{error}</div> : null}
            {message ? <div className="relative mt-4 rounded-xl border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">{message}</div> : null}
          </Surface>

          {!orgId ? (
            <PilotRecoveryCard
              title="Operations needs an organization before it can become the cockpit."
              summary="Approvals, agents, proof, memory, and SSE signals are all tenant-scoped. Select or create an org, then run the Trade Room reference story from Trades."
              tone="warn"
              checkpoints={['No cross-org signals are loaded without org context.', 'Settings controls team, roles, policies, and protected actions.', 'Trades can generate the controlled pilot story on demand.']}
              actions={
                <>
                  <Link className={buttonClassName({ variant: 'secondary' })} href="/settings">
                    Open Settings
                  </Link>
                  <Link className={buttonClassName()} href="/trades">
                    Open Trades
                  </Link>
                </>
              }
            />
          ) : error ? (
            <PilotRecoveryCard
              title="Operations is in degraded mode."
              summary="The cockpit could not refresh its structured signals. Retry the scoped query first; if the API is unavailable, the pilot story can be replayed once the services recover."
              tone="error"
              checkpoints={['Retry only reloads queryable activity.', 'Protected approvals are still server-enforced.', 'Replay and proof records remain scoped to the selected org.']}
              actions={
                <>
                  <Button variant="secondary" disabled={loading} onClick={refresh}>
                    <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
                    Retry
                  </Button>
                  <Link className={buttonClassName({ variant: 'secondary' })} href="/trades">
                    Reopen Trades
                  </Link>
                </>
              }
            />
          ) : !loading && !hasPilotSignals ? (
            <PilotRecoveryCard
              title="No operational signals yet."
              summary="Run the full Trade Room story to populate the cockpit with readiness changes, approvals, agent/eval results, proof bundles, memory events, and standalone attachment signals."
              checkpoints={['Priority queue is generated from structured objects.', 'Live signals arrive through SSE.', 'Pilot runway measures proof points across the demo story.']}
              actions={
                <>
                  <Link className={buttonClassName()} href="/trades">
                    Run from Trades
                  </Link>
                  <Link className={buttonClassName({ variant: 'secondary' })} href="/intelligence">
                    Ask Intelligence
                  </Link>
                </>
              }
            />
          ) : null}

          <OperationsBriefingCard briefing={cockpit.briefing} />

          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <CockpitMetric icon={<ShieldCheck className="h-4 w-4" />} label="Approvals Waiting" value={cockpit.pendingApprovals.length} tone="warn" />
            <CockpitMetric icon={<Activity className="h-4 w-4" />} label="Active Tasks" value={cockpit.activeTasks.length} tone="accent" />
            <CockpitMetric icon={<FileText className="h-4 w-4" />} label="Document Requests" value={cockpit.pendingDocumentRequests.length} tone="warn" />
            <CockpitMetric icon={<GitMerge className="h-4 w-4" />} label="Standalone Jobs" value={cockpit.standaloneWorkflowObjects.length} tone="accent" />
            <CockpitMetric icon={<ShieldCheck className="h-4 w-4" />} label="Approval Chains" value={cockpit.approvalChains.length} tone="warn" />
            <CockpitMetric icon={<Activity className="h-4 w-4" />} label="Workflow Runs" value={cockpit.workflowRuns.length} tone="accent" />
            <CockpitMetric icon={<AlertTriangle className="h-4 w-4" />} label="Risk Or Gaps" value={cockpit.riskyReadiness.length} tone="error" />
            <CockpitMetric icon={<Bot className="h-4 w-4" />} label="Agent Results" value={cockpit.agentResults.length} tone="accent" />
            <CockpitMetric icon={<BrainCircuit className="h-4 w-4" />} label="AI Eval Results" value={cockpit.aiEvalResults.length} tone="accent" />
            <CockpitMetric icon={<FileArchive className="h-4 w-4" />} label="Proof Bundles Ready" value={cockpit.proofs.length} tone="success" />
          </section>

          <PilotRunwayCard runway={cockpit.pilotRunway} />

          <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <WorkstreamHealthCard workstreams={cockpit.briefing.workstreams} />
            <RecentChangeDigestCard changes={cockpit.briefing.recentChanges} />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Surface className="p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Priority Queue</h2>
                  <p className="mt-1 text-xs text-muted">Derived from approvals, readiness gaps, protected actions, and agent recommendations.</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-muted" />
              </div>
              <div className="mt-4 space-y-2">
                {cockpit.priorityItems.length ? (
                  cockpit.priorityItems.map((item) => <PriorityRow key={item.id} item={item} />)
                ) : (
                  <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">
                    No urgent operational work yet. Run an alpha story or open a Trade Room to create readiness, approvals, and proof.
                  </p>
                )}
              </div>
            </Surface>

            <Surface className="p-5">
              <h2 className="font-semibold">Live Signals</h2>
              <p className="mt-1 text-xs text-muted">SSE events from alpha workflows appear here as operational signals.</p>
              <div className="mt-4 space-y-2">
                {events.length ? (
                  events.slice(0, 8).map((event) => (
                    <div key={event.event_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium">{event.type}</div>
                        <span className="text-[10px] text-muted">{formatShortDate(event.ts)}</span>
                      </div>
                      {event.trade_id ? <div className="mt-1 text-xs text-muted">Trade {event.trade_id.slice(0, 8)}</div> : null}
                    </div>
                  ))
                ) : (
                  <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">
                    Waiting for readiness, approval, proof, agent, or digest events.
                  </p>
                )}
              </div>
            </Surface>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <ApprovalColumn approvals={cockpit.approvals} loadingId={approvalLoading} onDecide={decideApproval} />
            <ApprovalChainColumn approvals={cockpit.approvalChains} />
            <ExecutionColumn tasks={cockpit.executionTasks} relatedObjects={[...cockpit.agentResults, ...cockpit.executionObjects]} loadingId={executionLoading} onUpdate={updateExecutionTask} />
            <AiQualityGateCard runs={evalRuns} evals={cockpit.aiEvalResults} loading={evalLoading} onRun={runEvalGate} />
            <QualityTrendsCard trends={qualityTrends} />
            <AiEvalColumn evals={cockpit.aiEvalResults} />
            <ObjectColumn title="Workflow Runs" objects={cockpit.workflowRuns} empty="No workflow runs yet." />
            <ObjectColumn title="Standalone Workflows" objects={cockpit.standaloneWorkflowObjects} empty="No standalone workflow objects yet." />
            <ObjectColumn title="Document Requests" objects={cockpit.documentRequests} empty="No document requests yet." />
            <ObjectColumn title="External Access" objects={cockpit.externalAccess} empty="No external participant grants yet." />
            <MemoryColumn memory={memory} />
          </section>
        </div>
      </div>
    </AppShell>
  );
}

function buildCockpit(objects: AlphaObject[], readiness: ReadinessState[], memory: AlphaMemoryEvent[], events: SSEEvent[]) {
  const approvals = objects.filter((object) => object.type === 'approval');
  const pendingApprovals = approvals.filter((object) => object.status === 'approval_required');
  const approvalChains = approvals.filter((object) => getApprovalChain(object).length > 0);
  const proofs = objects.filter((object) => object.type === 'proof_bundle' && object.status === 'completed');
  const agentResults = objects.filter((object) => object.type === 'agent_work_result');
  const aiEvalResults = objects.filter((object) => object.type === 'ai_eval_result');
  const workflowRuns = objects.filter((object) => object.type === 'workflow_run');
  const executionTasks = objects.filter((object) => object.type === 'execution_task');
  const activeTasks = executionTasks.filter((object) => ['in_progress', 'ready_for_review', 'blocked'].includes(object.status));
  const externalAccess = objects.filter((object) => object.type === 'external_access_grant');
  const documentRequests = objects.filter((object) => object.type === 'document_request');
  const pendingDocumentRequests = documentRequests.filter((object) => ['pending_input', 'in_progress'].includes(object.status));
  const workflowTypes = [
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
    'report'
  ];
  const executionObjects = objects.filter((object) => workflowTypes.includes(object.type) && Boolean(object.trade_id));
  const standaloneWorkflowObjects = objects.filter((object) => workflowTypes.includes(object.type) && !object.trade_id);
  const riskyReadiness = readiness.filter((state) => ['missing', 'risky', 'blocked'].includes(state.overall));
  const priorityItems = [
    ...pendingApprovals.map((object) => ({
      id: object.object_id,
      title: object.title,
      summary: currentApprovalStepSummary(object) ?? object.summary ?? 'Protected action needs human decision.',
      tone: 'warn' as const,
      href: object.trade_id ? `/trade/${object.trade_id}` : undefined
    })),
    ...riskyReadiness.slice(0, 5).map((state) => ({
      id: state.readiness_id,
      title: `Readiness ${state.overall}`,
      summary: state.next_actions[0] ?? state.missing_items[0] ?? 'Review missing or risky trade context.',
      tone: state.overall === 'blocked' ? ('error' as const) : ('warn' as const),
      href: state.trade_id ? `/trade/${state.trade_id}` : undefined
    })),
    ...activeTasks.slice(0, 5).map((object) => ({
      id: object.object_id,
      title: object.title,
      summary: object.summary ?? 'Execution task is in progress.',
      tone: 'accent' as const,
      href: object.trade_id ? `/trade/${object.trade_id}` : undefined
    })),
    ...workflowRuns
      .filter((object) => ['approval_required', 'in_progress', 'blocked', 'ready_for_review'].includes(object.status))
      .slice(0, 5)
      .map((object) => ({
        id: object.object_id,
        title: object.title,
        summary: String((object.payload_json?.workflow_state as Record<string, unknown> | undefined)?.stage ?? object.summary ?? 'Workflow run needs attention.'),
        tone: object.status === 'blocked' ? ('error' as const) : object.status === 'approval_required' ? ('warn' as const) : ('accent' as const),
        href: object.trade_id ? `/trade/${object.trade_id}` : undefined
      })),
    ...pendingDocumentRequests.slice(0, 5).map((object) => ({
      id: object.object_id,
      title: object.title,
      summary: object.summary ?? 'Missing evidence request is waiting for response.',
      tone: 'warn' as const,
      href: object.trade_id ? `/trade/${object.trade_id}` : undefined
    })),
    ...standaloneWorkflowObjects
      .filter((object) => ['pending_input', 'approval_required', 'ready_for_review', 'blocked'].includes(object.status))
      .slice(0, 5)
      .map((object) => ({
        id: object.object_id,
        title: object.title,
        summary: object.summary ?? 'Standalone workflow needs review or attachment.',
        tone: object.status === 'blocked' ? ('error' as const) : ('accent' as const),
        href: object.trade_id ? `/trade/${object.trade_id}` : undefined
      })),
    ...agentResults.slice(0, 3).map((object) => ({
      id: object.object_id,
      title: object.title,
      summary: object.summary ?? 'Review governed agent work result.',
      tone: 'accent' as const,
      href: object.trade_id ? `/trade/${object.trade_id}` : undefined
    })),
    ...aiEvalResults
      .filter((object) => ['blocked', 'ready_for_review'].includes(object.status) || object.payload_json?.status === 'warn' || object.payload_json?.status === 'fail')
      .slice(0, 3)
      .map((object) => ({
        id: object.object_id,
        title: object.title,
        summary: object.summary ?? 'Review AI evaluation result.',
        tone: object.payload_json?.status === 'fail' ? ('error' as const) : ('warn' as const),
        href: object.trade_id ? `/trade/${object.trade_id}` : undefined
      })),
    ...memory
      .filter((event) => event.signal.includes('blocked') || event.signal.includes('missing'))
      .slice(0, 3)
      .map((event) => ({
        id: event.memory_event_id,
        title: event.signal,
        summary: event.kind,
        tone: 'warn' as const,
        href: event.trade_id ? `/trade/${event.trade_id}` : undefined
      }))
  ];

  const pilotRunway = buildPilotRunway(objects, readiness, memory, events);
  const briefing = buildOperationsBriefing({
    objects,
    readiness,
    memory,
    events,
    pendingApprovals,
    activeTasks,
    pendingDocumentRequests,
    standaloneWorkflowObjects,
    workflowRuns,
    proofs,
    agentResults,
    aiEvalResults,
    riskyReadiness,
    priorityItems,
    pilotRunway
  });

  return {
    approvals,
    pendingApprovals,
    approvalChains,
    proofs,
    agentResults,
    aiEvalResults,
    workflowRuns,
    activeTasks,
    externalAccess,
    documentRequests,
    pendingDocumentRequests,
    executionObjects,
    executionTasks,
    standaloneWorkflowObjects,
    riskyReadiness,
    priorityItems,
    pilotRunway,
    briefing
  };
}

function buildQualityTrends(aiEvalResults: AlphaObject[], evalRuns: TradeBrainEvalRun[], readiness: ReadinessState[], proofs: AlphaObject[]): QualityTrend[] {
  const evalCases = extractEvalCaseResults(aiEvalResults);
  const documentCases = evalCases.filter((item) => item.dataset === 'document_intelligence' || item.kind === 'document_intelligence');
  const missingProofCases = evalCases.filter((item) => item.dataset === 'missing_proof_detection' || item.kind === 'missing_proof_detection');
  const documentPasses = documentCases.filter((item) => item.status === 'pass').length;
  const proofPasses = missingProofCases.filter((item) => item.status === 'pass').length;
  const documentMissingFields = sumQualitySignal(documentCases, 'missing_field_count');
  const proofMissingItems = sumQualitySignal(missingProofCases, 'missing_count');
  const latestRun = evalRuns[0];
  const riskyReadiness = readiness.filter((state) => ['missing', 'risky', 'blocked'].includes(state.overall));
  const averageReadiness = readiness.length ? readiness.reduce((total, state) => total + Number(state.score ?? 0), 0) / readiness.length : 0;

  return [
    {
      label: 'Document Intelligence',
      status: documentCases.length === 0 ? 'active' : documentMissingFields > 0 ? 'watch' : 'clear',
      score: documentCases.length ? (documentPasses / documentCases.length) * 100 : 0,
      summary: documentCases.length
        ? `${documentPasses}/${documentCases.length} document eval cases passed; ${documentMissingFields} missing required field signal(s) remain across the latest eval artifacts.`
        : 'No document-intelligence eval artifact is persisted yet. Run the Trade Brain gate to populate extraction quality signals.',
      metrics: [
        { label: 'Cases', value: documentCases.length },
        { label: 'Missing', value: documentMissingFields }
      ]
    },
    {
      label: 'Missing Proof Detection',
      status: missingProofCases.length === 0 ? 'active' : proofMissingItems > 0 ? 'watch' : 'clear',
      score: missingProofCases.length ? (proofPasses / missingProofCases.length) * 100 : 0,
      summary: missingProofCases.length
        ? `${proofPasses}/${missingProofCases.length} proof-gap eval cases passed; ${proofMissingItems} missing proof signal(s) were intentionally detected and explained.`
        : 'No missing-proof eval artifact is persisted yet. Run the Trade Brain gate to populate proof-gap quality signals.',
      metrics: [
        { label: 'Cases', value: missingProofCases.length },
        { label: 'Gaps', value: proofMissingItems }
      ]
    },
    {
      label: 'Readiness To Proof Loop',
      status: riskyReadiness.length ? 'watch' : proofs.length ? 'clear' : 'active',
      score: readiness.length ? averageReadiness : latestRun ? latestRun.score : 0,
      summary: readiness.length
        ? `${riskyReadiness.length} risky readiness state(s), ${proofs.length} proof bundle(s), and latest Trade Brain gate ${latestRun ? `${Math.round(latestRun.score)}%` : 'not yet persisted'}.`
        : 'Readiness quality will combine live readiness scores, proof bundles, and latest Trade Brain eval evidence.',
      metrics: [
        { label: 'Risky', value: riskyReadiness.length },
        { label: 'Proofs', value: proofs.length }
      ]
    }
  ];
}

type EvalCaseSignal = {
  id: string;
  dataset: string;
  kind: string;
  status: string;
  summary: Record<string, unknown>;
};

function extractEvalCaseResults(aiEvalResults: AlphaObject[]): EvalCaseSignal[] {
  return aiEvalResults.flatMap((object) => {
    const report = asRecord(object.payload_json?.report);
    const results = Array.isArray(report?.results) ? report.results : [];
    const reportCases = results.filter(isRecord).map((result) => ({
      id: String(result.id ?? 'eval_case'),
      dataset: String(result.dataset ?? ''),
      kind: String(result.kind ?? ''),
      status: String(result.status ?? object.payload_json?.status ?? object.status),
      summary: asRecord(result.summary) ?? {}
    }));
    const workflowCase = workflowEvalCaseSignal(object);
    return workflowCase ? [...reportCases, workflowCase] : reportCases;
  });
}

function workflowEvalCaseSignal(object: AlphaObject): EvalCaseSignal | null {
  const payload = object.payload_json;
  const suite = typeof payload?.suite === 'string' ? payload.suite : '';
  const status = typeof payload?.status === 'string' ? payload.status : object.status;
  const qualitySignals = asRecord(payload?.quality_signals) ?? {};
  if (suite === 'document-intelligence-alpha-v1') {
    return {
      id: object.object_id,
      dataset: 'document_intelligence',
      kind: 'document_intelligence',
      status,
      summary: {
        suite,
        score: payload.score,
        source: 'workflow_eval_artifact',
        quality_signals: qualitySignals
      }
    };
  }
  if (suite === 'proof-quality-alpha-v1') {
    return {
      id: object.object_id,
      dataset: 'missing_proof_detection',
      kind: 'missing_proof_detection',
      status,
      summary: {
        suite,
        score: payload.score,
        source: 'workflow_eval_artifact',
        quality_signals: qualitySignals
      }
    };
  }
  return null;
}

function sumQualitySignal(cases: EvalCaseSignal[], key: string): number {
  return cases.reduce((total, item) => {
    const quality = asRecord(item.summary.quality_signals);
    const value = Number(quality?.[key] ?? 0);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

type OperationsBriefing = {
  firstAction: BriefingAction;
  changed: BriefingSignal;
  blocked: BriefingSignal;
  proof: BriefingSignal;
  agent: BriefingSignal;
  workstreams: WorkstreamHealth[];
  recentChanges: BriefingChange[];
};

type BriefingAction = {
  title: string;
  summary: string;
  tone: 'warn' | 'error' | 'accent' | 'success';
  href?: string;
};

type BriefingSignal = {
  label: string;
  value: string;
  summary: string;
  tone: 'warn' | 'error' | 'accent' | 'success' | 'neutral';
};

type WorkstreamHealth = {
  label: string;
  status: 'clear' | 'watch' | 'blocked' | 'active';
  count: number;
  summary: string;
  href?: string;
};

type BriefingChange = {
  id: string;
  title: string;
  summary: string;
  when: string;
  tone: 'warn' | 'error' | 'accent' | 'success' | 'neutral';
  href?: string;
};

function buildOperationsBriefing(input: {
  objects: AlphaObject[];
  readiness: ReadinessState[];
  memory: AlphaMemoryEvent[];
  events: SSEEvent[];
  pendingApprovals: AlphaObject[];
  activeTasks: AlphaObject[];
  pendingDocumentRequests: AlphaObject[];
  standaloneWorkflowObjects: AlphaObject[];
  workflowRuns: AlphaObject[];
  proofs: AlphaObject[];
  agentResults: AlphaObject[];
  aiEvalResults: AlphaObject[];
  riskyReadiness: ReadinessState[];
  priorityItems: Array<{ id: string; title: string; summary: string; tone: 'warn' | 'error' | 'accent'; href?: string }>;
  pilotRunway: PilotRunway;
}): OperationsBriefing {
  const blockedObjects = input.objects.filter((object) => object.status === 'blocked');
  const activeWorkflowRuns = input.workflowRuns.filter((object) => ['approval_required', 'in_progress', 'blocked', 'ready_for_review'].includes(object.status));
  const proofReady = input.proofs.length;
  const recentChanges = buildRecentChanges(input.objects, input.memory, input.events);
  const topPriority = input.priorityItems[0];
  const pilotNext = input.pilotRunway.next;
  const firstAction: BriefingAction = topPriority
    ? {
        title: topPriority.title,
        summary: topPriority.summary,
        tone: topPriority.tone,
        href: topPriority.href
      }
    : pilotNext
      ? {
          title: pilotNext.title,
          summary: pilotNext.summary,
          tone: pilotNext.attention ? 'warn' : pilotNext.complete ? 'success' : 'accent',
          href: pilotNext.href
        }
      : {
          title: 'Run the next Trade Room story',
          summary: 'No urgent item is visible. Run or refresh the alpha story to keep the cockpit populated.',
          tone: 'accent',
          href: '/trades'
        };

  const changed: BriefingSignal = {
    label: 'What changed',
    value: recentChanges.length ? String(recentChanges.length) : '0',
    summary: recentChanges[0]?.summary ?? 'No recent events, memory changes, or object updates are visible yet.',
    tone: recentChanges.length ? 'accent' : 'neutral'
  };
  const blocked: BriefingSignal = {
    label: 'Blocked work',
    value: String(blockedObjects.length + input.riskyReadiness.filter((state) => state.overall === 'blocked').length + input.pendingDocumentRequests.length),
    summary:
      input.pendingDocumentRequests[0]?.summary ??
      input.riskyReadiness[0]?.next_actions[0] ??
      blockedObjects[0]?.summary ??
      'No blocked execution or missing-evidence queue is currently prominent.',
    tone: blockedObjects.length || input.pendingDocumentRequests.length || input.riskyReadiness.some((state) => state.overall === 'blocked') ? 'error' : 'success'
  };
  const proof: BriefingSignal = {
    label: 'Proof ready',
    value: String(proofReady),
    summary: input.proofs[0]?.summary ?? 'No proof bundle is ready yet. Generate proof after readiness and governed execution steps.',
    tone: proofReady ? 'success' : 'neutral'
  };
  const agent: BriefingSignal = {
    label: 'Agents and evals',
    value: String(input.agentResults.length + input.aiEvalResults.length),
    summary:
      input.agentResults[0]?.summary ??
      input.aiEvalResults[0]?.summary ??
      'No governed agent result or AI eval artifact is waiting for review.',
    tone: input.aiEvalResults.some((object) => object.status === 'blocked' || object.payload_json?.status === 'fail') ? 'warn' : input.agentResults.length ? 'accent' : 'neutral'
  };

  const workstreams: WorkstreamHealth[] = [
    {
      label: 'Readiness',
      status: input.riskyReadiness.length ? 'watch' : input.readiness.length ? 'clear' : 'active',
      count: input.riskyReadiness.length || input.readiness.length,
      summary: input.riskyReadiness[0]?.next_actions[0] ?? 'Readiness has no visible blocker.',
      href: input.riskyReadiness[0]?.trade_id ? `/trade/${input.riskyReadiness[0].trade_id}` : undefined
    },
    {
      label: 'Approvals',
      status: input.pendingApprovals.length ? 'blocked' : 'clear',
      count: input.pendingApprovals.length,
      summary: input.pendingApprovals[0] ? currentApprovalStepSummary(input.pendingApprovals[0]) ?? 'Protected action needs decision.' : 'No protected approval is waiting.',
      href: input.pendingApprovals[0]?.trade_id ? `/trade/${input.pendingApprovals[0].trade_id}` : undefined
    },
    {
      label: 'Execution',
      status: input.activeTasks.length ? 'active' : activeWorkflowRuns.length ? 'watch' : 'clear',
      count: input.activeTasks.length + activeWorkflowRuns.length,
      summary: input.activeTasks[0]?.summary ?? activeWorkflowRuns[0]?.summary ?? 'No controlled execution task is active.',
      href: input.activeTasks[0]?.trade_id ? `/trade/${input.activeTasks[0].trade_id}` : activeWorkflowRuns[0]?.trade_id ? `/trade/${activeWorkflowRuns[0].trade_id}` : undefined
    },
    {
      label: 'Standalone Jobs',
      status: input.standaloneWorkflowObjects.length ? 'watch' : 'clear',
      count: input.standaloneWorkflowObjects.length,
      summary: input.standaloneWorkflowObjects[0]?.summary ?? 'No standalone workflow is waiting for attachment.',
      href: '/finance'
    },
    {
      label: 'Documents',
      status: input.pendingDocumentRequests.length ? 'blocked' : 'clear',
      count: input.pendingDocumentRequests.length,
      summary: input.pendingDocumentRequests[0]?.summary ?? 'No document request is waiting for response.',
      href: input.pendingDocumentRequests[0]?.trade_id ? `/trade/${input.pendingDocumentRequests[0].trade_id}` : undefined
    },
    {
      label: 'Proof',
      status: proofReady ? 'clear' : 'active',
      count: proofReady,
      summary: input.proofs[0]?.summary ?? 'Proof bundle is not ready for the current operating set.',
      href: input.proofs[0]?.trade_id ? `/trade/${input.proofs[0].trade_id}` : undefined
    },
    {
      label: 'Intelligence',
      status: input.aiEvalResults.some((object) => object.status === 'blocked' || object.payload_json?.status === 'fail') ? 'watch' : input.agentResults.length ? 'active' : 'clear',
      count: input.agentResults.length + input.aiEvalResults.length,
      summary: input.agentResults[0]?.summary ?? input.aiEvalResults[0]?.summary ?? 'No active agent or eval review queue.',
      href: '/intelligence'
    }
  ];

  return { firstAction, changed, blocked, proof, agent, workstreams, recentChanges };
}

function buildRecentChanges(objects: AlphaObject[], memory: AlphaMemoryEvent[], events: SSEEvent[]): BriefingChange[] {
  const objectChanges = objects.slice(0, 12).map((object) => ({
    id: `object-${object.object_id}`,
    title: object.title,
    summary: `${object.type.replaceAll('_', ' ')} is ${object.status}.`,
    when: object.updated_at,
    tone: toneForStatus(object.status),
    href: object.trade_id ? `/trade/${object.trade_id}` : undefined
  }));
  const memoryChanges = memory.slice(0, 12).map((event) => ({
    id: `memory-${event.memory_event_id}`,
    title: event.signal,
    summary: `${event.level} memory · ${event.kind}`,
    when: event.created_at,
    tone: event.signal.includes('blocked') || event.signal.includes('missing') ? ('warn' as const) : ('accent' as const),
    href: event.trade_id ? `/trade/${event.trade_id}` : undefined
  }));
  const eventChanges = events.slice(0, 12).map((event) => ({
    id: `event-${event.event_id}`,
    title: event.type,
    summary: event.trade_id ? `Live event for trade ${event.trade_id.slice(0, 8)}.` : 'Live organization event.',
    when: event.ts,
    tone: toneForEvent(event.type),
    href: event.trade_id ? `/trade/${event.trade_id}` : undefined
  }));

  return [...eventChanges, ...memoryChanges, ...objectChanges]
    .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
    .slice(0, 8);
}

function toneForStatus(status: string): BriefingChange['tone'] {
  if (status === 'blocked' || status === 'rejected') return 'error';
  if (status === 'approval_required' || status === 'pending_input') return 'warn';
  if (status === 'completed' || status === 'approved' || status === 'attached') return 'success';
  if (status === 'in_progress' || status === 'ready_for_review') return 'accent';
  return 'neutral';
}

function toneForEvent(type: string): BriefingChange['tone'] {
  if (type.includes('blocked') || type.includes('failed')) return 'error';
  if (type.includes('approval') || type.includes('document_request')) return 'warn';
  if (type.includes('proof') || type.includes('ledger')) return 'success';
  if (type.includes('agent') || type.includes('workflow') || type.includes('readiness')) return 'accent';
  return 'neutral';
}

type PilotRunway = {
  completed: number;
  total: number;
  percent: number;
  next?: PilotRunwayItem;
  tradeId?: string;
  items: PilotRunwayItem[];
};

type PilotRunwayItem = {
  key: string;
  title: string;
  summary: string;
  complete: boolean;
  attention?: boolean;
  href?: string;
};

function buildPilotRunway(objects: AlphaObject[], readiness: ReadinessState[], memory: AlphaMemoryEvent[], events: SSEEvent[]): PilotRunway {
  const tradeIds = objects.map((object) => object.trade_id).filter(Boolean) as string[];
  const readinessTradeIds = readiness.map((state) => state.trade_id).filter(Boolean) as string[];
  const eventTradeIds = events.map((event) => event.trade_id).filter(Boolean) as string[];
  const tradeId = mostCommon([...tradeIds, ...readinessTradeIds, ...eventTradeIds]);
  const inScopeObjects = tradeId ? objects.filter((object) => object.trade_id === tradeId || !object.trade_id) : objects;
  const inScopeReadiness = tradeId ? readiness.filter((state) => state.trade_id === tradeId || !state.trade_id) : readiness;
  const inScopeMemory = tradeId ? memory.filter((event) => event.trade_id === tradeId || !event.trade_id) : memory;
  const inScopeEvents = tradeId ? events.filter((event) => event.trade_id === tradeId || !event.trade_id) : events;
  const hasObject = (type: string) => inScopeObjects.some((object) => object.type === type);
  const hasAnyObject = (types: string[]) => inScopeObjects.some((object) => types.includes(object.type));
  const latestReadiness = inScopeReadiness[0];
  const readinessHasGaps = Boolean(latestReadiness && (latestReadiness.missing_items.length || latestReadiness.risk_findings.length || ['missing', 'risky', 'blocked'].includes(latestReadiness.overall)));
  const approval = inScopeObjects.find((object) => object.type === 'approval');
  const pendingApproval = approval?.status === 'approval_required';
  const attached = inScopeObjects.some((object) => object.status === 'attached' || Boolean(object.payload_json?.attached_to));
  const operationsSignal = inScopeEvents.some((event) => event.type === 'operations.digest.ready') || inScopeMemory.some((event) => event.kind.includes('proof') || event.signal.includes('proof'));
  const verified =
    inScopeEvents.some((event) => event.type === 'ledger.bundle.verified') ||
    inScopeMemory.some((event) => event.kind === 'ledger.bundle.verified' || event.signal === 'proof.ledger_verified');
  const exported =
    events.some((event) => event.type === 'ledger.export.ready') ||
    memory.some((event) => event.kind === 'ledger.export.ready' || event.signal === 'proof.audit_export_ready');
  const tradeHref = tradeId ? `/trade/${tradeId}` : undefined;

  const items: PilotRunwayItem[] = [
    {
      key: 'messy_input',
      title: 'Messy input became trade context',
      summary: hasObject('trade_room') ? 'Trade Room context exists.' : 'Run the full reference story from Trades.',
      complete: hasObject('trade_room'),
      href: tradeHref ?? '/trades'
    },
    {
      key: 'document_upload',
      title: 'Document uploaded',
      summary: hasObject('document') ? 'Evidence entered the workflow.' : 'Upload or extract a reference document in the Trade Room.',
      complete: hasObject('document'),
      href: tradeHref
    },
    {
      key: 'data_extraction',
      title: 'Data extraction produced structure',
      summary: hasObject('extraction_result') ? 'Extraction result is available for readiness and proof.' : 'Run document extraction.',
      complete: hasObject('extraction_result'),
      href: tradeHref
    },
    {
      key: 'gap_risk_detection',
      title: 'Gap or risk detected',
      summary: readinessHasGaps ? 'Missing proof or risk is visible.' : 'Run readiness to surface gaps and risks.',
      complete: readinessHasGaps,
      attention: readinessHasGaps,
      href: tradeHref
    },
    {
      key: 'readiness_state',
      title: 'Readiness state exists',
      summary: latestReadiness ? `${latestReadiness.overall} at ${Math.round(latestReadiness.score)}%.` : 'No readiness state yet.',
      complete: Boolean(latestReadiness),
      attention: Boolean(latestReadiness && ['missing', 'risky', 'blocked'].includes(latestReadiness.overall)),
      href: tradeHref
    },
    {
      key: 'clearance_or_counterparty',
      title: 'Clearance or counterparty check',
      summary: hasAnyObject(['clearance_check', 'screening_result', 'counterparty']) ? 'Trust or clearance context is available.' : 'Add clearance or counterparty context.',
      complete: hasAnyObject(['clearance_check', 'screening_result', 'counterparty']),
      href: tradeHref
    },
    {
      key: 'execution_object',
      title: 'Execution object prepared',
      summary: hasAnyObject(['payment_intent', 'funding_request']) ? 'Payment or funding workflow exists.' : 'Prepare payment intent or funding request.',
      complete: hasAnyObject(['payment_intent', 'funding_request']),
      href: tradeHref
    },
    {
      key: 'human_approval',
      title: 'Human approval captured',
      summary: approval ? (pendingApproval ? 'Approval is waiting for human decision.' : `Approval is ${approval.status}.`) : 'Protected action has not requested approval yet.',
      complete: Boolean(approval),
      attention: pendingApproval,
      href: tradeHref
    },
    {
      key: 'proof_bundle',
      title: 'Proof bundle generated',
      summary: hasObject('proof_bundle') ? 'Alpha proof bundle exists.' : 'Generate proof from trade artifacts.',
      complete: hasObject('proof_bundle'),
      href: tradeHref
    },
    {
      key: 'operations_update',
      title: 'Operations Center updated',
      summary: operationsSignal ? 'Operations and memory received proof/readiness signals.' : 'Run the reference story or refresh after proof generation.',
      complete: operationsSignal,
      href: '/operations'
    },
    {
      key: 'attachment_integrity',
      title: 'Standalone object attached',
      summary: attached ? 'Attachment preserved trade context.' : 'Attach a standalone job to the Trade Room.',
      complete: attached,
      href: tradeHref
    },
    {
      key: 'proof_verification',
      title: 'Proof ZIP verified and exportable',
      summary: verified ? (exported ? 'Stored ZIP verified and audit export is ready.' : 'Stored ZIP verified; export archive when needed.') : 'Use the Proof Trust Inspector to verify the ledger ZIP.',
      complete: verified,
      href: tradeHref
    }
  ];

  const completed = items.filter((item) => item.complete).length;
  return {
    completed,
    total: items.length,
    percent: Math.round((completed / items.length) * 100),
    next: items.find((item) => !item.complete || item.attention),
    tradeId,
    items
  };
}

function mostCommon(values: string[]) {
  if (!values.length) return undefined;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

function OperationsBriefingCard({ briefing }: { briefing: OperationsBriefing }) {
  return (
    <Surface className="overflow-hidden border-warn/20 bg-[radial-gradient(circle_at_top_left,rgba(196,118,44,0.16),transparent_34%),rgb(var(--surface-1))] p-5">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
            <ListChecks className="h-3.5 w-3.5 text-warn" />
            Daily operating brief
          </div>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">What should we do first today?</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Generated from structured readiness, approvals, workflow runs, standalone jobs, proof, agent results, live events, and Trade Memory.
          </p>
          <div className="mt-4 rounded-3xl border border-border/10 bg-paper/70 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted">First action</div>
                <div className="mt-1 text-lg font-semibold">{briefing.firstAction.title}</div>
                <p className="mt-1 text-sm leading-6 text-muted">{briefing.firstAction.summary}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {briefing.firstAction.href ? (
                  <Link className={buttonClassName({ variant: 'primary', size: 'sm' })} href={briefing.firstAction.href}>
                    Go there
                  </Link>
                ) : null}
                <span className={cn('inline-flex items-center rounded-full px-3 py-2 text-xs', toneClass(briefing.firstAction.tone))}>
                  {briefing.firstAction.tone}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <BriefingSignalCard signal={briefing.changed} icon={<Clock3 className="h-4 w-4" />} />
          <BriefingSignalCard signal={briefing.blocked} icon={<AlertTriangle className="h-4 w-4" />} />
          <BriefingSignalCard signal={briefing.proof} icon={<FileArchive className="h-4 w-4" />} />
          <BriefingSignalCard signal={briefing.agent} icon={<Bot className="h-4 w-4" />} />
        </div>
      </div>
    </Surface>
  );
}

function BriefingSignalCard({ signal, icon }: { signal: BriefingSignal; icon: ReactNode }) {
  return (
    <div className="rounded-3xl border border-border/10 bg-paper/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-muted">{icon}</div>
        <span className={cn('rounded-full px-2 py-1 text-[10px]', toneClass(signal.tone))}>{signal.tone}</span>
      </div>
      <div className="mt-4 text-xs uppercase tracking-[0.18em] text-muted">{signal.label}</div>
      <div className="mt-1 text-2xl font-semibold">{signal.value}</div>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">{signal.summary}</p>
    </div>
  );
}

function WorkstreamHealthCard({ workstreams }: { workstreams: WorkstreamHealth[] }) {
  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Workstream Health</h2>
          <p className="mt-1 text-xs text-muted">Readiness, execution, standalone workflows, proof, documents, and intelligence in one operating map.</p>
        </div>
        <Activity className="h-5 w-5 text-muted" />
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {workstreams.map((stream) => {
          const content = (
            <div
              className={cn(
                'h-full rounded-2xl border px-3 py-3 transition hover:bg-surface2',
                stream.status === 'blocked'
                  ? 'border-error/20 bg-error/10'
                  : stream.status === 'watch'
                    ? 'border-warn/20 bg-warn/10'
                    : stream.status === 'active'
                      ? 'border-accent/20 bg-accent/10'
                      : 'border-success/20 bg-success/10'
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{stream.label}</div>
                <span className="rounded-full bg-paper/80 px-2 py-1 text-[10px] text-muted">{stream.status}</span>
              </div>
              <div className="mt-2 text-2xl font-semibold">{stream.count}</div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{stream.summary}</p>
            </div>
          );
          return stream.href ? (
            <Link key={stream.label} href={stream.href}>
              {content}
            </Link>
          ) : (
            <div key={stream.label}>{content}</div>
          );
        })}
      </div>
    </Surface>
  );
}

function RecentChangeDigestCard({ changes }: { changes: BriefingChange[] }) {
  return (
    <Surface className="p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">What Changed Recently</h2>
          <p className="mt-1 text-xs text-muted">A compact digest from live events, Trade Memory, and updated alpha objects.</p>
        </div>
        <Clock3 className="h-5 w-5 text-muted" />
      </div>
      <div className="mt-4 space-y-2">
        {changes.length ? (
          changes.map((change) => {
            const content = (
              <div className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-3 transition hover:bg-surface2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{change.title}</div>
                    <p className="mt-1 text-xs leading-5 text-muted">{change.summary}</p>
                  </div>
                  <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px]', toneClass(change.tone))}>{change.tone}</span>
                </div>
                <div className="mt-2 text-[10px] text-muted">{formatShortDate(change.when)}</div>
              </div>
            );
            return change.href ? (
              <Link key={change.id} href={change.href}>
                {content}
              </Link>
            ) : (
              <div key={change.id}>{content}</div>
            );
          })
        ) : (
          <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">No recent structured changes yet.</p>
        )}
      </div>
    </Surface>
  );
}

function toneClass(tone: 'warn' | 'error' | 'accent' | 'success' | 'neutral') {
  if (tone === 'warn') return 'bg-warn/10 text-warn';
  if (tone === 'error') return 'bg-error/10 text-error';
  if (tone === 'accent') return 'bg-accent/10 text-accent';
  if (tone === 'success') return 'bg-success/10 text-success';
  return 'bg-surface2 text-muted';
}

function ExecutionColumn({
  tasks,
  relatedObjects,
  loadingId,
  onUpdate
}: {
  tasks: AlphaObject[];
  relatedObjects: AlphaObject[];
  loadingId: string | null;
  onUpdate: (taskId: string, body: ExecutionTaskStatusRequest) => void;
}) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Controlled Execution</h2>
      <p className="mt-1 text-xs text-muted">Approved actions become operator-controlled tasks; TRAIBOX does not execute protected external actions automatically.</p>
      <div className="mt-4 space-y-3">
        {tasks.length ? (
          tasks.slice(0, 4).map((task) => (
            <ControlledExecutionTaskCard
              key={task.object_id}
              task={task}
              compact
              loading={loadingId === task.object_id}
              onUpdate={onUpdate}
            />
          ))
        ) : relatedObjects.length ? (
          relatedObjects.slice(0, 6).map((object) => <CompactObjectRow key={object.object_id} object={object} />)
        ) : (
          <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">No governed execution objects yet.</p>
        )}
      </div>
    </Surface>
  );
}

function PilotRunwayCard({ runway }: { runway: PilotRunway }) {
  const next = runway.next;
  return (
    <Surface className="overflow-hidden border-accent/20 bg-[radial-gradient(circle_at_top_left,rgba(17,116,102,0.12),transparent_34%),rgb(var(--surface-1))] p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
            <Play className="h-3.5 w-3.5 text-accent" />
            Pilot demo runway
          </div>
          <h2 className="mt-3 text-xl font-semibold">Can the alpha tell the full story?</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            This checks the exact demo promise: fragmented input becomes structured readiness, governed execution, trusted proof, Operations visibility, and attachable workflow memory.
          </p>
        </div>
        <div className="min-w-[220px] rounded-2xl border border-border/10 bg-paper/70 p-4">
          <div className="text-xs uppercase tracking-[0.18em] text-muted">Completion</div>
          <div className="mt-2 text-3xl font-semibold">{runway.percent}%</div>
          <div className="mt-1 text-xs text-muted">
            {runway.completed} of {runway.total} proof points
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/10">
            <div className="h-full rounded-full bg-accent" style={{ width: `${runway.percent}%` }} />
          </div>
        </div>
      </div>

      {next ? (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border/10 bg-paper/70 p-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-medium">Next best demo action: {next.title}</div>
            <p className="mt-1 text-xs leading-5 text-muted">{next.summary}</p>
          </div>
          <Link className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={next.href ?? '/trades'}>
            Go there
          </Link>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {runway.items.map((item) => (
          <Link
            key={item.key}
            href={item.href ?? '#'}
            className={cn(
              'rounded-2xl border px-3 py-3 transition hover:bg-surface2',
              item.complete ? 'border-success/20 bg-success/10' : item.attention ? 'border-warn/20 bg-warn/10' : 'border-border/10 bg-paper/60'
            )}
          >
            <div className="flex items-start gap-2">
              {item.complete ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /> : <Circle className={cn('mt-0.5 h-4 w-4', item.attention ? 'text-warn' : 'text-muted')} />}
              <div>
                <div className="text-sm font-medium">{item.title}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{item.summary}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </Surface>
  );
}

function ApprovalColumn({
  approvals,
  loadingId,
  onDecide
}: {
  approvals: AlphaObject[];
  loadingId: string | null;
  onDecide: (approval: AlphaObject, decision: 'approved' | 'rejected', input: ProtectedActionDecisionInput) => void;
}) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Protected Approvals</h2>
      <p className="mt-1 text-xs text-muted">Human control gates for externally consequential actions.</p>
      <div className="mt-4 space-y-3">
        {approvals.length ? (
          approvals.slice(0, 4).map((approval) =>
            approval.status === 'approval_required' ? (
              <ProtectedActionApprovalCard
                key={approval.object_id}
                approval={approval}
                compact
                loading={loadingId === approval.object_id}
                onDecide={(decision, input) => onDecide(approval, decision, input)}
              />
            ) : (
              <div key={approval.object_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{approval.title}</div>
                    <div className="mt-1 text-xs text-muted">{String(approval.payload_json?.protected_action ?? 'protected action').replaceAll('_', ' ')}</div>
                  </div>
                  <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{approval.status}</span>
                </div>
                {approval.trade_id ? (
                  <Link className="mt-2 inline-flex text-xs font-medium text-accent" href={`/trade/${approval.trade_id}`}>
                    Open Trade Room
                  </Link>
                ) : null}
              </div>
            )
          )
        ) : (
          <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">No approvals yet.</p>
        )}
      </div>
    </Surface>
  );
}

function ApprovalChainColumn({ approvals }: { approvals: AlphaObject[] }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Approval Chains</h2>
      <p className="mt-1 text-xs text-muted">Staged human-control gates with role, current step, decision history, and release status.</p>
      <div className="mt-4 space-y-3">
        {approvals.length ? (
          approvals.slice(0, 5).map((approval) => {
            const chain = getApprovalChain(approval);
            const currentStepKey = typeof approval.payload_json?.current_approval_step === 'string' ? approval.payload_json.current_approval_step : null;
            return (
              <div key={approval.object_id} className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{approval.title}</div>
                    <div className="mt-1 text-xs text-muted">
                      {String(approval.payload_json?.protected_action ?? 'protected action').replaceAll('_', ' ')}
                    </div>
                  </div>
                  <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{approval.status}</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {chain.map((step, index) => (
                    <div
                      key={step.key}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-xl border px-2.5 py-2 text-xs',
                        step.key === currentStepKey ? 'border-warn/25 bg-warn/10' : 'border-border/10 bg-paper/70'
                      )}
                    >
                      <div>
                        <span className="font-medium">
                          {index + 1}. {step.label}
                        </span>
                        <span className="text-muted"> · {step.required_role}</span>
                      </div>
                      <span className="rounded-full bg-surface2 px-2 py-1 text-[10px] text-muted">{step.status}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  {approval.payload_json?.protected_action_released
                    ? 'Protected action released into controlled execution.'
                    : currentApprovalStepSummary(approval) ?? 'Waiting for the next governed approval step.'}
                </p>
              </div>
            );
          })
        ) : (
          <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">No approval chains yet.</p>
        )}
      </div>
    </Surface>
  );
}

function CockpitMetric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: 'warn' | 'error' | 'accent' | 'success' }) {
  return (
    <Surface className="p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-muted">{icon}</div>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-[10px]',
            tone === 'warn' && 'bg-warn/10 text-warn',
            tone === 'error' && 'bg-error/10 text-error',
            tone === 'accent' && 'bg-accent/10 text-accent',
            tone === 'success' && 'bg-success/10 text-success'
          )}
        >
          live
        </span>
      </div>
      <div className="mt-4 text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.18em] text-muted">{label}</div>
    </Surface>
  );
}

function PriorityRow({ item }: { item: { title: string; summary: string; tone: 'warn' | 'error' | 'accent'; href?: string } }) {
  const content = (
    <div className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-3 transition hover:bg-surface2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{item.title}</div>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-[10px]',
            item.tone === 'error' ? 'bg-error/10 text-error' : item.tone === 'accent' ? 'bg-accent/10 text-accent' : 'bg-warn/10 text-warn'
          )}
        >
          {item.tone}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted">{item.summary}</p>
    </div>
  );
  return item.href ? <Link href={item.href}>{content}</Link> : content;
}

function AiQualityGateCard({
  runs,
  evals,
  loading,
  onRun
}: {
  runs: TradeBrainEvalRun[];
  evals: AlphaObject[];
  loading: boolean;
  onRun: () => void;
}) {
  const latest = runs[0] ?? null;
  const latestArtifact = evals.find((object) => object.object_id === latest?.eval_object_id) ?? evals.find((object) => object.payload_json?.artifact_kind === 'trade_brain_eval_report');
  return (
    <Surface className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Trade Brain Quality Gate</h2>
          <p className="mt-1 text-xs text-muted">CI and Operations share the same eval artifact trail: suite result, score, memory, audit, and replay evidence.</p>
        </div>
        <span
          className={cn(
            'rounded-full px-2 py-1 text-[10px]',
            latest?.status === 'pass' ? 'bg-success/10 text-success' : latest?.status === 'fail' ? 'bg-error/10 text-error' : 'bg-warn/10 text-warn'
          )}
        >
          {latest?.status ?? 'no run'}
        </span>
      </div>

      <div className="mt-4 rounded-2xl border border-border/10 bg-surface2/50 p-3">
        {latest ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">{latest.suite_id}</div>
              <div className="text-xs text-muted">{formatShortDate(latest.created_at)}</div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <QualityMetric label="Score" value={`${Math.round(latest.score)}%`} />
              <QualityMetric label="Passed" value={`${latest.passed}/${latest.case_count}`} />
              <QualityMetric label="Failed" value={latest.failed} />
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">
              {latestArtifact?.payload_json?.final_outcome
                ? String(latestArtifact.payload_json.final_outcome)
                : 'Latest persisted eval run is available as a queryable product artifact.'}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">No persisted Trade Brain eval run yet. CI will create report artifacts; Operators can run the same gate when the Trade Brain service is available.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={loading} onClick={onRun}>
          <BrainCircuit className={cn('h-4 w-4', loading ? 'animate-pulse' : '')} />
          Run eval gate
        </Button>
        {latest?.eval_object_id ? <span className="text-xs text-muted">Artifact {latest.eval_object_id.slice(0, 8)}</span> : null}
      </div>

      {runs.length > 1 ? (
        <div className="mt-3 space-y-1">
          {runs.slice(1, 4).map((run) => (
            <div key={run.run_id} className="flex items-center justify-between rounded-xl bg-paper px-2 py-1.5 text-xs text-muted">
              <span>{run.suite_id}</span>
              <span>
                {run.status} · {Math.round(run.score)}%
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}

function QualityMetric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl bg-paper px-2 py-2">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

type QualityTrend = {
  label: string;
  status: 'clear' | 'watch' | 'blocked' | 'active';
  score: number;
  summary: string;
  metrics: Array<{ label: string; value: string | number }>;
};

function QualityTrendsCard({ trends }: { trends: QualityTrend[] }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Readiness And Proof Quality</h2>
      <p className="mt-1 text-xs text-muted">Document intelligence and missing-proof evals are translated into operating trends for readiness and trusted proof.</p>
      <div className="mt-4 space-y-3">
        {trends.map((trend) => (
          <div key={trend.label} className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-medium">{trend.label}</div>
                <p className="mt-1 text-xs leading-5 text-muted">{trend.summary}</p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2 py-1 text-[10px]',
                  trend.status === 'blocked'
                    ? 'bg-error/10 text-error'
                    : trend.status === 'watch'
                      ? 'bg-warn/10 text-warn'
                      : trend.status === 'clear'
                        ? 'bg-success/10 text-success'
                        : 'bg-accent/10 text-accent'
                )}
              >
                {trend.status}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <QualityMetric label="Quality" value={`${Math.round(trend.score)}%`} />
              {trend.metrics.slice(0, 2).map((metric) => (
                <QualityMetric key={metric.label} label={metric.label} value={metric.value} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Surface>
  );
}

function AiEvalColumn({ evals }: { evals: AlphaObject[] }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">AI Eval And Replay</h2>
      <p className="mt-1 text-xs text-muted">Model outputs become queryable eval artifacts with safety, usefulness, and replay checks.</p>
      <div className="mt-4 space-y-2">
        {evals.length ? (
          evals.slice(0, 6).map((object) => {
            const checks = Array.isArray(object.payload_json?.checks) ? object.payload_json.checks : [];
            return (
              <div key={object.object_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{object.title}</div>
                    <div className="mt-1 text-xs text-muted">
                      {String(object.payload_json?.suite ?? 'eval suite')} · {Math.round(Number(object.payload_json?.score ?? 0))}%
                    </div>
                  </div>
                  <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{String(object.payload_json?.status ?? object.status)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {checks.slice(0, 4).map((check, index) => (
                    <span key={index} className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">
                      {String(check.case ?? 'check').replaceAll('_', ' ')} · {String(check.status ?? 'pending')}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">No AI eval artifacts yet. Run Copilot or launch a governed agent.</p>
        )}
      </div>
    </Surface>
  );
}

function ObjectColumn({ title, objects, empty }: { title: string; objects: AlphaObject[]; empty: string }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-4 space-y-2">
        {objects.length ? (
          objects.slice(0, 8).map((object) => (
            object.type === 'workflow_run' ? <WorkflowRunObjectRow key={object.object_id} object={object} /> : <CompactObjectRow key={object.object_id} object={object} />
          ))
        ) : (
          <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">{empty}</p>
        )}
      </div>
    </Surface>
  );
}

function WorkflowRunObjectRow({ object }: { object: AlphaObject }) {
  const workflowState = object.payload_json?.workflow_state && typeof object.payload_json.workflow_state === 'object' ? (object.payload_json.workflow_state as Record<string, unknown>) : {};
  const workflowWorker = object.payload_json?.workflow_worker && typeof object.payload_json.workflow_worker === 'object' ? (object.payload_json.workflow_worker as Record<string, unknown>) : {};
  const phase = String(workflowState.monitor_phase ?? workflowState.stage ?? object.status);
  const attentionRequired = object.status === 'blocked' || workflowWorker.last_attention_required === true || workflowWorker.stale === true;
  const summary = typeof workflowWorker.summary === 'string' ? workflowWorker.summary : object.summary;
  const recoveryHint = typeof workflowWorker.recovery_hint === 'string' ? workflowWorker.recovery_hint : null;
  const lastChecked = typeof workflowWorker.last_checked_at === 'string' ? workflowWorker.last_checked_at : null;

  return (
    <div className={cn('rounded-xl border px-3 py-2', attentionRequired ? 'border-warn/25 bg-warn/10' : 'border-border/10 bg-surface2/50')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{object.title}</div>
          <div className="mt-1 text-xs text-muted">
            {String(object.payload_json?.workflow_kind ?? 'workflow')} · {phase}
          </div>
        </div>
        <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{object.status}</span>
      </div>
      {summary ? <p className="mt-2 text-xs leading-5 text-muted">{summary}</p> : null}
      {attentionRequired && recoveryHint ? <p className="mt-1 text-xs leading-5 text-warn">{recoveryHint}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <WorkflowPill label={String(workflowState.temporal_workflow_type ?? 'Temporal-ready')} />
        <WorkflowPill label={String(workflowState.runtime_adapter ?? 'api workflow-run')} />
        {lastChecked ? <WorkflowPill label={`checked ${formatShortDate(lastChecked)}`} /> : null}
        {workflowWorker.stale === true ? <WorkflowPill label="recovery attention" /> : null}
      </div>
      {object.trade_id ? (
        <Link className="mt-2 inline-flex text-xs font-medium text-accent" href={`/trade/${object.trade_id}`}>
          Open Trade Room
        </Link>
      ) : null}
    </div>
  );
}

function WorkflowPill({ label }: { label: string }) {
  return <span className="rounded-full border border-border/10 bg-paper px-2 py-1 text-[10px] text-muted">{label}</span>;
}

function CompactObjectRow({ object }: { object: AlphaObject }) {
  return (
    <div className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{object.title}</div>
          <div className="mt-1 text-xs text-muted">{object.type.replaceAll('_', ' ')}</div>
        </div>
        <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{object.status}</span>
      </div>
      {object.trade_id ? (
        <Link className="mt-2 inline-flex text-xs font-medium text-accent" href={`/trade/${object.trade_id}`}>
          Open Trade Room
        </Link>
      ) : null}
    </div>
  );
}

function MemoryColumn({ memory }: { memory: AlphaMemoryEvent[] }) {
  return (
    <Surface className="p-5">
      <h2 className="font-semibold">Trade Memory</h2>
      <div className="mt-4 space-y-2">
        {memory.length ? (
          memory.slice(0, 8).map((event) => (
            <div key={event.memory_event_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{event.signal}</div>
                <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{event.level}</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {event.kind} · {formatShortDate(event.created_at)}
              </div>
            </div>
          ))
        ) : (
          <p className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-4 text-sm text-muted">No memory events yet.</p>
        )}
      </div>
    </Surface>
  );
}

type ApprovalChainStepView = {
  key: string;
  label: string;
  required_role: string;
  status: string;
};

function getApprovalChain(approval: AlphaObject): ApprovalChainStepView[] {
  const value = approval.payload_json?.approval_chain;
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((step, index) => ({
      key: typeof step.key === 'string' && step.key ? step.key : `approval_step_${index + 1}`,
      label: typeof step.label === 'string' && step.label ? step.label : `Approval step ${index + 1}`,
      required_role: typeof step.required_role === 'string' && step.required_role ? step.required_role : 'ops',
      status: typeof step.status === 'string' && step.status ? step.status : 'pending_input'
    }));
}

function currentApprovalStepSummary(approval: AlphaObject) {
  const chain = getApprovalChain(approval);
  if (!chain.length) return null;
  const currentStepKey = typeof approval.payload_json?.current_approval_step === 'string' ? approval.payload_json.current_approval_step : null;
  const currentStep = chain.find((step) => step.key === currentStepKey) ?? chain.find((step) => step.status === 'approval_required');
  if (!currentStep) return 'Approval chain has no pending gate.';
  return `Current gate: ${currentStep.label} (${currentStep.required_role})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function formatShortDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
