import type { ReplayStep } from '@traibox/contracts';

type DateLike = Date | string;
type JsonRecord = Record<string, unknown>;

export type ObjectReplayRow = {
  object_id: string;
  type: string;
  title: string;
  created_at: DateLike;
  trade_id: string | null;
  trace_id: string | null;
  owner_id: string;
  status: string | null;
  origin_workspace: string;
  summary: string | null;
  payload_json: JsonRecord | null;
  evidence_refs_json: unknown[] | null;
};

export type EventReplayRow = {
  event_id: string;
  trade_id: string | null;
  type: string;
  ts: DateLike;
  trace_id: string | null;
  actor: string | null;
  data: unknown;
};

export type MemoryReplayRow = {
  memory_event_id: string;
  trade_id: string | null;
  object_id: string | null;
  kind: string;
  signal: string;
  payload_json: unknown;
  trace_id: string | null;
  created_at: DateLike;
};

export type AuditReplayRow = {
  event_id: string;
  trade_id: string | null;
  actor: string | null;
  action: string;
  payload_json: unknown;
  prev_hash: string | null;
  hash: string | null;
  created_at: DateLike;
};

export type ReadinessReplayRow = {
  readiness_id: string;
  trade_id: string | null;
  object_id: string | null;
  overall: string;
  score: string | number | null;
  dimensions_json: unknown;
  missing_items_json: unknown;
  risk_findings_json: unknown;
  next_actions_json: unknown;
  trace_id: string | null;
  created_at: DateLike;
};

export type AttachmentReplayRow = {
  link_id: string;
  source_object_id: string;
  target_type: string;
  target_id: string;
  mode: string;
  payload_json: unknown;
  trace_id: string | null;
  created_at: DateLike;
};

export type ProofReplayRow = {
  bundle_id: string;
  trade_id: string | null;
  object_id: string | null;
  root: string | null;
  manifest_sha256: string | null;
  artifact_refs_json: unknown;
  status: string | null;
  trace_id: string | null;
  created_at: DateLike;
};

export function mapObjectReplayStep(row: ObjectReplayRow): ReplayStep {
  return {
    step_id: `object:${row.object_id}`,
    source: 'object',
    kind: `object.${row.type}`,
    title: `${row.type.replaceAll('_', ' ')} created`,
    summary: row.title,
    occurred_at: toIso(row.created_at),
    trade_id: row.trade_id,
    object_id: row.object_id,
    trace_id: row.trace_id,
    actor: `user:${row.owner_id}`,
    status: row.status,
    payload_json: {
      type: row.type,
      origin_workspace: row.origin_workspace,
      summary: row.summary,
      payload: toRecord(row.payload_json),
      evidence_refs: Array.isArray(row.evidence_refs_json) ? row.evidence_refs_json : []
    }
  };
}

export function mapEventReplayStep(row: EventReplayRow): ReplayStep {
  return {
    step_id: `event:${row.event_id}`,
    source: 'event',
    kind: row.type,
    title: String(row.type).replaceAll('_', ' '),
    summary: eventSummary(row.data),
    occurred_at: toIso(row.ts),
    trade_id: row.trade_id ?? null,
    object_id: objectIdFromPayload(row.data),
    trace_id: row.trace_id,
    actor: row.actor ?? null,
    status: statusFromPayload(row.data),
    payload_json: toRecord(row.data)
  };
}

export function mapMemoryReplayStep(row: MemoryReplayRow): ReplayStep {
  return {
    step_id: `memory:${row.memory_event_id}`,
    source: 'memory',
    kind: row.kind,
    title: row.signal,
    summary: row.kind,
    occurred_at: toIso(row.created_at),
    trade_id: row.trade_id ?? null,
    object_id: row.object_id ?? null,
    trace_id: row.trace_id,
    actor: null,
    status: statusFromPayload(row.payload_json),
    payload_json: toRecord(row.payload_json)
  };
}

export function mapAuditReplayStep(row: AuditReplayRow): ReplayStep {
  const payload = toRecord(row.payload_json);
  return {
    step_id: `audit:${row.event_id}`,
    source: 'audit',
    kind: row.action,
    title: String(row.action).replaceAll('.', ' '),
    summary: auditSummary(payload),
    occurred_at: toIso(row.created_at),
    trade_id: row.trade_id ?? (typeof payload.trade_id === 'string' ? payload.trade_id : null),
    object_id: objectIdFromPayload(payload),
    trace_id: typeof payload.trace_id === 'string' ? payload.trace_id : null,
    actor: row.actor,
    status: statusFromPayload(payload),
    payload_json: payload,
    hash: row.hash ?? null,
    prev_hash: row.prev_hash ?? null
  };
}

