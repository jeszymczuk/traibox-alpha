'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, GitBranch, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { AlphaObject } from '@traibox/contracts';

import { cn } from '../lib/cn';
import { Button } from './ui/button';

export type ProtectedActionDecisionInput = {
  notes: string;
  stepUpVerified: boolean;
  residualRisksAcknowledged: boolean;
  approvalStep?: string;
};

export function ProtectedActionApprovalCard({
  approval,
  loading,
  compact = false,
  onDecide
}: {
  approval: AlphaObject;
  loading?: boolean;
  compact?: boolean;
  onDecide: (decision: 'approved' | 'rejected', input: ProtectedActionDecisionInput) => void;
}) {
  const [notes, setNotes] = useState('Evidence reviewed; protected action may proceed inside alpha controls.');
  const [stepUpVerified, setStepUpVerified] = useState(false);
  const [risksAcknowledged, setRisksAcknowledged] = useState(false);

  const protectedAction = String(approval.payload_json?.protected_action ?? 'protected_action');
  const proposedAction = String(approval.payload_json?.proposed_action ?? approval.summary ?? approval.title);
  const rationale = typeof approval.payload_json?.rationale === 'string' ? approval.payload_json.rationale : null;
  const policyRefs = toStringArray(approval.payload_json?.policy_refs);
  const remainingRisks = toStringArray(approval.payload_json?.remaining_risks);
  const evidenceRequirements = toStringArray(approval.payload_json?.evidence_requirements);
  const consequence = String(approval.payload_json?.what_happens_if_approved ?? 'TRAIBOX creates a controlled execution task. The external action is still not executed automatically.');
  const target = approval.payload_json?.target as { type?: string; id?: string } | undefined;
  const confirmationRequirements = isRecord(approval.payload_json?.confirmation_requirements) ? approval.payload_json.confirmation_requirements : {};
  const humanControl = isRecord(approval.payload_json?.human_control) ? approval.payload_json.human_control : {};
  const workflowRunId = typeof approval.payload_json?.workflow_run_id === 'string' ? approval.payload_json.workflow_run_id : null;
  const stepUpRequired = approval.payload_json?.step_up_required !== false;
  const protectedActionReleased = approval.payload_json?.protected_action_released === true;
  const approvalChainCompleted = approval.payload_json?.approval_chain_completed === true;
  const approvalChain = toApprovalChain(approval.payload_json?.approval_chain);
  const currentApprovalStep = typeof approval.payload_json?.current_approval_step === 'string' ? approval.payload_json.current_approval_step : null;
  const currentStep = approvalChain.find((step) => step.key === currentApprovalStep) ?? approvalChain.find((step) => step.status === 'approval_required') ?? null;
  const canDecide = approval.status === 'approval_required' && (!approvalChain.length || Boolean(currentStep));
  const canApprove = canDecide && stepUpVerified && risksAcknowledged && notes.trim().length > 0;

  return (
    <div className="rounded-2xl border border-warn/25 bg-warn/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-paper p-2 text-warn">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">Protected Action Approval</div>
            <p className="mt-1 text-xs leading-5 text-muted">
              Human approval is required before TRAIBOX can release this protected action into controlled execution.
            </p>
          </div>
        </div>
        <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{approval.status}</span>
      </div>

      <div className={cn('mt-3 grid gap-3', compact ? 'grid-cols-1' : 'lg:grid-cols-[1.1fr_0.9fr]')}>
        <div className="rounded-xl bg-paper/75 px-3 py-3 text-xs leading-5">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Proposed action</div>
          <div className="mt-1 font-medium text-ink">{proposedAction}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Info label="Protected action" value={protectedAction.replaceAll('_', ' ')} />
            <Info label="Target" value={target?.type && target?.id ? `${target.type} · ${target.id.slice(0, 8)}` : 'not specified'} />
            <Info label="Evidence" value={`${approval.evidence_refs_json.length} linked artifact(s)`} />
            <Info label="Step-up" value={stepUpRequired ? 'required' : 'not required'} />
            <Info label="Current gate" value={currentStep ? `${currentStep.label} · ${currentStep.required_role}` : 'single human approval'} />
          </div>
          {rationale ? (
            <div className="mt-3 rounded-xl border border-border/10 bg-surface2/60 px-3 py-2">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Why</div>
              <p className="mt-1 text-muted">{rationale}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <RiskList title="Remaining risks" items={remainingRisks} fallback="External consequence, wrong recipient, stale evidence, or policy mismatch may still exist." tone="warn" />
          <RiskList title="Evidence expected" items={evidenceRequirements} fallback="Review linked evidence, readiness state, policy references, and target object before deciding." tone="accent" />
          <div className="rounded-xl border border-border/10 bg-paper/75 px-3 py-2 text-xs leading-5">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
              If approved
            </div>
            <p className="mt-1 text-muted">{consequence}</p>
          </div>
        </div>
      </div>

      <ProtectedActionControlPlane
        compact={compact}
        protectedAction={protectedAction}
        currentGate={currentStep ? `${currentStep.label} · ${currentStep.required_role}` : 'single human approval'}
        evidenceCount={approval.evidence_refs_json.length}
        confirmationRequirements={confirmationRequirements}
        humanControl={humanControl}
        workflowRunId={workflowRunId}
        stepUpRequired={stepUpRequired}
        protectedActionReleased={protectedActionReleased}
        approvalChainCompleted={approvalChainCompleted}
      />

      {policyRefs.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {policyRefs.map((policy) => (
            <span key={policy} className="rounded-full border border-border/10 bg-paper px-2 py-1 text-[11px] text-muted">
              {policy}
            </span>
          ))}
        </div>
      ) : null}

      {approvalChain.length ? (
        <div className="mt-3 rounded-xl border border-border/10 bg-paper/75 px-3 py-3">
          <div className="flex items-center gap-2 text-xs font-medium">
            <GitBranch className="h-3.5 w-3.5 text-accent" />
            Approval Chain
          </div>
          <div className="mt-2 grid gap-2">
            {approvalChain.map((step, index) => (
              <div
                key={step.key}
                className={cn(
                  'flex items-start justify-between gap-3 rounded-xl border px-3 py-2 text-xs',
                  step.key === currentStep?.key ? 'border-warn/25 bg-warn/10' : 'border-border/10 bg-surface2/60'
                )}
              >
                <div>
                  <div className="font-medium">
                    {index + 1}. {step.label}
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    Role: {step.required_role}
                    {step.actor_id ? ` · decided by ${step.actor_id.slice(0, 8)}` : ''}
                  </div>
                </div>
                <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{step.status}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            Approving this gate only releases the protected action when the full chain is complete. Each step is recorded in audit, memory, and replay context.
          </p>
        </div>
      ) : null}

      {canDecide ? (
        <>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="mt-3 min-h-[72px] w-full rounded-xl border border-border/10 bg-paper px-3 py-2 text-xs leading-5"
            placeholder="Decision notes"
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border border-border/10 bg-paper/75 px-3 py-2 text-xs text-muted">
              <input type="checkbox" checked={stepUpVerified} onChange={(event) => setStepUpVerified(event.target.checked)} />
              Step-up verification completed
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-border/10 bg-paper/75 px-3 py-2 text-xs text-muted">
              <input type="checkbox" checked={risksAcknowledged} onChange={(event) => setRisksAcknowledged(event.target.checked)} />
              Residual risks acknowledged
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={loading || !canApprove}
              onClick={() => onDecide('approved', { notes, stepUpVerified, residualRisksAcknowledged: risksAcknowledged, approvalStep: currentStep?.key })}
            >
              {loading ? 'Recording...' : currentStep ? `Approve ${currentStep.label}` : 'Approve protected action'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={loading || notes.trim().length === 0}
              onClick={() => onDecide('rejected', { notes, stepUpVerified, residualRisksAcknowledged: risksAcknowledged, approvalStep: currentStep?.key })}
            >
              Reject
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-3 rounded-xl border border-border/10 bg-paper/75 px-3 py-2 text-xs leading-5 text-muted">
          Decision recorded. This approval gate is now read-only; any released execution work appears as a controlled execution task.
        </div>
      )}
    </div>
  );
}

function ProtectedActionControlPlane({
  compact,
  protectedAction,
  currentGate,
  evidenceCount,
  confirmationRequirements,
  humanControl,
  workflowRunId,
  stepUpRequired,
  protectedActionReleased,
  approvalChainCompleted
}: {
  compact: boolean;
  protectedAction: string;
  currentGate: string;
  evidenceCount: number;
  confirmationRequirements: Record<string, unknown>;
  humanControl: Record<string, unknown>;
  workflowRunId: string | null;
  stepUpRequired: boolean;
  protectedActionReleased: boolean;
  approvalChainCompleted: boolean;
}) {
  const confirmationPills = [
    {
      label: 'Decision notes',
      active: confirmationRequirements.decision_notes_required !== false
    },
    {
      label: 'Step-up',
      active: confirmationRequirements.step_up_required !== false && stepUpRequired
    },
    {
      label: 'Risk acknowledgement',
      active: confirmationRequirements.residual_risk_acknowledgement_required !== false
    }
  ];
  const controlPills = [
    {
      label: 'Evidence visible',
      active: humanControl.must_show_evidence !== false && evidenceCount > 0
    },
    {
      label: 'Risks visible',
      active: humanControl.must_show_risks !== false
    },
    {
      label: 'Execution blocked',
      active: humanControl.execution_blocked_until_approved !== false && !protectedActionReleased
    },
    {
      label: 'Replay trace',
      active: Boolean(workflowRunId)
    }
  ];

  return (
    <div className="mt-3 rounded-2xl border border-border/10 bg-paper/80 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <LockKeyhole className="h-3.5 w-3.5 text-warn" />
          Human Control Plane
        </div>
        <span className="rounded-full bg-surface2 px-2 py-1 text-[10px] text-muted">
          {protectedActionReleased ? 'released to execution' : 'blocked until approval'}
        </span>
      </div>
      <div className={cn('mt-3 grid gap-2', compact ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-4')}>
        <ControlFact icon="agent" label="Agent may" value="recommend, draft, prepare, monitor" />
        <ControlFact icon="blocked" label="Agent cannot" value={`execute ${protectedAction.replaceAll('_', ' ')}`} />
        <ControlFact icon="human" label="Human gate" value={approvalChainCompleted ? 'chain completed' : currentGate} />
        <ControlFact icon="replay" label="Replay and proof" value={workflowRunId ? `workflow ${workflowRunId.slice(0, 8)}` : 'audit skeleton ready'} />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[...confirmationPills, ...controlPills].map((pill) => (
          <span
            key={pill.label}
            className={cn(
              'rounded-full border px-2 py-1 text-[11px]',
              pill.active ? 'border-success/20 bg-success/10 text-success' : 'border-border/10 bg-surface2 text-muted'
            )}
          >
            {pill.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ControlFact({ icon, label, value }: { icon: 'agent' | 'blocked' | 'human' | 'replay'; label: string; value: string }) {
  const Icon = icon === 'agent' ? Eye : icon === 'blocked' ? LockKeyhole : icon === 'human' ? ShieldCheck : CheckCircle2;
  return (
    <div className="rounded-xl border border-border/10 bg-surface2/60 px-3 py-2 text-xs leading-5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-muted">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 font-medium text-ink">{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function RiskList({ title, items, fallback, tone }: { title: string; items: string[]; fallback: string; tone: 'warn' | 'accent' }) {
  const values = items.length ? items : [fallback];
  return (
    <div className="rounded-xl border border-border/10 bg-paper/75 px-3 py-2 text-xs leading-5">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className={cn('h-3.5 w-3.5', tone === 'warn' ? 'text-warn' : 'text-accent')} />
        {title}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {values.slice(0, 5).map((item) => (
          <span key={item} className="rounded-full bg-surface2 px-2 py-1 text-[11px] text-muted">
            {item.replaceAll('_', ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

type ApprovalChainStepView = {
  key: string;
  label: string;
  required_role: string;
  status: string;
  actor_id?: string | null;
};

function toApprovalChain(value: unknown): ApprovalChainStepView[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((step, index) => ({
      key: typeof step.key === 'string' && step.key ? step.key : `approval_step_${index + 1}`,
      label: typeof step.label === 'string' && step.label ? step.label : `Approval step ${index + 1}`,
      required_role: typeof step.required_role === 'string' && step.required_role ? step.required_role : 'ops',
      status: typeof step.status === 'string' && step.status ? step.status : 'pending_input',
      actor_id: typeof step.actor_id === 'string' ? step.actor_id : null
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
