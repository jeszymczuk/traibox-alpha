import type { AlphaObjectType, ObjectLifecycleStatus, OriginWorkspace } from '@traibox/contracts';
import { ALPHA_OBJECT_TYPES, OBJECT_LIFECYCLE_STATUSES } from '@traibox/contracts';

export type TradeBrainCopilotPlan = {
  serviceVersion: string | null;
  objectType: AlphaObjectType;
  title: string | null;
  status: ObjectLifecycleStatus | null;
  answer: string | null;
  confidence: number | null;
  classificationReason: string | null;
  suggestedActions: Array<Record<string, unknown>>;
  aiObservability: Record<string, unknown>;
  evalPayload: Record<string, unknown> | null;
  structuredOutputSchema: string | null;
};

type TradeBrainFetch = (url: string, init?: RequestInit) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export async function requestTradeBrainCopilotPlan(input: {
  message: string;
  workspace: OriginWorkspace;
  tradeId?: string | null;
  objectIds?: string[];
  traceId: string;
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: TradeBrainFetch;
}): Promise<TradeBrainCopilotPlan | null> {
  const baseUrl = (input.baseUrl ?? process.env.TRADE_BRAIN_URL ?? '').trim();
  if (!baseUrl) return null;

  const timeoutMs = input.timeoutMs ?? Number(process.env.TRADE_BRAIN_TIMEOUT_MS ?? 1500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1500);
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(new URL('/v1/copilot/structure', baseUrl).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        message: input.message,
        workspace: input.workspace,
        trade_id: input.tradeId ?? null,
        object_ids: input.objectIds ?? [],
        trace_id: input.traceId
      })
    });
    if (!response.ok) return null;
    return normalizeTradeBrainCopilotPlan(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
    suggestedActions: Array.isArray(value.suggested_actions) ? value.suggested_actions.filter(isRecord) : [],
    aiObservability: isRecord(value.ai_observability) ? value.ai_observability : {},
    evalPayload: isRecord(value.eval_payload) ? value.eval_payload : null,
    structuredOutputSchema: stringOrNull(value.structured_output_schema)
  };
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
