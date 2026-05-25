import type { AlphaObjectType, OriginWorkspace, ProtectedActionKind } from '@traibox/contracts';
import { PROTECTED_ACTIONS } from '@traibox/contracts';

type AgentRuntimeRequest = {
  objective: string;
  inputObjectTypes?: AlphaObjectType[];
  permittedTools?: string[];
  dataAccess?: string[];
  writePermissions?: string[];
  approvalGates?: ProtectedActionKind[];
  timeBudgetSeconds?: number;
};

export type AgentRuntimePolicy = {
  runtime: 'deterministic_alpha_agent' | 'trade_brain_scoped_agent_alpha';
  scope_version: 'agent-scope-alpha-v2';
  objective: string;
  effective_tools: string[];
  denied_tools: string[];
  effective_data_access: string[];
  denied_data_access: string[];
  effective_write_permissions: string[];
  denied_write_permissions: string[];
  approval_gates: ProtectedActionKind[];
  inferred_approval_gates: ProtectedActionKind[];
  time_budget_seconds: number;
  max_time_budget_seconds: number;
  can_execute_protected_actions: false;
  protected_actions_blocked: true;
  policy_constraints: string[];
};

export type CopilotStructuredOutputInput = {
  objectType: AlphaObjectType;
  objectId: string;
  status: string;
  workspace: OriginWorkspace;
  tradeId: string | null;
  message: string;
  contextObjectIds: string[];
  suggestedActions: Array<Record<string, unknown>>;
  aiObservability: Record<string, unknown>;
  evalObjectId: string;
  evalPayload: Record<string, unknown>;
};

const TOOL_ALIASES: Record<string, string> = {
  read_trade_context: 'memory.query',
  inspect_trade_context: 'memory.query',
  prepare_payment_intent: 'payment.prepare',
  prepare_funding_request: 'funding.prepare',
  prepare_proof_bundle: 'proof.prepare',
  request_approval: 'approvals.request',
  run_readiness: 'readiness.evaluate'
};

const DATA_ACCESS_ALIASES: Record<string, string> = {
  trade_context: 'trade_room_memory_l1',
  audit: 'audit_replay',
  replay: 'audit_replay'
};

const WRITE_PERMISSION_ALIASES: Record<string, string> = {
  agent_task: 'create_agent_task',
  agent_work_result: 'create_agent_work_result',
  memory_event: 'create_memory_event',
  approval: 'create_approval_request',
  proof_bundle: 'create_proof_draft'
};

const ALLOWED_TOOLS = [
  'readiness.evaluate',
  'attachments.suggest',
  'proof.prepare',
  'approvals.request',
  'documents.extract',
  'objects.create',
  'counterparty.screen',
  'clearance.check',
  'funding.prepare',
  'payment.prepare',
  'memory.query',
  'replay.inspect'
] as const;

const ALLOWED_DATA_ACCESS = [
  'selected_objects',
  'trade_room_memory_l1',
  'organization_memory_l2',
  'readiness_states',
  'proof_bundles',
  'audit_replay',
  'trade_context'
] as const;

const ALLOWED_WRITE_PERMISSIONS = [
  'create_agent_task',
  'create_agent_work_result',
  'create_memory_event',
  'recommend_next_action',
  'create_approval_request',
  'create_proof_draft',
  'attach_suggestion'
] as const;

const DEFAULT_TOOLS = ['readiness.evaluate', 'attachments.suggest', 'proof.prepare'] as const;
const DEFAULT_DATA_ACCESS = ['selected_objects', 'trade_room_memory_l1', 'organization_memory_l2'] as const;
const DEFAULT_WRITE_PERMISSIONS = ['create_agent_task', 'create_agent_work_result', 'create_memory_event', 'recommend_next_action'] as const;
const MAX_TIME_BUDGET_SECONDS = 120;

