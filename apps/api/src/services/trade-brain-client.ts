import type {
  AiEvalResult,
  AlphaObjectType,
  ObjectLifecycleStatus,
  OriginWorkspace,
  ProtectedActionKind,
  TradeBrainEvalCaseResult,
  TradeBrainEvalCheck,
  TradeBrainEvalReport,
  TradeBrainEvalStatus,
  TradeBrainEvalSuiteSummary
} from '@traibox/contracts';
import { ALPHA_OBJECT_TYPES, OBJECT_LIFECYCLE_STATUSES, PROTECTED_ACTIONS } from '@traibox/contracts';
import type { AgentRuntimePolicy } from '../domains/intelligence/agent-runtime';

export type TradeBrainCopilotPlan = {
  serviceVersion: string | null;
  objectType: AlphaObjectType;
  title: string | null;
  status: ObjectLifecycleStatus | null;
  answer: string | null;
  confidence: number | null;
  classificationReason: string | null;
  clarifyingQuestions: string[];
  planSteps: string[];
  followUps: string[];
  suggestedActions: Array<Record<string, unknown>>;
  aiObservability: Record<string, unknown>;
  evalPayload: Record<string, unknown> | null;
  structuredOutputSchema: string | null;
};

export type TradeBrainAgentScope = {
  serviceVersion: string | null;
  runtimePolicy: AgentRuntimePolicy;
  violations: string[];
  replayPreview: Array<Record<string, unknown>>;
};

export type TradeBrainDocumentIntelligence = {
  serviceVersion: string | null;
  traceId: string | null;
  documentType: string;
  confidence: number;
  extractedFields: Record<string, unknown>;
  missingFields: string[];
  requiredFields: string[];
  provenance: Array<Record<string, unknown>>;
  qualitySignals: Record<string, unknown>;
  recommendations: string[];
};

export type TradeBrainMissingProof = {
  serviceVersion: string | null;
  traceId: string | null;
  objectType: string;
  overall: string;
  score: number;
  requiredProof: string[];
  availableProof: string[];
  missingItems: string[];
  riskFindings: string[];
  nextActions: string[];
  qualitySignals: Record<string, unknown>;
};

export type TradeBrainEvalSuites = {
  serviceVersion: string | null;
  suites: TradeBrainEvalSuiteSummary[];
};

type TradeBrainFetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

type TradeBrainRequestInput = {
  endpoint: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
};

export async function requestTradeBrainCopilotPlan(input: {
  message: string;
  workspace: OriginWorkspace;
  tradeId?: string | null;
  objectIds?: string[];
  traceId: string;
  mode?: string | null;
  model?: string | null;
  history?: Array<{ role: string; content: string }> | null;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
}): Promise<TradeBrainCopilotPlan | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/copilot/structure',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    body: {
      message: input.message,
      workspace: input.workspace,
      trade_id: input.tradeId ?? null,
      object_ids: input.objectIds ?? [],
      trace_id: input.traceId,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.history && input.history.length ? { history: input.history } : {})
    }
  });
  return normalizeTradeBrainCopilotPlan(payload);
}

/**
 * Stream copilot events (SSE) from the Trade Brain. Yields parsed event objects
 * ({type:'delta'|'meta'|'error'|'done', ...}). Yields nothing if no brain is
 * configured or the request fails, so callers can fall back gracefully.
 */
