export type WorkflowRunKind = 'approval_chain' | 'controlled_execution' | 'attach_transition' | 'proof_generation';

export type WorkflowRuntimeCommand = 'await_signal' | 'run_activity' | 'observe' | 'recover' | 'closed';

export type WorkflowRuntimeTarget = {
  type: string;
  id: string;
};

export type WorkflowRuntimeState = {
  adapter: 'temporal_alpha_bridge';
  mode: 'local_durable_simulation' | 'temporal_ready';
  workflow_id: string;
  workflow_run_id: string;
  run_id: string;
  workflow_type: string;
  task_queue: string;
  sequence: number;
  status: string;
  stage: string;
  command: WorkflowRuntimeCommand;
  awaiting_signal: string | null;
  pause_reason: string | null;
  protected_action_lock: boolean;
  target: WorkflowRuntimeTarget;
  resume_token: string;
  started_at: string;
  last_transition_at: string;
  last_trace_id: string;
  timeout_policy: {
    stale_after_seconds: number;
    heartbeat_timeout_seconds: number;
  };
  retry_policy: {
    max_attempts: number;
    backoff_seconds: number[];
  };
  recovery_policy: {
    resumable: boolean;
    deterministic_replay_required: boolean;
    resume_strategy: 'replay_from_structured_events';
    degraded_mode_supported: boolean;
  };
};

export function temporalMappingForWorkflow(kind: string) {
  return {
    temporal_workflow_type: workflowTypeForKind(kind),
    temporal_task_queue: 'traibox-alpha',
    recovery_strategy: 'replay_from_structured_events'
  };
}

export function workflowTypeForKind(kind: string) {
  if (kind === 'approval_chain') return 'ApprovalChainWorkflow';
  if (kind === 'controlled_execution') return 'ControlledExecutionWorkflow';
  if (kind === 'attach_transition') return 'AttachTransitionWorkflow';
  if (kind === 'proof_generation') return 'ProofGenerationWorkflow';
  return 'AlphaWorkflow';
}

export function isWorkflowRunKind(value: string): value is WorkflowRunKind {
  return ['approval_chain', 'controlled_execution', 'attach_transition', 'proof_generation'].includes(value);
}

export function buildWorkflowRuntimeState(input: {
  kind: WorkflowRunKind;
  status: string;
  stage: string;
  target: WorkflowRuntimeTarget;
  workflowRunId: string;
  traceId: string;
  nowIso: string;
  sequence?: number;
  existing?: Partial<WorkflowRuntimeState> | null;
  temporalEnabled?: boolean;
  stale?: boolean;
}): WorkflowRuntimeState {
  const existing = input.existing ?? {};
  const command = workflowRuntimeCommandFor({ kind: input.kind, status: input.status, stage: input.stage, stale: input.stale === true });
  const workflowId = existing.workflow_id ?? workflowIdForTarget(input.kind, input.target);
  const sequence = Number.isFinite(input.sequence) ? Number(input.sequence) : Number(existing.sequence ?? 0);
  return {
    adapter: 'temporal_alpha_bridge',
    mode: input.temporalEnabled ? 'temporal_ready' : 'local_durable_simulation',
    workflow_id: workflowId,
    workflow_run_id: input.workflowRunId,
    run_id: existing.run_id ?? `alpha-${input.traceId}`,
    workflow_type: workflowTypeForKind(input.kind),
    task_queue: existing.task_queue ?? 'traibox-alpha',
    sequence,
    status: input.status,
    stage: input.stage,
    command: command.command,
    awaiting_signal: command.awaitingSignal,
    pause_reason: command.pauseReason,
    protected_action_lock: input.kind === 'approval_chain' || input.kind === 'controlled_execution',
    target: input.target,
    resume_token: `${workflowId}:${sequence}:${command.command}`,
    started_at: existing.started_at ?? input.nowIso,
    last_transition_at: input.nowIso,
    last_trace_id: input.traceId,
    timeout_policy: existing.timeout_policy ?? {
      stale_after_seconds: 900,
      heartbeat_timeout_seconds: 120
    },
    retry_policy: existing.retry_policy ?? {
      max_attempts: 3,
      backoff_seconds: [15, 60, 300]
    },
    recovery_policy: existing.recovery_policy ?? {
      resumable: true,
      deterministic_replay_required: true,
      resume_strategy: 'replay_from_structured_events',
      degraded_mode_supported: true
    }
  };
}

export function workflowRuntimeCommandFor(input: {
  kind: WorkflowRunKind;
  status: string;
  stage?: string;
  stale?: boolean;
}): {
  command: WorkflowRuntimeCommand;
  awaitingSignal: string | null;
  pauseReason: string | null;
} {
  if (input.stale) {
    return {
      command: 'recover',
      awaitingSignal: 'workflow_recovery_review',
      pauseReason: 'No domain workflow step changed inside the stale window.'
    };
  }
  if (['completed', 'rejected', 'cancelled', 'archived'].includes(input.status)) {
    return { command: 'closed', awaitingSignal: null, pauseReason: null };
  }
  if (input.status === 'approval_required') {
    return {
      command: 'await_signal',
      awaitingSignal: 'approval_decision',
      pauseReason: 'Protected execution is paused until an authorized human approval signal is recorded.'
    };
  }
  if (input.kind === 'controlled_execution' && input.status === 'in_progress') {
    return {
      command: 'await_signal',
      awaitingSignal: 'operator_execution_update',
      pauseReason: 'Execution is released but waits for an operator confirmation signal.'
    };
  }
  if (input.kind === 'attach_transition' || input.kind === 'proof_generation') {
    return { command: input.status === 'in_progress' ? 'run_activity' : 'observe', awaitingSignal: null, pauseReason: null };
  }
  return { command: 'observe', awaitingSignal: null, pauseReason: null };
}

function workflowIdForTarget(kind: WorkflowRunKind, target: WorkflowRuntimeTarget) {
  return `traibox-${kind}-${safeIdPart(target.type)}-${safeIdPart(target.id)}`;
}

function safeIdPart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || 'unknown';
}