export function buildAgentRuntimePolicy(request: AgentRuntimeRequest): AgentRuntimePolicy {
  const effectiveTools = normalizeCapabilityList(request.permittedTools, DEFAULT_TOOLS, ALLOWED_TOOLS, TOOL_ALIASES);
  const effectiveDataAccess = normalizeCapabilityList(request.dataAccess, DEFAULT_DATA_ACCESS, ALLOWED_DATA_ACCESS, DATA_ACCESS_ALIASES);
  const effectiveWritePermissions = normalizeCapabilityList(
    request.writePermissions,
    DEFAULT_WRITE_PERMISSIONS,
    ALLOWED_WRITE_PERMISSIONS,
    WRITE_PERMISSION_ALIASES
  );
  const inferredApprovalGates = inferApprovalGates(request.objective, request.inputObjectTypes ?? []);
  const approvalGates = uniqueProtectedActions([...(request.approvalGates ?? []), ...inferredApprovalGates]);

  return {
    runtime: 'deterministic_alpha_agent',
    scope_version: 'agent-scope-alpha-v2',
    objective: request.objective,
    effective_tools: effectiveTools.allowed,
    denied_tools: effectiveTools.denied,
    effective_data_access: effectiveDataAccess.allowed,
    denied_data_access: effectiveDataAccess.denied,
    effective_write_permissions: effectiveWritePermissions.allowed,
    denied_write_permissions: effectiveWritePermissions.denied,
    approval_gates: approvalGates,
    inferred_approval_gates: inferredApprovalGates,
    time_budget_seconds: clampTimeBudget(request.timeBudgetSeconds),
    max_time_budget_seconds: MAX_TIME_BUDGET_SECONDS,
    can_execute_protected_actions: false,
    protected_actions_blocked: true,
    policy_constraints: [
      'Agent tasks are scoped before execution.',
      'Only effective tools, data access, and write permissions may be used.',
      'Denied capabilities are not executed.',
      'Protected actions are blocked until explicit human approval.',
      'Every material step must be replayable.'
    ]
  };
}

export function agentRuntimePolicyViolations(policy: AgentRuntimePolicy): string[] {
  const violations: string[] = [];
  if (policy.denied_tools.length) violations.push(`Denied tools requested: ${policy.denied_tools.join(', ')}`);
  if (policy.denied_data_access.length) violations.push(`Denied data access requested: ${policy.denied_data_access.join(', ')}`);
  if (policy.denied_write_permissions.length) violations.push(`Denied write permissions requested: ${policy.denied_write_permissions.join(', ')}`);
  if (!policy.effective_write_permissions.includes('create_agent_task')) violations.push('create_agent_task write permission is required');
  if (!policy.effective_write_permissions.includes('create_agent_work_result')) violations.push('create_agent_work_result write permission is required');
  return violations;
}

export function buildAgentReplayLog(input: {
  policy: AgentRuntimePolicy;
  objectiveHash: string;
  inputObjects: Array<{ object_id: string; type: AlphaObjectType; status: string; trade_id?: string | null }>;
  traceId: string;
  at: string;
}) {
  return [
    {
      at: input.at,
      step: 'task.accepted',
      objective_hash: input.objectiveHash,
      trace_id: input.traceId
    },
    {
      at: input.at,
      step: 'scope.normalized',
      scope_version: input.policy.scope_version,
      effective_tools: input.policy.effective_tools,
      effective_data_access: input.policy.effective_data_access,
      effective_write_permissions: input.policy.effective_write_permissions,
      denied: {
        tools: input.policy.denied_tools,
        data_access: input.policy.denied_data_access,
        write_permissions: input.policy.denied_write_permissions
      }
    },
    {
      at: input.at,
      step: 'context.bound',
      input_objects: input.inputObjects,
      object_count: input.inputObjects.length
    },
    {
      at: input.at,
      step: 'protected_actions.blocked_without_human_approval',
      gates: input.policy.approval_gates,
      inferred_gates: input.policy.inferred_approval_gates,
      can_execute_protected_actions: input.policy.can_execute_protected_actions
    },
    {
      at: input.at,
      step: 'runtime.ready',
      runtime: input.policy.runtime,
      time_budget_seconds: input.policy.time_budget_seconds,
      replayable: true
    }
  ];
}

