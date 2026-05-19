'use client';

import { useState } from 'react';
import { Activity, CheckCircle2, FileCheck2, LockKeyhole, ShieldCheck } from 'lucide-react';
import type { AlphaObject, ExecutionTaskStatusRequest, ObjectLifecycleStatus } from '@traibox/contracts';

import { cn } from '../lib/cn';
import { Button } from './ui/button';

export function ControlledExecutionTaskCard({
  task,
  loading,
  compact = false,
  onUpdate
}: {
  task: AlphaObject;
  loading?: boolean;
  compact?: boolean;
  onUpdate: (taskId: string, body: ExecutionTaskStatusRequest) => void;
}) {
  const [note, setNote] = useState('Operator reviewed evidence and controlled execution status.');
  const [externalReference, setExternalReference] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [operatorConfirmed, setOperatorConfirmed] = useState(false);
  const [risksAcknowledged, setRisksAcknowledged] = useState(false);

  const protectedAction = String(task.payload_json?.protected_action ?? 'protected_action');
  const executionKind = String(task.payload_json?.execution_kind ?? 'controlled');
  const executionState = String(task.payload_json?.execution_state ?? 'created_not_executed');
  const checklist = toStringArray(task.payload_json?.execution_checklist);
  const lifecycle = Array.isArray(task.payload_json?.execution_lifecycle) ? task.payload_json.execution_lifecycle : [];
  const notice = String(task.payload_json?.controlled_execution_notice ?? 'TRAIBOX alpha does not perform protected external actions automatically.');
  const idempotencyRequired = task.payload_json?.idempotency_required === true;
  const approvalObjectId = typeof task.payload_json?.approval_object_id === 'string' ? task.payload_json.approval_object_id : null;
  const workflowRunId = typeof task.payload_json?.workflow_run_id === 'string' ? task.payload_json.workflow_run_id : null;
  const idempotencyRecorded = typeof task.payload_json?.idempotency_key === 'string' && task.payload_json.idempotency_key.trim().length > 0;
  const operatorCompleted = task.payload_json?.operator_marked_external_action_completed === true;
  const canComplete = operatorConfirmed && risksAcknowledged && note.trim().length > 0 && (!idempotencyRequired || idempotencyKey.trim().length > 0);
  const isTerminal = task.status === 'completed' || task.status === 'cancelled';

  function update(status: ObjectLifecycleStatus, executionAction: ExecutionTaskStatusRequest['execution_action']) {
    onUpdate(task.object_id, {
      status,
      execution_action: executionAction,
      note,
      operator_confirmation: operatorConfirmed,
      residual_risks_acknowledged: risksAcknowledged,
      external_reference: externalReference.trim() || undefined,
      idempotency_key: idempotencyKey.trim() || undefined
    });
  }

  return (
    <div className="rounded-2xl border border-accent/20 bg-accent/10 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-paper p-2 text-accent">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold">{task.title}</div>
            <p className="mt-1 text-xs leading-5 text-muted">{task.summary}</p>
          </div>
        </div>
        <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{task.status}</span>
      </div>

      <div className={cn('mt-3 grid gap-3', compact ? 'grid-cols-1' : 'lg:grid-cols-[1fr_0.9fr]')}>
        <div className="rounded-xl bg-paper/75 px-3 py-3 text-xs leading-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Info label="Execution kind" value={executionKind.replaceAll('_', ' ')} />
            <Info label="Protected action" value={protectedAction.replaceAll('_', ' ')} />
            <Info label="Execution state" value={executionState.replaceAll('_', ' ')} />
            <Info label="Auto-executed by TRAIBOX" value={task.payload_json?.external_action_performed_by_traibox ? 'yes' : 'no'} />
          </div>
          <div className="mt-3 rounded-xl border border-border/10 bg-surface2/60 px-3 py-2">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck className="h-3.5 w-3.5 text-accent" />
              Controlled execution notice
            </div>
            <p className="mt-1 text-muted">{notice}</p>
          </div>
        </div>

        <div className="rounded-xl bg-paper/75 px-3 py-3 text-xs leading-5">
          <div className="font-medium">Execution checklist</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(checklist.length ? checklist : ['Review evidence', 'Confirm operator action', 'Record external reference']).map((item) => (
              <span key={item} className="rounded-full bg-surface2 px-2 py-1 text-[11px] text-muted">
                {item}
              </span>
            ))}
          </div>
          <div className="mt-3 font-medium">Latest lifecycle events</div>
          <div className="mt-2 space-y-1">
            {lifecycle.slice(-3).map((entry, index) => (
              <pre key={index} className="max-h-16 overflow-hidden rounded-lg bg-surface2 px-2 py-1 text-[10px] leading-4 text-muted">
                {JSON.stringify(entry, null, 2)}
              </pre>
            ))}
          </div>
        </div>
      </div>

      <ExecutionControlPlane
        compact={compact}
        approvalObjectId={approvalObjectId}
        workflowRunId={workflowRunId}
        idempotencyRequired={idempotencyRequired}
        idempotencyRecorded={idempotencyRecorded}
        operatorCompleted={operatorCompleted}
        externalActionPerformedByTraibox={task.payload_json?.external_action_performed_by_traibox === true}
      />

      {!isTerminal ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-3">
            <input
              value={externalReference}
              onChange={(event) => setExternalReference(event.target.value)}
              className="rounded-xl border border-border/10 bg-paper px-3 py-2 text-xs"
              placeholder="External reference"
            />
            <input
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              className="rounded-xl border border-border/10 bg-paper px-3 py-2 text-xs"
              placeholder={idempotencyRequired ? 'Idempotency key required' : 'Idempotency key'}
            />
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="rounded-xl border border-border/10 bg-paper px-3 py-2 text-xs"
              placeholder="Operator note"
            />
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex items-center gap-2 rounded-xl border border-border/10 bg-paper/75 px-3 py-2 text-xs text-muted">
              <input type="checkbox" checked={operatorConfirmed} onChange={(event) => setOperatorConfirmed(event.target.checked)} />
              Operator confirms the external step was performed outside automatic TRAIBOX control
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-border/10 bg-paper/75 px-3 py-2 text-xs text-muted">
              <input type="checkbox" checked={risksAcknowledged} onChange={(event) => setRisksAcknowledged(event.target.checked)} />
              Residual execution risks acknowledged
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={loading} onClick={() => update('in_progress', 'start_controlled_execution')}>
              Start controlled work
            </Button>
            <Button size="sm" variant="secondary" disabled={loading} onClick={() => update('ready_for_review', 'mark_ready_for_review')}>
              Mark ready for review
            </Button>
            <Button size="sm" disabled={loading || !canComplete} onClick={() => update('completed', 'mark_external_completed')}>
              {loading ? 'Updating...' : 'Confirm completed'}
            </Button>
            <Button size="sm" variant="danger" disabled={loading || note.trim().length === 0} onClick={() => update('blocked', 'mark_blocked')}>
              Block
            </Button>
          </div>
          {idempotencyRequired && !idempotencyKey.trim() ? (
            <div className="flex items-center gap-2 text-xs text-warn">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Idempotency key is required before completion for this execution kind.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ExecutionControlPlane({
  compact,
  approvalObjectId,
  workflowRunId,
  idempotencyRequired,
  idempotencyRecorded,
  operatorCompleted,
  externalActionPerformedByTraibox
}: {
  compact: boolean;
  approvalObjectId: string | null;
  workflowRunId: string | null;
  idempotencyRequired: boolean;
  idempotencyRecorded: boolean;
  operatorCompleted: boolean;
  externalActionPerformedByTraibox: boolean;
}) {
  const facts = [
    {
      icon: 'release' as const,
      label: 'Release source',
      value: approvalObjectId ? `approval ${approvalObjectId.slice(0, 8)}` : 'manual controlled task'
    },
    {
      icon: 'blocked' as const,
      label: 'Automatic external action',
      value: externalActionPerformedByTraibox ? 'performed by adapter' : 'blocked in alpha'
    },
    {
      icon: 'operator' as const,
      label: 'Operator control',
      value: operatorCompleted ? 'external step recorded' : 'human-operated execution'
    },
    {
      icon: 'proof' as const,
      label: 'Replay and proof',
      value: workflowRunId ? `workflow ${workflowRunId.slice(0, 8)}` : 'audit skeleton ready'
    }
  ];

  return (
    <div className="mt-3 rounded-2xl border border-border/10 bg-paper/80 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <LockKeyhole className="h-3.5 w-3.5 text-accent" />
          Execution Release Controls
        </div>
        <span className="rounded-full bg-surface2 px-2 py-1 text-[10px] text-muted">
          {idempotencyRequired ? 'idempotency required' : 'idempotency optional'}
        </span>
      </div>
      <div className={cn('mt-3 grid gap-2', compact ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-4')}>
        {facts.map((fact) => (
          <ExecutionFact key={fact.label} {...fact} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ExecutionPill active={Boolean(approvalObjectId)} label="Approval linked" />
        <ExecutionPill active={!externalActionPerformedByTraibox} label="No auto-execution" />
        <ExecutionPill active={!idempotencyRequired || idempotencyRecorded} label={idempotencyRequired ? 'Idempotency recorded' : 'Idempotency not required'} />
        <ExecutionPill active={Boolean(workflowRunId)} label="Replay trace" />
      </div>
    </div>
  );
}

function ExecutionFact({ icon, label, value }: { icon: 'release' | 'blocked' | 'operator' | 'proof'; label: string; value: string }) {
  const Icon = icon === 'release' ? ShieldCheck : icon === 'blocked' ? LockKeyhole : icon === 'operator' ? Activity : FileCheck2;
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

function ExecutionPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={cn('rounded-full border px-2 py-1 text-[11px]', active ? 'border-success/20 bg-success/10 text-success' : 'border-warn/20 bg-warn/10 text-warn')}>
      {label}
    </span>
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

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}
