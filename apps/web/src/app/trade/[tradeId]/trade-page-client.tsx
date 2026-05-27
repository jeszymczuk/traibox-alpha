'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Building2,
  CheckCircle2,
  Clock3,
  Circle,
  ClipboardCheck,
  FileArchive,
  FileDown,
  FileText,
  GitMerge,
  HandCoins,
  Layers3,
  LockKeyhole,
  PackageCheck,
  Receipt,
  Route,
  ShieldCheck,
  Sparkles,
  UsersRound,
  WalletCards
} from 'lucide-react';
import type {
  AlphaMemoryEvent,
  AlphaObject,
  ExecutionTaskStatusRequest,
  LedgerExportResponse,
  LedgerProofsResponse,
  LedgerVerifyStoredResponse,
  ReadinessState,
  ReplayStep,
  TradeWorkspaceResponse
} from '@traibox/contracts';

import { AppShell } from '../../../components/shell';
import { useOrgSelection } from '../../../components/use-org';
import { api } from '../../../lib/api';
import { Surface } from '../../../components/ui/surface';
import { Button, buttonClassName } from '../../../components/ui/button';
import { cn } from '../../../lib/cn';
import { TradeCard } from '../../../components/trade-card';
import { ChatPane } from '../../../components/chat-pane';
import { WorkspaceGrid } from '../../../components/workspace-grid';
import { useTradeWorkflow } from '../../../features/trade/use-trade-workflow';
import { ProtectedActionApprovalCard, type ProtectedActionDecisionInput } from '../../../components/protected-action-approval';
import { ControlledExecutionTaskCard } from '../../../components/controlled-execution-task';