export function buildCopilotStructuredOutputs(input: CopilotStructuredOutputInput) {
  const protectedAction = protectedActionForObjectType(input.objectType);
  const attachMode = attachModeForObjectType(input.objectType);
  const agentPolicy = buildAgentRuntimePolicy({
    objective: `Review ${input.objectType.replaceAll('_', ' ')} ${input.objectId} and prepare the next governed TRAIBOX action.`,
    inputObjectTypes: [input.objectType],
    permittedTools: ['readiness.evaluate', 'attachments.suggest', 'proof.prepare', 'approvals.request'],
    dataAccess: ['selected_objects', input.tradeId ? 'trade_room_memory_l1' : 'organization_memory_l2'],
    writePermissions: ['create_agent_task', 'create_agent_work_result', 'create_memory_event', 'recommend_next_action', 'create_approval_request'],
    approvalGates: protectedAction ? [protectedAction] : [],
    timeBudgetSeconds: 60
  });

  return [
    {
      kind: 'workflow_classification',
      object_type: input.objectType,
      usage_mode: input.tradeId ? 'trade_bound' : 'standalone',
      origin_workspace: input.workspace,
      confidence: input.aiObservability.confidence ?? 0.75,
      reason: classificationReason(input.objectType, input.message)
    },
    {
      kind: 'created_object',
      object_type: input.objectType,
      object_id: input.objectId,
      status: input.status,
      origin_workspace: input.workspace,
      trade_id: input.tradeId,
      attachable: true
    },
    {
      kind: 'readiness_preview',
      target: { type: input.objectType, id: input.objectId },
      likely_missing_items: likelyMissingItems(input.objectType),
      likely_risks: likelyRisks(input.objectType),
      recommended_call: {
        method: 'POST',
        endpoint: '/v1/readiness/evaluate',
        body: input.tradeId ? { trade_id: input.tradeId } : { object_id: input.objectId }
      }
    },
    {
      kind: 'execution_plan',
      target: { type: input.objectType, id: input.objectId },
      protected_action: protectedAction,
      human_approval_required: Boolean(protectedAction),
      agent_may: ['recommend', 'draft', 'prepare', 'monitor', 'explain', 'coordinate'],
      agent_must_not: ['execute protected actions', 'send external documents', 'submit declarations', 'move money'],
      next_steps: input.suggestedActions.map((action) => ({
        action: action.action,
        label: action.label,
        requires_human_approval: Boolean(action.protected_action),
        protected_action: action.protected_action ?? null
      }))
    },
    {
      kind: 'attach_suggestion',
      attachable: true,
      mode: attachMode,
      target_trade_id: input.tradeId,
      preserve: ['permissions', 'audit', 'memory', 'evidence', 'proof', 'replay']
    },
    {
      kind: 'agent_task_draft',
      objective: agentPolicy.objective,
      input_objects: [input.objectId, ...input.contextObjectIds],
      permitted_tools: agentPolicy.effective_tools,
      data_access: agentPolicy.effective_data_access,
      write_permissions: agentPolicy.effective_write_permissions,
      approval_gates: agentPolicy.approval_gates,
      time_budget_seconds: agentPolicy.time_budget_seconds,
      protected_actions_blocked: agentPolicy.protected_actions_blocked
    },
    input.aiObservability,
    {
      kind: 'ai_eval_result',
      object_id: input.evalObjectId,
      ...input.evalPayload
    }
  ];
}

export function enhancedSuggestedActionsFor(type: AlphaObjectType, object: { object_id: string; trade_id?: string | null }) {
  const common = [
    {
      action: 'readiness.evaluate',
      method: 'POST',
      endpoint: '/v1/readiness/evaluate',
      object_id: object.object_id,
      label: 'Evaluate readiness',
      requires_human_approval: false
    },
    {
      action: 'proof.prepare',
      method: 'POST',
      endpoint: '/v1/proofs/bundles',
      object_id: object.object_id,
      label: 'Prepare proof bundle',
      requires_human_approval: false
    }
  ];
  const protectedAction = protectedActionForObjectType(type);
  const approval = protectedAction
    ? [
        {
          action: 'approvals.request',
          method: 'POST',
          endpoint: '/v1/approvals',
          protected_action: protectedAction,
          object_id: object.object_id,
          label: 'Request human approval',
          requires_human_approval: true
        }
      ]
    : [];
  const contextual =
    type === 'funding_request'
      ? [{ action: 'documents.request', endpoint: '/v1/document-requests', object_id: object.object_id, label: 'Prepare finance-readiness pack' }]
      : type === 'clearance_check'
        ? [{ action: 'reports.generate', endpoint: '/v1/reports', object_id: object.object_id, label: 'Generate clearance report' }]
        : [{ action: 'attachments.suggest', endpoint: '/v1/attachments', object_id: object.object_id, label: 'Attach to Trade Room when useful' }];
  return [...common, ...approval, ...contextual];
}