export async function* streamTradeBrainCopilotEvents(input: {
  message: string;
  workspace: OriginWorkspace;
  tradeId?: string | null;
  mode?: string | null;
  model?: string | null;
  history?: Array<{ role: string; content: string }> | null;
  traceId: string;
  baseUrl?: string | null;
}): AsyncGenerator<Record<string, unknown>> {
  const base = (input.baseUrl ?? process.env.TRADE_BRAIN_URL ?? '').trim();
  if (!base) return;
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, '')}/v1/copilot/stream`, {
      method: 'POST',
      headers: tradeBrainRequestHeaders(),
      body: JSON.stringify({
        message: input.message,
        workspace: input.workspace,
        trade_id: input.tradeId ?? null,
        trace_id: input.traceId,
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.history && input.history.length ? { history: input.history } : {})
      })
    });
  } catch {
    return;
  }
  if (!res.ok || !res.body) return;
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      } catch {
        // ignore malformed frame
      }
    }
  }
}

export async function requestTradeBrainAgentScope(input: {
  objective: string;
  inputObjectTypes: AlphaObjectType[];
  inputObjects: Array<Record<string, unknown>>;
  permittedTools?: string[];
  dataAccess?: string[];
  writePermissions?: string[];
  approvalGates?: ProtectedActionKind[];
  timeBudgetSeconds?: number;
  traceId: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
}): Promise<TradeBrainAgentScope | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/agents/scope',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    body: {
      objective: input.objective,
      input_object_types: input.inputObjectTypes,
      input_objects: input.inputObjects,
      permitted_tools: input.permittedTools ?? [],
      data_access: input.dataAccess ?? [],
      write_permissions: input.writePermissions ?? [],
      approval_gates: input.approvalGates ?? [],
      time_budget_seconds: input.timeBudgetSeconds,
      trace_id: input.traceId
    }
  });
  return normalizeTradeBrainAgentScope(payload);
}

export async function requestTradeBrainReplayLog(input: {
  objective: string;
  runtimePolicy: AgentRuntimePolicy;
  inputObjects: Array<Record<string, unknown>>;
  traceId: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
}): Promise<Array<Record<string, unknown>> | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/replay/build',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    body: {
      objective: input.objective,
      runtime_policy: input.runtimePolicy,
      input_objects: input.inputObjects,
      trace_id: input.traceId
    }
  });
  if (!isRecord(payload) || !Array.isArray(payload.replay_log)) return null;
  const replayLog = payload.replay_log.filter(isRecord);
  return replayLog.length ? replayLog : null;
}

export async function requestTradeBrainEvalPayload(input: {
  payload: AiEvalResult;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
}): Promise<AiEvalResult | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/evals/run',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    body: input.payload as unknown as Record<string, unknown>
  });
  return normalizeTradeBrainEvalPayload(payload, input.payload);
}

export async function requestTradeBrainDocumentIntelligence(input: {
  filename: string;
  text: string;
  mimeType?: string | null;
  traceId: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
}): Promise<TradeBrainDocumentIntelligence | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/documents/intelligence',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    body: {
      filename: input.filename,
      text: input.text,
      mime_type: input.mimeType ?? null,
      trace_id: input.traceId
    }
  });
  return normalizeTradeBrainDocumentIntelligence(payload);
}

export async function requestTradeBrainMissingProof(input: {
  objectType: string;
  requiredProof?: string[];
  availableProof?: string[];
  artifacts?: Record<string, unknown>;
  traceId: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
}): Promise<TradeBrainMissingProof | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/proofs/missing',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    body: {
      object_type: input.objectType,
      required_proof: input.requiredProof ?? [],
      available_proof: input.availableProof ?? [],
      artifacts: input.artifacts ?? {},
      trace_id: input.traceId
    }
  });
  return normalizeTradeBrainMissingProof(payload);
}

export async function requestTradeBrainEvalSuites(input: {
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
} = {}): Promise<TradeBrainEvalSuites | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/evals/suites',
    method: 'GET',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl
  });
  return normalizeTradeBrainEvalSuites(payload);
}

export async function requestTradeBrainEvalSuiteRun(input: {
  suiteId?: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
} = {}): Promise<TradeBrainEvalReport | null> {
  const payload = await requestTradeBrainJson({
    endpoint: '/v1/evals/suites/run',
    baseUrl: input.baseUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: input.fetchImpl,
    body: { suite_id: input.suiteId ?? 'all' }
  });
  return normalizeTradeBrainEvalReport(payload);
}

export function normalizeTradeBrainCopilotPlan(value: unknown): TradeBrainCopilotPlan | null {
  if (!isRecord(value)) return null;
  const rawType = value.object_type;
  if (typeof rawType !== 'string' || !(ALPHA_OBJECT_TYPES as readonly string[]).includes(rawType)) return null;
  const rawStatus = value.status;
  const status =
    typeof rawStatus === 'string' && (OBJECT_LIFECYCLE_STATUSES as readonly string[]).includes(rawStatus)
      ? (rawStatus as ObjectLifecycleStatus)
      : null;

  return {
    serviceVersion: stringOrNull(value.service_version),
    objectType: rawType as AlphaObjectType,
    title: stringOrNull(value.title),
    status,
    answer: stringOrNull(value.answer),
    confidence: numberOrNull(value.confidence),
    classificationReason: stringOrNull(value.classification_reason),
    clarifyingQuestions: Array.isArray(value.clarifying_questions)
      ? value.clarifying_questions.filter((x): x is string => typeof x === 'string')
      : [],
    planSteps: Array.isArray(value.plan_steps)
      ? value.plan_steps.filter((x): x is string => typeof x === 'string')
      : [],
    followUps: Array.isArray(value.follow_ups)
      ? value.follow_ups.filter((x): x is string => typeof x === 'string')
      : [],
    suggestedActions: Array.isArray(value.suggested_actions) ? value.suggested_actions.filter(isRecord) : [],
    aiObservability: isRecord(value.ai_observability) ? value.ai_observability : {},
    evalPayload: isRecord(value.eval_payload) ? value.eval_payload : null,
    structuredOutputSchema: stringOrNull(value.structured_output_schema)
  };
}

export function normalizeTradeBrainDocumentIntelligence(value: unknown): TradeBrainDocumentIntelligence | null {
  if (!isRecord(value)) return null;
  const documentType = stringOrNull(value.document_type);
  if (!documentType) return null;
  const confidence = numberOrNull(value.confidence);
  if (confidence == null) return null;
  return {
    serviceVersion: stringOrNull(value.service_version),
    traceId: stringOrNull(value.trace_id),
    documentType,
    confidence,
    extractedFields: isRecord(value.extracted_fields) ? value.extracted_fields : {},
    missingFields: stringArray(value.missing_fields),
    requiredFields: stringArray(value.required_fields),
    provenance: Array.isArray(value.provenance) ? value.provenance.filter(isRecord) : [],
    qualitySignals: isRecord(value.quality_signals) ? value.quality_signals : {},
    recommendations: stringArray(value.recommendations)
  };
}

export function normalizeTradeBrainMissingProof(value: unknown): TradeBrainMissingProof | null {
  if (!isRecord(value)) return null;
  const objectType = stringOrNull(value.object_type);
  const overall = stringOrNull(value.overall);
  const score = scoreOrNull(value.score);
  if (!objectType || !overall || score == null) return null;
  return {
    serviceVersion: stringOrNull(value.service_version),
    traceId: stringOrNull(value.trace_id),
    objectType,
    overall,
    score,
    requiredProof: stringArray(value.required_proof),
    availableProof: stringArray(value.available_proof),
    missingItems: stringArray(value.missing_items),
    riskFindings: stringArray(value.risk_findings),
    nextActions: stringArray(value.next_actions),
    qualitySignals: isRecord(value.quality_signals) ? value.quality_signals : {}
  };
}

export function normalizeTradeBrainAgentScope(value: unknown): TradeBrainAgentScope | null {
  if (!isRecord(value)) return null;
  const runtimePolicy = normalizeAgentRuntimePolicy(value.runtime_policy);
  if (!runtimePolicy) return null;
  return {
    serviceVersion: stringOrNull(value.service_version),
    runtimePolicy,
    violations: stringArray(value.violations),
    replayPreview: Array.isArray(value.replay_preview) ? value.replay_preview.filter(isRecord) : []
  };
}

export function normalizeAgentRuntimePolicy(value: unknown): AgentRuntimePolicy | null {
  if (!isRecord(value)) return null;
  const runtime = value.runtime === 'trade_brain_scoped_agent_alpha' ? 'trade_brain_scoped_agent_alpha' : value.runtime === 'deterministic_alpha_agent' ? 'deterministic_alpha_agent' : null;
  if (!runtime) return null;
  const scopeVersion = value.scope_version === 'agent-scope-alpha-v2' ? 'agent-scope-alpha-v2' : null;
  if (!scopeVersion) return null;
  const approvalGates = protectedActionArray(value.approval_gates);
  const inferredApprovalGates = protectedActionArray(value.inferred_approval_gates);
  return {
    runtime,
    scope_version: scopeVersion,
    objective: stringOrNull(value.objective) ?? '',
    effective_tools: stringArray(value.effective_tools),
    denied_tools: stringArray(value.denied_tools),
    effective_data_access: stringArray(value.effective_data_access),
    denied_data_access: stringArray(value.denied_data_access),
    effective_write_permissions: stringArray(value.effective_write_permissions),
    denied_write_permissions: stringArray(value.denied_write_permissions),
    approval_gates: approvalGates,
    inferred_approval_gates: inferredApprovalGates,
    time_budget_seconds: positiveInteger(value.time_budget_seconds, 60),
    max_time_budget_seconds: positiveInteger(value.max_time_budget_seconds, 120),
    can_execute_protected_actions: false,
    protected_actions_blocked: true,
    policy_constraints: stringArray(value.policy_constraints)
  };
}

export function normalizeTradeBrainEvalPayload(value: unknown, fallback: AiEvalResult): AiEvalResult | null {
  if (!isRecord(value)) return null;
  const checks = Array.isArray(value.checks) ? value.checks.filter(isRecord) : fallback.checks;
  const status = value.status === 'fail' || value.status === 'warn' || value.status === 'pass' ? value.status : fallback.status;
  return {
    ...fallback,
    suite: stringOrNull(value.suite) ?? fallback.suite,
    status,
    score: scoreOrNull(value.score) ?? fallback.score,
    checks: checks as AiEvalResult['checks'],
    model: stringOrNull(value.model) ?? fallback.model,
    prompt_version: stringOrNull(value.prompt_version) ?? fallback.prompt_version,
    context_used: isRecord(value.context_used) ? value.context_used : fallback.context_used,
    artifacts_used: Array.isArray(value.artifacts_used) ? value.artifacts_used : fallback.artifacts_used,
    sources_used: Array.isArray(value.sources_used) ? value.sources_used : fallback.sources_used,
    confidence: numberOrNull(value.confidence) ?? fallback.confidence,
    policy_constraints: stringArray(value.policy_constraints).length ? stringArray(value.policy_constraints) : fallback.policy_constraints,
    generated_recommendation: stringOrNull(value.generated_recommendation) ?? fallback.generated_recommendation,
    human_decision:
      value.human_decision === 'accepted' || value.human_decision === 'rejected' || value.human_decision === 'pending'
        ? value.human_decision
        : fallback.human_decision,
    final_outcome: stringOrNull(value.final_outcome) ?? fallback.final_outcome,
    replayable: typeof value.replayable === 'boolean' ? value.replayable : fallback.replayable,
    trace_id: stringOrNull(value.trace_id) ?? fallback.trace_id
  };
}

export function normalizeTradeBrainEvalSuites(value: unknown): TradeBrainEvalSuites | null {
  if (!isRecord(value)) return null;
  const suites = Array.isArray(value.suites) ? value.suites.map(normalizeTradeBrainEvalSuiteSummary).filter(isNotNull) : [];
  return {
    serviceVersion: stringOrNull(value.service_version),
    suites
  };
}

export function normalizeTradeBrainEvalReport(value: unknown): TradeBrainEvalReport | null {
  if (!isRecord(value)) return null;
  const runId = stringOrNull(value.run_id);
  const generatedAt = stringOrNull(value.generated_at);
  const harnessVersion = stringOrNull(value.harness_version);
  const serviceVersion = stringOrNull(value.service_version);
  const suiteId = stringOrNull(value.suite_id);
  const status = evalStatusOrNull(value.status);
  if (!runId || !generatedAt || !harnessVersion || !serviceVersion || !suiteId || !status) return null;
  return {
    run_id: runId,
    generated_at: generatedAt,
    harness_version: harnessVersion,
    service_version: serviceVersion,
    suite_id: suiteId,
    case_count: nonNegativeInteger(value.case_count),
    passed: nonNegativeInteger(value.passed),
    failed: nonNegativeInteger(value.failed),
    score: scoreOrNull(value.score) ?? 0,
    status,
    results: Array.isArray(value.results) ? value.results.map(normalizeTradeBrainEvalCaseResult).filter(isNotNull) : []
  };
}

async function requestTradeBrainJson(input: TradeBrainRequestInput): Promise<unknown> {
  const baseUrl = (input.baseUrl ?? process.env.TRADE_BRAIN_URL ?? '').trim();
  if (!baseUrl) return null;

  const timeoutMs = input.timeoutMs ?? Number(process.env.TRADE_BRAIN_TIMEOUT_MS ?? 1500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1500);
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const method = input.method ?? 'POST';
    const init: RequestInit = {
      method,
      headers: tradeBrainRequestHeaders(),
      signal: controller.signal
    };
    if (method !== 'GET' && input.body) init.body = JSON.stringify(input.body);
    const response = await fetchImpl(new URL(input.endpoint, baseUrl).toString(), {
      ...init
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function tradeBrainRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json'
  };
  const token = process.env.TRADE_BRAIN_SERVICE_TOKEN?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
}

function scoreOrNull(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function positiveInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value: unknown): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))) : [];
}

function protectedActionArray(value: unknown): ProtectedActionKind[] {
  return stringArray(value).filter((action): action is ProtectedActionKind => (PROTECTED_ACTIONS as readonly string[]).includes(action));
}

function normalizeTradeBrainEvalSuiteSummary(value: unknown): TradeBrainEvalSuiteSummary | null {
  if (!isRecord(value)) return null;
  const suiteId = stringOrNull(value.suite_id);
  if (!suiteId) return null;
  return {
    suite_id: suiteId,
    case_count: nonNegativeInteger(value.case_count),
    path: stringOrNull(value.path) ?? undefined
  };
}

function normalizeTradeBrainEvalCaseResult(value: unknown): TradeBrainEvalCaseResult | null {
  if (!isRecord(value)) return null;
  const id = stringOrNull(value.id);
  const dataset = stringOrNull(value.dataset);
  const kind = stringOrNull(value.kind);
  const status = evalStatusOrNull(value.status);
  if (!id || !dataset || !kind || !status) return null;
  return {
    id,
    dataset,
    kind,
    tags: stringArray(value.tags),
    status,
    checks: Array.isArray(value.checks) ? value.checks.map(normalizeTradeBrainEvalCheck).filter(isNotNull) : [],
    summary: isRecord(value.summary) ? value.summary : {}
  };
}

function normalizeTradeBrainEvalCheck(value: unknown): TradeBrainEvalCheck | null {
  if (!isRecord(value)) return null;
  const caseId = stringOrNull(value.case);
  const status = evalStatusOrNull(value.status);
  const finding = stringOrNull(value.finding);
  if (!caseId || !status || !finding) return null;
  return {
    case: caseId,
    status,
    finding,
    score: scoreOrNull(value.score) ?? undefined
  };
}

function evalStatusOrNull(value: unknown): TradeBrainEvalStatus | null {
  return value === 'pass' || value === 'warn' || value === 'fail' ? value : null;
}

function isNotNull<T>(value: T | null): value is T {
  return value !== null;
}