export function mapReadinessReplayStep(row: ReadinessReplayRow): ReplayStep {
  const nextActions = toArray(row.next_actions_json);
  return {
    step_id: `readiness:${row.readiness_id}`,
    source: 'readiness',
    kind: 'readiness.evaluated',
    title: `Readiness ${row.overall}`,
    summary: `${Math.round(Number(row.score ?? 0))}% · ${typeof nextActions[0] === 'string' ? nextActions[0] : 'No next action'}`,
    occurred_at: toIso(row.created_at),
    trade_id: row.trade_id ?? null,
    object_id: row.object_id ?? null,
    trace_id: row.trace_id,
    actor: null,
    status: row.overall,
    payload_json: {
      score: Number(row.score ?? 0),
      dimensions: toArray(row.dimensions_json),
      missing_items: toArray(row.missing_items_json),
      risk_findings: toArray(row.risk_findings_json),
      next_actions: nextActions
    }
  };
}

export function mapAttachmentReplayStep(row: AttachmentReplayRow): ReplayStep {
  const payload = toRecord(row.payload_json);
  return {
    step_id: `attachment:${row.link_id}`,
    source: 'attachment',
    kind: `attachment.${row.mode}`,
    title: `${String(row.mode).replaceAll('_', ' ')} standalone object`,
    summary: typeof payload.reason === 'string' ? payload.reason : null,
    occurred_at: toIso(row.created_at),
    trade_id: row.target_type === 'trade' || row.target_type === 'trade_room' ? row.target_id : null,
    object_id: row.source_object_id,
    trace_id: row.trace_id,
    actor: null,
    status: row.mode,
    payload_json: {
      source_object_id: row.source_object_id,
      target: { type: row.target_type, id: row.target_id },
      mode: row.mode,
      payload
    }
  };
}

export function mapProofReplayStep(row: ProofReplayRow): ReplayStep {
  const artifactRefs = toArray(row.artifact_refs_json);
  return {
    step_id: `proof:${row.bundle_id}`,
    source: 'proof',
    kind: 'proof.bundle.ready',
    title: 'Proof bundle ready',
    summary: `${artifactRefs.length} artifact(s) · ${row.manifest_sha256}`,
    occurred_at: toIso(row.created_at),
    trade_id: row.trade_id ?? null,
    object_id: row.object_id ?? row.bundle_id,
    trace_id: row.trace_id,
    actor: null,
    status: row.status,
    payload_json: {
      bundle_id: row.bundle_id,
      root: row.root,
      manifest_sha256: row.manifest_sha256,
      artifact_refs: artifactRefs
    },
    hash: row.root
  };
}

function eventSummary(payload: unknown): string | null {
  const record = toNullableRecord(payload);
  if (!record) return null;
  if (typeof record.summary === 'string') return record.summary;
  if (typeof record.decision === 'string') return `Decision: ${record.decision}`;
  if (typeof record.status === 'string') return `Status: ${record.status}`;
  if (typeof record.mode === 'string') return `Mode: ${record.mode}`;
  return null;
}

function auditSummary(payload: unknown): string | null {
  const record = toNullableRecord(payload);
  if (!record) return null;
  if (typeof record.object_id === 'string') return `Object ${record.object_id.slice(0, 8)}`;
  if (typeof record.approval_object_id === 'string') return `Approval ${record.approval_object_id.slice(0, 8)}`;
  if (typeof record.task_object_id === 'string') return `Task ${record.task_object_id.slice(0, 8)}`;
  if (typeof record.bundle_id === 'string') return `Bundle ${record.bundle_id.slice(0, 8)}`;
  return null;
}

function objectIdFromPayload(payload: unknown): string | null {
  const record = toNullableRecord(payload);
  if (!record) return null;
  for (const key of ['object_id', 'approval_object_id', 'task_object_id', 'proof_bundle_id', 'document_id', 'extraction_result_id', 'grant_object_id']) {
    if (typeof record[key] === 'string') return record[key];
  }
  const target = record.target;
  if (target && typeof target === 'object' && !Array.isArray(target)) {
    const targetId = (target as JsonRecord).id;
    if (typeof targetId === 'string') return targetId;
  }
  return null;
}

function statusFromPayload(payload: unknown): string | null {
  const record = toNullableRecord(payload);
  if (!record) return null;
  if (typeof record.status === 'string') return record.status;
  if (typeof record.decision === 'string') return record.decision;
  if (typeof record.overall === 'string') return record.overall;
  return null;
}

function toIso(value: DateLike): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toRecord(value: unknown): JsonRecord {
  return toNullableRecord(value) ?? {};
}

function toNullableRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}