function normalizeCapabilityList<const T extends readonly string[]>(
  values: string[] | undefined,
  defaults: readonly T[number][],
  allowed: T,
  aliases: Record<string, string>
) {
  const requested = values?.length ? values : [...defaults];
  const normalized = requested.map((value) => aliases[value] ?? value);
  const allowedSet = new Set<string>(allowed);
  return {
    allowed: unique(normalized.filter((value) => allowedSet.has(value))),
    denied: unique(normalized.filter((value) => !allowedSet.has(value)))
  };
}

function inferApprovalGates(objective: string, objectTypes: AlphaObjectType[]): ProtectedActionKind[] {
  const lower = objective.toLowerCase();
  const inferred: ProtectedActionKind[] = [];
  if (/(send|execute|release|complete).{0,24}(payment|money|advance)|payment/.test(lower) || objectTypes.includes('payment_intent')) inferred.push('send_payment');
  if (/funding|finance request|loan/.test(lower) || objectTypes.includes('funding_request')) inferred.push('submit_funding_request');
  if (/accept.{0,24}offer/.test(lower) || objectTypes.includes('funding_offer')) inferred.push('accept_funding_offer');
  if (/clearance declaration|submit clearance/.test(lower) || objectTypes.includes('clearance_check')) inferred.push('submit_clearance_declaration');
  if (/share.{0,24}proof|external proof/.test(lower) || objectTypes.includes('proof_bundle')) inferred.push('share_proof_bundle_externally');
  return uniqueProtectedActions(inferred);
}

function protectedActionForObjectType(type: AlphaObjectType): ProtectedActionKind | null {
  if (type === 'payment_intent') return 'send_payment';
  if (type === 'funding_request') return 'submit_funding_request';
  if (type === 'funding_offer') return 'accept_funding_offer';
  if (type === 'clearance_check') return 'submit_clearance_declaration';
  if (type === 'proof_bundle') return 'share_proof_bundle_externally';
  return null;
}

function attachModeForObjectType(type: AlphaObjectType): 'attach' | 'link' | 'convert' {
  if (['counterparty', 'screening_result', 'trade_passport', 'agent_work_result', 'agent_task'].includes(type)) return 'link';
  if (['document', 'extraction_result', 'trade_plan'].includes(type)) return 'convert';
  return 'attach';
}

function likelyMissingItems(type: AlphaObjectType): string[] {
  if (type === 'payment_intent') return ['beneficiary_verification', 'approval_chain', 'payment_reference'];
  if (type === 'funding_request') return ['commercial_invoice', 'purchase_order', 'approval_chain'];
  if (type === 'clearance_check') return ['rule_pack', 'origin_evidence', 'supporting_documents'];
  if (type === 'document') return ['classification', 'extraction_result', 'provenance'];
  if (type === 'trade_plan') return ['counterparty_verification', 'documents', 'readiness_state'];
  return ['readiness_state', 'proof_evidence'];
}

function likelyRisks(type: AlphaObjectType): string[] {
  if (type === 'payment_intent') return ['wrong beneficiary', 'duplicate payment', 'unapproved external execution'];
  if (type === 'funding_request') return ['incomplete finance pack', 'unsupported eligibility claim'];
  if (type === 'clearance_check') return ['missing rule evidence', 'unsubmitted declaration'];
  if (type === 'proof_bundle') return ['external sharing without approval'];
  return ['missing proof', 'insufficient context'];
}

function classificationReason(type: AlphaObjectType, message: string): string {
  const lower = message.toLowerCase();
  if (type === 'payment_intent') return 'Message refers to payment or pay execution intent.';
  if (type === 'funding_request') return 'Message refers to funding, finance, or loan readiness.';
  if (type === 'clearance_check') return 'Message refers to clearance, compliance, or sustainability checks.';
  if (type === 'document') return 'Message refers to document upload or document-first work.';
  if (lower.trim().length) return 'Message was structured as the closest canonical TRAIBOX object.';
  return 'Fallback canonical object for empty or ambiguous trade work.';
}

function clampTimeBudget(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) return 60;
  return Math.max(5, Math.min(MAX_TIME_BUDGET_SECONDS, Math.floor(value)));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function uniqueProtectedActions(values: ProtectedActionKind[]) {
  const allowed = new Set<string>(PROTECTED_ACTIONS);
  return Array.from(new Set(values.filter((value) => allowed.has(value)))) as ProtectedActionKind[];
}