export function TradePageClient({ tradeId }: { tradeId: string }) {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();

  const wf = useTradeWorkflow({ mode: 'live', enabled: auth.status === 'authenticated' && Boolean(orgId), orgId, tradeId });
  const [alphaObjects, setAlphaObjects] = useState<AlphaObject[]>([]);
  const [standaloneCandidates, setStandaloneCandidates] = useState<AlphaObject[]>([]);
  const [alphaReadiness, setAlphaReadiness] = useState<ReadinessState[]>([]);
  const [alphaMemory, setAlphaMemory] = useState<AlphaMemoryEvent[]>([]);
  const [alphaReplaySteps, setAlphaReplaySteps] = useState<ReplayStep[]>([]);
  const [alphaReplayHash, setAlphaReplayHash] = useState<string | null>(null);
  const [alphaReplayGaps, setAlphaReplayGaps] = useState<string[]>([]);
  const [alphaComposer, setAlphaComposer] = useState(
    'Review this Trade Room, summarize what is ready or missing, and prepare the next governed execution step.'
  );
  const [alphaAnswer, setAlphaAnswer] = useState<string | null>(null);
  const [alphaLoading, setAlphaLoading] = useState<
    'refresh' | 'ai' | 'document' | 'upload' | 'doc_pack' | 'payment' | 'attach_candidate' | 'proof' | 'approval' | 'decision' | 'agent' | 'task' | 'access' | 'doc_request' | 'doc_submit' | null
  >(null);
  const [alphaError, setAlphaError] = useState<string | null>(null);
  const [ledgerProof, setLedgerProof] = useState<LedgerProofsResponse | null>(null);
  const [proofVerification, setProofVerification] = useState<LedgerVerifyStoredResponse | null>(null);
  const [proofExport, setProofExport] = useState<LedgerExportResponse | null>(null);
  const [proofLoading, setProofLoading] = useState<'ledger' | 'verify' | 'export' | 'share' | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);

  const chatMessages = useMemo(() => {
    if (wf.messages.length > 0) return wf.messages;
    return [{ role: 'assistant', text: 'Describe the trade and TRAIBOX will guide the next steps.' }];
  }, [wf.messages]);

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    let cancelled = false;
    async function loadAlphaContext() {
      try {
        const [result, replay, standalone] = await Promise.all([
          api.queryAlphaObjects(orgId!, { trade_id: tradeId, limit: 80 }),
          api.queryAlphaReplay(orgId!, { trade_id: tradeId, limit: 120 }),
          api.queryAlphaObjects(orgId!, { trade_id: null, limit: 80 })
        ]);
        if (cancelled) return;
        setAlphaObjects(result.objects ?? []);
        setStandaloneCandidates((standalone.objects ?? []).filter(isComposableCandidate));
        setAlphaReadiness(result.readiness_states ?? []);
        setAlphaMemory(result.memory_events ?? []);
        setAlphaReplaySteps(replay.steps ?? []);
        setAlphaReplayHash(replay.deterministic_hash ?? null);
        setAlphaReplayGaps(replay.gaps ?? []);
      } catch {
        if (!cancelled) {
          setAlphaObjects([]);
          setStandaloneCandidates([]);
          setAlphaReadiness([]);
          setAlphaMemory([]);
          setAlphaReplaySteps([]);
          setAlphaReplayHash(null);
          setAlphaReplayGaps([]);
        }
      }
    }
    void loadAlphaContext();
    return () => {
      cancelled = true;
    };
  }, [auth.status, orgId, tradeId, wf.events.length]);

  async function refreshAlphaContext(nextLoading: typeof alphaLoading = 'refresh') {
    if (!orgId) return;
    setAlphaLoading(nextLoading);
    setAlphaError(null);
    try {
      const [result, replay, standalone] = await Promise.all([
        api.queryAlphaObjects(orgId, { trade_id: tradeId, limit: 80 }),
        api.queryAlphaReplay(orgId, { trade_id: tradeId, limit: 120 }),
        api.queryAlphaObjects(orgId, { trade_id: null, limit: 80 })
      ]);
      setAlphaObjects(result.objects ?? []);
      setStandaloneCandidates((standalone.objects ?? []).filter(isComposableCandidate));
      setAlphaReadiness(result.readiness_states ?? []);
      setAlphaMemory(result.memory_events ?? []);
      setAlphaReplaySteps(replay.steps ?? []);
      setAlphaReplayHash(replay.deterministic_hash ?? null);
      setAlphaReplayGaps(replay.gaps ?? []);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Unable to refresh Trade Memory');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function runAlphaCopilot() {
    if (!orgId) return;
    setAlphaLoading('ai');
    setAlphaError(null);
    try {
      const result = await api.runAlphaIntelligence(orgId, {
        message: alphaComposer,
        workspace: 'trades',
        trade_id: tradeId,
        object_ids: alphaObjects.slice(0, 8).map((object) => object.object_id)
      });
      setAlphaAnswer(result.answer ?? 'Structured Trade Brain output created.');
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Trade Brain request failed');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function ensureAlphaTradeRoomObject() {
    if (!orgId) return null;
    const existing = alphaObjects.find((object) => object.type === 'trade_room' && object.trade_id === tradeId);
    if (existing) return existing;
    const created = await api.createAlphaObject(orgId, 'trade_room', {
      title: `Trade Room: ${wf.snapshot?.trade?.title ?? tradeId.slice(0, 8)}`,
      summary: 'Canonical Trade Room context created from the guided reference UX.',
      status: 'in_progress',
      origin_workspace: 'trades',
      trade_id: tradeId,
      payload: {
        source: 'trade_room_reference_ux',
        usage_mode: 'full_trade_cycle',
        corridor: wf.snapshot?.trade?.corridor ?? null,
        amount: wf.snapshot?.trade?.amount ?? null,
        currency: wf.snapshot?.trade?.currency ?? null
      }
    });
    return created.object;
  }

  async function extractReferenceDocumentAndReadiness() {
    if (!orgId) return;
    setAlphaLoading('document');
    setAlphaError(null);
    try {
      await ensureAlphaTradeRoomObject();
      const extraction = await api.extractAlphaDocument(orgId, {
        filename: 'trade-room-reference-po.txt',
        mime_type: 'text/plain',
        text:
          'Purchase Order PO-8812. Seller: Lusitania Automation Lda. Buyer: Iberica Components SL. Amount EUR 48000. Delivery Spain. Payment 40% advance and 60% after acceptance. Missing buyer VAT and signed acceptance proof.',
        trade_id: tradeId,
        origin_workspace: 'trades'
      });

      if (!alphaObjects.some((object) => object.type === 'clearance_check')) {
        await api.createAlphaObject(orgId, 'clearance_check', {
          title: 'PT-ES clearance evidence check',
          summary: 'Reference clearance check created from extracted purchase-order context.',
          status: extraction.missing_fields.length ? 'pending_input' : 'ready_for_review',
          origin_workspace: 'clearance',
          trade_id: tradeId,
          payload: {
            corridor: wf.snapshot?.trade?.corridor ?? 'PT-ES',
            ruleset: 'EU-alpha',
            missing: extraction.missing_fields,
            source: 'trade_room_reference_ux'
          },
          evidence_refs: [{ object_id: extraction.extraction_result.object_id, role: 'extraction_result' }]
        });
      }

      const readiness = await api.evaluateAlphaReadiness(orgId, {
        trade_id: tradeId,
        context: { source: 'trade_room_reference_ux', missing_fields: extraction.missing_fields }
      });
      setAlphaAnswer(`Reference document extracted. Readiness is ${readiness.readiness.overall} at ${Math.round(readiness.readiness.score)}%.`);
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not extract reference document');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function uploadStoredDocument(file: File) {
    if (!orgId) return;
    setAlphaLoading('upload');
    setAlphaError(null);
    try {
      const uploaded = await api.uploadAlphaDocument(orgId, {
        file,
        trade_id: tradeId,
        origin_workspace: 'trades',
        extract: true
      });
      if (uploaded.extraction_result) {
        const readiness = await api.evaluateAlphaReadiness(orgId, {
          trade_id: tradeId,
          context: { source: 'stored_document_upload', document_id: uploaded.document.object_id, extraction_result_id: uploaded.extraction_result.object_id }
        });
        setAlphaAnswer(`Stored ${file.name}, extracted ${Object.keys(asRecord(uploaded.extraction_result.payload_json?.extracted_fields) ?? {}).length} field(s), and refreshed readiness to ${readiness.readiness.overall}.`);
      } else {
        setAlphaAnswer(`Stored ${file.name}. Text extraction is pending because the uploaded file is not text-readable in alpha.`);
      }
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not upload stored document');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function generateDocumentPack() {
    if (!orgId) return;
    const objectIds = alphaObjects
      .filter((object) => ['document', 'extraction_result'].includes(object.type))
      .map((object) => object.object_id);
    if (!objectIds.length) {
      setAlphaError('Upload or extract at least one document before generating a document pack.');
      return;
    }
    setAlphaLoading('doc_pack');
    setAlphaError(null);
    try {
      const pack = await api.generateDocumentPack(orgId, {
        trade_id: tradeId,
        object_ids: objectIds,
        title: 'Trade Room document pack'
      });
      setAlphaAnswer(`Document pack generated with ${pack.document_count} document(s), ${pack.extraction_count} extraction(s), and ${pack.missing_fields.length} missing field signal(s).`);
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not generate document pack');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function createStandalonePaymentAndAttach() {
    if (!orgId) return;
    setAlphaLoading('payment');
    setAlphaError(null);
    try {
      await ensureAlphaTradeRoomObject();
      const created = await api.createAlphaObject(orgId, 'payment_intent', {
        title: 'Standalone payment intent',
        summary: 'Created independently from Finance, then attached to this Trade Room from the reference UX.',
        origin_workspace: 'finance',
        status: 'approval_required',
        trade_id: null,
        payload: {
          amount: 4800,
          currency: 'EUR',
          protected_action: 'send_payment',
          approval_gate: 'human_required',
          source: 'trade_room_reference_ux'
        },
        permissions: {
          visibility: 'org',
          external_access: false,
          protected_actions_require_approval: true
        }
      });
      await api.attachAlphaObject(orgId, {
        object_id: created.object.object_id,
        target: { type: 'trade_room', id: tradeId },
        mode: 'attach',
        reason: 'Demonstrate composable standalone payment attachment without losing audit, memory, or permission context.'
      });
      await api.evaluateAlphaReadiness(orgId, { trade_id: tradeId });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not attach standalone payment');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function attachStandaloneCandidate(candidateId: string, mode: 'attach' | 'link' | 'convert') {
    if (!orgId) return;
    const candidate = standaloneCandidates.find((object) => object.object_id === candidateId);
    if (!candidate) {
      setAlphaError('Standalone object is no longer available for composition.');
      return;
    }

    setAlphaLoading('attach_candidate');
    setAlphaError(null);
    try {
      await ensureAlphaTradeRoomObject();
      await api.attachAlphaObject(orgId, {
        object_id: candidate.object_id,
        target: { type: 'trade_room', id: tradeId },
        mode,
        reason: `${mode} standalone ${candidate.type.replaceAll('_', ' ')} into this Trade Room while preserving permission, audit, memory, evidence, and replay context.`
      });
      await api.evaluateAlphaReadiness(orgId, { trade_id: tradeId });
      setAlphaAnswer(`${candidate.title} was ${mode === 'link' ? 'linked' : mode === 'convert' ? 'converted' : 'attached'} into this Trade Room with context preservation.`);
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not compose standalone object into Trade Room');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function continueReferenceStory() {
    const hasTradeRoom = alphaObjects.some((object) => object.type === 'trade_room');
    const hasExtraction = alphaObjects.some((object) => object.type === 'extraction_result');
    const hasPayment = alphaObjects.some((object) => object.type === 'payment_intent');
    const hasAgentWork = alphaObjects.some((object) => object.type === 'agent_work_result');
    const hasApproval = alphaObjects.some((object) => object.type === 'approval');
    const pendingApproval = alphaObjects.some((object) => object.type === 'approval' && object.status === 'approval_required');
    const hasProof = alphaObjects.some((object) => object.type === 'proof_bundle');

    if (!hasTradeRoom || !hasExtraction) {
      await extractReferenceDocumentAndReadiness();
      return;
    }
    if (!hasPayment) {
      await createStandalonePaymentAndAttach();
      return;
    }
    if (!hasAgentWork) {
      await launchScopedExecutionAgent();
      return;
    }
    if (!hasApproval) {
      await requestProtectedPaymentApproval();
      return;
    }
    if (pendingApproval) {
      setAlphaAnswer('The reference loop is intentionally paused at the human approval gate. Review the evidence, complete step-up, acknowledge residual risks, then approve or reject.');
      return;
    }
    if (!hasProof) {
      await generateAlphaProofBundle();
      return;
    }
    setAlphaAnswer('Reference loop complete: readiness, governed execution, approval history, proof, memory, and attached standalone work are present.');
  }

  async function generateAlphaProofBundle() {
    if (!orgId) return;
    setAlphaLoading('proof');
    setAlphaError(null);
    try {
      await api.generateAlphaProofBundle(orgId, {
        trade_id: tradeId,
        object_ids: alphaObjects.slice(0, 12).map((object) => object.object_id),
        title: 'Trade Room reference proof bundle'
      });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not generate proof bundle');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function buildLedgerProofBundle() {
    if (!orgId) return;
    setProofLoading('ledger');
    setProofError(null);
    try {
      const proof = await api.getProofs(orgId, tradeId);
      setLedgerProof(proof);
      setProofVerification(null);
      await wf.actions.refresh();
    } catch (err) {
      setProofError(err instanceof Error ? err.message : 'Could not build ledger proof bundle');
    } finally {
      setProofLoading(null);
    }
  }

  async function verifyLedgerProofBundle() {
    if (!orgId) return;
    setProofLoading('verify');
    setProofError(null);
    try {
      const verification = await api.verifyStoredProof(orgId, { trade_id: tradeId });
      setProofVerification(verification);
    } catch (err) {
      setProofError(err instanceof Error ? err.message : 'Could not verify proof bundle');
    } finally {
      setProofLoading(null);
    }
  }

  async function exportLedgerProofBundle() {
    if (!orgId) return;
    setProofLoading('export');
    setProofError(null);
    try {
      const exported = await api.exportLedger(orgId, { trade_ids: [tradeId] });
      setProofExport(exported);
    } catch (err) {
      setProofError(err instanceof Error ? err.message : 'Could not export proof archive');
    } finally {
      setProofLoading(null);
    }
  }

  async function requestProofShareApproval() {
    if (!orgId) return;
    const proof = latestAlphaObject(alphaObjects.filter((object) => object.type === 'proof_bundle'));
    if (!proof) {
      setProofError('Generate a proof bundle before requesting external sharing approval.');
      return;
    }
    setProofLoading('share');
    setProofError(null);
    try {
      const share = await api.requestProofShare(orgId, {
        proof_bundle_id: proof.object_id,
        recipient: {
          name: 'Pilot proof recipient',
          email: 'proof-recipient@example.com',
          role: 'counterparty'
        },
        scopes: ['view_proof_summary', 'view_artifact_manifest', 'download_verified_bundle'],
        reason: 'Pilot-controlled proof sharing request for external counterparty review.'
      });
      setAlphaAnswer(`Proof sharing prepared behind human approval ${share.approval.object_id.slice(0, 8)}. TRAIBOX has not shared anything externally.`);
      await refreshAlphaContext(null);
    } catch (err) {
      setProofError(err instanceof Error ? err.message : 'Could not request proof sharing approval');
    } finally {
      setProofLoading(null);
    }
  }

  async function launchScopedExecutionAgent() {
    if (!orgId) return;
    setAlphaLoading('agent');
    setAlphaError(null);
    try {
      await api.launchAlphaAgentTask(orgId, {
        trade_id: tradeId,
        objective: 'Prepare the next governed execution step for this Trade Room and identify approval blockers before any protected action.',
        input_objects: alphaObjects.slice(0, 10).map((object) => object.object_id),
        permitted_tools: ['read_trade_context', 'prepare_payment_intent', 'prepare_proof_bundle', 'request_approval'],
        data_access: ['selected_objects', 'trade_room_memory_l1', 'organization_memory_l2', 'audit_replay'],
        write_permissions: ['create_agent_task', 'create_agent_work_result', 'create_memory_event', 'recommend_next_action', 'create_approval_request'],
        approval_gates: ['send_payment'],
        time_budget_seconds: 60
      });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not launch scoped agent task');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function requestProtectedPaymentApproval() {
    if (!orgId) return;
    const target = alphaObjects.find((object) => object.type === 'payment_intent' && object.status !== 'rejected' && object.status !== 'cancelled');
    if (!target) {
      setAlphaError('Attach or create a payment intent before requesting protected-action approval.');
      return;
    }

    setAlphaLoading('approval');
    setAlphaError(null);
    try {
      await api.requestAlphaApproval(orgId, {
        target: { type: 'payment_intent', id: target.object_id },
        protected_action: 'send_payment',
        proposed_action: `Approve protected payment execution for ${target.title}.`,
        evidence_refs: [
          { object_id: target.object_id, role: 'payment_intent' },
          ...alphaObjects
            .filter((object) => ['document', 'extraction_result', 'readiness_state', 'proof_bundle'].includes(object.type))
            .slice(0, 4)
            .map((object) => ({ object_id: object.object_id, role: object.type }))
        ],
        policy_refs: ['protected-actions-alpha-v1', 'trade-room-execution-alpha'],
        step_up_required: true,
        rationale: 'Payment execution is externally consequential and must remain blocked until a human approves with evidence and residual risks visible.',
        approval_chain: [
          { key: 'finance_review', label: 'Finance review', required_role: 'finance', status: 'approval_required' },
          { key: 'ops_release', label: 'Operations release', required_role: 'ops', status: 'pending_input' }
        ],
        current_approval_step: 'finance_review'
      });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not request approval');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function decideLatestApproval(
    decision: 'approved' | 'rejected',
    input: { notes: string; stepUpVerified: boolean; residualRisksAcknowledged: boolean; approvalStep?: string }
  ) {
    if (!orgId) return;
    const approval = alphaObjects.find((object) => object.type === 'approval' && object.status === 'approval_required');
    if (!approval) {
      setAlphaError('No pending approval is available for decision.');
      return;
    }

    setAlphaLoading('decision');
    setAlphaError(null);
    try {
      await api.decideAlphaApproval(orgId, approval.object_id, {
        decision,
        notes: input.notes,
        step_up_verified: input.stepUpVerified,
        residual_risks_acknowledged: input.residualRisksAcknowledged,
        approval_step: input.approvalStep
      });
      await api.evaluateAlphaReadiness(orgId, { trade_id: tradeId });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not record approval decision');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function completeLatestExecutionTask() {
    if (!orgId) return;
    const task = alphaObjects.find((object) => object.type === 'execution_task' && ['in_progress', 'ready_for_review'].includes(object.status));
    if (!task) {
      setAlphaError('No active execution task is available to complete.');
      return;
    }

    setAlphaLoading('task');
    setAlphaError(null);
    try {
      await api.updateExecutionTaskStatus(orgId, task.object_id, {
        status: 'completed',
        execution_action: 'mark_external_completed',
        note: 'Operator confirmed controlled execution completion from the Trade Room execution lane.',
        operator_confirmation: true,
        residual_risks_acknowledged: true,
        external_reference: `trade-room-${tradeId.slice(0, 8)}-manual-completion`,
        idempotency_key: `alpha-${task.object_id}`
      });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not update execution task');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function updateExecutionTask(taskId: string, body: ExecutionTaskStatusRequest) {
    if (!orgId) return;
    setAlphaLoading('task');
    setAlphaError(null);
    try {
      await api.updateExecutionTaskStatus(orgId, taskId, body);
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not update execution task');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function createScopedExternalAccess() {
    if (!orgId) return;
    const target =
      alphaObjects.find((object) => object.type === 'execution_task' && object.status !== 'completed') ??
      alphaObjects.find((object) => object.type === 'proof_bundle') ??
      alphaObjects.find((object) => object.type === 'payment_intent');

    setAlphaLoading('access');
    setAlphaError(null);
    try {
      await api.createExternalAccessGrant(orgId, {
        target: target ? { type: target.type, id: target.object_id } : { type: 'trade_room', id: tradeId },
        trade_id: tradeId,
        participant: {
          name: 'External Counterparty',
          email: 'counterparty@example.com',
          role: 'external_counterparty'
        },
        scopes: ['view_task', 'submit_task_update', 'upload_requested_document', 'view_proof_summary', 'view_artifact_manifest'],
        reason: 'Grant scoped alpha access for external participant follow-up without exposing unrelated organization data.'
      });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not create scoped external access');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function createMissingDocumentRequest() {
    if (!orgId) return;
    const latestReadiness = alphaReadiness[0];
    const activeTask = alphaObjects.find((object) => object.type === 'execution_task' && ['in_progress', 'ready_for_review'].includes(object.status));
    const requestedItems = (latestReadiness?.missing_items ?? []).slice(0, 4);

    setAlphaLoading('doc_request');
    setAlphaError(null);
    try {
      await api.createDocumentRequest(orgId, {
        trade_id: tradeId,
        task_id: activeTask?.object_id,
        title: 'Request missing trade evidence',
        summary: 'External participant should provide missing proof so readiness and proof can update.',
        requested_items: requestedItems.length ? requestedItems : ['buyer_tax_id', 'incoterm', 'acceptance_proof'],
        requested_from: {
          name: 'External Counterparty',
          email: 'counterparty@example.com',
          role: 'buyer'
        },
        reason: latestReadiness?.next_actions?.[0] ?? 'Close readiness gaps before execution.'
      });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not create document request');
    } finally {
      setAlphaLoading(null);
    }
  }

  async function submitRequestedDocument() {
    if (!orgId) return;
    const request = alphaObjects.find((object) => object.type === 'document_request' && ['pending_input', 'in_progress'].includes(object.status));
    if (!request) {
      setAlphaError('No pending document request is available for submission.');
      return;
    }

    setAlphaLoading('doc_submit');
    setAlphaError(null);
    try {
      await api.submitDocumentRequest(orgId, request.object_id, {
        filename: 'buyer-vat-and-acceptance-proof.txt',
        mime_type: 'text/plain',
        text:
          'Purchase Order PO-8812. Seller: Lusitania Automation Lda. Buyer: Iberica Components SL. Buyer VAT: ESB12345678. Amount EUR 48000. Incoterm DAP. Payment terms: 40% advance and 60% after acceptance. Acceptance proof signed by buyer operations lead.',
        submitted_by: {
          name: 'External Counterparty',
          email: 'counterparty@example.com',
          role: 'buyer'
        }
      });
      await refreshAlphaContext(null);
    } catch (err) {
      setAlphaError(err instanceof Error ? err.message : 'Could not submit requested document');
    } finally {
      setAlphaLoading(null);
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
          <p className="text-sm text-muted mt-2">Please sign in to view this trade.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  const plan = wf.snapshot?.plan ?? null;
  const compliance = wf.snapshot?.compliance ?? null;
  const offers = wf.snapshot?.offers ?? [];
  const reservation = wf.snapshot?.reservation ?? null;
  const latestPayment = Array.isArray(wf.snapshot?.payments) && wf.snapshot.payments.length > 0 ? wf.snapshot.payments[0] : null;

  return (
    <AppShell
      orgId={orgId}
      orgs={orgs}
      onOrgChange={setOrgId}
      headerRight={<div className="text-sm text-muted">{selectedOrg?.name ?? 'Select org'}</div>}
    >
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <TradeRoomCommandDeck
          snapshot={wf.snapshot}
          objects={alphaObjects}
          readinessStates={alphaReadiness}
          memoryEvents={alphaMemory}
          replayHash={alphaReplayHash}
          replayGaps={alphaReplayGaps}
          loading={alphaLoading}
          disabled={!orgId}
          onContinueReferenceStory={continueReferenceStory}
          onRunCopilot={runAlphaCopilot}
          onGenerateProof={generateAlphaProofBundle}
        />

        <WorkspaceGrid
          className="xl:grid-cols-[minmax(380px,0.82fr)_minmax(640px,1.18fr)]"
          rightClassName="space-y-4"
          left={
            <ChatPane
              title={wf.title}
              subtitle={wf.subtitle}
              messages={chatMessages}
              placeholder="Ask TRAIBOX…"
              disabled={!orgId}
              onSend={async (text) => {
                await wf.actions.sendChat(text);
              }}
            />
          }
          right={
            <>
              <AlphaTradeRoomPanel
                objects={alphaObjects}
                standaloneCandidates={standaloneCandidates}
                readinessStates={alphaReadiness}
                memoryEvents={alphaMemory}
                replaySteps={alphaReplaySteps}
                replayHash={alphaReplayHash}
                replayGaps={alphaReplayGaps}
                composer={alphaComposer}
                answer={alphaAnswer}
                loading={alphaLoading}
                error={alphaError}
                onComposerChange={setAlphaComposer}
                onRefresh={() => refreshAlphaContext()}
                onRunCopilot={runAlphaCopilot}
                onStartReadinessLoop={extractReferenceDocumentAndReadiness}
                onUploadDocument={uploadStoredDocument}
                onGenerateDocumentPack={generateDocumentPack}
                onContinueReferenceStory={continueReferenceStory}
                onAttachPayment={createStandalonePaymentAndAttach}
                onAttachCandidate={attachStandaloneCandidate}
                onLaunchAgent={launchScopedExecutionAgent}
                onRequestApproval={requestProtectedPaymentApproval}
                onDecideApproval={decideLatestApproval}
                onCompleteTask={completeLatestExecutionTask}
                onUpdateExecutionTask={updateExecutionTask}
                onCreateExternalAccess={createScopedExternalAccess}
                onCreateDocumentRequest={createMissingDocumentRequest}
                onSubmitDocumentRequest={submitRequestedDocument}
                onGenerateProof={generateAlphaProofBundle}
                disabled={!orgId}
              />

              <ProofTrustPanel
                orgId={orgId}
                alphaObjects={alphaObjects}
                readinessStates={alphaReadiness}
                ledgerProof={ledgerProof ?? wf.lastProofs ?? wf.snapshot?.proofs ?? null}
                verification={proofVerification}
                exported={proofExport}
                loading={proofLoading}
                error={proofError}
                onBuildLedger={buildLedgerProofBundle}
                onVerifyLedger={verifyLedgerProofBundle}
                onExport={exportLedgerProofBundle}
                onRequestShareApproval={requestProofShareApproval}
              />

              <TradeCard
                icon={<FileText className="h-4 w-4" />}
                title="Trade Plan"
                status={wf.cards.plan.status}
                traceId={undefined}
                primary={{
                  label: plan ? 'Copy plan JSON' : 'Copy example intent',
                  onClick: async () => {
                    try {
                      if (plan) await navigator.clipboard.writeText(JSON.stringify(plan, null, 2));
                      else await navigator.clipboard.writeText('Sell 100 cases of wine to Madrid; 50% advance; ship next week');
                    } catch {
                      // ignore
                    }
                  }
                }}
                glassBox={wf.cards.plan.reasons}
              >
                {plan ? (
                  <div className="text-sm space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Items</div>
                      <div className="text-sm font-medium text-right">{Array.isArray(plan.items) ? plan.items.length : 0}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Corridor</div>
                      <div className="text-sm font-medium text-right">{wf.snapshot?.trade?.corridor ?? '—'}</div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-muted">Confidence</div>
                      <div className="text-sm font-medium text-right">
                        {plan.confidence == null ? '—' : `${Math.round(Number(plan.confidence) * 100)}%`}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Plan not found.</p>
                )}
              </TradeCard>

              <TradeCard
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Compliance"
                status={wf.cards.compliance.status}
                traceId={undefined}
                primary={{
                  label: 'Run compliance',
                  onClick: () => wf.actions.runCompliance(),
                  disabled: !orgId || !plan
                }}
                secondary={
                  compliance?.pdf_url && orgId
                    ? {
                        label: 'Download report',
                        icon: <FileDown className="h-4 w-4" />,
                        href: api.downloadUrl(orgId, compliance.pdf_url)
                      }
                    : undefined
                }
              >
                <div className="text-sm space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Overall</div>
                    <div className="text-sm font-medium text-right">{compliance?.overall ?? '—'}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-muted">Risk</div>
                    <div className="text-sm font-medium text-right">{compliance?.risk_level ?? '—'}</div>
                  </div>
                </div>
              </TradeCard>

              <TradeCard
                icon={<HandCoins className="h-4 w-4" />}
                title="Finance (PriME + STF)"
                status={wf.cards.finance.status}
                traceId={undefined}
                primary={{
                  label: reservation ? 'Accepted' : wf.cards.finance.recommendedOfferId ? 'Accept recommended' : 'Request offers',
                  onClick: async () => {
                    if (reservation) return;
                    if (wf.cards.finance.recommendedOfferId) return wf.actions.acceptRecommended();
                    return wf.actions.requestOffers();
                  },
                  disabled: !orgId || !plan || Boolean(reservation)
                }}
                glassBox={wf.cards.finance.recommendedReasons}
              >
                <div className="space-y-3">
                  <div className="text-sm">
                    Request status: <span className="font-medium">{wf.snapshot?.offer_request?.status ?? '—'}</span>
                  </div>

                  {reservation ? (
                    <div className="text-xs text-muted">
                      Reservation: {reservation.offer_id} • expires {new Date(reservation.expires_at).toLocaleString()}
                    </div>
                  ) : null}

                  {wf.snapshot?.offer_request?.status === 'pending' && offers.length === 0 ? (
                    <p className="text-sm text-muted">
                      Waiting for partner offers… (request {wf.snapshot?.offer_request?.request_id})
                    </p>
                  ) : null}

                  {offers.length > 0 ? (
                    <ul className="space-y-2">
                      {offers.map((o: any) => {
                        const isRecommended = o.offer_id === wf.cards.finance.recommendedOfferId;
                        const reasons = Array.isArray(o.allocation_json?.reasons)
                          ? o.allocation_json.reasons
                          : Array.isArray(o.explanations)
                            ? o.explanations
                            : [];
                        return (
                          <li key={o.offer_id} className="rounded-xl border border-border/10 bg-surface2/40 p-3 text-sm">
                            <div className="flex items-center justify-between">
                              <div className="font-medium">
                                {o.financier_name}
                                {isRecommended ? <span className="ml-2 text-xs text-accent font-medium">Recommended</span> : null}
                              </div>
                              <div className="text-xs text-muted">{o.sustainability_grade ?? '—'}</div>
                            </div>
                            <div className="text-xs text-muted mt-1">
                              APR {o.apr_bps} bps • Fees {o.fees} • Tenor {o.tenor_days}d
                            </div>
                            {reasons.length > 0 ? (
                              <ul className="mt-2 text-xs text-muted list-disc pl-4">
                                {reasons.slice(0, 3).map((r: string, idx: number) => (
                                  <li key={idx}>{r}</li>
                                ))}
                              </ul>
                            ) : null}
                            <div className="mt-2">
                              <Button
                                variant={isRecommended ? 'primary' : 'secondary'}
                                size="sm"
                                disabled={Boolean(reservation)}
                                onClick={async () => {
                                  if (!orgId) return;
                                  await api.acceptOffer(orgId, o.offer_id);
                                  await wf.actions.refresh();
                                }}
                              >
                                Accept
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">No offers yet.</p>
                  )}
                </div>
              </TradeCard>

              <TradeCard
                icon={<WalletCards className="h-4 w-4" />}
                title="Payments (TrueLayer + fallback)"
                status={wf.cards.payments.status}
                traceId={undefined}
                primary={{
                  label: wf.accounts.length ? 'Compute routes' : 'Connect bank',
                  onClick: async () => {
                    if (wf.accounts.length === 0) return wf.actions.connectBank();
                    return wf.actions.computeRoutes();
                  },
                  disabled: !orgId || !plan
                }}
              >
                <div className="space-y-3">
                  <div className="text-sm text-muted">
                    {wf.accounts.length === 0 ? (
                      <span>No linked bank accounts. Connect via TrueLayer or use manual fallback.</span>
                    ) : (
                      <span>Linked accounts: {wf.accounts.length}</span>
                    )}
                  </div>

                  {wf.accounts.length > 0 ? (
                    <div className="flex gap-2">
                      <select
                        value={wf.selectedAccountId}
                        onChange={(e) => wf.setSelectedAccountId(e.target.value)}
                        className="flex-1 rounded-xl border border-border/10 bg-surface2 px-2 py-2 text-sm"
                      >
                        <option value="">Select account…</option>
                        {wf.accounts.map((a) => (
                          <option key={a.account_id} value={a.account_id}>
                            {a.name ?? a.iban}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" disabled={!wf.selectedAccountId || !orgId} onClick={() => wf.actions.computeRoutes()}>
                      Compute routes
                    </Button>
                    <select
                      value={wf.selectedRouteId}
                      onChange={(e) => wf.setSelectedRouteId(e.target.value)}
                      className="flex-1 rounded-xl border border-border/10 bg-surface2 px-2 py-2 text-sm"
                    >
                      <option value="">Select route…</option>
                      {wf.routes.map((r) => (
                        <option key={r.route_id} value={r.route_id}>
                          {r.scheme} • fee {r.fee}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="ink" size="sm" disabled={!wf.selectedAccountId || !wf.selectedRouteId || !orgId} onClick={() => wf.actions.executePayment()}>
                      Execute payment
                    </Button>
                    {wf.lastPayment?.payment_id && String(wf.lastPayment.scheme ?? '').startsWith('MANUAL') ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          if (!orgId) return;
                          await api.completeManualPayment(orgId, wf.lastPayment!.payment_id, 'executed');
                          await wf.actions.refresh();
                        }}
                      >
                        Mark executed
                      </Button>
                    ) : null}
                  </div>

                  {wf.lastPayment?.redirect_url ? (
                    <div className="text-xs text-muted space-y-2">
                      <div className="break-all">Redirect URL: {wf.lastPayment.redirect_url}</div>
                      {/^https?:\/\//.test(wf.lastPayment.redirect_url) ? (
                        <a className={buttonClassName({ variant: 'primary', size: 'sm' })} href={wf.lastPayment.redirect_url} target="_blank" rel="noreferrer">
                          Continue SCA
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {latestPayment?.payment_id ? (
                    <div className="text-xs text-muted">
                      Latest payment: {latestPayment.payment_id} • {latestPayment.status}
                    </div>
                  ) : null}
                </div>
              </TradeCard>

              <TradeCard
                icon={<Receipt className="h-4 w-4" />}
                title="Proofs"
                status={wf.cards.proofs.status}
                traceId={undefined}
                primary={{
                  label: 'Build proof pack',
                  onClick: () => wf.actions.buildProofPack(),
                  disabled: !orgId
                }}
                secondary={
                  orgId && (wf.lastProofs?.bundle_url || wf.snapshot?.proofs?.bundle_url)
                    ? {
                        label: 'Download ZIP',
                        icon: <FileDown className="h-4 w-4" />,
                        href: api.downloadUrl(orgId, (wf.lastProofs?.bundle_url ?? wf.snapshot?.proofs?.bundle_url) as string)
                      }
                    : undefined
                }
              >
                <div className="space-y-2">
                  <div className="text-xs text-muted break-all">Root: {wf.lastProofs?.root ?? wf.snapshot?.proofs?.root ?? '—'}</div>
                  {wf.lastProofs?.anchor ? (
                    <div className="text-xs text-muted break-all">
                      Anchor: {wf.lastProofs.anchor.status} {wf.lastProofs.anchor.tx_hash ? `• ${wf.lastProofs.anchor.tx_hash}` : ''}
                    </div>
                  ) : null}
                </div>
              </TradeCard>

              <details className="rounded-2xl border border-border/10 bg-surface1/60 px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted select-none">Debug events</summary>
                <ul className="mt-3 space-y-2">
                  {wf.events.slice(0, 25).map((e) => (
                    <li key={e.event_id} className="rounded-xl border border-border/10 bg-surface2/40 p-3 text-xs">
                      <div className="font-medium">{e.type}</div>
                      <pre className="whitespace-pre-wrap">{JSON.stringify(e.data, null, 2)}</pre>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          }
        />
      </div>
    </AppShell>
  );
}

function TradeRoomCommandDeck({
  snapshot,
  objects,
  readinessStates,
  memoryEvents,
  replayHash,
  replayGaps,
  loading,
  disabled,
  onContinueReferenceStory,
  onRunCopilot,
  onGenerateProof
}: {
  snapshot: TradeWorkspaceResponse | null;
  objects: AlphaObject[];
  readinessStates: ReadinessState[];
  memoryEvents: AlphaMemoryEvent[];
  replayHash: string | null;
  replayGaps: string[];
  loading: string | null;
  disabled?: boolean;
  onContinueReferenceStory: () => void;
  onRunCopilot: () => void;
  onGenerateProof: () => void;
}) {
  const trade = snapshot?.trade;
  const plan = snapshot?.plan;
  const latestReadiness = readinessStates[0] ?? (objects.find((object) => object.type === 'readiness_state')?.payload_json as ReadinessState | undefined);
  const storySteps = buildReferenceStoryProgress(objects, readinessStates, memoryEvents);
  const completedSteps = storySteps.filter((step) => step.state === 'done').length;
  const nextStep = storySteps.find((step) => step.state !== 'done');
  const completion = Math.round((completedSteps / Math.max(storySteps.length, 1)) * 100);
  const proof = objects.find((object) => object.type === 'proof_bundle');
  const pendingApprovalCount = objects.filter((object) => object.type === 'approval' && object.status === 'approval_required').length;
  const attachedCount = objects.filter((object) => object.status === 'attached' || Boolean(object.payload_json?.attached_to)).length;
  const workflowRunCount = objects.filter((object) => object.type === 'workflow_run').length;
  const subjectItems = plan?.items ?? [];
  const parties = plan?.parties ?? [];
  const mechanics = objects.filter((object) =>
    ['payment_intent', 'funding_request', 'clearance_check', 'screening_result', 'onboarding_flow', 'execution_task', 'approval', 'proof_bundle'].includes(object.type)
  );
  const missingItems = asStringArray(latestReadiness?.missing_items);
  const risks = asStringArray(latestReadiness?.risk_findings);
  const nextActions = asStringArray(latestReadiness?.next_actions);

  const layerCards = [
    {
      title: 'Subject Of Trade',
      icon: <PackageCheck className="h-4 w-4" />,
      status: subjectItems.length || trade ? 'structured' : 'waiting',
      summary:
        subjectItems[0]?.name ??
        trade?.title ??
        'Goods, services, deliverables, access, or obligations will appear here once messy intent is parsed.',
      facts: [
        subjectItems.length ? `${subjectItems.length} item(s)` : 'No items yet',
        trade?.amount && trade?.currency ? `${trade.currency} ${Number(trade.amount).toLocaleString()}` : 'Amount pending',
        plan?.terms?.payment_terms ? `Payment: ${plan.terms.payment_terms}` : 'Settlement pending'
      ]
    },
    {
      title: 'Counterparties',
      icon: <UsersRound className="h-4 w-4" />,
      status: parties.length || objects.some((object) => ['counterparty', 'screening_result', 'trade_passport'].includes(object.type)) ? 'structured' : 'waiting',
      summary:
        parties
          .map((party) => [party.role, party.country].filter(Boolean).join(' · '))
          .filter(Boolean)
          .slice(0, 2)
          .join(' / ') || 'Buyer, seller, financier, and partner context will stay reusable across workflows.',
      facts: [
        parties.length ? `${parties.length} role(s)` : 'No parties yet',
        objects.some((object) => object.type === 'screening_result') ? 'Screening present' : 'Screening pending',
        objects.some((object) => object.type === 'trade_passport') ? 'Passport present' : 'Passport pending'
      ]
    },
    {
      title: 'Execution Mechanics',
      icon: <Route className="h-4 w-4" />,
      status: mechanics.length ? (pendingApprovalCount ? 'approval gate' : 'active') : 'waiting',
      summary:
        nextActions[0] ??
        'Documentation, clearance, funding, payment, approval, execution, and proof mechanics converge in this room.',
      facts: [
        `${mechanics.length} mechanic object(s)`,
        `${workflowRunCount} workflow run(s)`,
        attachedCount ? `${attachedCount} attached job(s)` : 'No attachments yet'
      ]
    }
  ];

  return (
    <Surface className="relative overflow-hidden border-accent/20 bg-[radial-gradient(circle_at_top_left,rgba(17,116,102,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(196,118,44,0.12),transparent_30%),rgb(var(--surface-1))]">
      <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-paper/70 px-3 py-1 text-xs text-muted">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" />
              Trade Room command deck
            </div>
            <h1 className="mt-4 max-w-4xl text-3xl font-semibold tracking-tight">
              {trade?.title ?? 'Build this Trade Room from fragmented trade activity.'}
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-muted">
              TRAIBOX keeps the full exchange visible: what is being traded, who is accountable, which mechanics move it forward, what needs approval, and what proof has been generated.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
              <span className="rounded-full border border-border/10 bg-paper/70 px-3 py-1">{trade?.corridor ? `Corridor ${trade.corridor}` : 'Corridor pending'}</span>
              <span className="rounded-full border border-border/10 bg-paper/70 px-3 py-1">{latestReadiness ? `Readiness ${latestReadiness.overall} · ${Math.round(latestReadiness.score)}%` : 'Readiness pending'}</span>
              <span className="rounded-full border border-border/10 bg-paper/70 px-3 py-1">{replayHash ? `Replay ${shortHash(replayHash)}` : 'Replay waiting'}</span>
            </div>
          </div>

          <div className="min-w-[260px] rounded-3xl border border-border/10 bg-paper/75 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-muted">Reference loop</div>
                <div className="mt-2 text-3xl font-semibold">{completion}%</div>
                <div className="mt-1 text-xs text-muted">
                  {completedSteps} of {storySteps.length} proof points complete
                </div>
              </div>
              <Clock3 className="h-5 w-5 text-accent" />
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-border/10">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${completion}%` }} />
            </div>
            <div className="mt-3 rounded-2xl bg-surface2/70 px-3 py-2">
              <div className="text-xs font-medium">Next best action</div>
              <p className="mt-1 text-xs leading-5 text-muted">{nextStep ? `${nextStep.title}: ${nextStep.summary}` : 'Reference loop complete. Verify proof and replay before pilot handoff.'}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <AlphaMetric label="Missing Proof" value={String(missingItems.length)} tone={missingItems.length ? 'blocked' : 'ready'} />
          <AlphaMetric label="Risk Findings" value={String(risks.length)} tone={risks.length ? 'risky' : 'ready'} />
          <AlphaMetric label="Approval Gates" value={String(pendingApprovalCount)} tone={pendingApprovalCount ? 'blocked' : undefined} />
          <AlphaMetric label="Attached Jobs" value={String(attachedCount)} tone={attachedCount ? 'ready' : undefined} />
          <AlphaMetric label="Proof Bundle" value={proof ? 'Ready' : 'Not yet'} tone={proof ? 'ready' : 'blocked'} />
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-3">
          {layerCards.map((layer) => (
            <TradeLayerCard key={layer.title} layer={layer} />
          ))}
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[1fr_auto] xl:items-start">
          <div className="rounded-3xl border border-border/10 bg-paper/65 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Lifecycle Runway</div>
                <p className="mt-1 text-xs leading-5 text-muted">
                  The alpha demo path stays explicit so we can see readiness, execution, proof, Operations, and attachment integrity at a glance.
                </p>
              </div>
              {replayGaps.length ? (
                <span className="rounded-full border border-warn/20 bg-warn/10 px-3 py-1 text-xs text-warn">{replayGaps.length} replay gap(s)</span>
              ) : (
                <span className="rounded-full border border-success/20 bg-success/10 px-3 py-1 text-xs text-success">Replay covered</span>
              )}
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {storySteps.map((step) => (
                <div
                  key={step.key}
                  className={cn(
                    'rounded-2xl border px-3 py-3',
                    step.state === 'done' ? 'border-success/20 bg-success/10' : step.state === 'attention' ? 'border-warn/20 bg-warn/10' : 'border-border/10 bg-surface2/60'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {step.state === 'done' ? <CheckCircle2 className="h-4 w-4 text-success" /> : step.state === 'attention' ? <AlertTriangle className="h-4 w-4 text-warn" /> : <Circle className="h-4 w-4 text-muted" />}
                    <div className="truncate text-sm font-medium">{step.title}</div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{step.summary}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-border/10 bg-paper/75 p-4 xl:w-[280px]">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <LockKeyhole className="h-4 w-4 text-accent" />
              Governed Actions
            </div>
            <p className="mt-2 text-xs leading-5 text-muted">
              Agents can prepare and recommend, but protected execution remains blocked until human approval is recorded.
            </p>
            <div className="mt-4 grid gap-2">
              <Button disabled={disabled || Boolean(loading)} onClick={onContinueReferenceStory}>
                Continue story <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="secondary" disabled={disabled || loading === 'ai'} onClick={onRunCopilot}>
                {loading === 'ai' ? 'Thinking…' : 'Ask Trade Brain'}
              </Button>
              <Button variant="secondary" disabled={disabled || loading === 'proof' || objects.length === 0} onClick={onGenerateProof}>
                {loading === 'proof' ? 'Generating…' : 'Generate proof'}
              </Button>
              <Link className={buttonClassName({ variant: 'secondary' })} href="/operations">
                Open Operations
              </Link>
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function TradeLayerCard({
  layer
}: {
  layer: {
    title: string;
    icon: ReactNode;
    status: string;
    summary: string;
    facts: string[];
  };
}) {
  return (
    <div className="rounded-3xl border border-border/10 bg-paper/65 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-2xl bg-accent/10 p-2 text-accent">{layer.icon}</div>
        <span className="rounded-full border border-border/10 bg-surface2 px-2 py-1 text-[10px] text-muted">{layer.status}</span>
      </div>
      <div className="mt-4 text-sm font-semibold">{layer.title}</div>
      <p className="mt-2 min-h-[44px] text-xs leading-5 text-muted">{layer.summary}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {layer.facts.map((fact) => (
          <span key={fact} className="rounded-full border border-border/10 bg-surface2 px-2 py-1 text-[10px] text-muted">
            {fact}
          </span>
        ))}
      </div>
    </div>
  );
}

type DisplayLedgerProof = {
  bundle_url: string;
  root: string;
  manifest_sha256: string;
  created_at?: string;
  artifacts?: LedgerProofsResponse['artifacts'];
  artifact_count?: number;
  anchor?: LedgerProofsResponse['anchor'];
  trace_id?: string;
};

function ProofTrustPanel({
  orgId,
  alphaObjects,
  readinessStates,
  ledgerProof,
  verification,
  exported,
  loading,
  error,
  onBuildLedger,
  onVerifyLedger,
  onExport,
  onRequestShareApproval
}: {
  orgId: string | null;
  alphaObjects: AlphaObject[];
  readinessStates: ReadinessState[];
  ledgerProof: DisplayLedgerProof | null;
  verification: LedgerVerifyStoredResponse | null;
  exported: LedgerExportResponse | null;
  loading: 'ledger' | 'verify' | 'export' | 'share' | null;
  error: string | null;
  onBuildLedger: () => void;
  onVerifyLedger: () => void;
  onExport: () => void;
  onRequestShareApproval: () => void;
}) {
  const alphaProof = latestAlphaObject(alphaObjects.filter((object) => object.type === 'proof_bundle'));
  const manifest = alphaProof?.payload_json?.manifest as { artifacts?: Array<Record<string, unknown>>; generated_at?: string; title?: string } | undefined;
  const alphaArtifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : alphaProof?.evidence_refs_json ?? [];
  const ledgerArtifacts = ledgerProof?.artifacts ?? [];
  const proofIsValid = verification?.valid === true;
  const proofIsInvalid = verification?.valid === false;
  const quality = buildQualityArtifactInsight(alphaObjects, readinessStates);
  const shareControl = asRecord(alphaProof?.payload_json?.share_control);
  const manifestSharePolicy = asRecord(asRecord(alphaProof?.payload_json?.manifest)?.share_policy);
  const sharePolicy = shareControl ?? manifestSharePolicy;
  const shareStatus = String(shareControl?.status ?? manifestSharePolicy?.external_sharing_status ?? (alphaProof ? 'internal_only' : 'not ready'));
  const shareScopes = asStringArray(shareControl?.scopes).length ? asStringArray(shareControl?.scopes) : asStringArray(sharePolicy?.allowed_scopes);

  return (
    <Surface className="overflow-hidden border-success/20 bg-[radial-gradient(circle_at_top_left,rgba(39,174,96,0.12),transparent_34%),rgb(var(--surface-1))]">
      <div className="border-b border-border/10 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-success/10 p-2 text-success">
              <FileArchive className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold leading-tight">Proof Trust Inspector</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                Inspect alpha proof objects, build a downloadable ledger ZIP, verify stored hashes, and export an audit archive.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={!orgId || loading === 'ledger'} onClick={onBuildLedger}>
              {loading === 'ledger' ? 'Building…' : 'Build ledger ZIP'}
            </Button>
            <Button variant="secondary" size="sm" disabled={!orgId || loading === 'verify' || !ledgerProof} onClick={onVerifyLedger}>
              {loading === 'verify' ? 'Verifying…' : 'Verify ZIP'}
            </Button>
            <Button variant="secondary" size="sm" disabled={!orgId || loading === 'export' || !ledgerProof} onClick={onExport}>
              {loading === 'export' ? 'Exporting…' : 'Export audit ZIP'}
            </Button>
            <Button variant="secondary" size="sm" disabled={!orgId || loading === 'share' || !alphaProof} onClick={onRequestShareApproval}>
              {loading === 'share' ? 'Preparing…' : 'Request share approval'}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {error ? <div className="rounded-xl border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">{error}</div> : null}

        <div className="grid gap-2 sm:grid-cols-5">
          <AlphaMetric label="Alpha proof" value={alphaProof ? 'Ready' : 'Not yet'} tone={alphaProof ? 'ready' : 'blocked'} />
          <AlphaMetric label="Ledger ZIP" value={ledgerProof ? 'Built' : 'Not yet'} tone={ledgerProof ? 'ready' : 'blocked'} />
          <AlphaMetric label="Verification" value={verification ? (proofIsValid ? 'Valid' : 'Failed') : 'Not run'} tone={proofIsValid ? 'ready' : proofIsInvalid ? 'blocked' : undefined} />
          <AlphaMetric label="Export" value={exported ? 'Ready' : 'Not yet'} tone={exported ? 'ready' : undefined} />
          <AlphaMetric label="Share Gate" value={shareStatus.replaceAll('_', ' ')} tone={shareStatus.includes('approved') ? 'ready' : alphaProof ? 'blocked' : undefined} />
        </div>

        <QualityArtifactInspector insight={quality} />

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
            <div className="text-sm font-semibold">Alpha Manifest</div>
            {alphaProof ? (
              <div className="mt-3 space-y-2 text-xs text-muted">
                <ProofFact label="Title" value={String(manifest?.title ?? alphaProof.title)} />
                <ProofFact label="Root" value={shortHash(String(alphaProof.payload_json?.root ?? ''))} />
                <ProofFact label="Manifest SHA" value={shortHash(String(alphaProof.payload_json?.manifest_sha256 ?? ''))} />
                <ProofFact label="Generated" value={manifest?.generated_at ? formatShortDate(manifest.generated_at) : formatShortDate(alphaProof.created_at)} />
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Artifacts</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {alphaArtifacts.slice(0, 8).map((artifact, index) => (
                      <span key={index} className="rounded-full border border-border/10 bg-surface2 px-2 py-1 text-[11px] text-muted">
                        {String((artifact as Record<string, unknown>).type ?? (artifact as Record<string, unknown>).role ?? (artifact as Record<string, unknown>).title ?? `artifact ${index + 1}`).replaceAll('_', ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted">Generate an alpha proof bundle from Trade Room artifacts first.</p>
            )}
          </div>

          <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
            <div className="text-sm font-semibold">Ledger Verification</div>
            {ledgerProof ? (
              <div className="mt-3 space-y-2 text-xs text-muted">
                <ProofFact label="Root" value={shortHash(ledgerProof.root)} />
                <ProofFact label="Manifest SHA" value={shortHash(ledgerProof.manifest_sha256)} />
                <ProofFact label="Bundle artifacts" value={String(ledgerProof.artifact_count ?? ledgerArtifacts.length ?? 0)} />
                <ProofFact label="Anchor" value={ledgerProof.anchor?.status ?? 'off'} />
                {verification ? (
                  <>
                    <ProofFact label="Stored root check" value={verification.root === verification.expected_root ? 'matches' : 'mismatch'} />
                    <ProofFact label="Bundle SHA" value={shortHash(verification.bundle_sha256 ?? '')} />
                    {verification.reasons.length ? <SignalList label="Verification reasons" items={verification.reasons} /> : <SignalList label="Verification reasons" items={['No hash mismatches detected']} />}
                  </>
                ) : (
                  <p className="rounded-xl bg-surface2/60 px-3 py-2">Run verification to recompute artifact hashes and the Merkle root from the stored ZIP.</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {orgId ? (
                    <a className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={api.downloadUrl(orgId, ledgerProof.bundle_url)}>
                      Download ZIP
                    </a>
                  ) : null}
                  {exported && orgId ? (
                    <a className={buttonClassName({ variant: 'secondary', size: 'sm' })} href={api.downloadUrl(orgId, exported.url)}>
                      Download audit export
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs leading-5 text-muted">Build a ledger ZIP to create a downloadable, independently verifiable proof package.</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-semibold">Proof Share Control</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                External proof sharing is a protected action. TRAIBOX can prepare the request, but it remains blocked until explicit human approval and controlled execution.
              </p>
            </div>
            <span className="rounded-full border border-border/10 bg-surface2 px-2 py-1 text-[10px] text-muted">{shareStatus.replaceAll('_', ' ')}</span>
          </div>
          {alphaProof ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-xl bg-surface2/60 px-3 py-2 text-xs text-muted">
                <ProofFact label="Protected action" value={String(sharePolicy?.protected_action ?? 'share_proof_bundle_externally').replaceAll('_', ' ')} />
                <ProofFact label="Approval required" value={sharePolicy?.approval_required === false ? 'no' : 'yes'} />
                <ProofFact label="External performed by TRAIBOX" value={asRecord(sharePolicy?.human_control)?.external_action_performed_by_traibox === true ? 'yes' : 'no'} />
              </div>
              <div className="rounded-xl bg-surface2/60 px-3 py-2 text-xs text-muted">
                <SignalList label="Allowed or requested scopes" items={shareScopes.length ? shareScopes : ['view_proof_summary', 'view_artifact_manifest', 'download_verified_bundle']} />
                {shareControl?.approval_object_id ? <ProofFact label="Approval" value={shortHash(String(shareControl.approval_object_id))} /> : null}
                {shareControl?.recipient ? <ProofFact label="Recipient" value={String(asRecord(shareControl.recipient)?.email ?? asRecord(shareControl.recipient)?.name ?? 'pending')} /> : null}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5 text-muted">Generate a proof bundle before preparing an external share approval request.</p>
          )}
        </div>

        {ledgerArtifacts.length ? (
          <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
            <div className="text-sm font-semibold">Ledger Artifact Hashes</div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {ledgerArtifacts.slice(0, 6).map((artifact) => (
                <div key={`${artifact.path}-${artifact.sha256}`} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2 text-xs">
                  <div className="font-medium">{artifact.path}</div>
                  <div className="mt-1 text-muted">{artifact.mime} · {artifact.bytes ?? 0} bytes</div>
                  <div className="mt-1 break-all font-mono text-[11px] text-muted">{artifact.sha256}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Surface>
  );
}

type QualityArtifactInsight = {
  hasQualityArtifacts: boolean;
  latestExtraction: AlphaObject | null;
  latestDocumentEval: AlphaObject | null;
  latestProofEval: AlphaObject | null;
  latestProof: AlphaObject | null;
  latestReadiness: ReadinessState | null;
  document: {
    classification: string;
    confidence: number | null;
    score: number | null;
    status: string;
    source: string;
    requiredFields: string[];
    extractedFields: string[];
    missingFields: string[];
    recommendations: string[];
    provenanceMethod: string;
    provenanceSource: string;
    fieldProvenance: Array<Record<string, unknown>>;
    traceId: string | null;
  };
  proof: {
    overall: string;
    score: number | null;
    status: string;
    proofReady: boolean | null;
    requiredProof: string[];
    availableProof: string[];
    missingItems: string[];
    riskFindings: string[];
    nextActions: string[];
    artifactCount: number;
    traceId: string | null;
  };
  evidence: {
    manifestSha: string | null;
    root: string | null;
    evidenceRefCount: number;
    evalSuites: string[];
    sources: string[];
    artifactIds: string[];
    replayable: boolean;
  };
};

function QualityArtifactInspector({ insight }: { insight: QualityArtifactInsight }) {
  if (!insight.hasQualityArtifacts) {
    return (
      <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
        <div className="text-sm font-semibold">Quality Artifacts</div>
        <p className="mt-2 text-xs leading-5 text-muted">
          Run document extraction or generate a proof bundle to create persisted document quality, missing-proof, provenance, and eval artifacts.
        </p>
      </div>
    );
  }

  const provenanceLabels = [
    insight.document.provenanceMethod ? `method: ${insight.document.provenanceMethod}` : '',
    insight.document.provenanceSource ? `source: ${insight.document.provenanceSource}` : '',
    insight.document.traceId ? `trace: ${shortHash(insight.document.traceId)}` : ''
  ].filter(Boolean);

  return (
    <div className="rounded-3xl border border-accent/15 bg-[radial-gradient(circle_at_top_right,rgba(17,116,102,0.12),transparent_34%),rgb(var(--surface-1))] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-accent" />
            Quality Artifacts
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
            Inspect the persisted signals behind proof readiness: document quality, missing proof gaps, evidence provenance, eval suites, and replayability.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <IntegrityPill label={insight.latestDocumentEval ? 'document eval persisted' : 'document eval pending'} />
          <IntegrityPill label={insight.latestProofEval ? 'proof eval persisted' : 'proof eval pending'} />
          <IntegrityPill label={insight.evidence.replayable ? 'replayable' : 'replay pending'} />
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-4">
        <AlphaMetric label="Document Quality" value={insight.document.score != null ? formatQualityScore(insight.document.score) : formatConfidence(insight.document.confidence)} tone={qualityTone(insight.document.status)} />
        <AlphaMetric label="Missing Fields" value={String(insight.document.missingFields.length)} tone={insight.document.missingFields.length ? 'blocked' : 'ready'} />
        <AlphaMetric label="Proof Readiness" value={insight.proof.proofReady === true ? 'Ready' : insight.proof.proofReady === false ? 'Gaps' : 'Pending'} tone={insight.proof.proofReady === true ? 'ready' : insight.proof.proofReady === false ? 'blocked' : undefined} />
        <AlphaMetric label="Missing Proof" value={String(insight.proof.missingItems.length)} tone={insight.proof.missingItems.length ? 'blocked' : insight.latestProof ? 'ready' : undefined} />
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        <div className="rounded-2xl border border-border/10 bg-paper/70 p-3">
          <div className="text-sm font-semibold">Document Intelligence</div>
          <div className="mt-3 space-y-2 text-xs text-muted">
            <ProofFact label="Classification" value={insight.document.classification || 'pending'} />
            <ProofFact label="Confidence" value={formatConfidence(insight.document.confidence)} />
            <ProofFact label="Eval status" value={insight.document.status || 'pending'} />
            <SignalList label="Missing fields" items={insight.document.missingFields} />
            <SignalList label="Extracted fields" items={insight.document.extractedFields} />
            <SignalList label="Required fields" items={insight.document.requiredFields} />
            <SignalList label="Recommendations" items={insight.document.recommendations} />
          </div>
        </div>

        <div className="rounded-2xl border border-border/10 bg-paper/70 p-3">
          <div className="text-sm font-semibold">Missing Proof Gaps</div>
          <div className="mt-3 space-y-2 text-xs text-muted">
            <ProofFact label="Overall" value={insight.proof.overall || insight.latestReadiness?.overall || 'pending'} />
            <ProofFact label="Proof score" value={formatQualityScore(insight.proof.score)} />
            <ProofFact label="Readiness" value={insight.latestReadiness ? `${insight.latestReadiness.overall} · ${Math.round(insight.latestReadiness.score)}%` : 'pending'} />
            <SignalList label="Missing proof" items={insight.proof.missingItems} />
            <SignalList label="Required proof" items={insight.proof.requiredProof} />
            <SignalList label="Available proof" items={insight.proof.availableProof} />
            <SignalList label="Risk findings" items={insight.proof.riskFindings} />
            <SignalList label="Next actions" items={insight.proof.nextActions} />
          </div>
        </div>

        <div className="rounded-2xl border border-border/10 bg-paper/70 p-3">
          <div className="text-sm font-semibold">Evidence Provenance</div>
          <div className="mt-3 space-y-2 text-xs text-muted">
            <ProofFact label="Manifest SHA" value={shortHash(insight.evidence.manifestSha ?? '')} />
            <ProofFact label="Root" value={shortHash(insight.evidence.root ?? '')} />
            <ProofFact label="Artifact refs" value={String(insight.proof.artifactCount || insight.evidence.evidenceRefCount)} />
            <SignalList label="Provenance" items={provenanceLabels} />
            <SignalList label="Eval suites" items={insight.evidence.evalSuites} />
            <SignalList label="Sources used" items={insight.evidence.sources} />
            <SignalList label="Artifacts used" items={insight.evidence.artifactIds.map(shortHash)} />
            {insight.document.fieldProvenance.length ? (
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Field provenance</div>
                <div className="mt-1 space-y-1">
                  {insight.document.fieldProvenance.slice(0, 4).map((entry, index) => (
                    <div key={index} className="rounded-xl bg-surface2/60 px-3 py-2">
                      {String(entry.field ?? entry.source ?? `provenance ${index + 1}`)}
                      {entry.evidence_hash ? <span className="ml-2 font-mono text-muted">{shortHash(String(entry.evidence_hash))}</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function QualityArtifactSummaryCard({ insight }: { insight: QualityArtifactInsight }) {
  const source = [insight.document.source, insight.document.provenanceMethod].filter(Boolean).join(' · ');
  return (
    <div className="rounded-xl border border-accent/15 bg-accent/10 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">Document quality and proof readiness</div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {insight.document.missingFields.length || insight.proof.missingItems.length
              ? 'Quality artifacts show the gaps that still need evidence before confident proof sharing.'
              : 'Quality artifacts show extraction, provenance, and proof checks are currently clear.'}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full bg-paper px-2 py-1 text-[10px]', insight.proof.proofReady === false ? 'text-warn' : 'text-success')}>
          {insight.proof.proofReady === false ? 'gaps visible' : 'proof-aware'}
        </span>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <AlphaMetric label="Doc score" value={insight.document.score != null ? formatQualityScore(insight.document.score) : formatConfidence(insight.document.confidence)} tone={qualityTone(insight.document.status)} />
        <AlphaMetric label="Doc gaps" value={String(insight.document.missingFields.length)} tone={insight.document.missingFields.length ? 'blocked' : 'ready'} />
        <AlphaMetric label="Proof gaps" value={String(insight.proof.missingItems.length)} tone={insight.proof.missingItems.length ? 'blocked' : insight.latestProof ? 'ready' : undefined} />
      </div>
      <div className="mt-3 space-y-2">
        <SignalList label="Document gaps" items={insight.document.missingFields} />
        <SignalList label="Proof gaps" items={insight.proof.missingItems} />
        <SignalList label="Evidence provenance" items={[source, ...insight.evidence.evalSuites].filter(Boolean)} />
      </div>
    </div>
  );
}

function ProofFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-surface2/60 px-3 py-2">
      <span>{label}</span>
      <span className="max-w-[58%] truncate font-mono text-ink">{value || '—'}</span>
    </div>
  );
}

function shortHash(value: string) {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function buildQualityArtifactInsight(objects: AlphaObject[], readinessStates: ReadinessState[]): QualityArtifactInsight {
  const latestExtraction = latestAlphaObject(objects.filter((object) => object.type === 'extraction_result'));
  const latestProof = latestAlphaObject(objects.filter((object) => object.type === 'proof_bundle'));
  const latestDocumentEval = latestAlphaObject(objects.filter((object) => object.type === 'ai_eval_result' && object.payload_json?.suite === 'document-intelligence-alpha-v1'));
  const latestProofEval = latestAlphaObject(objects.filter((object) => object.type === 'ai_eval_result' && object.payload_json?.suite === 'proof-quality-alpha-v1'));
  const latestReadiness = readinessStates[0] ?? null;

  const extractionPayload = latestExtraction?.payload_json ?? {};
  const extractionProvenance = asRecord(extractionPayload.provenance) ?? {};
  const extractionQuality = asRecord(extractionPayload.quality_signals) ?? {};
  const documentEvalPayload = latestDocumentEval?.payload_json ?? {};
  const documentEvalQuality = asRecord(documentEvalPayload.quality_signals) ?? {};
  const documentContext = asRecord(documentEvalPayload.context_used) ?? {};
  const documentQuality = { ...extractionQuality, ...documentEvalQuality };

  const proofPayload = latestProof?.payload_json ?? {};
  const proofDetection = asRecord(proofPayload.missing_proof_detection) ?? {};
  const proofPayloadQuality = asRecord(proofPayload.proof_quality_signals) ?? {};
  const proofDetectionQuality = asRecord(proofDetection.qualitySignals) ?? asRecord(proofDetection.quality_signals) ?? {};
  const proofEvalPayload = latestProofEval?.payload_json ?? {};
  const proofEvalQuality = asRecord(proofEvalPayload.quality_signals) ?? {};
  const proofContext = asRecord(proofEvalPayload.context_used) ?? {};
  const proofQuality = { ...proofPayloadQuality, ...proofDetectionQuality, ...proofEvalQuality };
  const manifest = asRecord(proofPayload.manifest) ?? {};
  const manifestArtifacts = asRecordArray(manifest.artifacts);
  const missingProofItems = firstStringArray(proofDetection.missingItems, proofDetection.missing_items, proofContext.missing_items);
  const proofReady = asBoolean(proofQuality.proof_ready) ?? (latestProof ? missingProofItems.length === 0 : null);
  const evidenceRefCount = latestProof?.evidence_refs_json?.length ?? 0;
  const explicitArtifactCount = asFiniteNumber(proofQuality.artifact_count);
  const artifactCount = explicitArtifactCount ?? (manifestArtifacts.length || evidenceRefCount);
  const evalSuites = uniqueStrings([
    stringOrNull(documentEvalPayload.suite),
    stringOrNull(proofEvalPayload.suite)
  ]);
  const sources = uniqueStrings([
    ...asRecordArray(documentEvalPayload.sources_used).map(sourceLabel),
    ...asRecordArray(proofEvalPayload.sources_used).map(sourceLabel)
  ]);
  const artifactIds = uniqueStrings([
    ...asStringArray(documentEvalPayload.artifacts_used),
    ...asStringArray(proofEvalPayload.artifacts_used)
  ]);

  return {
    hasQualityArtifacts: Boolean(latestExtraction || latestDocumentEval || latestProofEval || latestProof),
    latestExtraction,
    latestDocumentEval,
    latestProofEval,
    latestProof,
    latestReadiness,
    document: {
      classification: String(extractionPayload.classification ?? documentContext.classification ?? documentQuality.document_type ?? ''),
      confidence: asFiniteNumber(extractionPayload.confidence ?? documentEvalPayload.confidence),
      score: asFiniteNumber(documentEvalPayload.score),
      status: String(documentEvalPayload.status ?? latestDocumentEval?.status ?? latestExtraction?.status ?? ''),
      source: String(documentQuality.workflow_quality_source ?? documentContext.workflow_quality_source ?? ''),
      requiredFields: firstStringArray(extractionPayload.required_fields, documentContext.required_fields),
      extractedFields: Object.keys(asRecord(extractionPayload.extracted_fields) ?? {}),
      missingFields: firstStringArray(extractionPayload.missing_fields, documentContext.missing_fields),
      recommendations: asStringArray(extractionPayload.recommendations),
      provenanceMethod: String(extractionProvenance.method ?? ''),
      provenanceSource: String(extractionProvenance.source ?? ''),
      fieldProvenance: asRecordArray(extractionProvenance.field_provenance),
      traceId: latestExtraction?.trace_id ?? latestDocumentEval?.trace_id ?? null
    },
    proof: {
      overall: String(proofDetection.overall ?? proofContext.overall ?? ''),
      score: asFiniteNumber(proofDetection.score ?? proofEvalPayload.score),
      status: String(proofEvalPayload.status ?? latestProofEval?.status ?? latestProof?.status ?? ''),
      proofReady,
      requiredProof: firstStringArray(proofDetection.requiredProof, proofDetection.required_proof, proofContext.required_proof),
      availableProof: firstStringArray(proofDetection.availableProof, proofDetection.available_proof, proofContext.available_proof),
      missingItems: missingProofItems,
      riskFindings: firstStringArray(proofDetection.riskFindings, proofDetection.risk_findings),
      nextActions: firstStringArray(proofDetection.nextActions, proofDetection.next_actions),
      artifactCount,
      traceId: latestProof?.trace_id ?? latestProofEval?.trace_id ?? null
    },
    evidence: {
      manifestSha: stringOrNull(proofPayload.manifest_sha256),
      root: stringOrNull(proofPayload.root),
      evidenceRefCount,
      evalSuites,
      sources,
      artifactIds,
      replayable: asBoolean(documentEvalPayload.replayable) === true || asBoolean(proofEvalPayload.replayable) === true
    }
  };
}

function AlphaTradeRoomPanel({
  objects,
  standaloneCandidates,
  readinessStates,
  memoryEvents,
  replaySteps,
  replayHash,
  replayGaps,
  composer,
  answer,
  loading,
  error,
  onComposerChange,
  onRefresh,
  onRunCopilot,
  onStartReadinessLoop,
  onUploadDocument,
  onGenerateDocumentPack,
  onContinueReferenceStory,
  onAttachPayment,
  onAttachCandidate,
  onLaunchAgent,
  onRequestApproval,
  onDecideApproval,
  onCompleteTask,
  onUpdateExecutionTask,
  onCreateExternalAccess,
  onCreateDocumentRequest,
  onSubmitDocumentRequest,
  onGenerateProof,
  disabled
}: {
  objects: AlphaObject[];
  standaloneCandidates: AlphaObject[];
  readinessStates: ReadinessState[];
  memoryEvents: AlphaMemoryEvent[];
  replaySteps: ReplayStep[];
  replayHash: string | null;
  replayGaps: string[];
  composer: string;
  answer: string | null;
  loading: 'refresh' | 'ai' | 'document' | 'upload' | 'doc_pack' | 'payment' | 'attach_candidate' | 'proof' | 'approval' | 'decision' | 'agent' | 'task' | 'access' | 'doc_request' | 'doc_submit' | null;
  error: string | null;
  onComposerChange: (value: string) => void;
  onRefresh: () => void;
  onRunCopilot: () => void;
  onStartReadinessLoop: () => void;
  onUploadDocument: (file: File) => void;
  onGenerateDocumentPack: () => void;
  onContinueReferenceStory: () => void;
  onAttachPayment: () => void;
  onAttachCandidate: (candidateId: string, mode: 'attach' | 'link' | 'convert') => void;
  onLaunchAgent: () => void;
  onRequestApproval: () => void;
  onDecideApproval: (
    decision: 'approved' | 'rejected',
    input: ProtectedActionDecisionInput
  ) => void;
  onCompleteTask: () => void;
  onUpdateExecutionTask: (taskId: string, body: ExecutionTaskStatusRequest) => void;
  onCreateExternalAccess: () => void;
  onCreateDocumentRequest: () => void;
  onSubmitDocumentRequest: () => void;
  onGenerateProof: () => void;
  disabled?: boolean;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const readinessObjects = objects.filter((object) => object.type === 'readiness_state');
  const latestReadiness = readinessStates[0] ?? (readinessObjects[0]?.payload_json as ReadinessState | undefined);
  const proof = objects.find((object) => object.type === 'proof_bundle');
  const approvals = objects.filter((object) => object.type === 'approval');
  const pendingApproval = approvals.find((object) => object.status === 'approval_required');
  const activeTask = objects.find((object) => object.type === 'execution_task' && ['in_progress', 'ready_for_review'].includes(object.status));
  const accessGrants = objects.filter((object) => object.type === 'external_access_grant');
  const documentRequests = objects.filter((object) => object.type === 'document_request');
  const pendingDocumentRequest = documentRequests.find((object) => ['pending_input', 'in_progress'].includes(object.status));
  const tradeRoom = objects.find((object) => object.type === 'trade_room');
  const documentObjects = objects.filter((object) => ['document', 'extraction_result'].includes(object.type));
  const partyObjects = objects.filter((object) => ['counterparty', 'screening_result', 'onboarding_flow', 'trade_passport'].includes(object.type));
  const financeObjects = objects.filter((object) => ['payment_intent', 'payment_route', 'funding_request', 'funding_offer', 'trade_finance_instrument'].includes(object.type));
  const clearanceObjects = objects.filter((object) => ['clearance_check', 'report', 'risk_finding'].includes(object.type));
  const executionObjects = objects.filter((object) =>
    ['execution_task', 'payment_intent', 'funding_request', 'funding_offer', 'clearance_check', 'screening_result', 'onboarding_flow', 'agent_work_result'].includes(object.type)
  );
  const workflowRuns = objects.filter((object) => object.type === 'workflow_run');
  const evidenceObjects = objects.filter((object) => ['document_request', 'document', 'extraction_result', 'document_pack', 'report', 'proof_bundle'].includes(object.type));
  const qualityInsight = buildQualityArtifactInsight(objects, readinessStates);
  const attachedObjects = objects.filter((object) => object.status === 'attached' || Boolean(object.payload_json?.attached_to));
  const missingItems = asStringArray(latestReadiness?.missing_items);
  const risks = asStringArray(latestReadiness?.risk_findings);
  const nextActions = asStringArray(latestReadiness?.next_actions);
  const storySteps = buildReferenceStoryProgress(objects, readinessStates, memoryEvents);
  const nextStoryStep = storySteps.find((step) => step.state !== 'done');
  const nextBestAction = nextStoryStep?.summary ?? nextActions[0] ?? 'Run the guided reference story to surface the next execution step.';
  const timelineObjects = [...objects].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 8);

  return (
    <Surface className="overflow-hidden border-accent/20 bg-[radial-gradient(circle_at_top_right,rgba(17,116,102,0.14),transparent_32%),rgb(var(--surface-1))]">
      <div className="border-b border-border/10 px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-xl bg-accent/10 p-2 text-accent">
              <BrainCircuit className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold leading-tight">Trade Room Reference Loop</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                The alpha spine in one place: readiness, execution objects, proof, attachments, and Trade Memory.
              </p>
            </div>
          </div>
          <Button variant="secondary" size="sm" disabled={disabled || loading === 'refresh'} onClick={onRefresh}>
            {loading === 'refresh' ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          <AlphaMetric label="Readiness" value={latestReadiness ? `${latestReadiness.overall} · ${Math.round(latestReadiness.score)}%` : 'No state'} tone={latestReadiness?.overall} />
          <AlphaMetric label="Objects" value={String(objects.length)} />
          <AlphaMetric label="Attached" value={String(attachedObjects.length)} />
          <AlphaMetric label="Proof" value={proof ? 'Ready' : 'Not yet'} tone={proof ? 'ready' : 'blocked'} />
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          <CockpitCard
            icon={<ClipboardCheck className="h-4 w-4" />}
            label="Next Best Action"
            value={nextStoryStep ? nextStoryStep.title : 'Reference loop complete'}
            summary={nextBestAction}
          />
          <CockpitCard
            icon={<Building2 className="h-4 w-4" />}
            label="Parties"
            value={String(partyObjects.length)}
            summary={partyObjects[0]?.summary ?? 'Counterparty, passport, and screening context can link into this room.'}
          />
          <CockpitCard
            icon={<Route className="h-4 w-4" />}
            label="Execution Mechanics"
            value={String(financeObjects.length + clearanceObjects.length)}
            summary="Finance, payment, funding, clearance, and report mechanics stay structured."
          />
          <CockpitCard
            icon={<Layers3 className="h-4 w-4" />}
            label="Workflow Runs"
            value={String(workflowRuns.length)}
            summary={workflowRuns[0]?.summary ?? 'Durable workflow state appears here before Temporal takes over orchestration.'}
          />
          <CockpitCard
            icon={<Layers3 className="h-4 w-4" />}
            label="Context Preservation"
            value={attachedObjects.length ? 'Active' : 'Waiting'}
            summary={attachedObjects.length ? 'Attached work carries audit, memory, evidence, and proof context.' : 'Attach or convert a standalone object to prove composability.'}
          />
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {error ? <div className="rounded-xl border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">{error}</div> : null}

        <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-sm font-semibold">Guided Reference Story</div>
              <p className="mt-1 text-xs leading-5 text-muted">
                {nextStoryStep
                  ? `Next: ${nextStoryStep.title}. TRAIBOX advances the loop until it reaches a protected human approval gate.`
                  : 'The reference loop is complete for this Trade Room.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" disabled={disabled || loading === 'document'} onClick={onStartReadinessLoop}>
                {loading === 'document' ? 'Extracting…' : 'Start readiness loop'}
              </Button>
              <Button size="sm" disabled={disabled || Boolean(loading)} onClick={onContinueReferenceStory}>
                Continue story
              </Button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {storySteps.map((step) => (
              <div
                key={step.key}
                className={cn(
                  'rounded-xl border px-3 py-2',
                  step.state === 'done' ? 'border-success/20 bg-success/10' : step.state === 'attention' ? 'border-warn/20 bg-warn/10' : 'border-border/10 bg-surface2/50'
                )}
              >
                <div className="flex items-center gap-2">
                  {step.state === 'done' ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className={cn('h-4 w-4', step.state === 'attention' ? 'text-warn' : 'text-muted')} />}
                  <div className="text-sm font-medium">{step.title}</div>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{step.summary}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-accent" />
            Trade Intelligence
          </div>
          <textarea
            value={composer}
            onChange={(event) => onComposerChange(event.target.value)}
            className="min-h-[96px] w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm leading-6"
            placeholder="Ask TRAIBOX to inspect readiness, prepare an execution step, or explain the proof trail…"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={disabled || loading === 'ai'} onClick={onRunCopilot}>
              {loading === 'ai' ? 'Thinking…' : 'Run Trade Brain'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'document'} onClick={onStartReadinessLoop}>
              {loading === 'document' ? 'Extracting…' : 'Upload reference document'}
            </Button>
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.csv,.json,.xml,.pdf,text/*,application/json,application/pdf"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (file) onUploadDocument(file);
              }}
            />
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'upload'} onClick={() => uploadInputRef.current?.click()}>
              {loading === 'upload' ? 'Storing…' : 'Upload stored file'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'doc_pack' || documentObjects.length === 0} onClick={onGenerateDocumentPack}>
              {loading === 'doc_pack' ? 'Packing…' : 'Generate document pack'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'payment'} onClick={onAttachPayment}>
              <GitMerge className="h-4 w-4" />
              {loading === 'payment' ? 'Attaching…' : 'Attach standalone payment'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'agent'} onClick={onLaunchAgent}>
              {loading === 'agent' ? 'Preparing…' : 'Launch scoped agent'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'approval'} onClick={onRequestApproval}>
              {loading === 'approval' ? 'Requesting…' : 'Request approval'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'task' || !activeTask} onClick={onCompleteTask}>
              {loading === 'task' ? 'Updating…' : 'Complete task'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'access'} onClick={onCreateExternalAccess}>
              {loading === 'access' ? 'Granting…' : 'Grant scoped access'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'doc_request'} onClick={onCreateDocumentRequest}>
              {loading === 'doc_request' ? 'Requesting…' : 'Request document'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'doc_submit' || !pendingDocumentRequest} onClick={onSubmitDocumentRequest}>
              {loading === 'doc_submit' ? 'Submitting…' : 'Submit response'}
            </Button>
            <Button variant="secondary" size="sm" disabled={disabled || loading === 'proof' || objects.length === 0} onClick={onGenerateProof}>
              {loading === 'proof' ? 'Generating…' : 'Generate proof bundle'}
            </Button>
          </div>
          {answer ? <p className="mt-3 rounded-xl bg-accent/10 px-3 py-2 text-xs leading-5 text-ink">{answer}</p> : null}
        </div>

        {pendingApproval ? (
          <ProtectedActionApprovalCard
            approval={pendingApproval}
            loading={loading === 'decision' || disabled}
            onDecide={onDecideApproval}
          />
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <AlphaSection title="Trade Context" empty="No canonical Trade Room object yet.">
            {tradeRoom ? (
              <>
                <AlphaObjectRow object={tradeRoom} />
                <TradeContextFacts object={tradeRoom} />
              </>
            ) : null}
            {partyObjects.slice(0, 3).map((object) => (
              <AlphaObjectRow key={object.object_id} object={object} />
            ))}
          </AlphaSection>

          <AlphaSection title="Readiness" empty="No readiness state yet. Run the alpha story or ask Trade Brain for an evaluation.">
            {latestReadiness ? (
              <>
                <div className="flex items-center justify-between rounded-xl bg-surface2/60 px-3 py-2 text-sm">
                  <span className="text-muted">Overall</span>
                  <span className="font-medium">{latestReadiness.overall}</span>
                </div>
                <SignalList label="Missing" items={missingItems} />
                <SignalList label="Risks" items={risks} />
                <SignalList label="Next actions" items={nextActions} />
              </>
            ) : null}
          </AlphaSection>

          <AlphaSection title="Readiness Matrix" empty="Run readiness to populate dimensions.">
            {latestReadiness?.dimensions?.slice(0, 6).map((dimension) => (
              <div key={dimension.key} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{dimension.label}</div>
                  <span className={cn('rounded-full bg-paper px-2 py-1 text-[10px]', dimension.status === 'ready' || dimension.status === 'approved' ? 'text-success' : dimension.status === 'blocked' || dimension.status === 'risky' ? 'text-warn' : 'text-muted')}>
                    {dimension.status} · {Math.round(dimension.score)}%
                  </span>
                </div>
                {dimension.reasons?.[0] ? <p className="mt-1 text-xs leading-5 text-muted">{dimension.reasons[0]}</p> : null}
              </div>
            ))}
          </AlphaSection>

          <AlphaSection title="Governed Execution" empty="No execution objects yet. Attach a standalone payment to prove composability.">
            {executionObjects.slice(0, 5).map((object) => (
              object.type === 'execution_task' ? (
                <ControlledExecutionTaskCard
                  key={object.object_id}
                  task={object}
                  compact
                  loading={loading === 'task'}
                  onUpdate={onUpdateExecutionTask}
                />
              ) : (
                <AlphaObjectRow key={object.object_id} object={object} />
              )
            ))}
            {approvals.slice(0, 2).map((object) => (
              <AlphaObjectRow key={object.object_id} object={object} />
            ))}
          </AlphaSection>

          <AlphaSection title="Finance And Clearance Mechanics" empty="No payment, funding, clearance, or report mechanics yet.">
            {[...financeObjects, ...clearanceObjects].slice(0, 6).map((object) => (
              <AlphaObjectRow key={object.object_id} object={object} />
            ))}
          </AlphaSection>

          <AlphaSection title="Evidence And Proof" empty="No evidence or proof objects yet.">
            {evidenceObjects.slice(0, 6).map((object) => (
              <AlphaObjectRow key={object.object_id} object={object} />
            ))}
          </AlphaSection>

          <AlphaSection title="Quality Artifacts" empty="No document quality, missing-proof, or provenance artifacts yet.">
            {qualityInsight.hasQualityArtifacts ? <QualityArtifactSummaryCard insight={qualityInsight} /> : null}
          </AlphaSection>

          <AlphaSection title="Document Requests" empty="No missing-evidence requests yet.">
            {documentRequests.slice(0, 4).map((object) => (
              <AlphaObjectRow key={object.object_id} object={object} />
            ))}
          </AlphaSection>

          <AlphaSection title="Attachable Standalone Jobs" empty="No unattached standalone jobs are waiting. Create one from Finance, Clearance, or Network.">
            {standaloneCandidates.slice(0, 6).map((candidate) => (
              <StandaloneCandidateRow
                key={candidate.object_id}
                object={candidate}
                loading={loading === 'attach_candidate'}
                onAttach={(mode) => onAttachCandidate(candidate.object_id, mode)}
              />
            ))}
          </AlphaSection>

          <AlphaSection title="Composable Integrity" empty="No standalone workflow has been attached, linked, or converted yet.">
            {attachedObjects.slice(0, 5).map((object) => (
              <div key={object.object_id} className="rounded-xl border border-success/20 bg-success/10 px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{object.title}</div>
                    <div className="mt-1 text-xs text-muted">{object.type.replaceAll('_', ' ')} · {attachmentModeLabel(object)}</div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-success" />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <IntegrityPill label="Permission scoped" />
                  <IntegrityPill label="Audit retained" />
                  <IntegrityPill label="Memory retained" />
                  <IntegrityPill label="Proof-ready" />
                </div>
              </div>
            ))}
          </AlphaSection>

          <AlphaSection title="Trade Memory" empty="No L1 memory events yet.">
            {memoryEvents.slice(0, 6).map((event) => (
              <div key={event.memory_event_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{event.signal}</div>
                  <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{event.level}</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {event.kind} · {formatShortDate(event.created_at)}
                </div>
              </div>
            ))}
          </AlphaSection>

          <AlphaSection title="Workflow Runs" empty="No workflow runs yet. Approvals, execution, attachments, and proof generation will create durable run state.">
            {workflowRuns.slice(0, 6).map((object) => (
              <WorkflowRunRow key={object.object_id} object={object} />
            ))}
          </AlphaSection>

          <AlphaSection title="Deterministic Replay" empty="No replay steps yet. Material actions will appear here with a stable replay hash.">
            {replayHash ? (
              <div className="rounded-xl border border-accent/20 bg-accent/10 px-3 py-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted">Replay hash</div>
                <div className="mt-1 break-all text-xs font-medium">{replayHash}</div>
              </div>
            ) : null}
            {replayGaps.length ? <SignalList label="Replay gaps" items={replayGaps} /> : null}
            {replaySteps.slice(-6).reverse().map((step) => (
              <ReplayStepRow key={step.step_id} step={step} />
            ))}
          </AlphaSection>

          <AlphaSection title="External Access" empty="No scoped external participant access yet.">
            {accessGrants.slice(0, 4).map((object) => (
              <AlphaObjectRow key={object.object_id} object={object} />
            ))}
          </AlphaSection>

          <AlphaSection title="Execution Timeline" empty="No material actions recorded yet.">
            {timelineObjects.map((object) => (
              <div key={object.object_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{object.type.replaceAll('_', ' ')}</div>
                  <span className="text-[10px] text-muted">{formatShortDate(object.updated_at)}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{object.title} · {object.status}</p>
              </div>
            ))}
          </AlphaSection>
        </div>
      </div>
    </Surface>
  );
}

type ReferenceStoryStep = {
  key: string;
  title: string;
  state: 'done' | 'attention' | 'waiting';
  summary: string;
};

function buildReferenceStoryProgress(objects: AlphaObject[], readinessStates: ReadinessState[], memoryEvents: AlphaMemoryEvent[]): ReferenceStoryStep[] {
  const latestReadiness = readinessStates[0];
  const hasObject = (type: string) => objects.some((object) => object.type === type);
  const hasAnyObject = (types: string[]) => objects.some((object) => types.includes(object.type));
  const pendingApproval = objects.some((object) => object.type === 'approval' && object.status === 'approval_required');
  const decidedApproval = objects.some((object) => object.type === 'approval' && ['approved', 'rejected'].includes(object.status));
  const attached = objects.some((object) => object.status === 'attached' || Boolean(object.payload_json?.attached_to));
  const hasMemory = memoryEvents.length > 0;
  const missingItems = asStringArray(latestReadiness?.missing_items);

  return [
    {
      key: 'trade_room',
      title: 'Trade Room context',
      state: hasObject('trade_room') ? 'done' : 'waiting',
      summary: hasObject('trade_room') ? 'Canonical Trade Room object exists for this transaction.' : 'Create the Trade Room context before attaching execution work.'
    },
    {
      key: 'document_upload',
      title: 'Document upload',
      state: hasObject('document') ? 'done' : 'waiting',
      summary: hasObject('document') ? 'Evidence has entered the room.' : 'Upload or synthesize a reference document for extraction.'
    },
    {
      key: 'data_extraction',
      title: 'Extraction and provenance',
      state: hasObject('extraction_result') ? 'done' : 'waiting',
      summary: hasObject('extraction_result') ? 'Structured fields and provenance are available.' : 'TRAIBOX still needs extracted trade facts.'
    },
    {
      key: 'gap_detection',
      title: 'Gap and risk detection',
      state: latestReadiness ? (missingItems.length ? 'attention' : 'done') : 'waiting',
      summary: latestReadiness
        ? missingItems.length
          ? `${missingItems.length} readiness gap(s) need attention.`
          : 'No missing proof was detected in the latest readiness pass.'
        : 'Run readiness to expose missing proof and risks.'
    },
    {
      key: 'readiness_state',
      title: 'Readiness state',
      state: latestReadiness ? 'done' : 'waiting',
      summary: latestReadiness ? `${latestReadiness.overall} at ${Math.round(latestReadiness.score)}%.` : 'No readiness state has been produced yet.'
    },
    {
      key: 'clearance_check',
      title: 'Clearance or counterparty check',
      state: hasAnyObject(['clearance_check', 'screening_result', 'counterparty']) ? 'done' : 'waiting',
      summary: hasAnyObject(['clearance_check', 'screening_result', 'counterparty'])
        ? 'Risk context is attached to the transaction.'
        : 'Add clearance or counterparty context before execution.'
    },
    {
      key: 'execution_object',
      title: 'Execution object',
      state: hasAnyObject(['payment_intent', 'funding_request']) ? 'done' : 'waiting',
      summary: hasAnyObject(['payment_intent', 'funding_request'])
        ? 'A payment or funding workflow exists.'
        : 'Attach a standalone payment or funding request.'
    },
    {
      key: 'agent_recommendation',
      title: 'Scoped agent recommendation',
      state: hasObject('agent_work_result') ? 'done' : 'waiting',
      summary: hasObject('agent_work_result') ? 'A governed agent produced replayable work.' : 'Launch a scoped agent before protected execution.'
    },
    {
      key: 'human_approval',
      title: 'Human approval gate',
      state: pendingApproval ? 'attention' : decidedApproval ? 'done' : 'waiting',
      summary: pendingApproval
        ? 'Approval is waiting for step-up and residual-risk acknowledgement.'
        : decidedApproval
          ? 'Human decision is captured in audit and memory.'
          : 'Protected execution still needs an approval request.'
    },
    {
      key: 'proof_bundle',
      title: 'Proof bundle',
      state: hasObject('proof_bundle') ? 'done' : 'waiting',
      summary: hasObject('proof_bundle') ? 'A proof bundle is ready.' : 'Generate proof from the trade artifacts.'
    },
    {
      key: 'operations_memory',
      title: 'Operations and memory',
      state: hasMemory ? 'done' : 'waiting',
      summary: hasMemory ? 'Trade Memory is recording material activity.' : 'Material actions will appear in memory and Operations.'
    },
    {
      key: 'attachment',
      title: 'Attachment integrity',
      state: attached ? 'done' : 'waiting',
      summary: attached ? 'Standalone work is attached without losing context.' : 'Attach standalone work into the Trade Room.'
    }
  ];
}

function AlphaMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-paper/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={cn('mt-1 text-sm font-semibold', tone === 'blocked' || tone === 'risky' ? 'text-warn' : tone === 'ready' ? 'text-success' : 'text-ink')}>
        {value}
      </div>
    </div>
  );
}

function CockpitCard({ icon, label, value, summary }: { icon: ReactNode; label: string; value: string; summary: string }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-paper/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-accent">{icon}</div>
        <AlertTriangle className="h-4 w-4 text-muted" />
      </div>
      <div className="mt-3 text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
      <p className="mt-2 text-xs leading-5 text-muted">{summary}</p>
    </div>
  );
}

function AlphaSection({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  return (
    <div className="rounded-2xl border border-border/10 bg-paper/50 p-3">
      <div className="mb-3 text-sm font-semibold">{title}</div>
      <div className="space-y-2">{hasChildren ? children : <p className="text-xs leading-5 text-muted">{empty}</p>}</div>
    </div>
  );
}

function TradeContextFacts({ object }: { object: AlphaObject }) {
  const payload = object.payload_json ?? {};
  const candidateFacts: Array<[string, unknown]> = [
    ['Usage mode', payload.usage_mode],
    ['Corridor', payload.corridor],
    ['Amount', payload.amount],
    ['Currency', payload.currency]
  ];
  const facts = candidateFacts.filter(([, value]) => value !== undefined && value !== null && value !== '');

  if (!facts.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
          <div className="mt-1 truncate text-sm font-medium">{String(value)}</div>
        </div>
      ))}
    </div>
  );
}

function AlphaObjectRow({ object }: { object: AlphaObject }) {
  return (
    <div className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{object.title}</div>
          <div className="mt-1 text-xs text-muted">
            {object.type.replaceAll('_', ' ')} · {object.origin_workspace}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{object.status}</span>
      </div>
      {object.summary ? <p className="mt-2 text-xs leading-5 text-muted">{object.summary}</p> : null}
    </div>
  );
}

function StandaloneCandidateRow({
  object,
  loading,
  onAttach
}: {
  object: AlphaObject;
  loading: boolean;
  onAttach: (mode: 'attach' | 'link' | 'convert') => void;
}) {
  const recommendedMode = recommendedComposeMode(object);
  return (
    <div className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium">{object.title}</div>
            <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{object.type.replaceAll('_', ' ')}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {object.summary ?? 'Standalone workflow can become broader trade context without losing its audit, memory, evidence, or replay trail.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <IntegrityPill label={`Recommended: ${recommendedMode}`} />
            <IntegrityPill label="permission-aware" />
            <IntegrityPill label="audit + memory kept" />
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {(['attach', 'link', 'convert'] as const).map((mode) => (
            <Button
              key={mode}
              size="sm"
              variant={mode === recommendedMode ? 'secondary' : 'ghost'}
              disabled={loading}
              onClick={() => onAttach(mode)}
            >
              {loading ? 'Composing…' : composeModeLabel(mode)}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReplayStepRow({ step }: { step: ReplayStep }) {
  return (
    <div className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{step.title}</div>
          <div className="mt-1 text-xs text-muted">
            {step.source} · {step.kind} · {formatShortDate(step.occurred_at)}
          </div>
        </div>
        {step.status ? <span className="shrink-0 rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{step.status}</span> : null}
      </div>
      {step.summary ? <p className="mt-2 text-xs leading-5 text-muted">{step.summary}</p> : null}
      {step.hash ? <div className="mt-2 break-all text-[10px] text-muted">hash {step.hash}</div> : null}
    </div>
  );
}

function WorkflowRunRow({ object }: { object: AlphaObject }) {
  const workflowState = object.payload_json?.workflow_state && typeof object.payload_json.workflow_state === 'object' ? (object.payload_json.workflow_state as Record<string, unknown>) : {};
  const workflowWorker = object.payload_json?.workflow_worker && typeof object.payload_json.workflow_worker === 'object' ? (object.payload_json.workflow_worker as Record<string, unknown>) : {};
  const workflowRuntime = object.payload_json?.workflow_runtime && typeof object.payload_json.workflow_runtime === 'object' ? (object.payload_json.workflow_runtime as Record<string, unknown>) : {};
  const lifecycle = Array.isArray(object.payload_json?.workflow_lifecycle) ? object.payload_json.workflow_lifecycle : [];
  const monitorPhase = String(workflowState.monitor_phase ?? workflowState.stage ?? object.status);
  const runtimeCommand = String(workflowRuntime.command ?? workflowState.runtime_command ?? 'observe');
  const awaitingSignal = typeof workflowRuntime.awaiting_signal === 'string' ? workflowRuntime.awaiting_signal : typeof workflowState.awaiting_signal === 'string' ? workflowState.awaiting_signal : null;
  const resumeToken = typeof workflowRuntime.resume_token === 'string' ? workflowRuntime.resume_token : typeof workflowState.resume_token === 'string' ? workflowState.resume_token : null;
  const workflowId = typeof workflowRuntime.workflow_id === 'string' ? workflowRuntime.workflow_id : typeof workflowState.workflow_id === 'string' ? workflowState.workflow_id : null;
  const workerSummary = typeof workflowWorker.summary === 'string' ? workflowWorker.summary : null;
  const recoveryHint = typeof workflowWorker.recovery_hint === 'string' ? workflowWorker.recovery_hint : null;
  const attentionRequired = object.status === 'blocked' || workflowWorker.last_attention_required === true || workflowWorker.stale === true;
  const lastChecked = typeof workflowWorker.last_checked_at === 'string' ? workflowWorker.last_checked_at : null;
  return (
    <div className={cn('rounded-xl border px-3 py-2', attentionRequired ? 'border-warn/25 bg-warn/10' : 'border-border/10 bg-surface2/50')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{object.title}</div>
          <div className="mt-1 text-xs text-muted">
            {String(object.payload_json?.workflow_kind ?? 'workflow')} · {monitorPhase}
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{object.status}</span>
      </div>
      {workerSummary ? <p className="mt-2 text-xs leading-5 text-muted">{workerSummary}</p> : null}
      {recoveryHint && attentionRequired ? <p className="mt-1 text-xs leading-5 text-warn">{recoveryHint}</p> : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <IntegrityPill label="resumable" />
        <IntegrityPill label="replayable" />
        <IntegrityPill label={String(workflowState.temporal_workflow_type ?? 'Temporal-ready')} />
        <IntegrityPill label={String(workflowState.runtime_adapter ?? 'api workflow-run')} />
        <IntegrityPill label={`runtime ${runtimeCommand.replaceAll('_', ' ')}`} />
        {awaitingSignal ? <IntegrityPill label={`awaits ${awaitingSignal.replaceAll('_', ' ')}`} /> : null}
        {workflowId ? <IntegrityPill label={`id ${shortHash(workflowId)}`} /> : null}
        {resumeToken ? <IntegrityPill label={`resume ${shortHash(resumeToken)}`} /> : null}
        {lastChecked ? <IntegrityPill label={`checked ${formatShortDate(lastChecked)}`} /> : null}
        {workflowWorker.stale === true ? <IntegrityPill label="recovery attention" /> : null}
        <IntegrityPill label={`${lifecycle.length} step(s)`} />
      </div>
    </div>
  );
}

function IntegrityPill({ label }: { label: string }) {
  return <span className="rounded-full border border-border/10 bg-paper px-2 py-1 text-[10px] text-muted">{label}</span>;
}

function attachmentModeLabel(object: AlphaObject) {
  if (typeof object.payload_json?.attach_mode === 'string') return object.payload_json.attach_mode;
  return object.status === 'attached' ? 'attached' : 'linked';
}

function isComposableCandidate(object: AlphaObject) {
  const composableTypes = [
    'payment_intent',
    'payment_route',
    'funding_request',
    'funding_offer',
    'trade_finance_instrument',
    'clearance_check',
    'trade_passport',
    'counterparty',
    'screening_result',
    'onboarding_flow',
    'matchmaking_result',
    'document',
    'extraction_result',
    'document_pack',
    'report',
    'proof_bundle'
  ];
  return !object.trade_id && composableTypes.includes(object.type) && !['cancelled', 'archived', 'rejected'].includes(object.status);
}

function recommendedComposeMode(object: AlphaObject): 'attach' | 'link' | 'convert' {
  if (['counterparty', 'screening_result', 'trade_passport', 'matchmaking_result'].includes(object.type)) return 'link';
  if (['document', 'extraction_result', 'document_pack', 'report'].includes(object.type)) return 'convert';
  return 'attach';
}

function composeModeLabel(mode: 'attach' | 'link' | 'convert') {
  if (mode === 'link') return 'Link';
  if (mode === 'convert') return 'Convert';
  return 'Attach';
}

function SignalList({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {items.slice(0, 5).map((item) => (
          <span key={item} className="rounded-full border border-border/10 bg-surface2 px-2 py-1 text-[11px] text-muted">
            {item.replaceAll('_', ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}

function latestAlphaObject(objects: AlphaObject[]) {
  return [...objects].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(asRecord(item))) : [];
}

function asFiniteNumber(value: unknown): number | null {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function firstStringArray(...values: unknown[]) {
  for (const value of values) {
    const items = asStringArray(value);
    if (items.length) return items;
  }
  return [];
}

function sourceLabel(source: Record<string, unknown>) {
  const kind = String(source.kind ?? source.field ?? source.source ?? source.method ?? 'source');
  const hash = stringOrNull(source.sha256) ?? stringOrNull(source.evidence_hash) ?? stringOrNull(source.text_hash);
  return hash ? `${kind} ${shortHash(hash)}` : kind;
}

function qualityTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'fail' || normalized === 'blocked') return 'blocked';
  if (normalized === 'warn' || normalized === 'pending_input') return 'risky';
  if (normalized === 'pass' || normalized === 'completed' || normalized === 'ready_for_review') return 'ready';
  return undefined;
}

function formatQualityScore(value: number | null | undefined) {
  return value == null ? 'Not scored' : `${Math.round(value)}%`;
}

function formatConfidence(value: number | null | undefined) {
  return value == null ? 'Not captured' : `${Math.round(value * 100)}%`;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function formatShortDate(value: string) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}
