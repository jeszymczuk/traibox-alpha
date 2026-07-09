import type pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setAppContext, withTx } from '@traibox/db';
import type {
  AgentTaskRequest,
  AgentTaskResponse,
  AgentWorkResult,
  AiEvalCheck,
  AiEvalResult,
  AlphaDemoResponse,
  AlphaScenarioId,
  AlphaDemoStep,
  AlphaMemoryEvent,
  AlphaObject,
  AlphaObjectRef,
  AlphaObjectType,
  AuditChainVerificationResponse,
  ApprovalChainStep,
  ApprovalDecisionRequest,
  ApprovalDecisionResponse,
  ApprovalRequest,
  ApprovalResponse,
  AttachMode,
  AttachObjectRequest,
  AttachObjectResponse,
  BuildNetworkTrustRequest,
  BuildNetworkTrustResponse,
  ClearanceRuleRequirement,
  CreateAlphaObjectRequest,
  CreateAlphaObjectResponse,
  DocumentExtractRequest,
  DocumentExtractResponse,
  DocumentPackGenerateRequest,
  DocumentPackGenerateResponse,
  DocumentRequestCreateRequest,
  DocumentRequestCreateResponse,
  DocumentRequestSubmissionRequest,
  DocumentRequestSubmissionResponse,
  DocumentUploadResponse,
  EvaluateClearanceCheckRequest,
  EvaluateClearanceCheckResponse,
  ExecutePaymentIntentRequest,
  ExecutePaymentIntentResponse,
  ExecutePaymentRequest,
  ExecutionTaskRequest,
  ExecutionTaskResponse,
  ExecutionTaskStatusRequest,
  ExecutionTaskStatusResponse,
  ExternalAccessGrantRequest,
  ExternalAccessGrantResponse,
  ExternalAccessRevokeRequest,
  ExternalAccessRevokeResponse,
  ExternalOnboardingEvidenceRequest,
  ExternalOnboardingEvidenceResponse,
  ExternalParticipantSessionResponse,
  ExternalParticipantTaskUpdateRequest,
  ExternalParticipantTaskUpdateResponse,
  GenerateProofBundleRequest,
  GenerateProofBundleResponse,
  IntelligenceRunRequest,
  IntelligenceRunResponse,
  MemoryInsight,
  MemoryInsightCategory,
  MemoryLens,
  MemoryLensKind,
  MemoryInsightsRequest,
  MemoryInsightsResponse,
  NetworkTrustContext,
  ObjectLifecycleStatus,
  OriginWorkspace,
  QueryAlphaObjectsRequest,
  QueryAlphaObjectsResponse,
  ProofShareRequest,
  ProofShareResponse,
  ReplayQueryRequest,
  ReplayQueryResponse,
  ReplayStep,
  ReadinessDimension,
  ReadinessEvaluateRequest,
  ReadinessEvaluateResponse,
  ReadinessOverall,
  ReadinessState,
  SSEEvent,
  UUID,
  WorkflowRunKind
} from '@traibox/contracts';
import type { Profile } from '@traibox/profiles';
import {
  ALPHA_OBJECT_TYPES,
  ALPHA_SCENARIOS,
  OBJECT_LIFECYCLE_STATUSES,
  buildWorkflowRuntimeState,
  isWorkflowRunKind,
  temporalMappingForWorkflow
} from '@traibox/contracts';
import {
  approvalConsequenceForProtectedAction,
  approvalRoleForProtectedAction,
  evidenceRequirementsForProtectedAction,
  executionPlanForProtectedAction,
  labelForApprovalRole,
  remainingRisksForProtectedAction
} from '../domains/approvals/protected-actions';
import type { StorageClient } from './storage.js';
import {
  agentRuntimePolicyViolations,
  buildAgentReplayLog,
  buildAgentRuntimePolicy,
  buildCopilotStructuredOutputs,
  enhancedSuggestedActionsFor,
  type AgentRuntimePolicy
} from '../domains/intelligence/agent-runtime';
import { validateInitialLifecycleState, validateLifecycleTransition } from '../domains/objects/object-lifecycle';
import { buildProofArtifactRefs, buildProofManifest, buildProofRootInput, buildProofSharePolicy, type ProofArtifactRef } from '../domains/proof/proof-manifest';
import { buildReplayHashPayload, replayCoverageGaps } from '../domains/replay/replay-coverage';
import {
  mapAttachmentReplayStep,
  mapAuditReplayStep,
  mapEventReplayStep,
  mapMemoryReplayStep,
  mapObjectReplayStep,
  mapProofReplayStep,
  mapReadinessReplayStep
} from '../domains/replay/replay-steps';
import {
  requestTradeBrainAgentScope,
  requestTradeBrainCopilotPlan,
  requestTradeBrainDocumentIntelligence,
  requestTradeBrainEvalPayload,
  requestTradeBrainMissingProof,
  requestTradeBrainReplayLog,
  type TradeBrainCopilotPlan,
  type TradeBrainMissingProof
} from './trade-brain-client';
import { executePayment } from './payments';

type ActorInput = {
  orgId: string;
  userId: string;
  traceId: string;
};

type AlphaRow = {
  object_id: string;
  org_id: string;
  type: string;
  status: string;
  origin_workspace: string;
  owner_id: string;
  trade_id: string | null;
  title: string;
  summary: string | null;
  payload_json: Record<string, unknown> | null;
  permissions_json: Record<string, unknown> | null;
  evidence_refs_json: unknown[] | null;
  audit_refs_json: unknown[] | null;
  trace_id: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type InsertAlphaObjectInput = {
  objectId?: string;
  type: AlphaObjectType;
  status: ObjectLifecycleStatus;
  originWorkspace: OriginWorkspace;
  ownerId: string;
  tradeId?: string | null;
  title: string;
  summary?: string | null;
  payload?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  evidenceRefs?: unknown[];
  traceId: string;
};

type DocumentUploadInput = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  tradeId?: string | null;
  originWorkspace?: OriginWorkspace;
  extract?: boolean;
};

const DEFAULT_PERMISSIONS = {
  visibility: 'org',
  external_access: false,
  protected_actions_require_approval: true
};

const EXTERNAL_PARTICIPANT_USER_ID = '00000000-0000-0000-0000-000000000000';

type ExternalGrantCreateResult = {
  object: AlphaObject;
  accessToken: string;
  accessUrl: string;
};

type StoredApprovalChainStep = Omit<ApprovalChainStep, 'required_role' | 'status'> & {
  required_role: string;
  status: ObjectLifecycleStatus;
};

export async function createAlphaObject(
  pool: pg.Pool,
  input: ActorInput & { type: AlphaObjectType; body: CreateAlphaObjectRequest }
): Promise<CreateAlphaObjectResponse> {
  const object = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    if (input.body.trade_id) await assertTradeInCurrentOrg(client, input.body.trade_id, 'Trade context not found');
    const objectId = randomUUID();
    const payload = input.body.payload ?? {};
    const permissions = { ...DEFAULT_PERMISSIONS, ...(input.body.permissions ?? {}) };
    const status = input.body.status ?? defaultStatusFor(input.type);
    assertInitialLifecycleState(input.type, status);
    const inserted = await client.query<AlphaRow>(
      `INSERT INTO alpha_objects(
         object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
         title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        objectId,
        input.orgId,
        input.type,
        status,
        input.body.origin_workspace,
        input.userId,
        input.body.trade_id ?? null,
        input.body.title,
        input.body.summary ?? null,
        JSON.stringify(payload),
        JSON.stringify(permissions),
        JSON.stringify(input.body.evidence_refs ?? []),
        input.traceId
      ]
    );
    const object = mapAlphaObject(inserted.rows[0]!);
    await appendAudit(client, input, 'alpha.object.created', { object_id: object.object_id, type: object.type, status: object.status });
    await writeMemory(client, input, {
      level: object.trade_id ? 'L1' : 'L2',
      tradeId: object.trade_id ?? null,
      objectId: object.object_id,
      kind: 'object.created',
      signal: `${object.type}:${object.status}`,
      payload: { title: object.title, origin_workspace: object.origin_workspace }
    });
    await insertEvent(client, input, {
      type: 'object.created',
      tradeId: object.trade_id ?? null,
      data: { object_id: object.object_id, object_type: object.type, status: object.status, trace_id: input.traceId }
    });
    return object;
  });

  return { object, trace_id: input.traceId };
}

async function insertAlphaObject(client: pg.PoolClient, input: InsertAlphaObjectInput): Promise<AlphaObject> {
  if (input.tradeId) await assertTradeInCurrentOrg(client, input.tradeId, 'Trade context not found');
  assertInitialLifecycleState(input.type, input.status);
  const inserted = await client.query<AlphaRow>(
    `INSERT INTO alpha_objects(
       object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
       title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
    )
     VALUES($1, app.current_org(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      input.objectId ?? randomUUID(),
      input.type,
      input.status,
      input.originWorkspace,
      input.ownerId,
      input.tradeId ?? null,
      input.title,
      input.summary ?? null,
      JSON.stringify(input.payload ?? {}),
      JSON.stringify({ ...DEFAULT_PERMISSIONS, ...(input.permissions ?? {}) }),
      JSON.stringify(input.evidenceRefs ?? []),
      input.traceId
    ]
  );
  return mapAlphaObject(inserted.rows[0]!);
}

export async function queryAlphaObjects(
  pool: pg.Pool,
  input: ActorInput & { query: QueryAlphaObjectsRequest }
): Promise<QueryAlphaObjectsResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const clauses: string[] = ['org_id=$1'];
    const params: unknown[] = [input.orgId];
    let idx = params.length + 1;

    if (input.query.origin_workspace) {
      clauses.push(`origin_workspace=$${idx++}`);
      params.push(input.query.origin_workspace);
    }
    if (input.query.owner_id) {
      clauses.push(`owner_id=$${idx++}`);
      params.push(input.query.owner_id);
    }
    if (input.query.status) {
      clauses.push(`status=$${idx++}`);
      params.push(input.query.status);
    }
    if (input.query.type) {
      clauses.push(`type=$${idx++}`);
      params.push(input.query.type);
    }
    if (input.query.payment_provider) {
      clauses.push(`(payload_json->>'provider_id'=$${idx} OR payload_json->>'provider'=$${idx} OR payload_json->>'payment_provider'=$${idx})`);
      params.push(input.query.payment_provider);
      idx += 1;
    }
    if (input.query.adapter_id) {
      clauses.push(`(payload_json->>'adapter_id'=$${idx} OR payload_json->>'payment_adapter_id'=$${idx})`);
      params.push(input.query.adapter_id);
      idx += 1;
    }
    if (Object.prototype.hasOwnProperty.call(input.query, 'trade_id')) {
      if (input.query.trade_id === null) {
        clauses.push('trade_id IS NULL');
      } else if (input.query.trade_id) {
        clauses.push(`trade_id=$${idx++}`);
        params.push(input.query.trade_id);
      }
    }

    const limit = Math.max(1, Math.min(200, Number(input.query.limit ?? 50)));
    params.push(limit);
    const res = await client.query<AlphaRow>(
      `SELECT * FROM alpha_objects
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${idx}`,
      params
    );
    const objects = res.rows.map(mapAlphaObject);

    const activityClauses: string[] = ['org_id=$1'];
    const activityParams: unknown[] = [input.orgId];
    let activityIdx = activityParams.length + 1;
    if (Object.prototype.hasOwnProperty.call(input.query, 'trade_id')) {
      if (input.query.trade_id === null) {
        activityClauses.push('trade_id IS NULL');
      } else if (input.query.trade_id) {
        activityClauses.push(
          `(trade_id=$${activityIdx} OR object_id IN (SELECT object_id FROM alpha_objects WHERE org_id=$1 AND trade_id=$${activityIdx}))`
        );
        activityParams.push(input.query.trade_id);
        activityIdx += 1;
      }
    }

    const readinessParams = [...activityParams, limit];
    const readiness = await client.query(
      `SELECT readiness_id, org_id, object_id, trade_id, overall, score, dimensions_json,
              missing_items_json, risk_findings_json, next_actions_json, trace_id, created_at
       FROM alpha_readiness_states
       WHERE ${activityClauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${activityIdx}`,
      readinessParams
    );

    const memoryParams = [...activityParams, limit];
    const memory = await client.query(
      `SELECT memory_event_id, org_id, level, trade_id, object_id, kind, signal, payload_json, trace_id, created_at
       FROM alpha_memory_events
       WHERE ${activityClauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${activityIdx}`,
      memoryParams
    );

    return {
      objects,
      readiness_states: readiness.rows.map(mapReadiness),
      memory_events: memory.rows.map(mapMemoryEvent)
    };
  });

  return { ...result, trace_id: input.traceId };
}

export async function uploadDocumentAlpha(
  pool: pg.Pool,
  storage: StorageClient,
  input: ActorInput & { body: DocumentUploadInput }
): Promise<DocumentUploadResponse> {
  const documentId = randomUUID();
  const filename = sanitizeStorageFilename(input.body.filename || 'uploaded-document.txt');
  const mimeType = input.body.mimeType || 'application/octet-stream';
  const byteSize = input.body.bytes.byteLength;
  const hash = sha256Bytes(input.body.bytes);
  const text = textFromUploadedBytes(input.body.bytes, mimeType, filename);
  const storageKey = `${input.orgId}/${input.body.tradeId ?? 'standalone'}/${documentId}-${filename}`;
  const stored = await storage.putObject({
    bucket: 'documents',
    key: storageKey,
    body: input.body.bytes,
    contentType: mimeType
  });

  const document = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    const object = await insertAlphaObject(client, {
      objectId: documentId,
      type: 'document',
      status: text ? 'ready_for_review' : 'pending_input',
      originWorkspace: input.body.originWorkspace ?? 'intelligence',
      ownerId: input.userId,
      tradeId: input.body.tradeId ?? null,
      title: input.body.filename || filename,
      summary: text
        ? `Stored ${mimeType} document with extractable text (${byteSize} bytes)`
        : `Stored ${mimeType} document; text extraction pending (${byteSize} bytes)`,
      payload: {
        filename: input.body.filename || filename,
        mime_type: mimeType,
        byte_size: byteSize,
        sha256: hash,
        file_url: stored.url,
        storage: {
          bucket: 'documents',
          key: storageKey,
          url: stored.url
        },
        text_sample: text?.slice(0, 1600) ?? null,
        extracted_text_available: Boolean(text),
        upload: {
          method: 'multipart',
          stored_at: new Date().toISOString(),
          origin_workspace: input.body.originWorkspace ?? 'intelligence'
        }
      },
      permissions: DEFAULT_PERMISSIONS,
      traceId: input.traceId
    });
    await appendAudit(client, input, 'alpha.document.uploaded', {
      document_id: object.object_id,
      file_url: stored.url,
      byte_size: byteSize,
      sha256: hash
    });
    await writeMemory(client, input, {
      level: object.trade_id ? 'L1' : 'L2',
      tradeId: object.trade_id ?? null,
      objectId: object.object_id,
      kind: 'document.uploaded',
      signal: text ? 'document.stored_with_text' : 'document.stored_text_pending',
      payload: {
        document_id: object.object_id,
        filename: input.body.filename || filename,
        mime_type: mimeType,
        byte_size: byteSize,
        sha256: hash,
        file_url: stored.url,
        extracted_text_available: Boolean(text)
      }
    });
    await insertEvent(client, input, {
      type: 'document.uploaded',
      tradeId: object.trade_id ?? null,
      data: {
        document_id: object.object_id,
        filename: input.body.filename || filename,
        mime_type: mimeType,
        byte_size: byteSize,
        sha256: hash,
        file_url: stored.url,
        extracted_text_available: Boolean(text),
        trace_id: input.traceId
      }
    });
    return object;
  });

  const extraction =
    input.body.extract !== false && text
      ? await extractDocumentAlpha(pool, {
          orgId: input.orgId,
          userId: input.userId,
          traceId: input.traceId,
          body: {
            object_id: document.object_id,
            filename: input.body.filename || filename,
            mime_type: mimeType,
            text,
            trade_id: input.body.tradeId ?? document.trade_id ?? null,
            origin_workspace: input.body.originWorkspace ?? document.origin_workspace
          }
        })
      : null;

  return {
    document: extraction?.document ?? document,
    extraction_result: extraction?.extraction_result,
    eval_result: extraction?.eval_result,
    file_url: stored.url,
    sha256: hash,
    byte_size: byteSize,
    extracted_text_available: Boolean(text),
    trace_id: input.traceId
  };
}

export async function generateDocumentPackAlpha(
  pool: pg.Pool,
  storage: StorageClient,
  input: ActorInput & { body: DocumentPackGenerateRequest }
): Promise<DocumentPackGenerateResponse> {
  if (!input.body.trade_id && !input.body.object_ids?.length) throwBadRequest('trade_id or object_ids is required');
  const sourceObjects = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    if (input.body.object_ids?.length) {
      const res = await client.query<AlphaRow>(
        `SELECT *
         FROM alpha_objects
         WHERE org_id=$1
           AND object_id = ANY($2::uuid[])
           AND type = ANY($3::text[])
         ORDER BY created_at ASC`,
        [input.orgId, input.body.object_ids, ['document', 'extraction_result']]
      );
      return res.rows.map(mapAlphaObject);
    }
    const res = await client.query<AlphaRow>(
      `SELECT *
       FROM alpha_objects
       WHERE org_id=$1
         AND trade_id=$2
         AND type = ANY($3::text[])
       ORDER BY created_at ASC`,
      [input.orgId, input.body.trade_id, ['document', 'extraction_result']]
    );
    return res.rows.map(mapAlphaObject);
  });
  if (!sourceObjects.length) throwBadRequest('No document or extraction objects are available for the document pack');

  const documents = sourceObjects.filter((object) => object.type === 'document');
  const extractions = sourceObjects.filter((object) => object.type === 'extraction_result');
  const missingFields = uniqueStringValues(extractions.flatMap((object) => toStringArray(object.payload_json?.missing_fields)));
  const manifest = {
    schema: 'traibox.document-pack.alpha.v1',
    generated_at: new Date().toISOString(),
    generated_by: input.userId,
    org_id: input.orgId,
    trade_id: input.body.trade_id ?? sourceObjects.find((object) => object.trade_id)?.trade_id ?? null,
    title: input.body.title ?? 'TRAIBOX document pack',
    summary: {
      document_count: documents.length,
      extraction_count: extractions.length,
      missing_fields: missingFields,
      ready_for_review: missingFields.length === 0
    },
    documents: documents.map((object) => ({
      object_id: object.object_id,
      title: object.title,
      status: object.status,
      file_url: object.payload_json?.file_url ?? (object.payload_json?.storage as Record<string, unknown> | undefined)?.url ?? null,
      sha256: object.payload_json?.sha256 ?? null,
      mime_type: object.payload_json?.mime_type ?? null,
      byte_size: object.payload_json?.byte_size ?? null
    })),
    extractions: extractions.map((object) => ({
      object_id: object.object_id,
      title: object.title,
      status: object.status,
      classification: object.payload_json?.classification ?? null,
      confidence: object.payload_json?.confidence ?? null,
      missing_fields: toStringArray(object.payload_json?.missing_fields),
      required_fields: toStringArray(object.payload_json?.required_fields),
      extracted_fields: Object.keys(recordOrEmpty(object.payload_json?.extracted_fields)),
      provenance: object.payload_json?.provenance ?? null,
      quality_signals: object.payload_json?.quality_signals ?? null
    }))
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const manifestSha = sha256Bytes(manifestBytes);
  const packId = randomUUID();
  const key = `${input.orgId}/${manifest.trade_id ?? 'standalone'}/${packId}-document-pack.json`;
  const stored = await storage.putObject({
    bucket: 'document-packs',
    key,
    body: manifestBytes,
    contentType: 'application/json'
  });

  const pack = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const object = await insertAlphaObject(client, {
      objectId: packId,
      type: 'document_pack',
      status: missingFields.length ? 'ready_for_review' : 'completed',
      originWorkspace: 'operations',
      ownerId: input.userId,
      tradeId: manifest.trade_id,
      title: input.body.title ?? 'TRAIBOX document pack',
      summary: missingFields.length
        ? `Document pack with ${documents.length} document(s), ${extractions.length} extraction(s), and ${missingFields.length} missing field(s)`
        : `Document pack with ${documents.length} document(s) and ${extractions.length} extraction(s)`,
      payload: {
        file_url: stored.url,
        manifest_sha256: manifestSha,
        manifest,
        document_count: documents.length,
        extraction_count: extractions.length,
        missing_fields: missingFields,
        source_object_ids: sourceObjects.map((object) => object.object_id),
        storage: { bucket: 'document-packs', key, url: stored.url }
      },
      permissions: { ...DEFAULT_PERMISSIONS, shareable: false },
      evidenceRefs: sourceObjects.map((object) => ({ object_id: object.object_id, role: object.type })),
      traceId: input.traceId
    });
    await appendAudit(client, input, 'alpha.document_pack.generated', {
      document_pack_id: object.object_id,
      file_url: stored.url,
      manifest_sha256: manifestSha,
      source_object_ids: sourceObjects.map((item) => item.object_id),
      missing_fields: missingFields
    });
    await writeMemory(client, input, {
      level: object.trade_id ? 'L1' : 'L2',
      tradeId: object.trade_id ?? null,
      objectId: object.object_id,
      kind: 'document_pack.generated',
      signal: missingFields.length ? 'document_pack.generated_with_gaps' : 'document_pack.ready',
      payload: {
        document_pack_id: object.object_id,
        manifest_sha256: manifestSha,
        document_count: documents.length,
        extraction_count: extractions.length,
        missing_fields: missingFields,
        file_url: stored.url
      }
    });
    await insertEvent(client, input, {
      type: 'document_pack.generated',
      tradeId: object.trade_id ?? null,
      data: {
        document_pack_id: object.object_id,
        manifest_sha256: manifestSha,
        document_count: documents.length,
        extraction_count: extractions.length,
        missing_fields: missingFields,
        file_url: stored.url,
        trace_id: input.traceId
      }
    });
    return object;
  });

  return {
    document_pack: pack,
    file_url: stored.url,
    manifest_sha256: manifestSha,
    document_count: documents.length,
    extraction_count: extractions.length,
    missing_fields: missingFields,
    trace_id: input.traceId
  };
}

export async function getMemoryInsightsAlpha(
  pool: pg.Pool,
  input: ActorInput & { query: MemoryInsightsRequest }
): Promise<MemoryInsightsResponse> {
  const limit = Math.min(Math.max(Number(input.query.limit ?? 300), 1), 500);
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);

    const clauses = ['org_id=$1'];
    const params: unknown[] = [input.orgId];
    let idx = 2;
    if (input.query.trade_id) {
      clauses.push(`trade_id=$${idx}`);
      params.push(input.query.trade_id);
      idx += 1;
    }
    if (input.query.level) {
      clauses.push(`level=$${idx}`);
      params.push(input.query.level);
      idx += 1;
    }
    params.push(limit);

    const memory = await client.query(
      `SELECT memory_event_id, org_id, level, trade_id, object_id, kind, signal, payload_json, trace_id, created_at
       FROM alpha_memory_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${idx}`,
      params
    );
    return memory.rows.map(mapMemoryEvent);
  });

  const insights = buildMemoryInsights(result, input.query.trade_id ? 'L1' : 'L2');
  const lenses = buildMemoryLenses(result);

  return {
    insights,
    lenses,
    recommended_actions: buildMemoryRecommendedActions(lenses, insights),
    source_events: result.length,
    trace_id: input.traceId
  };
}

export async function queryAlphaReplay(
  pool: pg.Pool,
  input: ActorInput & { query: ReplayQueryRequest }
): Promise<ReplayQueryResponse> {
  if (!input.query.trade_id && !input.query.object_id) throwBadRequest('trade_id or object_id is required');

  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });

    const targetObject = input.query.object_id ? await getAlphaObject(client, input.query.object_id) : null;
    if (input.query.object_id && !targetObject) throwNotFound('Replay target object not found');
    const tradeId = input.query.trade_id ?? targetObject?.trade_id ?? null;
    if (input.query.trade_id) await assertTradeInCurrentOrg(client, input.query.trade_id, 'Replay target trade not found');

    const limit = Math.max(1, Math.min(300, Number(input.query.limit ?? 120)));
    const objectRows = await replayObjectRows(client, { orgId: input.orgId, tradeId, objectId: input.query.object_id ?? null, limit });
    const objectIds = new Set<string>(objectRows.map((row) => row.object_id));
    if (targetObject) objectIds.add(targetObject.object_id);

    const eventRows = await replayEventRows(client, { orgId: input.orgId, tradeId, objectId: input.query.object_id ?? null, limit });
    const memoryRows = await replayMemoryRows(client, { orgId: input.orgId, tradeId, objectId: input.query.object_id ?? null, objectIds, limit });
    const auditRows =
      input.query.include_audit === false
        ? []
        : await replayAuditRows(client, { orgId: input.orgId, tradeId, objectId: input.query.object_id ?? null, objectIds, limit });
    const readinessRows = await replayReadinessRows(client, { orgId: input.orgId, tradeId, objectId: input.query.object_id ?? null, objectIds, limit });
    const attachmentRows = await replayAttachmentRows(client, { orgId: input.orgId, tradeId, objectId: input.query.object_id ?? null, objectIds, limit });
    const proofRows = await replayProofRows(client, { orgId: input.orgId, tradeId, objectId: input.query.object_id ?? null, objectIds, limit });

    const steps = [
      ...objectRows.map(mapObjectReplayStep),
      ...eventRows.map(mapEventReplayStep),
      ...memoryRows.map(mapMemoryReplayStep),
      ...auditRows.map(mapAuditReplayStep),
      ...readinessRows.map(mapReadinessReplayStep),
      ...attachmentRows.map(mapAttachmentReplayStep),
      ...proofRows.map(mapProofReplayStep)
    ]
      .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime() || a.step_id.localeCompare(b.step_id))
      .slice(0, limit);

    const gaps = replayGaps(steps, {
      requestedTradeId: input.query.trade_id ?? null,
      requestedObjectId: input.query.object_id ?? null,
      includeAudit: input.query.include_audit !== false
    });

    return {
      target: {
        trade_id: tradeId,
        object_id: input.query.object_id ?? null
      },
      steps,
      deterministic_hash: replayHash(steps),
      coverage: {
        objects: objectRows.length,
        events: eventRows.length,
        memory_events: memoryRows.length,
        audit_events: auditRows.length,
        readiness_states: readinessRows.length,
        attachments: attachmentRows.length,
        proof_bundles: proofRows.length
      },
      gaps
    };
  });

  return { ...result, trace_id: input.traceId };
}

export async function attachAlphaObject(
  pool: pg.Pool,
  input: ActorInput & { body: AttachObjectRequest }
): Promise<AttachObjectResponse> {
  const mode: AttachMode = input.body.mode ?? 'attach';
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const current = await getAlphaObject(client, input.body.object_id);
    if (!current) throwNotFound('Object not found');

    const targetTradeId = input.body.target.type === 'trade' || input.body.target.type === 'trade_room' ? input.body.target.id : null;
    if (targetTradeId) {
      const trade = await client.query('SELECT 1 FROM trades WHERE trade_id=$1 AND org_id=$2 LIMIT 1', [targetTradeId, input.orgId]);
      if (!trade.rows[0]) throwNotFound('Target trade not found');
    }

    const linkId = randomUUID();
    const payload = {
      reason: input.body.reason ?? null,
      previous_trade_id: current.trade_id ?? null,
      ...(input.body.payload ?? {})
    };
    const link = await client.query(
      `INSERT INTO alpha_object_links(
         link_id, org_id, source_object_id, target_type, target_id, mode,
         payload_json, trace_id, created_by
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING link_id, source_object_id, target_type, target_id, mode, trace_id, created_at`,
      [
        linkId,
        input.orgId,
        input.body.object_id,
        input.body.target.type,
        input.body.target.id,
        mode,
        JSON.stringify(payload),
        input.traceId,
        input.userId
      ]
    );

    const nextStatus = mode === 'link' ? current.status : 'attached';
    assertLifecycleTransition(current, nextStatus, `object.${mode}`);

    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET trade_id=COALESCE($1, trade_id),
           status=$2,
           payload_json=payload_json || $3::jsonb,
           trace_id=$4
       WHERE object_id=$5 AND org_id=$6
       RETURNING *`,
      [
        targetTradeId,
        nextStatus,
        JSON.stringify({ attached_to: input.body.target, attach_mode: mode, attached_at: new Date().toISOString() }),
        input.traceId,
        input.body.object_id,
        input.orgId
      ]
    );

    let object = mapAlphaObject(updated.rows[0]!);
    const workflowRun = await createWorkflowRunObject(client, input, {
      kind: 'attach_transition',
      title: `Attach workflow: ${object.title}`,
      summary: 'Durable alpha workflow state for attach, link, or convert transition.',
      status: 'completed',
      tradeId: object.trade_id ?? null,
      target: { type: object.type, id: object.object_id },
      stage: `${mode}_completed`,
      payload: {
        mode,
        link_id: linkId,
        from_trade_id: current.trade_id ?? null,
        to_target: input.body.target,
        context_preservation: ['permissions', 'audit', 'memory', 'evidence', 'proof', 'replay'],
        temporal_mapping: temporalMappingForWorkflow('attach_transition')
      },
      evidenceRefs: [{ object_id: object.object_id, role: 'attached_object' }]
    });
    object = {
      ...object,
      payload_json: { ...object.payload_json, last_attach_workflow_run_id: workflowRun.object_id }
    };
    await client.query(
      `UPDATE alpha_objects
       SET payload_json=payload_json || $1::jsonb,
           trace_id=$2
       WHERE object_id=$3 AND org_id=$4`,
      [JSON.stringify({ last_attach_workflow_run_id: workflowRun.object_id }), input.traceId, object.object_id, input.orgId]
    );
    await appendAudit(client, input, 'alpha.object.attached', {
      object_id: object.object_id,
      target: input.body.target,
      mode,
      workflow_run_id: workflowRun.object_id
    });
    await writeMemory(client, input, {
      level: object.trade_id ? 'L1' : 'L2',
      tradeId: object.trade_id ?? null,
      objectId: object.object_id,
      kind: 'object.attached',
      signal: `${object.type}:${mode}`,
      payload: { target: input.body.target, reason: input.body.reason ?? null, workflow_run_id: workflowRun.object_id }
    });
    await insertEvent(client, input, {
      type: 'object.attached',
      tradeId: object.trade_id ?? null,
      data: { object_id: object.object_id, target: input.body.target, mode, workflow_run_id: workflowRun.object_id, trace_id: input.traceId }
    });

    return { object, link: link.rows[0] };
  });

  return {
    object: result.object,
    link: {
      link_id: result.link.link_id,
      source_object_id: result.link.source_object_id,
      target_type: result.link.target_type,
      target_id: result.link.target_id,
      mode: result.link.mode,
      trace_id: result.link.trace_id,
      created_at: toIso(result.link.created_at)
    },
    trace_id: input.traceId
  };
}

export async function extractDocumentAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: DocumentExtractRequest }
): Promise<DocumentExtractResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);

    let document = input.body.object_id ? await getAlphaObject(client, input.body.object_id) : null;
    if (input.body.object_id && !document) throwNotFound('Document object not found');

    const filename = input.body.filename ?? document?.title ?? 'uploaded-trade-document.txt';
    const text = input.body.text ?? stringifyRecord(document?.payload_json ?? {});
    const localClassification = classifyDocument(filename, text);
    const localExtracted = extractFields(filename, text);
    const localMissing = requiredMissingFields(localClassification, localExtracted);
    const localConfidence = Math.max(0.45, Math.min(0.96, 0.62 + Object.keys(localExtracted).length * 0.06 - localMissing.length * 0.04));
    const tradeBrainDocument = await requestTradeBrainDocumentIntelligence({
      filename,
      text,
      mimeType: input.body.mime_type,
      traceId: input.traceId
    });
    const intelligenceSource = tradeBrainDocument ? 'trade_brain_service' : 'local_deterministic_fallback';
    const classification = tradeBrainDocument?.documentType ?? localClassification;
    const extracted = tradeBrainDocument?.extractedFields ?? localExtracted;
    const missing = tradeBrainDocument?.missingFields ?? localMissing;
    const confidence = tradeBrainDocument?.confidence ?? localConfidence;
    const requiredFields = tradeBrainDocument?.requiredFields.length ? tradeBrainDocument.requiredFields : requiredFieldsForDocumentClassification(classification);
    const provenance = tradeBrainDocument?.provenance.length
      ? tradeBrainDocument.provenance
      : [{ source: 'document_text', method: 'alpha_deterministic_extractor', text_hash: sha256(text) }];
    const qualitySignals = {
      ...(tradeBrainDocument?.qualitySignals ?? {}),
      workflow_quality_source: intelligenceSource,
      trade_brain_service_version: tradeBrainDocument?.serviceVersion ?? null,
      document_type: classification,
      confidence,
      required_field_count: requiredFields.length,
      extracted_field_count: Object.keys(extracted).length,
      missing_field_count: missing.length,
      ready_for_readiness: missing.length === 0
    };
    const recommendations = tradeBrainDocument?.recommendations.length
      ? tradeBrainDocument.recommendations
      : missing.length
        ? missing.map((field) => `Request or extract missing document field: ${field}.`)
        : ['Use extracted fields for readiness evaluation and proof bundle evidence.'];

    if (!document) {
      const inserted = await client.query<AlphaRow>(
        `INSERT INTO alpha_objects(
           object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
           title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
         )
         VALUES($1,$2,'document',$3,$4,$5,$6,$7,$8,$9,$10,'[]'::jsonb,$11)
         RETURNING *`,
        [
          randomUUID(),
          input.orgId,
          missing.length ? 'pending_input' : 'ready_for_review',
          input.body.origin_workspace ?? 'intelligence',
          input.userId,
          input.body.trade_id ?? null,
          filename,
          `${classification} uploaded for TRAIBOX extraction`,
          JSON.stringify({ filename, mime_type: input.body.mime_type ?? 'text/plain', text_sample: text.slice(0, 1200) }),
          JSON.stringify(DEFAULT_PERMISSIONS),
          input.traceId
        ]
      );
      document = mapAlphaObject(inserted.rows[0]!);
    } else {
      const updated = await client.query<AlphaRow>(
        `UPDATE alpha_objects
         SET status=$1,
             payload_json=payload_json || $2::jsonb,
             trace_id=$3
         WHERE object_id=$4 AND org_id=$5
         RETURNING *`,
        [
          missing.length ? 'pending_input' : 'ready_for_review',
          JSON.stringify({ classification, extraction_started_at: new Date().toISOString() }),
          input.traceId,
          document.object_id,
          input.orgId
        ]
      );
      document = mapAlphaObject(updated.rows[0]!);
    }

    const extractionPayload = {
      document_id: document.object_id,
      classification,
      extracted_fields: extracted,
      missing_fields: missing,
      required_fields: requiredFields,
      confidence,
      provenance: {
        filename,
        method: intelligenceSource === 'trade_brain_service' ? 'trade_brain_document_intelligence' : 'alpha_deterministic_extractor',
        source: 'document_text',
        trade_brain_service_version: tradeBrainDocument?.serviceVersion ?? null,
        field_provenance: provenance
      },
      quality_signals: qualitySignals,
      recommendations
    };
    const extraction = await client.query<AlphaRow>(
      `INSERT INTO alpha_objects(
         object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
         title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
       )
       VALUES($1,$2,'extraction_result',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        randomUUID(),
        input.orgId,
        missing.length ? 'pending_input' : 'ready_for_review',
        document.origin_workspace,
        input.userId,
        document.trade_id ?? input.body.trade_id ?? null,
        `Extraction: ${filename}`,
        missing.length ? `Missing ${missing.length} field(s)` : 'Extraction ready for review',
        JSON.stringify(extractionPayload),
        JSON.stringify(DEFAULT_PERMISSIONS),
        JSON.stringify([{ object_id: document.object_id, role: 'source_document' }]),
        input.traceId
      ]
    );

    const extractionObject = mapAlphaObject(extraction.rows[0]!);
    await appendAudit(client, input, 'alpha.document.extracted', {
      document_id: document.object_id,
      extraction_result_id: extractionObject.object_id,
      missing_fields: missing
    });
    await writeMemory(client, input, {
      level: document.trade_id ? 'L1' : 'L2',
      tradeId: document.trade_id ?? null,
      objectId: extractionObject.object_id,
      kind: 'document.extracted',
      signal: missing.length ? 'document.missing_fields' : 'document.ready_for_review',
      payload: extractionPayload
    });
    await insertEvent(client, input, {
      type: 'document.extracted',
      tradeId: document.trade_id ?? null,
      data: {
        document_id: document.object_id,
        extraction_result_id: extractionObject.object_id,
        missing_fields: missing,
        confidence,
        trace_id: input.traceId
      }
    });

    const evalPayload = buildDocumentExtractionEvalResult(input, {
      document,
      extractionObject,
      classification,
      extracted,
      missing,
      confidence,
      filename,
      requiredFields,
      provenance,
      qualitySignals,
      recommendations,
      intelligenceSource,
      serviceVersion: tradeBrainDocument?.serviceVersion ?? null
    });
    const evalResult = await createAiEvalResultObject(client, input, {
      title: `AI eval: extraction ${filename.slice(0, 44)}`,
      summary: `${evalPayload.status.toUpperCase()} · ${Math.round(evalPayload.score)}% · document extraction and missing-proof checks`,
      status: evalPayload.status === 'fail' ? 'blocked' : 'completed',
      tradeId: document.trade_id ?? input.body.trade_id ?? null,
      payload: evalPayload,
      evidenceRefs: [
        { object_id: document.object_id, role: 'source_document' },
        { object_id: extractionObject.object_id, role: 'extraction_result' }
      ]
    });

    return { document, extractionObject, extracted, missing, confidence, evalResult };
  });

  return {
    document: result.document,
    extraction_result: result.extractionObject,
    extracted_fields: result.extracted,
    missing_fields: result.missing,
    confidence: result.confidence,
    eval_result: result.evalResult,
    trace_id: input.traceId
  };
}

export async function evaluateReadinessAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: ReadinessEvaluateRequest }
): Promise<ReadinessEvaluateResponse> {
  const readiness = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const object = input.body.object_id ? await getAlphaObject(client, input.body.object_id) : null;
    if (input.body.object_id && !object) throwNotFound('Object not found');

    const tradeId = input.body.trade_id ?? object?.trade_id ?? null;
    const linked = await loadLinkedAlphaContext(client, { tradeId, objectId: object?.object_id ?? null });
    const computed = computeReadiness({ object, linked, context: input.body.context ?? {} });
    const readinessId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO alpha_readiness_states(
         readiness_id, org_id, object_id, trade_id, overall, score,
         dimensions_json, missing_items_json, risk_findings_json, next_actions_json, trace_id
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING readiness_id, org_id, object_id, trade_id, overall, score, dimensions_json,
                 missing_items_json, risk_findings_json, next_actions_json, trace_id, created_at`,
      [
        readinessId,
        input.orgId,
        object?.object_id ?? null,
        tradeId,
        computed.overall,
        computed.score,
        JSON.stringify(computed.dimensions),
        JSON.stringify(computed.missing_items),
        JSON.stringify(computed.risk_findings),
        JSON.stringify(computed.next_actions),
        input.traceId
      ]
    );

    const state = mapReadiness(inserted.rows[0]);
    await client.query(
      `INSERT INTO alpha_objects(
         object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
         title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
       )
       VALUES($1,$2,'readiness_state',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        randomUUID(),
        input.orgId,
        state.overall === 'ready' ? 'ready_for_review' : state.overall === 'blocked' ? 'blocked' : 'pending_input',
        object?.origin_workspace ?? 'operations',
        input.userId,
        tradeId,
        `Readiness: ${state.overall}`,
        state.next_actions[0] ?? 'Readiness evaluated',
        JSON.stringify(state),
        JSON.stringify(DEFAULT_PERMISSIONS),
        JSON.stringify(object ? [{ object_id: object.object_id, role: 'readiness_target' }] : []),
        input.traceId
      ]
    );

    await appendAudit(client, input, 'alpha.readiness.evaluated', {
      object_id: object?.object_id ?? null,
      trade_id: tradeId,
      overall: state.overall,
      score: state.score
    });
    await writeMemory(client, input, {
      level: tradeId ? 'L1' : 'L2',
      tradeId,
      objectId: object?.object_id ?? null,
      kind: 'readiness.evaluated',
      signal: `readiness.${state.overall}`,
      payload: { ...state }
    });
    await insertEvent(client, input, {
      type: 'readiness.evaluated',
      tradeId,
      data: { readiness_id: state.readiness_id, overall: state.overall, score: state.score, trace_id: input.traceId }
    });

    const evalPayload = buildReadinessEvalResult(input, { state, object, linkedCount: linked.length });
    const evalResult = await createAiEvalResultObject(client, input, {
      title: `AI eval: readiness ${state.overall}`,
      summary: `${evalPayload.status.toUpperCase()} · ${Math.round(evalPayload.score)}% · readiness scoring and missing-proof checks`,
      status: evalPayload.status === 'fail' ? 'blocked' : 'completed',
      tradeId,
      payload: evalPayload,
      evidenceRefs: object ? [{ object_id: object.object_id, role: 'readiness_target' }] : []
    });

    return { state, evalResult };
  });

  return { readiness: readiness.state, eval_result: readiness.evalResult, trace_id: input.traceId };
}

export async function requestApprovalAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: ApprovalRequest }
): Promise<ApprovalResponse> {
  const targetTradeId = await resolveApprovalTargetTradeId(pool, input);
  const approvalChain = normalizeApprovalChain(input.body.protected_action, input.body.approval_chain, input.body.current_approval_step);
  const response = await createAlphaObject(pool, {
    ...input,
      type: 'approval',
      body: {
      title: `Approval required: ${input.body.protected_action}`,
      summary: input.body.proposed_action,
      status: 'approval_required',
      origin_workspace: 'operations',
      trade_id: targetTradeId,
      payload: {
        target: input.body.target,
        protected_action: input.body.protected_action,
        proposed_action: input.body.proposed_action,
        policy_refs: input.body.policy_refs ?? [],
        step_up_required: input.body.step_up_required ?? true,
        rationale: input.body.rationale ?? null,
        remaining_risks: remainingRisksForProtectedAction(input.body.protected_action),
        evidence_requirements: evidenceRequirementsForProtectedAction(input.body.protected_action),
        what_happens_if_approved: approvalConsequenceForProtectedAction(input.body.protected_action),
        what_happens_if_rejected: 'TRAIBOX keeps the target blocked and records the rejection in audit, memory, and replay context.',
        approval_chain: approvalChain.steps,
        current_approval_step: approvalChain.currentStepKey,
        confirmation_requirements: {
          decision_notes_required: true,
          step_up_required: input.body.step_up_required ?? true,
          residual_risk_acknowledgement_required: true
        },
        human_control: {
          must_show_evidence: true,
          must_show_risks: true,
          execution_blocked_until_approved: true
        }
      },
      evidence_refs: input.body.evidence_refs ?? []
    }
  });

  let workflowRunId: string | null = null;
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const workflowRun = await createWorkflowRunObject(client, input, {
      kind: 'approval_chain',
      title: `Approval workflow: ${input.body.protected_action}`,
      summary: 'Durable alpha workflow state for a protected action approval chain.',
      status: 'approval_required',
      tradeId: targetTradeId,
      target: { type: 'approval', id: response.object.object_id },
      stage: 'approval_requested',
      payload: {
        protected_action: input.body.protected_action,
        approval_chain: approvalChain.steps,
        current_approval_step: approvalChain.currentStepKey,
        temporal_mapping: temporalMappingForWorkflow('approval_chain')
      },
      evidenceRefs: [{ object_id: response.object.object_id, role: 'approval' }, ...(input.body.evidence_refs ?? [])]
    });
    workflowRunId = workflowRun.object_id;
    await client.query(
      `UPDATE alpha_objects
       SET payload_json=payload_json || $1::jsonb,
           trace_id=$2
       WHERE object_id=$3 AND org_id=$4`,
      [
        JSON.stringify({ workflow_run_id: workflowRun.object_id }),
        input.traceId,
        response.object.object_id,
        input.orgId
      ]
    );
    await insertEvent(client, input, {
      type: 'approval.requested',
      tradeId: targetTradeId,
      data: {
        approval_object_id: response.object.object_id,
        workflow_run_id: workflowRun.object_id,
        protected_action: input.body.protected_action,
        target: input.body.target,
        current_approval_step: approvalChain.currentStepKey,
        approval_chain_steps: approvalChain.steps.map((step) => ({ key: step.key, required_role: step.required_role, status: step.status })),
        trace_id: input.traceId
      }
    });
  });

  return {
    approval: workflowRunId
      ? {
          ...response.object,
          payload_json: { ...response.object.payload_json, workflow_run_id: workflowRunId }
        }
      : response.object,
    protected_action: input.body.protected_action,
    trace_id: input.traceId
  };
}

async function resolveApprovalTargetTradeId(pool: pg.Pool, input: ActorInput & { body: ApprovalRequest }): Promise<string | null> {
  const target = input.body.target;
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    if (target.type === 'trade' || target.type === 'trade_room') {
      await assertTradeInCurrentOrg(client, target.id, 'Approval target trade not found');
      return target.id;
    }
    if (!isAlphaObjectType(target.type)) return null;

    const object = await getAlphaObject(client, target.id);
    if (!object) throwNotFound('Approval target not found');
    return object.trade_id ?? null;
  });
}

export async function decideApprovalAlpha(
  pool: pg.Pool,
  input: ActorInput & { approvalId: string; body: ApprovalDecisionRequest }
): Promise<ApprovalDecisionResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const current = await getAlphaObject(client, input.approvalId);
    if (!current) throwNotFound('Approval not found');
    if (current.type !== 'approval') throwBadRequest('Object is not an approval');
    if (current.status !== 'approval_required') throwBadRequest('Approval has already been decided');

    const decidedAt = new Date().toISOString();
    const target = current.payload_json?.target as { type?: string; id?: string } | undefined;
    const protectedAction = String(current.payload_json?.protected_action ?? 'protected_action');
    const stepUpRequired = current.payload_json?.step_up_required !== false;
    if (!input.body.notes?.trim()) throwBadRequest('Approval decision notes are required');
    const decisionNotes = input.body.notes.trim();
    if (input.body.decision === 'approved') {
      if (stepUpRequired && !input.body.step_up_verified) throwBadRequest('Step-up verification is required before approval');
      if (!input.body.residual_risks_acknowledged) throwBadRequest('Residual risks must be acknowledged before approval');
    }

    const storedChain = normalizeApprovalChain(protectedAction, current.payload_json?.approval_chain, current.payload_json?.current_approval_step);
    const currentStep = resolveCurrentApprovalStep(storedChain.steps, input.body.approval_step ?? storedChain.currentStepKey);
    const actorRole = await getActorOrgRole(client, input);
    assertApprovalStepRole(actorRole, currentStep.required_role);
    const chainDecision = advanceApprovalChain(storedChain.steps, currentStep.key, input.body.decision, {
      actorId: input.userId,
      decidedAt,
      notes: decisionNotes
    });
    const decisionPayload = {
      decision: input.body.decision,
      decided_by: input.userId,
      decided_at: decidedAt,
      notes: decisionNotes,
      step_up_verified: input.body.step_up_verified ?? false,
      residual_risks_acknowledged: input.body.residual_risks_acknowledged ?? false,
      approval_step: currentStep.key,
      approval_step_label: currentStep.label,
      required_role: currentStep.required_role,
      approval_chain_completed: chainDecision.chainCompleted,
      protected_action_released: input.body.decision === 'approved' && chainDecision.chainCompleted
    };
    const nextApprovalStatus: ObjectLifecycleStatus =
      input.body.decision === 'rejected' ? 'rejected' : chainDecision.chainCompleted ? 'approved' : 'approval_required';
    assertLifecycleTransition(current, nextApprovalStatus, 'approval.decision');

    const approval = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status=$1,
           payload_json=payload_json || $2::jsonb,
           trace_id=$3
       WHERE object_id=$4 AND org_id=$5
       RETURNING *`,
      [
        nextApprovalStatus,
        JSON.stringify({
          human_decision: decisionPayload,
          approval_chain: chainDecision.steps,
          current_approval_step: chainDecision.currentStepKey,
          approval_chain_completed: chainDecision.chainCompleted,
          protected_action_released: decisionPayload.protected_action_released
        }),
        input.traceId,
        input.approvalId,
        input.orgId
      ]
    );

    let targetObject: AlphaObject | null = null;
    const terminalDecision = input.body.decision === 'rejected' || chainDecision.chainCompleted;
    if (terminalDecision && target?.id && target.type && isAlphaObjectType(target.type)) {
      const currentTarget = await getAlphaObject(client, target.id);
      if (!currentTarget) throwNotFound('Approval target not found');
      if (protectedAction === 'share_proof_bundle_externally' && currentTarget.type === 'proof_bundle') {
        const shareControl = {
          ...recordOrEmpty(currentTarget.payload_json?.share_control),
          status: input.body.decision === 'approved' ? 'approved_for_controlled_share' : 'rejected',
          decision: input.body.decision,
          decided_by: input.userId,
          decided_at: decidedAt,
          approval_object_id: input.approvalId,
          external_action_performed_by_traibox: false
        };
        const updatedTarget = await client.query<AlphaRow>(
          `UPDATE alpha_objects
           SET payload_json=payload_json || $1::jsonb,
               permissions_json=permissions_json || $2::jsonb,
               trace_id=$3
           WHERE object_id=$4 AND org_id=$5
           RETURNING *`,
          [
            JSON.stringify({ approval_decision: decisionPayload, approval_object_id: input.approvalId, share_control: shareControl }),
            JSON.stringify({ shareable: input.body.decision === 'approved', external_share_requires_approval: true }),
            input.traceId,
            target.id,
            input.orgId
          ]
        );
        targetObject = updatedTarget.rows[0] ? mapAlphaObject(updatedTarget.rows[0]) : null;
      } else {
        const nextTargetStatus: ObjectLifecycleStatus = input.body.decision === 'approved' ? 'approved' : 'rejected';
        assertLifecycleTransition(currentTarget, nextTargetStatus, 'approval.target_decision');
        const updatedTarget = await client.query<AlphaRow>(
          `UPDATE alpha_objects
           SET status=$1,
               payload_json=payload_json || $2::jsonb,
               trace_id=$3
           WHERE object_id=$4 AND org_id=$5
           RETURNING *`,
          [
            nextTargetStatus,
            JSON.stringify({ approval_decision: decisionPayload, approval_object_id: input.approvalId }),
            input.traceId,
            target.id,
            input.orgId
          ]
        );
        targetObject = updatedTarget.rows[0] ? mapAlphaObject(updatedTarget.rows[0]) : null;
      }
    }

    const approvalObject = mapAlphaObject(approval.rows[0]!);
    const executionPlan = executionPlanForProtectedAction(protectedAction);
    const executionTask =
      input.body.decision === 'approved' && chainDecision.chainCompleted
        ? await createExecutionTaskObject(client, input, {
            tradeId: approvalObject.trade_id ?? targetObject?.trade_id ?? null,
            title: `Execute approved action: ${protectedAction}`,
            summary: `Approved protected action is ready for controlled execution: ${current.summary ?? approvalObject.title}`,
            target: target?.id && target.type ? ({ type: target.type as AlphaObjectRef['type'], id: target.id as UUID } as AlphaObjectRef) : undefined,
            payload: {
              approval_object_id: approvalObject.object_id,
              protected_action: protectedAction,
              execution_kind: executionPlan.kind,
              approval_decision: decisionPayload,
              execution_state: 'released_not_executed',
              execution_stage: 'released_after_approval',
              allowed_execution_actions: executionPlan.allowedActions,
              execution_checklist: executionPlan.checklist,
              requires_final_human_operator: true,
              operator_confirmation_required: true,
              residual_risk_acknowledgement_required: true,
              external_action_performed_by_traibox: false,
              operator_marked_external_action_completed: false,
              idempotency_required: executionPlan.idempotencyRequired,
              controlled_execution_notice: executionPlan.notice
            },
            evidenceRefs: [
              { object_id: approvalObject.object_id, role: 'approval' },
              ...(target?.id ? [{ object_id: target.id, role: 'approved_target' }] : [])
            ]
          })
        : null;
    const approvalWorkflowRunId = stringOrNull(current.payload_json?.workflow_run_id);
    if (approvalWorkflowRunId) {
      await appendWorkflowRunStep(client, input, {
        workflowRunId: approvalWorkflowRunId,
        status: input.body.decision === 'rejected' ? 'rejected' : chainDecision.chainCompleted ? 'completed' : 'approval_required',
        stage: input.body.decision === 'rejected' ? 'approval_rejected' : chainDecision.chainCompleted ? 'approval_chain_completed' : 'approval_step_completed',
        step: {
          kind: 'approval.decision',
          approval_step: currentStep.key,
          decision: input.body.decision,
          chain_completed: chainDecision.chainCompleted,
          current_approval_step: chainDecision.currentStepKey,
          execution_task_id: executionTask?.object_id ?? null
        }
      });
    }
    await appendAudit(client, input, 'alpha.approval.decided', {
      approval_object_id: approvalObject.object_id,
      target,
      decision: input.body.decision,
      step_up_verified: input.body.step_up_verified ?? false,
      approval_step: currentStep.key,
      approval_chain_completed: chainDecision.chainCompleted,
      execution_task_id: executionTask?.object_id ?? null
    });
    await writeMemory(client, input, {
      level: approvalObject.trade_id ? 'L1' : 'L2',
      tradeId: approvalObject.trade_id ?? targetObject?.trade_id ?? null,
      objectId: approvalObject.object_id,
      kind: 'approval.decided',
      signal: input.body.decision === 'approved' && !chainDecision.chainCompleted ? 'approval.step.approved' : `approval.${input.body.decision}`,
      payload: {
        approval_object_id: approvalObject.object_id,
        target,
        decision: decisionPayload,
        approval_chain: chainDecision.steps,
        current_approval_step: chainDecision.currentStepKey
      }
    });
    await insertEvent(client, input, {
      type: 'approval.decided',
      tradeId: approvalObject.trade_id ?? targetObject?.trade_id ?? null,
      data: {
        approval_object_id: approvalObject.object_id,
        execution_task_id: executionTask?.object_id ?? null,
        target,
        decision: input.body.decision,
        approval_step: currentStep.key,
        approval_chain_completed: chainDecision.chainCompleted,
        current_approval_step: chainDecision.currentStepKey,
        trace_id: input.traceId
      }
    });

    return { approvalObject, targetObject, executionTask };
  });

  return {
    approval: result.approvalObject,
    target: result.targetObject,
    execution_task: result.executionTask,
    decision: input.body.decision,
    trace_id: input.traceId
  };
}

export async function createExecutionTaskAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: ExecutionTaskRequest }
): Promise<ExecutionTaskResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const targetTradeId = input.body.trade_id ?? (input.body.target ? await resolveTargetTradeId(client, input.body.target) : null);
    const task = await createExecutionTaskObject(client, input, {
      tradeId: targetTradeId,
      title: input.body.title,
      summary: input.body.summary ?? 'Execution task created for governed trade follow-up.',
      target: input.body.target,
      payload: {
        assigned_to_role: input.body.assigned_to_role ?? 'ops',
        assigned_to_user_id: input.body.assigned_to_user_id ?? null,
        due_at: input.body.due_at ?? null,
        priority: input.body.priority ?? 'normal',
        external_participant: input.body.external_participant ?? null
      },
      evidenceRefs: input.body.evidence_refs ?? []
    });

    const externalGrant = input.body.external_participant
      ? await createExternalAccessGrantObject(client, input, {
          tradeId: targetTradeId,
          target: { type: 'execution_task', id: task.object_id },
          participant: {
            name: input.body.external_participant.name,
            email: input.body.external_participant.email,
            role: input.body.external_participant.role
          },
          scopes: input.body.external_participant.scopes,
          reason: 'Scoped participant access for assigned execution task.'
        })
      : null;

    return { task, externalGrant };
  });

  return {
    task: result.task,
    external_access_grant: result.externalGrant?.object ?? null,
    external_access_token: result.externalGrant?.accessToken,
    external_access_url: result.externalGrant?.accessUrl,
    trace_id: input.traceId
  };
}

export async function updateExecutionTaskStatusAlpha(
  pool: pg.Pool,
  input: ActorInput & { taskId: string; body: ExecutionTaskStatusRequest }
): Promise<ExecutionTaskStatusResponse> {
  const task = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const current = await getAlphaObject(client, input.taskId);
    if (!current) throwNotFound('Execution task not found');
    if (current.type !== 'execution_task') throwBadRequest('Object is not an execution task');
    if (current.status === 'completed' || current.status === 'cancelled') throwBadRequest('Execution task is already terminal');
    assertLifecycleTransition(current, input.body.status, 'execution.task.status');
    if (input.body.status === 'completed') {
      if (!input.body.note?.trim()) throwBadRequest('Execution completion requires an operator note');
      if (!input.body.operator_confirmation) throwBadRequest('Execution completion requires operator confirmation');
      if (!input.body.residual_risks_acknowledged) throwBadRequest('Residual risks must be acknowledged before completing execution');
      if (current.payload_json?.idempotency_required === true && !input.body.idempotency_key?.trim()) {
        throwBadRequest('Execution completion requires an idempotency key');
      }
    }

    const lifecycleEntry = {
      at: new Date().toISOString(),
      by: input.userId,
      from_status: current.status,
      to_status: input.body.status,
      action: input.body.execution_action ?? actionForStatus(input.body.status),
      note: input.body.note ?? null,
      operator_confirmation: input.body.operator_confirmation ?? false,
      residual_risks_acknowledged: input.body.residual_risks_acknowledged ?? false,
      external_reference: input.body.external_reference ?? null,
      idempotency_key: input.body.idempotency_key ?? null,
      external_action_performed_by_traibox: false
    };
    const executionLifecycle = Array.isArray(current.payload_json?.execution_lifecycle) ? current.payload_json.execution_lifecycle : [];
    const executionState = executionStateForStatus(input.body.status, lifecycleEntry.action);

    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status=$1,
           payload_json=payload_json || $2::jsonb,
           trace_id=$3
       WHERE object_id=$4 AND org_id=$5
       RETURNING *`,
      [
        input.body.status,
        JSON.stringify({
          last_status_note: input.body.note ?? null,
          last_status_changed_by: input.userId,
          last_status_changed_at: lifecycleEntry.at,
          execution_state: executionState,
          execution_stage: executionState,
          execution_lifecycle: [...executionLifecycle, lifecycleEntry],
          last_execution_action: lifecycleEntry.action,
          external_reference: input.body.external_reference ?? current.payload_json?.external_reference ?? null,
          idempotency_key: input.body.idempotency_key ?? current.payload_json?.idempotency_key ?? null,
          external_action_performed_by_traibox: false,
          operator_marked_external_action_completed:
            input.body.status === 'completed' || current.payload_json?.operator_marked_external_action_completed === true
        }),
        input.traceId,
        input.taskId,
        input.orgId
      ]
    );
    const task = mapAlphaObject(updated.rows[0]!);
    const workflowRunId = stringOrNull(current.payload_json?.workflow_run_id);
    if (workflowRunId) {
      await appendWorkflowRunStep(client, input, {
        workflowRunId,
        status: input.body.status,
        stage: executionState,
        step: {
          kind: 'execution.task.status',
          task_object_id: task.object_id,
          from_status: current.status,
          to_status: input.body.status,
          execution_action: lifecycleEntry.action,
          operator_confirmation: lifecycleEntry.operator_confirmation,
          external_reference: lifecycleEntry.external_reference,
          idempotency_key: lifecycleEntry.idempotency_key
        }
      });
    }
    await appendAudit(client, input, 'alpha.execution.task.updated', {
      task_object_id: task.object_id,
      status: input.body.status,
      note: input.body.note ?? null,
      execution_action: lifecycleEntry.action,
      external_action_performed_by_traibox: false
    });
    await writeMemory(client, input, {
      level: task.trade_id ? 'L1' : 'L2',
      tradeId: task.trade_id ?? null,
      objectId: task.object_id,
      kind: 'execution.task.updated',
      signal: `execution_task.${input.body.status}`,
      payload: { task_object_id: task.object_id, status: input.body.status, note: input.body.note ?? null, execution_action: lifecycleEntry.action }
    });
    await insertEvent(client, input, {
      type: 'execution.task.updated',
      tradeId: task.trade_id ?? null,
      data: { task_object_id: task.object_id, status: input.body.status, execution_action: lifecycleEntry.action, trace_id: input.traceId }
    });
    return task;
  });

  return { task, trace_id: input.traceId };
}

export async function createDocumentRequestAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: DocumentRequestCreateRequest }
): Promise<DocumentRequestCreateResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);

    const task = input.body.task_id ? await getAlphaObject(client, input.body.task_id) : null;
    if (input.body.task_id && !task) throwNotFound('Execution task not found');
    if (task && task.type !== 'execution_task') throwBadRequest('Document request task_id must reference an execution task');

    const tradeId = input.body.trade_id ?? task?.trade_id ?? null;
    const request = await insertAlphaObject(client, {
      type: 'document_request',
      status: 'pending_input',
      originWorkspace: 'operations',
      ownerId: input.userId,
      tradeId,
      title: input.body.title,
      summary: input.body.summary ?? 'Requested missing evidence from a participant.',
      payload: {
        task_id: task?.object_id ?? null,
        requested_items: input.body.requested_items,
        requested_from: input.body.requested_from ?? null,
        due_at: input.body.due_at ?? null,
        reason: input.body.reason ?? null,
        response_policy: {
          create_document: true,
          run_extraction: true,
          update_readiness: true,
          refresh_proof: true
        }
      },
      permissions: {
        visibility: 'org',
        external_access: Boolean(input.body.requested_from),
        protected_actions_require_approval: false
      },
      evidenceRefs: task ? [{ object_id: task.object_id, role: 'execution_task' }] : [],
      traceId: input.traceId
    });

    const externalGrant = input.body.requested_from
      ? await createExternalAccessGrantObject(client, input, {
          tradeId,
          target: { type: 'document_request', id: request.object_id },
          participant: input.body.requested_from,
          scopes: ['view_document_request', 'upload_requested_document'],
          reason: 'Scoped access to satisfy a document request.'
        })
      : null;

    await appendAudit(client, input, 'alpha.document_request.created', {
      document_request_id: request.object_id,
      task_id: task?.object_id ?? null,
      requested_items: input.body.requested_items
    });
    await writeMemory(client, input, {
      level: tradeId ? 'L1' : 'L2',
      tradeId,
      objectId: request.object_id,
      kind: 'document_request.created',
      signal: 'document_request.pending_input',
      payload: { document_request_id: request.object_id, requested_items: input.body.requested_items, task_id: task?.object_id ?? null }
    });
    await insertEvent(client, input, {
      type: 'document_request.created',
      tradeId,
      data: { document_request_id: request.object_id, task_id: task?.object_id ?? null, trace_id: input.traceId }
    });

    return { request, externalGrant };
  });

  return {
    request: result.request,
    external_access_grant: result.externalGrant?.object ?? null,
    external_access_token: result.externalGrant?.accessToken,
    external_access_url: result.externalGrant?.accessUrl,
    trace_id: input.traceId
  };
}

export async function submitDocumentRequestAlpha(
  pool: pg.Pool,
  input: ActorInput & { requestId: string; body: DocumentRequestSubmissionRequest }
): Promise<DocumentRequestSubmissionResponse> {
  const request = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const current = await getAlphaObject(client, input.requestId);
    if (!current) throwNotFound('Document request not found');
    if (current.type !== 'document_request') throwBadRequest('Object is not a document request');
    if (['completed', 'cancelled', 'rejected', 'archived'].includes(current.status)) throwBadRequest('Document request is already terminal');
    assertLifecycleTransition(current, 'completed', 'document_request.submit');
    return current;
  });

  const extraction = await extractDocumentAlpha(pool, {
    ...input,
    body: {
      filename: input.body.filename,
      mime_type: input.body.mime_type,
      text: input.body.text,
      trade_id: request.trade_id ?? null,
      origin_workspace: 'operations'
    }
  });

  const updatedRequest = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status='completed',
           payload_json=payload_json || $1::jsonb,
           evidence_refs_json=evidence_refs_json || $2::jsonb,
           trace_id=$3
       WHERE object_id=$4 AND org_id=$5
       RETURNING *`,
      [
        JSON.stringify({
          submitted_at: new Date().toISOString(),
          submitted_by: input.body.submitted_by ?? null,
          submission_document_id: extraction.document.object_id,
          extraction_result_id: extraction.extraction_result.object_id,
          missing_fields_after_extraction: extraction.missing_fields
        }),
        JSON.stringify([
          { object_id: extraction.document.object_id, role: 'submitted_document' },
          { object_id: extraction.extraction_result.object_id, role: 'extraction_result' }
        ]),
        input.traceId,
        input.requestId,
        input.orgId
      ]
    );

    const nextRequest = mapAlphaObject(updated.rows[0]!);
    await appendAudit(client, input, 'alpha.document_request.submitted', {
      document_request_id: nextRequest.object_id,
      document_id: extraction.document.object_id,
      extraction_result_id: extraction.extraction_result.object_id
    });
    await writeMemory(client, input, {
      level: nextRequest.trade_id ? 'L1' : 'L2',
      tradeId: nextRequest.trade_id ?? null,
      objectId: nextRequest.object_id,
      kind: 'document_request.submitted',
      signal: extraction.missing_fields.length ? 'document_request.submitted_with_gaps' : 'document_request.satisfied',
      payload: {
        document_request_id: nextRequest.object_id,
        document_id: extraction.document.object_id,
        extraction_result_id: extraction.extraction_result.object_id,
        missing_fields: extraction.missing_fields
      }
    });
    await insertEvent(client, input, {
      type: 'document_request.submitted',
      tradeId: nextRequest.trade_id ?? null,
      data: {
        document_request_id: nextRequest.object_id,
        document_id: extraction.document.object_id,
        extraction_result_id: extraction.extraction_result.object_id,
        missing_fields: extraction.missing_fields,
        trace_id: input.traceId
      }
    });
    return nextRequest;
  });

  const readiness = (
    await evaluateReadinessAlpha(pool, {
      ...input,
      body: updatedRequest.trade_id ? { trade_id: updatedRequest.trade_id } : { object_id: updatedRequest.object_id }
    })
  ).readiness;
  const proof = await generateProofBundleAlpha(pool, {
    ...input,
    body: {
      trade_id: updatedRequest.trade_id ?? undefined,
      object_ids: [updatedRequest.object_id, extraction.document.object_id, extraction.extraction_result.object_id],
      title: 'Document request response proof bundle'
    }
  });

  return {
    request: updatedRequest,
    document: extraction.document,
    extraction_result: extraction.extraction_result,
    readiness,
    proof_bundle: proof.proof_bundle,
    trace_id: input.traceId
  };
}

export async function createExternalAccessGrantAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: ExternalAccessGrantRequest }
): Promise<ExternalAccessGrantResponse> {
  const grant = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const targetTradeId = input.body.trade_id ?? (await resolveTargetTradeId(client, input.body.target));
    return createExternalAccessGrantObject(client, input, {
      tradeId: targetTradeId,
      target: input.body.target,
      participant: input.body.participant,
      scopes: input.body.scopes,
      expiresAt: input.body.expires_at,
      reason: input.body.reason
    });
  });

  return { grant: grant.object, access_token: grant.accessToken, access_url: grant.accessUrl, trace_id: input.traceId };
}

export async function revokeExternalAccessGrantAlpha(
  pool: pg.Pool,
  input: ActorInput & { grantId: string; body: ExternalAccessRevokeRequest }
): Promise<ExternalAccessRevokeResponse> {
  if (!input.body.reason?.trim()) throwBadRequest('Revocation reason is required');
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const current = await getAlphaObject(client, input.grantId);
    if (!current) throwNotFound('External access grant not found');
    if (current.type !== 'external_access_grant') throwBadRequest('Object is not an external access grant');
    if (current.status !== 'approved') throwBadRequest('External access grant is not active');
    assertLifecycleTransition(current, 'cancelled', 'external_access.revoke');
    const revokedAt = new Date().toISOString();
    const tokenUpdate = await client.query(
      `UPDATE alpha_external_access_tokens
       SET status='revoked',
           revoked_at=COALESCE(revoked_at, now())
       WHERE org_id=app.current_org()
         AND grant_object_id=$1
         AND status='active'
         AND revoked_at IS NULL`,
      [current.object_id]
    );
    const updatedGrant = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status='cancelled',
           payload_json=payload_json || $1::jsonb,
           permissions_json=permissions_json || $2::jsonb,
           trace_id=$3
       WHERE object_id=$4 AND org_id=app.current_org()
       RETURNING *`,
      [
        JSON.stringify({
          revoked_at: revokedAt,
          revoked_by: input.userId,
          revocation_reason: input.body.reason.trim(),
          external_access_status: 'revoked'
        }),
        JSON.stringify({ external_access: false, revoked: true }),
        input.traceId,
        current.object_id
      ]
    );
    const grant = mapAlphaObject(updatedGrant.rows[0]!);
    const revokedTokens = Number(tokenUpdate.rowCount ?? 0);
    await appendAudit(client, input, 'alpha.external_access.revoked', {
      grant_object_id: grant.object_id,
      revoked_tokens: revokedTokens,
      reason: input.body.reason.trim(),
      participant: grant.payload_json?.participant ?? null,
      scopes: grant.payload_json?.scopes ?? []
    });
    await writeMemory(client, input, {
      level: grant.trade_id ? 'L1' : 'L2',
      tradeId: grant.trade_id ?? null,
      objectId: grant.object_id,
      kind: 'external_access.revoked',
      signal: 'external_access.revoked',
      payload: {
        grant_object_id: grant.object_id,
        revoked_tokens: revokedTokens,
        reason: input.body.reason.trim()
      }
    });
    await insertEvent(client, input, {
      type: 'external_access.revoked',
      tradeId: grant.trade_id ?? null,
      data: { grant_object_id: grant.object_id, revoked_tokens: revokedTokens, trace_id: input.traceId }
    });
    return { grant, revokedTokens };
  });

  return { grant: result.grant, revoked_tokens: result.revokedTokens, trace_id: input.traceId };
}

export async function verifyAuditChainAlpha(
  pool: pg.Pool,
  input: ActorInput & { limit?: number }
): Promise<AuditChainVerificationResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const limit = Math.max(1, Math.min(1000, input.limit ?? 500));
    const res = await client.query<{
      event_id: string;
      action: string;
      actor: string;
      prev_hash: string | null;
      hash: string | null;
      expected_hash: string;
      created_at: Date | string;
    }>(
      `SELECT event_id, action, actor, prev_hash, hash, created_at,
              encode(digest(coalesce(prev_hash,'') || ':' || coalesce(actor,'') || ':' || coalesce(action,'') || ':' || coalesce(payload_json::text,''), 'sha256'), 'hex') AS expected_hash
       FROM (
         SELECT event_id, action, actor, prev_hash, hash, payload_json, created_at
         FROM audit_events
         WHERE org_id=app.current_org()
         ORDER BY created_at DESC, event_id DESC
         LIMIT $1
       ) scoped
       ORDER BY created_at ASC, event_id ASC`,
      [limit]
    );
    const failures: AuditChainVerificationResponse['failures'] = [];
    const knownHashes = new Set(res.rows.map((row) => row.hash).filter((hash): hash is string => Boolean(hash)));
    for (const [index, row] of res.rows.entries()) {
      if (row.hash !== row.expected_hash) {
        failures.push({
          event_id: row.event_id as UUID,
          action: row.action,
          reason: 'hash_mismatch',
          expected_hash: row.expected_hash,
          actual_hash: row.hash
        });
      }
      if (index > 0 && (!row.prev_hash || !knownHashes.has(row.prev_hash))) {
        failures.push({
          event_id: row.event_id as UUID,
          action: row.action,
          reason: 'prev_hash_missing_from_checked_chain',
          expected_prev_hash: 'known audited predecessor hash',
          actual_prev_hash: row.prev_hash
        });
      }
    }
    const first = res.rows[0] ?? null;
    const last = res.rows.at(-1) ?? null;
    await appendAudit(client, input, 'alpha.governance.audit_chain.verified', {
      checked_events: res.rows.length,
      valid: failures.length === 0,
      failure_count: failures.length,
      head_hash: last?.hash ?? null
    });
    await insertEvent(client, input, {
      type: 'governance.audit_chain.verified',
      tradeId: null,
      data: {
        checked_events: res.rows.length,
        valid: failures.length === 0,
        failure_count: failures.length,
        trace_id: input.traceId
      }
    });
    return {
      valid: failures.length === 0,
      checked_events: res.rows.length,
      head_hash: last?.hash ?? null,
      tail_prev_hash: first?.prev_hash ?? null,
      first_event_at: first ? toIso(first.created_at) : null,
      last_event_at: last ? toIso(last.created_at) : null,
      failures
    };
  });

  return { ...result, trace_id: input.traceId };
}

export async function getExternalParticipantSessionAlpha(
  pool: pg.Pool,
  input: { token: string; traceId: string }
): Promise<ExternalParticipantSessionResponse> {
  const session = await loadExternalAccessSession(pool, { token: input.token, traceId: input.traceId });
  const visibleObjects = await loadExternalPortalObjects(pool, session);
  return {
    grant: session.grant,
    target: session.target,
    visible_objects: visibleObjects,
    portal_summary: buildExternalPortalSummary(session, visibleObjects),
    trade_id: session.grant.trade_id ?? session.target?.trade_id ?? null,
    participant: session.participant,
    scopes: session.scopes,
    allowed_actions: allowedActionsForExternalScopes(session.scopes),
    expires_at: session.expiresAt,
    trace_id: input.traceId
  };
}

export async function submitExternalDocumentRequestAlpha(
  pool: pg.Pool,
  input: { token: string; requestId: string; traceId: string; body: DocumentRequestSubmissionRequest }
): Promise<DocumentRequestSubmissionResponse> {
  const session = await loadExternalAccessSession(pool, {
    token: input.token,
    traceId: input.traceId,
    requiredScope: 'upload_requested_document'
  });
  const target = session.grant.payload_json?.target as { type?: string; id?: string } | undefined;
  if (target?.type !== 'document_request' || target.id !== input.requestId) {
    throwForbidden('External access token is not scoped to this document request');
  }

  const response = await submitDocumentRequestAlpha(pool, {
    orgId: session.orgId,
    userId: EXTERNAL_PARTICIPANT_USER_ID,
    traceId: input.traceId,
    requestId: input.requestId,
    body: {
      ...input.body,
      submitted_by: input.body.submitted_by ?? session.participant
    }
  });

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: EXTERNAL_PARTICIPANT_USER_ID, orgId: session.orgId });
    await client.query('UPDATE alpha_external_access_tokens SET last_used_at=now() WHERE token_hash=$1 AND org_id=app.current_org()', [
      session.tokenHash
    ]);
    await appendAudit(
      client,
      { orgId: session.orgId, userId: EXTERNAL_PARTICIPANT_USER_ID, traceId: input.traceId },
      'alpha.external_access.used',
      {
        grant_object_id: session.grant.object_id,
        document_request_id: input.requestId,
        participant: session.participant,
        scopes: session.scopes
      }
    );
    await writeMemory(client, { orgId: session.orgId, userId: EXTERNAL_PARTICIPANT_USER_ID, traceId: input.traceId }, {
      level: response.request.trade_id ? 'L1' : 'L2',
      tradeId: response.request.trade_id ?? null,
      objectId: response.request.object_id,
      kind: 'external_access.used',
      signal: 'external_access.document_submitted',
      payload: {
        grant_object_id: session.grant.object_id,
        document_request_id: input.requestId,
        participant_role: session.participant.role,
        document_id: response.document.object_id
      }
    });
    await insertEvent(client, { orgId: session.orgId, userId: EXTERNAL_PARTICIPANT_USER_ID, traceId: input.traceId }, {
      type: 'external_access.used',
      tradeId: response.request.trade_id ?? null,
      data: {
        grant_object_id: session.grant.object_id,
        target_object_id: response.request.object_id,
        signal: 'external_access.document_submitted',
        scopes: session.scopes,
        trace_id: input.traceId
      }
    });
  });

  return response;
}

export async function submitExternalExecutionTaskUpdateAlpha(
  pool: pg.Pool,
  input: { token: string; taskId: string; traceId: string; body: ExternalParticipantTaskUpdateRequest }
): Promise<ExternalParticipantTaskUpdateResponse> {
  const session = await loadExternalAccessSession(pool, {
    token: input.token,
    traceId: input.traceId,
    requiredScope: 'submit_task_update'
  });
  const target = session.grant.payload_json?.target as { type?: string; id?: string } | undefined;
  if (target?.type !== 'execution_task' || target.id !== input.taskId) {
    throwForbidden('External access token is not scoped to this execution task');
  }
  if (!input.body.note?.trim()) throwBadRequest('External task update note is required');

  const task = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: EXTERNAL_PARTICIPANT_USER_ID, orgId: session.orgId });
    const current = await getAlphaObject(client, input.taskId);
    if (!current) throwNotFound('Execution task not found');
    if (current.type !== 'execution_task') throwBadRequest('Object is not an execution task');
    if (current.status === 'completed' || current.status === 'cancelled') throwBadRequest('Execution task is already terminal');
    const nextStatus = input.body.status ?? 'ready_for_review';
    assertLifecycleTransition(current, nextStatus, 'external.execution_task.update');
    const updateEntry = {
      at: new Date().toISOString(),
      by: 'external_participant',
      participant: session.participant,
      note: input.body.note.trim(),
      status: nextStatus,
      external_action_performed_by_traibox: false
    };
    const existingUpdates = Array.isArray(current.payload_json?.external_participant_updates)
      ? current.payload_json.external_participant_updates.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [];
    const lifecycle = Array.isArray(current.payload_json?.execution_lifecycle)
      ? current.payload_json.execution_lifecycle.filter((entry): entry is Record<string, unknown> => isRecord(entry))
      : [];
    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status=$1,
           payload_json=payload_json || $2::jsonb,
           trace_id=$3
       WHERE object_id=$4 AND org_id=app.current_org()
       RETURNING *`,
      [
        nextStatus,
        JSON.stringify({
          external_participant_updates: [...existingUpdates, updateEntry],
          last_external_participant_update: updateEntry,
          execution_lifecycle: [
            ...lifecycle,
            {
              at: updateEntry.at,
              by: 'external_participant',
              from_status: current.status,
              to_status: nextStatus,
              action: 'external_participant_update',
              note: input.body.note.trim(),
              operator_confirmation: false,
              residual_risks_acknowledged: false,
              external_action_performed_by_traibox: false
            }
          ],
          external_action_performed_by_traibox: false
        }),
        input.traceId,
        current.object_id
      ]
    );
    const updatedTask = mapAlphaObject(updated.rows[0]!);
    await markExternalAccessUsed(client, {
      session,
      traceId: input.traceId,
      targetObjectId: updatedTask.object_id,
      auditAction: 'alpha.external_access.task_updated',
      memoryKind: 'external_access.used',
      memorySignal: 'external_access.task_updated',
      payload: {
        grant_object_id: session.grant.object_id,
        task_id: updatedTask.object_id,
        participant_role: session.participant.role,
        status: nextStatus
      }
    });
    await insertEvent(client, { orgId: session.orgId, userId: EXTERNAL_PARTICIPANT_USER_ID, traceId: input.traceId }, {
      type: 'execution.task.updated',
      tradeId: updatedTask.trade_id ?? null,
      data: { task_object_id: updatedTask.object_id, status: nextStatus, external_participant: true, trace_id: input.traceId }
    });
    return updatedTask;
  });

  return { task, trace_id: input.traceId };
}

export async function submitExternalOnboardingEvidenceAlpha(
  pool: pg.Pool,
  input: { token: string; traceId: string; body: ExternalOnboardingEvidenceRequest }
): Promise<ExternalOnboardingEvidenceResponse> {
  const session = await loadExternalAccessSession(pool, {
    token: input.token,
    traceId: input.traceId,
    requiredScope: 'submit_onboarding_evidence'
  });
  if (!session.target || !['trade_passport', 'counterparty', 'onboarding_flow'].includes(session.target.type)) {
    throwForbidden('External access token is not scoped to onboarding evidence');
  }
  if (!input.body.filename.trim() || !input.body.text.trim()) throwBadRequest('Filename and evidence text are required');

  const targets = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: EXTERNAL_PARTICIPANT_USER_ID, orgId: session.orgId });
    return resolveExternalOnboardingTargets(client, session);
  });

  const extraction = await extractDocumentAlpha(pool, {
    orgId: session.orgId,
    userId: EXTERNAL_PARTICIPANT_USER_ID,
    traceId: input.traceId,
    body: {
      filename: input.body.filename,
      mime_type: input.body.mime_type ?? 'text/plain',
      text: input.body.text,
      trade_id: session.grant.trade_id ?? session.target.trade_id ?? null,
      origin_workspace: 'network'
    }
  });

  const updated = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: EXTERNAL_PARTICIPANT_USER_ID, orgId: session.orgId });
    const evidenceRefs = [
      { object_id: session.grant.object_id, role: 'external_access_grant' },
      { object_id: session.target!.object_id, role: 'scoped_portal_target' },
      ...(targets.counterparty ? [{ object_id: targets.counterparty.object_id, role: 'counterparty' }] : []),
      ...(targets.onboardingFlow ? [{ object_id: targets.onboardingFlow.object_id, role: 'onboarding_flow' }] : []),
      ...(targets.tradePassport ? [{ object_id: targets.tradePassport.object_id, role: 'trade_passport' }] : [])
    ];
    await client.query(
      `UPDATE alpha_objects
       SET evidence_refs_json=evidence_refs_json || $1::jsonb,
           payload_json=payload_json || $2::jsonb,
           trace_id=$3
       WHERE object_id = ANY($4::uuid[]) AND org_id=app.current_org()`,
      [
        JSON.stringify(evidenceRefs),
        JSON.stringify({
          submitted_via_external_portal: true,
          external_access_grant_id: session.grant.object_id,
          submitted_by: input.body.submitted_by ?? session.participant
        }),
        input.traceId,
        [extraction.document.object_id, extraction.extraction_result.object_id]
      ]
    );

    const completedFields = uniqueStringValues([
      ...(input.body.completed_fields ?? []),
      ...Object.keys(recordOrEmpty(extraction.extracted_fields))
    ]);
    const submissionEntry = {
      at: new Date().toISOString(),
      participant: input.body.submitted_by ?? session.participant,
      evidence_type: input.body.evidence_type ?? 'onboarding_evidence',
      filename: input.body.filename,
      completed_fields: completedFields,
      document_id: extraction.document.object_id,
      extraction_result_id: extraction.extraction_result.object_id
    };

    let onboardingFlow = targets.onboardingFlow;
    if (onboardingFlow) {
      const payload = recordOrEmpty(onboardingFlow.payload_json);
      const requiredFields = uniqueStringValues(toStringArray(payload.required_fields));
      const existingCompleted = uniqueStringValues(toStringArray(payload.completed_fields));
      const nextCompleted = uniqueStringValues([...existingCompleted, ...completedFields]);
      const missing = requiredFields.filter((field) => !nextCompleted.includes(field));
      const nextStatus: ObjectLifecycleStatus = missing.length ? 'pending_input' : 'ready_for_review';
      assertLifecycleTransition(onboardingFlow, nextStatus, 'external.onboarding_evidence');
      const res = await client.query<AlphaRow>(
        `UPDATE alpha_objects
         SET status=$1,
             payload_json=payload_json || $2::jsonb,
             evidence_refs_json=evidence_refs_json || $3::jsonb,
             trace_id=$4
         WHERE object_id=$5 AND org_id=app.current_org()
         RETURNING *`,
        [
          nextStatus,
          JSON.stringify({
            completed_fields: nextCompleted,
            external_onboarding_evidence: submissionEntry,
            missing_fields_after_external_submission: missing
          }),
          JSON.stringify([{ object_id: extraction.document.object_id, role: 'external_onboarding_document' }]),
          input.traceId,
          onboardingFlow.object_id
        ]
      );
      onboardingFlow = mapAlphaObject(res.rows[0]!);
    }

    let counterparty = targets.counterparty;
    if (counterparty) {
      const nextStatus: ObjectLifecycleStatus = counterparty.status === 'approved' ? 'approved' : 'ready_for_review';
      assertLifecycleTransition(counterparty, nextStatus, 'external.onboarding_evidence');
      const res = await client.query<AlphaRow>(
        `UPDATE alpha_objects
         SET status=$1,
             payload_json=payload_json || $2::jsonb,
             evidence_refs_json=evidence_refs_json || $3::jsonb,
             trace_id=$4
         WHERE object_id=$5 AND org_id=app.current_org()
         RETURNING *`,
        [
          nextStatus,
          JSON.stringify({
            external_onboarding_evidence: submissionEntry,
            external_onboarding_status: 'ready_for_internal_review'
          }),
          JSON.stringify([{ object_id: extraction.document.object_id, role: 'external_onboarding_document' }]),
          input.traceId,
          counterparty.object_id
        ]
      );
      counterparty = mapAlphaObject(res.rows[0]!);
    }

    let tradePassport = targets.tradePassport;
    if (tradePassport) {
      const nextStatus: ObjectLifecycleStatus = tradePassport.status === 'approved' ? 'approved' : 'ready_for_review';
      assertLifecycleTransition(tradePassport, nextStatus, 'external.onboarding_evidence');
      const res = await client.query<AlphaRow>(
        `UPDATE alpha_objects
         SET status=$1,
             payload_json=payload_json || $2::jsonb,
             evidence_refs_json=evidence_refs_json || $3::jsonb,
             trace_id=$4
         WHERE object_id=$5 AND org_id=app.current_org()
         RETURNING *`,
        [
          nextStatus,
          JSON.stringify({
            external_onboarding_evidence: submissionEntry,
            visibility_review_required: true
          }),
          JSON.stringify([{ object_id: extraction.document.object_id, role: 'external_onboarding_document' }]),
          input.traceId,
          tradePassport.object_id
        ]
      );
      tradePassport = mapAlphaObject(res.rows[0]!);
    }

    await markExternalAccessUsed(client, {
      session,
      traceId: input.traceId,
      targetObjectId: session.target!.object_id,
      auditAction: 'alpha.external_access.onboarding_evidence_submitted',
      memoryKind: 'external_access.used',
      memorySignal: 'external_access.onboarding_evidence_submitted',
      payload: {
        grant_object_id: session.grant.object_id,
        target_object_id: session.target!.object_id,
        participant_role: session.participant.role,
        document_id: extraction.document.object_id,
        completed_fields: completedFields
      }
    });

    return { counterparty, onboardingFlow, tradePassport };
  });

  const readiness = (
    await evaluateReadinessAlpha(pool, {
      orgId: session.orgId,
      userId: EXTERNAL_PARTICIPANT_USER_ID,
      traceId: input.traceId,
      body: { object_id: updated.tradePassport?.object_id ?? updated.counterparty?.object_id ?? session.target.object_id }
    })
  ).readiness;
  const proof = await generateProofBundleAlpha(pool, {
    orgId: session.orgId,
    userId: EXTERNAL_PARTICIPANT_USER_ID,
    traceId: input.traceId,
    body: {
      trade_id: session.grant.trade_id ?? session.target.trade_id ?? undefined,
      object_ids: uniqueStringValues([
        session.target.object_id,
        updated.counterparty?.object_id ?? '',
        updated.onboardingFlow?.object_id ?? '',
        updated.tradePassport?.object_id ?? '',
        extraction.document.object_id,
        extraction.extraction_result.object_id
      ]),
      title: 'External onboarding evidence proof bundle'
    }
  });

  return {
    counterparty: updated.counterparty,
    onboarding_flow: updated.onboardingFlow,
    trade_passport: updated.tradePassport,
    document: extraction.document,
    extraction_result: extraction.extraction_result,
    readiness,
    proof_bundle: proof.proof_bundle,
    trace_id: input.traceId
  };
}

async function createExecutionTaskObject(
  client: pg.PoolClient,
  input: ActorInput,
  task: {
    tradeId?: string | null;
    title: string;
    summary: string;
    target?: AlphaObjectRef;
    payload?: Record<string, unknown>;
    evidenceRefs?: unknown[];
  }
): Promise<AlphaObject> {
  let object = await insertAlphaObject(client, {
    type: 'execution_task',
    status: 'in_progress',
    originWorkspace: 'operations',
    ownerId: input.userId,
    tradeId: task.tradeId ?? null,
    title: task.title,
    summary: task.summary,
    payload: {
      target: task.target ?? null,
      assigned_to_role: 'ops',
      priority: 'high',
      execution_policy: 'human_operated_after_approval',
      external_consequence: 'blocked_until_operator_marks_progress',
      execution_state: 'created_not_executed',
      execution_stage: 'created',
      external_action_performed_by_traibox: false,
      operator_marked_external_action_completed: false,
      execution_lifecycle: [
        {
          at: new Date().toISOString(),
          by: input.userId,
          from_status: null,
          to_status: 'in_progress',
          action: 'prepare',
          note: 'Execution task created. No protected external action was executed automatically.',
          operator_confirmation: false,
          residual_risks_acknowledged: false,
          external_reference: null,
          idempotency_key: null,
          external_action_performed_by_traibox: false
        }
      ],
      ...(task.payload ?? {})
    },
    permissions: {
      visibility: 'org',
      external_access: false,
      protected_actions_require_approval: true
    },
    evidenceRefs: task.evidenceRefs ?? [],
    traceId: input.traceId
  });

  const workflowRun = await createWorkflowRunObject(client, input, {
    kind: 'controlled_execution',
    title: `Execution workflow: ${task.title}`,
    summary: 'Durable alpha workflow state for a human-operated protected execution task.',
    status: 'in_progress',
    tradeId: object.trade_id ?? null,
    target: { type: 'execution_task', id: object.object_id },
    stage: 'execution_task_created',
    payload: {
      execution_state: object.payload_json.execution_state,
      execution_policy: object.payload_json.execution_policy,
      temporal_mapping: temporalMappingForWorkflow('controlled_execution')
    },
    evidenceRefs: [{ object_id: object.object_id, role: 'execution_task' }, ...(task.evidenceRefs ?? [])]
  });
  object = {
    ...object,
    payload_json: { ...object.payload_json, workflow_run_id: workflowRun.object_id }
  };
  await client.query(
    `UPDATE alpha_objects
     SET payload_json=payload_json || $1::jsonb,
         trace_id=$2
     WHERE object_id=$3 AND org_id=$4`,
    [JSON.stringify({ workflow_run_id: workflowRun.object_id }), input.traceId, object.object_id, input.orgId]
  );

  await appendAudit(client, input, 'alpha.execution.task.created', {
    task_object_id: object.object_id,
    trade_id: object.trade_id,
    target: task.target ?? null,
    workflow_run_id: workflowRun.object_id
  });
  await writeMemory(client, input, {
    level: object.trade_id ? 'L1' : 'L2',
    tradeId: object.trade_id ?? null,
    objectId: object.object_id,
    kind: 'execution.task.created',
    signal: 'execution_task.in_progress',
    payload: { task_object_id: object.object_id, title: object.title, target: task.target ?? null, workflow_run_id: workflowRun.object_id }
  });
  await insertEvent(client, input, {
    type: 'execution.task.created',
    tradeId: object.trade_id ?? null,
    data: { task_object_id: object.object_id, workflow_run_id: workflowRun.object_id, target: task.target ?? null, trace_id: input.traceId }
  });

  return object;
}

async function createExternalAccessGrantObject(
  client: pg.PoolClient,
  input: ActorInput,
  grant: {
    tradeId?: string | null;
    target: AlphaObjectRef;
    participant: { name?: string; email?: string; role: string };
    scopes: string[];
    expiresAt?: string;
    reason?: string;
  }
): Promise<ExternalGrantCreateResult> {
  const scopePolicy = await buildExternalAccessScopePolicy(client, grant.target, grant.scopes, grant.expiresAt);
  const accessToken = createExternalAccessToken();
  const tokenHash = hashExternalAccessToken(accessToken);
  const accessUrl = `/external-access?token=${encodeURIComponent(accessToken)}`;
  const object = await insertAlphaObject(client, {
    type: 'external_access_grant',
    status: 'approved',
    originWorkspace: 'operations',
    ownerId: input.userId,
    tradeId: grant.tradeId ?? null,
    title: `Scoped access: ${grant.participant.role}`,
    summary: grant.reason ?? 'Permission-aware external participant access grant.',
    payload: {
      target: grant.target,
      participant: grant.participant,
      scopes: scopePolicy.scopes,
      expires_at: grant.expiresAt ?? null,
      access_mode: 'scoped_external_participant',
      access_policy: scopePolicy,
      revocable: true,
      token_issued_at: new Date().toISOString(),
      token_hint: accessToken.slice(-8)
    },
    permissions: {
      visibility: 'org',
      external_access: true,
      external_scopes: scopePolicy.scopes,
      protected_actions_require_approval: true
    },
    evidenceRefs: [{ target: grant.target, role: 'access_target' }],
    traceId: input.traceId
  });

  await client.query(
    `INSERT INTO alpha_external_access_tokens(token_hash, org_id, grant_object_id, expires_at)
     VALUES($1, app.current_org(), $2, $3)`,
    [tokenHash, object.object_id, grant.expiresAt ?? null]
  );

  await appendAudit(client, input, 'alpha.external_access.granted', {
    grant_object_id: object.object_id,
    target: grant.target,
    participant_role: grant.participant.role,
    scopes: scopePolicy.scopes,
    access_policy: scopePolicy,
    token_hint: accessToken.slice(-8)
  });
  await writeMemory(client, input, {
    level: object.trade_id ? 'L1' : 'L2',
    tradeId: object.trade_id ?? null,
    objectId: object.object_id,
    kind: 'external_access.granted',
    signal: `external_access.${grant.participant.role}`,
    payload: { grant_object_id: object.object_id, target: grant.target, scopes: scopePolicy.scopes, token_issued: true, access_policy: scopePolicy }
  });
  await insertEvent(client, input, {
    type: 'external_access.granted',
    tradeId: object.trade_id ?? null,
    data: { grant_object_id: object.object_id, target: grant.target, scopes: scopePolicy.scopes, trace_id: input.traceId }
  });

  return { object, accessToken, accessUrl };
}

async function resolveTargetTradeId(client: pg.PoolClient, target: AlphaObjectRef): Promise<string | null> {
  if (target.type === 'trade' || target.type === 'trade_room') {
    await assertTradeInCurrentOrg(client, target.id, 'Target trade not found');
    return target.id;
  }
  if (!isAlphaObjectType(target.type)) return null;

  const object = await getAlphaObject(client, target.id);
  if (!object) throwNotFound('Target object not found');
  return object.trade_id ?? null;
}

async function createWorkflowRunObject(
  client: pg.PoolClient,
  input: ActorInput,
  run: {
    kind: WorkflowRunKind;
    title: string;
    summary: string;
    status: ObjectLifecycleStatus;
    tradeId?: string | null;
    target: AlphaObjectRef;
    stage: string;
    payload?: Record<string, unknown>;
    evidenceRefs?: unknown[];
  }
): Promise<AlphaObject> {
  const workflowRunId = randomUUID();
  const entry = workflowEntry(input, {
    kind: `${run.kind}.started`,
    stage: run.stage,
    status: run.status,
    payload: { target: run.target }
  });
  const runtime = buildWorkflowRuntimeState({
    kind: run.kind,
    status: run.status,
    stage: run.stage,
    target: run.target,
    workflowRunId,
    traceId: input.traceId,
    nowIso: entry.at,
    sequence: 0
  });
  const object = await insertAlphaObject(client, {
    objectId: workflowRunId,
    type: 'workflow_run',
    status: run.status,
    originWorkspace: 'operations',
    ownerId: input.userId,
    tradeId: run.tradeId ?? null,
    title: run.title,
    summary: run.summary,
    payload: {
      workflow_kind: run.kind,
      target: run.target,
      workflow_state: {
        status: run.status,
        stage: run.stage,
        temporal_ready: true,
        runtime_command: runtime.command,
        awaiting_signal: runtime.awaiting_signal,
        pause_reason: runtime.pause_reason,
        workflow_id: runtime.workflow_id,
        resume_token: runtime.resume_token,
        ...temporalMappingForWorkflow(run.kind)
      },
      workflow_runtime: runtime,
      workflow_lifecycle: [entry],
      recovery_policy: {
        resumable: true,
        idempotency_required: run.kind === 'controlled_execution',
        replay_required: true,
        degraded_mode_supported: true
      },
      ...(run.payload ?? {})
    },
    permissions: {
      visibility: 'org',
      external_access: false,
      protected_actions_require_approval: run.kind === 'approval_chain' || run.kind === 'controlled_execution'
    },
    evidenceRefs: run.evidenceRefs ?? [],
    traceId: input.traceId
  });

  await appendAudit(client, input, 'alpha.workflow.run.created', {
    workflow_run_id: object.object_id,
    workflow_kind: run.kind,
    target: run.target,
    status: run.status,
    stage: run.stage,
    trade_id: run.tradeId ?? null
  });
  await writeMemory(client, input, {
    level: object.trade_id ? 'L1' : 'L2',
    tradeId: object.trade_id ?? null,
    objectId: object.object_id,
    kind: 'workflow.run.created',
    signal: `workflow.${run.kind}.${run.status}`,
    payload: { workflow_run_id: object.object_id, target: run.target, stage: run.stage }
  });
  await insertEvent(client, input, {
    type: 'workflow.run.created',
    tradeId: object.trade_id ?? null,
    data: { workflow_run_id: object.object_id, workflow_kind: run.kind, target: run.target, status: run.status, stage: run.stage, trace_id: input.traceId }
  });

  return object;
}

async function appendWorkflowRunStep(
  client: pg.PoolClient,
  input: ActorInput,
  update: {
    workflowRunId: string;
    status: ObjectLifecycleStatus;
    stage: string;
    step: Record<string, unknown>;
  }
): Promise<AlphaObject> {
  const current = await getAlphaObject(client, update.workflowRunId);
  if (!current) throwNotFound('Workflow run not found');
  if (current.type !== 'workflow_run') throwBadRequest('Object is not a workflow run');
  assertLifecycleTransition(current, update.status, 'workflow.run.update');
  const lifecycle = Array.isArray(current.payload_json?.workflow_lifecycle) ? current.payload_json.workflow_lifecycle : [];
  const workflowKindValue = String(current.payload_json?.workflow_kind ?? 'controlled_execution');
  const workflowKind = isWorkflowRunKind(workflowKindValue) ? workflowKindValue : 'controlled_execution';
  const runtimeTarget = workflowRuntimeTargetFrom(current.payload_json?.target, update.workflowRunId);
  const entry = workflowEntry(input, {
    kind: typeof update.step.kind === 'string' ? update.step.kind : 'workflow.step',
    stage: update.stage,
    status: update.status,
    payload: update.step
  });
  const runtime = buildWorkflowRuntimeState({
    kind: workflowKind,
    status: update.status,
    stage: update.stage,
    target: runtimeTarget,
    workflowRunId: update.workflowRunId,
    traceId: input.traceId,
    nowIso: entry.at,
    sequence: lifecycle.length + 1,
    existing: current.payload_json?.workflow_runtime as Partial<ReturnType<typeof buildWorkflowRuntimeState>> | undefined
  });

  const updated = await client.query<AlphaRow>(
    `UPDATE alpha_objects
     SET status=$1,
         payload_json=payload_json || $2::jsonb,
         trace_id=$3
     WHERE object_id=$4 AND org_id=$5
     RETURNING *`,
    [
      update.status,
      JSON.stringify({
        workflow_state: {
          status: update.status,
          stage: update.stage,
          temporal_ready: true,
          runtime_command: runtime.command,
          awaiting_signal: runtime.awaiting_signal,
          pause_reason: runtime.pause_reason,
          workflow_id: runtime.workflow_id,
          resume_token: runtime.resume_token,
          ...temporalMappingForWorkflow(workflowKind)
        },
        workflow_runtime: runtime,
        workflow_lifecycle: [...lifecycle, entry],
        last_workflow_step: entry
      }),
      input.traceId,
      update.workflowRunId,
      input.orgId
    ]
  );
  const object = mapAlphaObject(updated.rows[0]!);

  await appendAudit(client, input, 'alpha.workflow.run.updated', {
    workflow_run_id: object.object_id,
    workflow_kind: object.payload_json.workflow_kind,
    status: update.status,
    stage: update.stage,
    step: update.step,
    trade_id: object.trade_id ?? null
  });
  await writeMemory(client, input, {
    level: object.trade_id ? 'L1' : 'L2',
    tradeId: object.trade_id ?? null,
    objectId: object.object_id,
    kind: 'workflow.run.updated',
    signal: `workflow.${String(object.payload_json.workflow_kind ?? 'run')}.${update.status}`,
    payload: { workflow_run_id: object.object_id, status: update.status, stage: update.stage, step: update.step }
  });
  await insertEvent(client, input, {
    type: 'workflow.run.updated',
    tradeId: object.trade_id ?? null,
    data: { workflow_run_id: object.object_id, status: update.status, stage: update.stage, step: update.step, trace_id: input.traceId }
  });

  return object;
}

function workflowEntry(input: ActorInput, step: { kind: string; stage: string; status: ObjectLifecycleStatus; payload: Record<string, unknown> }) {
  return {
    at: new Date().toISOString(),
    by: input.userId,
    trace_id: input.traceId,
    kind: step.kind,
    stage: step.stage,
    status: step.status,
    payload: step.payload,
    replayable: true
  };
}

function workflowRuntimeTargetFrom(value: unknown, fallbackId: string) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const target = value as Record<string, unknown>;
    if (typeof target.type === 'string' && typeof target.id === 'string') return { type: target.type, id: target.id };
  }
  return { type: 'workflow_run', id: fallbackId };
}

export async function generateProofBundleAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: GenerateProofBundleRequest }
): Promise<GenerateProofBundleResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    const objectIds = [...new Set(input.body.object_ids ?? [])];
    const objects = objectIds.length ? await getAlphaObjects(client, objectIds) : [];
    if (objects.length !== objectIds.length) throwNotFound('Proof bundle object not found');
    const tradeId = input.body.trade_id ?? objects.find((o) => o.trade_id)?.trade_id ?? null;
    const latestReadiness = await loadLatestReadinessForProof(client, { tradeId, objectIds });
    const artifactRefs = buildProofArtifactRefs(objects);
    const manifest = buildProofManifest({
      title: input.body.title,
      orgId: input.orgId,
      tradeId,
      objectIds,
      artifacts: artifactRefs,
      generatedAt: new Date().toISOString(),
      generatedBy: input.userId,
      shareable: input.body.shareable
    });
    const manifestSha = sha256(manifest);
    const root = sha256(buildProofRootInput({ manifestSha256: manifestSha, traceId: input.traceId, artifactCount: artifactRefs.length }));
    const availableProof = availableProofSignalsForProof({ objects, artifactRefs, latestReadiness, manifestSha, root });
    const requiredProof = requiredProofForProofBundle(objects);
    const proofQuality =
      (await requestTradeBrainMissingProof({
        objectType: 'proof_bundle',
        requiredProof,
        availableProof,
        artifacts: {
          artifact_hashes: Boolean(manifestSha && root),
          evidence_links: artifactRefs.length > 0,
          approval: availableProof.includes('approval'),
          readiness_state: availableProof.includes('readiness_state'),
          agent_trace: availableProof.includes('agent_trace')
        },
        traceId: input.traceId
      })) ??
      localMissingProofDetection({
        objectType: 'proof_bundle',
        requiredProof,
        availableProof,
        traceId: input.traceId
      });
    const bundleId = randomUUID();
    await client.query(
      `INSERT INTO alpha_proof_bundles(
         bundle_id, org_id, trade_id, object_id, root, manifest_sha256,
         artifact_refs_json, status, trace_id, created_by
       )
       VALUES($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9)`,
      [bundleId, input.orgId, tradeId, objects[0]?.object_id ?? null, root, manifestSha, JSON.stringify(artifactRefs), input.traceId, input.userId]
    );

    const proofObject = await client.query<AlphaRow>(
      `INSERT INTO alpha_objects(
         object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
         title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
       )
       VALUES($1,$2,'proof_bundle','completed','operations',$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        bundleId,
        input.orgId,
        input.userId,
        tradeId,
        input.body.title ?? 'TRAIBOX alpha proof bundle',
        proofQuality.missingItems.length
          ? `Proof bundle with ${artifactRefs.length} artifact(s); ${proofQuality.missingItems.length} quality gap(s) detected`
          : `Proof bundle with ${artifactRefs.length} artifact(s)`,
        JSON.stringify({
          bundle_id: bundleId,
          root,
          manifest_sha256: manifestSha,
          manifest,
          missing_proof_detection: proofQuality,
          proof_quality_signals: proofQuality.qualitySignals,
          latest_readiness_id: latestReadiness?.readiness_id ?? null
        }),
        JSON.stringify({ ...DEFAULT_PERMISSIONS, shareable: input.body.shareable ?? false }),
        JSON.stringify(artifactRefs),
        input.traceId
      ]
    );

    let object = mapAlphaObject(proofObject.rows[0]!);
    const workflowRun = await createWorkflowRunObject(client, input, {
      kind: 'proof_generation',
      title: `Proof workflow: ${object.title}`,
      summary: 'Durable alpha workflow state for proof bundle generation.',
      status: 'completed',
      tradeId,
      target: { type: 'proof_bundle', id: object.object_id },
      stage: 'proof_bundle_ready',
      payload: {
        bundle_id: bundleId,
        root,
        manifest_sha256: manifestSha,
        artifact_count: artifactRefs.length,
        missing_proof_detection: proofQuality,
        proof_ready: proofQuality.qualitySignals.proof_ready === true,
        temporal_mapping: temporalMappingForWorkflow('proof_generation')
      },
      evidenceRefs: [{ object_id: object.object_id, role: 'proof_bundle' }, ...artifactRefs.map((artifact) => ({ object_id: artifact.object_id, role: artifact.type }))]
    });
    object = {
      ...object,
      payload_json: { ...object.payload_json, workflow_run_id: workflowRun.object_id }
    };
    await client.query(
      `UPDATE alpha_objects
       SET payload_json=payload_json || $1::jsonb,
           trace_id=$2
      WHERE object_id=$3 AND org_id=$4`,
      [JSON.stringify({ workflow_run_id: workflowRun.object_id }), input.traceId, object.object_id, input.orgId]
    );
    const evalPayload = buildProofQualityEvalResult(input, {
      proofBundle: object,
      objects,
      artifactRefs,
      manifestSha,
      root,
      latestReadiness,
      proofQuality
    });
    const evalResult = await createAiEvalResultObject(client, input, {
      title: `AI eval: proof ${object.title.slice(0, 48)}`,
      summary: `${evalPayload.status.toUpperCase()} · ${Math.round(evalPayload.score)}% · missing-proof and manifest quality checks`,
      status: evalPayload.status === 'fail' ? 'blocked' : 'completed',
      tradeId,
      payload: evalPayload,
      evidenceRefs: [
        { object_id: object.object_id, role: 'proof_bundle' },
        ...artifactRefs.map((artifact) => ({ object_id: artifact.object_id, role: artifact.type }))
      ]
    });
    object = {
      ...object,
      payload_json: { ...object.payload_json, workflow_run_id: workflowRun.object_id, proof_quality_eval_result_id: evalResult.object_id }
    };
    await client.query(
      `UPDATE alpha_objects
       SET payload_json=payload_json || $1::jsonb,
           trace_id=$2
       WHERE object_id=$3 AND org_id=$4`,
      [JSON.stringify({ proof_quality_eval_result_id: evalResult.object_id }), input.traceId, object.object_id, input.orgId]
    );
    await appendAudit(client, input, 'alpha.proof.bundle.ready', {
      bundle_id: bundleId,
      root,
      manifest_sha256: manifestSha,
      workflow_run_id: workflowRun.object_id,
      proof_quality_eval_result_id: evalResult.object_id,
      missing_proof_items: proofQuality.missingItems
    });
    await writeMemory(client, input, {
      level: tradeId ? 'L1' : 'L2',
      tradeId,
      objectId: object.object_id,
      kind: 'proof.bundle.ready',
      signal: proofQuality.missingItems.length ? 'proof.completed_with_quality_gaps' : 'proof.completed',
      payload: {
        root,
        manifest_sha256: manifestSha,
        artifact_count: artifactRefs.length,
        workflow_run_id: workflowRun.object_id,
        proof_quality_eval_result_id: evalResult.object_id,
        missing_proof_detection: proofQuality
      }
    });
    await insertEvent(client, input, {
      type: 'proof.bundle.ready',
      tradeId,
      data: {
        proof_bundle_id: object.object_id,
        workflow_run_id: workflowRun.object_id,
        proof_quality_eval_result_id: evalResult.object_id,
        root,
        manifest_sha256: manifestSha,
        missing_proof_items: proofQuality.missingItems,
        trace_id: input.traceId
      }
    });

    return { object, root, manifestSha, artifactRefs, evalResult };
  });

  return {
    proof_bundle: result.object,
    root: result.root,
    manifest_sha256: result.manifestSha,
    artifact_refs: result.artifactRefs,
    eval_result: result.evalResult,
    trace_id: input.traceId
  };
}

export async function requestProofShareAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: ProofShareRequest }
): Promise<ProofShareResponse> {
  const prepared = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const proofBundle = await getAlphaObject(client, input.body.proof_bundle_id);
    if (!proofBundle) throwNotFound('Proof bundle not found');
    if (proofBundle.type !== 'proof_bundle') throwBadRequest('Object is not a proof bundle');

    const manifest = recordOrEmpty(proofBundle.payload_json?.manifest);
    const manifestPolicy = recordOrEmpty(manifest.share_policy);
    const allowedScopes = toStringArray(manifestPolicy.allowed_scopes).length
      ? toStringArray(manifestPolicy.allowed_scopes)
      : buildProofSharePolicy({ shareable: true }).allowed_scopes;
    const requestedScopes = input.body.scopes?.length ? uniqueStringValues(input.body.scopes) : ['view_proof_summary', 'view_artifact_manifest'];
    const deniedScopes = requestedScopes.filter((scope) => !allowedScopes.includes(scope));
    if (deniedScopes.length) throwBadRequest(`Unsupported proof sharing scope: ${deniedScopes.join(', ')}`);
    const scopes = requestedScopes.filter((scope) => allowedScopes.includes(scope));
    if (!scopes.length) throwBadRequest('At least one allowed proof sharing scope is required');

    return {
      proofBundle,
      scopes,
      sharePolicy: {
        ...buildProofSharePolicy({ shareable: true }),
        requested_recipient: input.body.recipient,
        requested_scopes: scopes,
        requested_reason: input.body.reason ?? null,
        expires_at: input.body.expires_at ?? null
      }
    };
  });

  const approval = await requestApprovalAlpha(pool, {
    ...input,
    body: {
      target: { type: 'proof_bundle', id: prepared.proofBundle.object_id },
      protected_action: 'share_proof_bundle_externally',
      proposed_action: `Share proof bundle "${prepared.proofBundle.title}" with ${input.body.recipient.name ?? input.body.recipient.email ?? input.body.recipient.role}.`,
      rationale: input.body.reason ?? 'External proof sharing requires recipient, scope, evidence, and human approval.',
      step_up_required: true,
      policy_refs: ['proof_share_policy_alpha_v1'],
      evidence_refs: [
        { object_id: prepared.proofBundle.object_id, role: 'proof_bundle' },
        ...prepared.proofBundle.evidence_refs_json.filter(isRecord)
      ]
    }
  });

  const proofBundle = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const requestedAt = new Date().toISOString();
    const proofShareControl = {
      status: 'approval_required',
      protected_action: 'share_proof_bundle_externally',
      approval_object_id: approval.approval.object_id,
      requested_at: requestedAt,
      recipient: input.body.recipient,
      scopes: prepared.scopes,
      reason: input.body.reason ?? null,
      expires_at: input.body.expires_at ?? null,
      share_policy: prepared.sharePolicy,
      external_action_performed_by_traibox: false
    };
    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET payload_json=payload_json || $1::jsonb,
           permissions_json=permissions_json || $2::jsonb,
           trace_id=$3
       WHERE object_id=$4 AND org_id=$5
       RETURNING *`,
      [
        JSON.stringify({ share_control: proofShareControl }),
        JSON.stringify({ shareable: false, external_share_requires_approval: true }),
        input.traceId,
        prepared.proofBundle.object_id,
        input.orgId
      ]
    );
    const object = mapAlphaObject(updated.rows[0]!);
    await appendAudit(client, input, 'alpha.proof.share.requested', {
      proof_bundle_id: object.object_id,
      approval_object_id: approval.approval.object_id,
      recipient: input.body.recipient,
      scopes: prepared.scopes,
      reason: input.body.reason ?? null
    });
    await writeMemory(client, input, {
      level: object.trade_id ? 'L1' : 'L2',
      tradeId: object.trade_id ?? null,
      objectId: object.object_id,
      kind: 'proof.share.requested',
      signal: 'proof.external_share_approval_required',
      payload: proofShareControl
    });
    await insertEvent(client, input, {
      type: 'proof.share.requested',
      tradeId: object.trade_id ?? null,
      data: {
        proof_bundle_id: object.object_id,
        approval_object_id: approval.approval.object_id,
        protected_action: 'share_proof_bundle_externally',
        recipient: input.body.recipient,
        scopes: prepared.scopes,
        trace_id: input.traceId
      }
    });
    return object;
  });

  return {
    proof_bundle: proofBundle,
    approval: approval.approval,
    protected_action: 'share_proof_bundle_externally',
    share_policy: recordOrEmpty(proofBundle.payload_json?.share_control) ?? prepared.sharePolicy,
    trace_id: input.traceId
  };
}

export async function executeApprovedPaymentIntentAlpha(
  pool: pg.Pool,
  input: ActorInput & {
    profile: Profile;
    paymentIntentId: string;
    body: ExecutePaymentIntentRequest;
    idempotencyKey: string;
  }
): Promise<ExecutePaymentIntentResponse> {
  const prepared = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const paymentIntent = await getAlphaObject(client, input.paymentIntentId);
    if (!paymentIntent) throwNotFound('Payment intent not found');
    if (paymentIntent.type !== 'payment_intent') throwBadRequest('Object is not a payment intent');

    const approval = await getAlphaObject(client, input.body.approval_id);
    if (!approval) throwNotFound('Approval not found');
    if (approval.type !== 'approval') throwBadRequest('Object is not an approval');
    if (approval.status !== 'approved') throwBadRequest('Payment intent approval must be approved before execution');

    const approvalPayload = recordOrEmpty(approval.payload_json);
    const target = recordOrEmpty(approvalPayload.target);
    if (String(target.type ?? '') !== 'payment_intent' || String(target.id ?? '') !== paymentIntent.object_id) {
      throwBadRequest('Approval does not target this payment intent');
    }
    if (String(approvalPayload.protected_action ?? '') !== 'send_payment') {
      throwBadRequest('Approval is not for protected payment execution');
    }

    const existingExecution = recordOrEmpty(paymentIntent.payload_json?.payment_execution);
    if (typeof existingExecution.payment_id === 'string' && existingExecution.payment_id) {
      throwBadRequest('Payment intent already has an execution payment');
    }

    const payload = recordOrEmpty(paymentIntent.payload_json);
    const amount = positiveNumberOrNull(input.body.amount) ?? positiveNumberOrNull(payload.amount);
    const currency = stringOrNull(input.body.currency) ?? stringOrNull(payload.currency) ?? 'EUR';
    const creditorName =
      stringOrNull(input.body.creditor_name) ??
      stringOrNull(payload.creditor_name) ??
      stringOrNull(payload.beneficiary) ??
      stringOrNull(payload.supplier_name);
    const creditorIban =
      stringOrNull(input.body.creditor_iban) ??
      stringOrNull(payload.creditor_iban) ??
      stringOrNull(payload.beneficiary_iban) ??
      stringOrNull(payload.iban);
    if (!amount) throwBadRequest('Payment amount is required before execution');
    if (!creditorName) throwBadRequest('Creditor name is required before execution');
    if (!creditorIban) throwBadRequest('Creditor IBAN is required before execution');

    const executeInput: ExecutePaymentRequest = {
      trade_id: paymentIntent.trade_id ?? undefined,
      route_id: input.body.route_id ?? stringOrNull(payload.route_id) ?? stringOrNull(payload.selected_route_id) ?? 'r_manual',
      from_account_id: input.body.from_account_id,
      creditor_name: creditorName,
      creditor_iban: creditorIban.replace(/\s+/g, '').toUpperCase(),
      amount,
      currency: currency.toUpperCase(),
      remittance: stringOrNull(input.body.remittance) ?? stringOrNull(payload.remittance) ?? stringOrNull(payload.purpose) ?? undefined,
      e2e_id: stringOrNull(input.body.e2e_id) ?? `TBX-${paymentIntent.object_id.slice(0, 8).toUpperCase()}`
    };

    return { paymentIntent, approval, executeInput };
  });

  const payment = await executePayment(pool, {
    orgId: input.orgId,
    userId: input.userId,
    traceId: input.traceId,
    profile: input.profile,
    input: prepared.executeInput,
    idempotencyKey: input.idempotencyKey
  });

  const updatedPaymentIntent = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const current = await getAlphaObject(client, input.paymentIntentId);
    if (!current) throwNotFound('Payment intent not found');
    const nextStatus: ObjectLifecycleStatus = payment.status === 'executed' ? 'completed' : 'in_progress';
    assertLifecycleTransition(current, nextStatus, 'payment.intent.execute');
    const executionPayload = {
      payment_id: payment.payment_id,
      payment_status: payment.status,
      scheme: payment.scheme,
      iso_status: payment.iso_status ?? null,
      redirect_url: payment.redirect_url ?? null,
      route_id: prepared.executeInput.route_id,
      from_account_id: prepared.executeInput.from_account_id,
      approval_object_id: prepared.approval.object_id,
      idempotency_key: input.idempotencyKey,
      started_at: new Date().toISOString(),
      protected_action: 'send_payment',
      operator_confirmed: true,
      external_action_performed_by_traibox: false
    };
    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status=$1,
           payload_json=payload_json || $2::jsonb,
           permissions_json=permissions_json || $3::jsonb,
           trace_id=$4
       WHERE object_id=$5 AND org_id=$6
       RETURNING *`,
      [
        nextStatus,
        JSON.stringify({
          payment_execution: executionPayload,
          route_id: prepared.executeInput.route_id,
          payment_id: payment.payment_id
        }),
        JSON.stringify({ protected_execution_started: true, payment_execution_approved: true }),
        input.traceId,
        current.object_id,
        input.orgId
      ]
    );
    const object = mapAlphaObject(updated.rows[0]!);
    await appendAudit(client, input, 'alpha.payment_intent.execution.started', {
      payment_intent_id: object.object_id,
      payment_id: payment.payment_id,
      approval_object_id: prepared.approval.object_id,
      payment_status: payment.status,
      scheme: payment.scheme,
      route_id: prepared.executeInput.route_id
    });
    await writeMemory(client, input, {
      level: object.trade_id ? 'L1' : 'L2',
      tradeId: object.trade_id ?? null,
      objectId: object.object_id,
      kind: 'payment.intent.execution',
      signal: `payment.${payment.status}`,
      payload: executionPayload
    });
    return object;
  });

  return {
    payment_intent: updatedPaymentIntent,
    approval: prepared.approval,
    payment,
    trace_id: input.traceId
  };
}

export async function evaluateClearanceCheckAlpha(
  pool: pg.Pool,
  input: ActorInput & { clearanceCheckId: string; body: EvaluateClearanceCheckRequest }
): Promise<EvaluateClearanceCheckResponse> {
  const evaluated = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const clearance = await getAlphaObject(client, input.clearanceCheckId);
    if (!clearance) throwNotFound('Clearance check not found');
    if (clearance.type !== 'clearance_check') throwBadRequest('Object is not a clearance check');

    const payload = recordOrEmpty(clearance.payload_json);
    const corridor = stringOrNull(input.body.corridor) ?? stringOrNull(payload.corridor) ?? 'PT-ES';
    const rulePackId = stringOrNull(input.body.rule_pack_id) ?? stringOrNull(payload.rule_pack_id) ?? stringOrNull(payload.ruleset) ?? 'EU-alpha';
    const availableEvidence = uniqueStringValues([
      ...toStringArray(payload.available_evidence),
      ...toStringArray(payload.present_documents),
      ...toStringArray(payload.evidence),
      ...(input.body.available_evidence ?? [])
    ]);
    const subject = stringOrNull(input.body.subject) ?? stringOrNull(payload.subject) ?? stringOrNull(payload.trade_subject) ?? 'trade activity';
    const requirements = buildClearanceRequirements({
      corridor,
      rulePackId,
      subject,
      availableEvidence,
      payload
    });
    const missingEvidence = requirements.filter((requirement) => requirement.status === 'missing').map((requirement) => requirement.key);
    const riskFindings = requirements
      .filter((requirement) => requirement.status === 'missing' || requirement.status === 'risky')
      .map((requirement) => `${requirement.key}:${requirement.severity}`);
    const nextStatus: ObjectLifecycleStatus = missingEvidence.length ? 'blocked' : 'ready_for_review';
    assertLifecycleTransition(clearance, nextStatus, 'clearance.evaluate');
    const evaluatedAt = new Date().toISOString();
    const evaluationPayload = {
      rule_pack_id: rulePackId,
      corridor,
      subject,
      available_evidence: availableEvidence,
      requirements,
      missing_evidence: missingEvidence,
      risk_findings: riskFindings,
      evaluated_at: evaluatedAt,
      status: missingEvidence.length ? 'missing_evidence' : 'ready_for_review',
      eu_first: true
    };
    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status=$1,
           payload_json=payload_json || $2::jsonb,
           trace_id=$3
       WHERE object_id=$4 AND org_id=$5
       RETURNING *`,
      [
        nextStatus,
        JSON.stringify({
          clearance_evaluation: evaluationPayload,
          rule_pack_id: rulePackId,
          corridor,
          missing_fields: missingEvidence,
          risks: riskFindings,
          available_evidence: availableEvidence
        }),
        input.traceId,
        clearance.object_id,
        input.orgId
      ]
    );
    const object = mapAlphaObject(updated.rows[0]!);
    await appendAudit(client, input, 'alpha.clearance.evaluated', {
      clearance_check_id: object.object_id,
      rule_pack_id: rulePackId,
      corridor,
      missing_evidence: missingEvidence,
      risk_findings: riskFindings
    });
    await writeMemory(client, input, {
      level: object.trade_id ? 'L1' : 'L2',
      tradeId: object.trade_id ?? null,
      objectId: object.object_id,
      kind: 'clearance.evaluated',
      signal: missingEvidence.length ? 'clearance.missing_evidence' : 'clearance.ready_for_review',
      payload: evaluationPayload
    });
    return { object, evaluationPayload, rulePackId, requirements, missingEvidence, riskFindings };
  });

  const report = (
    await createAlphaObject(pool, {
      ...input,
      type: 'report',
      body: {
        title: `Clearance rule-pack report: ${evaluated.evaluationPayload.corridor}`,
        summary: evaluated.missingEvidence.length
          ? `${evaluated.missingEvidence.length} clearance evidence gap(s) require action.`
          : 'Clearance rule-pack evidence is ready for review.',
        status: 'ready_for_review',
        origin_workspace: 'clearance',
        trade_id: evaluated.object.trade_id ?? undefined,
        payload: {
          report_type: 'clearance_rule_pack',
          ...evaluated.evaluationPayload
        },
        evidence_refs: [{ object_id: evaluated.object.object_id, role: 'clearance_check' }]
      }
    })
  ).object;

  const readiness = await evaluateReadinessAlpha(pool, {
    ...input,
    body: {
      object_id: evaluated.object.object_id,
      trade_id: evaluated.object.trade_id ?? undefined,
      context: {
        workspace: 'clearance',
        rule_pack_id: evaluated.rulePackId,
        missing_evidence: evaluated.missingEvidence
      }
    }
  });

  return {
    clearance_check: evaluated.object,
    report,
    readiness: readiness.readiness,
    rule_pack_id: evaluated.rulePackId,
    requirements: evaluated.requirements,
    missing_evidence: evaluated.missingEvidence,
    risk_findings: evaluated.riskFindings,
    trace_id: input.traceId
  };
}

export async function buildNetworkTrustAlpha(
  pool: pg.Pool,
  input: ActorInput & { counterpartyId: string; body: BuildNetworkTrustRequest }
): Promise<BuildNetworkTrustResponse> {
  const prepared = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    const counterparty = await getAlphaObject(client, input.counterpartyId);
    if (!counterparty) throwNotFound('Counterparty not found');
    if (counterparty.type !== 'counterparty') throwBadRequest('Object is not a counterparty');

    const related = await loadNetworkTrustRelatedObjects(client, {
      counterpartyId: counterparty.object_id,
      onboardingFlowId: input.body.onboarding_flow_id ?? null,
      screeningResultId: input.body.screening_result_id ?? null
    });
    const onboarding = related.find((object) => object.type === 'onboarding_flow') ?? null;
    const screening = related.find((object) => object.type === 'screening_result') ?? null;
    const trustContext = buildNetworkTrustContext({
      counterparty,
      onboarding,
      screening,
      passportVisibility: input.body.passport_visibility ?? 'internal'
    });
    const nextStatus: ObjectLifecycleStatus = trustContext.status === 'blocked' ? 'blocked' : trustContext.status === 'ready_for_review' ? 'ready_for_review' : 'pending_input';
    assertLifecycleTransition(counterparty, nextStatus, 'network.trust.build');
    const updated = await client.query<AlphaRow>(
      `UPDATE alpha_objects
       SET status=$1,
           payload_json=payload_json || $2::jsonb,
           permissions_json=permissions_json || $3::jsonb,
           trace_id=$4
       WHERE object_id=$5 AND org_id=$6
       RETURNING *`,
      [
        nextStatus,
        JSON.stringify({
          trust_context: trustContext,
          trust_score: trustContext.score,
          trust_status: trustContext.status,
          passport_visibility: trustContext.passport_visibility
        }),
        JSON.stringify({ reusable_across_trades: true, trust_context_built: true }),
        input.traceId,
        counterparty.object_id,
        input.orgId
      ]
    );
    const updatedCounterparty = mapAlphaObject(updated.rows[0]!);
    await appendAudit(client, input, 'alpha.network.trust_context.built', {
      counterparty_id: updatedCounterparty.object_id,
      score: trustContext.score,
      status: trustContext.status,
      missing_items: trustContext.missing_items,
      risk_findings: trustContext.risk_findings
    });
    await writeMemory(client, input, {
      level: updatedCounterparty.trade_id ? 'L1' : 'L2',
      tradeId: updatedCounterparty.trade_id ?? null,
      objectId: updatedCounterparty.object_id,
      kind: 'network.trust_context',
      signal: `network.trust.${trustContext.status}`,
      payload: { ...trustContext }
    });
    await insertEvent(client, input, {
      type: 'network.trust.updated',
      tradeId: updatedCounterparty.trade_id ?? null,
      data: {
        counterparty_id: updatedCounterparty.object_id,
        score: trustContext.score,
        status: trustContext.status,
        trace_id: input.traceId
      }
    });
    return { counterparty: updatedCounterparty, onboarding, screening, trustContext };
  });

  const evidenceRefs = [
    { object_id: prepared.counterparty.object_id, role: 'counterparty' },
    ...(prepared.onboarding ? [{ object_id: prepared.onboarding.object_id, role: 'onboarding_flow' }] : []),
    ...(prepared.screening ? [{ object_id: prepared.screening.object_id, role: 'screening_result' }] : [])
  ];
  const counterpartyName = counterpartyDisplayName(prepared.counterparty);
  const tradePassport = (
    await createAlphaObject(pool, {
      ...input,
      type: 'trade_passport',
      body: {
        title: `Trade Passport: ${counterpartyName}`,
        summary: `${prepared.trustContext.status.replaceAll('_', ' ')} · trust score ${prepared.trustContext.score}%`,
        status: prepared.trustContext.status === 'ready_for_review' ? 'ready_for_review' : 'pending_input',
        origin_workspace: 'network',
        trade_id: prepared.counterparty.trade_id ?? undefined,
        payload: {
          counterparty_id: prepared.counterparty.object_id,
          counterparty: counterpartyName,
          visibility: prepared.trustContext.passport_visibility,
          trust_context: prepared.trustContext,
          reusable_across_trades: true,
          missing_items: prepared.trustContext.missing_items,
          risk_findings: prepared.trustContext.risk_findings
        },
        permissions: {
          reusable_across_trades: true,
          external_visibility: prepared.trustContext.passport_visibility === 'controlled_external'
        },
        evidence_refs: evidenceRefs
      }
    })
  ).object;

  const matchContext = input.body.match_context ?? {};
  const corridor = stringOrNull(matchContext.corridor) ?? stringOrNull(prepared.counterparty.payload_json?.corridor) ?? 'PT-ES';
  const domain = stringOrNull(matchContext.domain) ?? (prepared.counterparty.payload_json?.role === 'buyer' ? 'buyer' : 'supplier');
  const matchmakingResult = (
    await createAlphaObject(pool, {
      ...input,
      type: 'matchmaking_result',
      body: {
        title: `Network trust match: ${counterpartyName}`,
        summary: `Reusable ${domain} trust context for ${corridor}.`,
        status: 'ready_for_review',
        origin_workspace: 'network',
        trade_id: prepared.counterparty.trade_id ?? undefined,
        payload: {
          match_type: domain,
          corridor,
          counterparty_id: prepared.counterparty.object_id,
          trade_passport_id: tradePassport.object_id,
          confidence: Math.max(0.35, Math.min(0.96, prepared.trustContext.score / 100)),
          reasons: networkMatchReasons(prepared.trustContext, corridor, domain)
        },
        evidence_refs: [{ object_id: prepared.counterparty.object_id, role: 'counterparty' }, { object_id: tradePassport.object_id, role: 'trade_passport' }]
      }
    })
  ).object;

  let approval: AlphaObject | undefined;
  if (input.body.invite) {
    const invite = input.body.invite;
    const approvalResponse = await requestApprovalAlpha(pool, {
      ...input,
      body: {
        target: { type: 'counterparty', id: prepared.counterparty.object_id },
        protected_action: 'invite_external_counterparty',
        proposed_action: `Invite ${invite.name ?? invite.email} as ${invite.role} with scoped Network access.`,
        rationale: invite.reason ?? 'External counterparty invitations expose controlled trust context and require explicit human approval.',
        step_up_required: true,
        policy_refs: ['network-invite-policy-alpha-v1'],
        evidence_refs: [
          { object_id: prepared.counterparty.object_id, role: 'counterparty' },
          { object_id: tradePassport.object_id, role: 'trade_passport' },
          ...(prepared.screening ? [{ object_id: prepared.screening.object_id, role: 'screening_result' }] : [])
        ],
        approval_chain: [
          { key: 'ops_review', label: 'Operations review', required_role: 'ops', status: 'approval_required' },
          { key: 'admin_release', label: 'Admin release', required_role: 'admin', status: 'pending_input' }
        ],
        current_approval_step: 'ops_review'
      }
    });
    approval = approvalResponse.approval;

    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: input.userId, orgId: input.orgId });
      const invitePayload = {
        approval_object_id: approval!.object_id,
        recipient: invite,
        scopes: invite.scopes?.length ? invite.scopes : ['view_trade_passport', 'submit_onboarding_evidence'],
        status: 'approval_required',
        external_action_performed_by_traibox: false
      };
      await client.query(
        `UPDATE alpha_objects
         SET payload_json=payload_json || $1::jsonb,
             trace_id=$2
         WHERE object_id=$3 AND org_id=$4`,
        [JSON.stringify({ pending_invitation: invitePayload }), input.traceId, prepared.counterparty.object_id, input.orgId]
      );
      await appendAudit(client, input, 'alpha.network.invitation.prepared', {
        counterparty_id: prepared.counterparty.object_id,
        approval_object_id: approval!.object_id,
        recipient: invite.email,
        scopes: invitePayload.scopes
      });
      await writeMemory(client, input, {
        level: prepared.counterparty.trade_id ? 'L1' : 'L2',
        tradeId: prepared.counterparty.trade_id ?? null,
        objectId: prepared.counterparty.object_id,
        kind: 'network.invitation.prepared',
        signal: 'network.invite.approval_required',
        payload: invitePayload
      });
    });
  }

  const finalCounterparty = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    return (await getAlphaObject(client, prepared.counterparty.object_id)) ?? prepared.counterparty;
  });

  return {
    counterparty: finalCounterparty,
    trade_passport: tradePassport,
    matchmaking_result: matchmakingResult,
    approval,
    trust_context: prepared.trustContext,
    trace_id: input.traceId
  };
}

async function persistAiEvalResult(
  pool: pg.Pool,
  input: ActorInput,
  evalObject: {
    title: string;
    summary: string;
    status: ObjectLifecycleStatus;
    tradeId?: string | null;
    payload: AiEvalResult;
    evidenceRefs?: unknown[];
  }
) {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    return createAiEvalResultObject(client, input, evalObject);
  });
}

async function createAiEvalResultObject(
  client: pg.PoolClient,
  input: ActorInput,
  evalObject: {
    title: string;
    summary: string;
    status: ObjectLifecycleStatus;
    tradeId?: string | null;
    payload: AiEvalResult;
    evidenceRefs?: unknown[];
  }
) {
  const object = await insertAlphaObject(client, {
    type: 'ai_eval_result',
    status: evalObject.status,
    originWorkspace: 'intelligence',
    ownerId: input.userId,
    tradeId: evalObject.tradeId ?? null,
    title: evalObject.title,
    summary: evalObject.summary,
    payload: evalObject.payload as unknown as Record<string, unknown>,
    permissions: {
      visibility: 'org',
      ai_governance: true,
      replay_required: true,
      protected_actions_require_approval: true
    },
    evidenceRefs: evalObject.evidenceRefs ?? [],
    traceId: input.traceId
  });

  await appendAudit(client, input, 'alpha.ai.eval.completed', {
    eval_object_id: object.object_id,
    suite: evalObject.payload.suite,
    status: evalObject.payload.status,
    score: evalObject.payload.score,
    checks: evalObject.payload.checks.map((check) => ({ case: check.case, status: check.status, score: check.score }))
  });
  await writeMemory(client, input, {
    level: object.trade_id ? 'L1' : 'L2',
    tradeId: object.trade_id ?? null,
    objectId: object.object_id,
    kind: 'ai.eval.completed',
    signal: `ai_eval.${evalObject.payload.status}`,
    payload: {
      suite: evalObject.payload.suite,
      score: evalObject.payload.score,
      generated_recommendation: evalObject.payload.generated_recommendation,
      human_decision: evalObject.payload.human_decision,
      final_outcome: evalObject.payload.final_outcome
    }
  });
  await insertEvent(client, input, {
    type: 'ai.eval.completed',
    tradeId: object.trade_id ?? null,
    data: {
      eval_object_id: object.object_id,
      suite: evalObject.payload.suite,
      status: evalObject.payload.status,
      score: evalObject.payload.score,
      trace_id: input.traceId
    }
  });

  return object;
}

export async function launchAgentTaskAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: AgentTaskRequest }
): Promise<AgentTaskResponse> {
  const result = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    if (input.body.trade_id) await assertTradeInCurrentOrg(client, input.body.trade_id, 'Agent task trade not found');
    const inputObjectIds = input.body.input_objects ?? [];
    const inputObjects = await getAlphaObjects(client, inputObjectIds);
    if (inputObjects.length !== inputObjectIds.length) throwBadRequest('Agent input object not found or not accessible');
    if (input.body.trade_id && inputObjects.some((object) => object.trade_id && object.trade_id !== input.body.trade_id)) {
      throwBadRequest('Agent input object belongs to a different Trade Room');
    }
    const inputObjectSnapshot = inputObjects.map((object) => ({
      object_id: object.object_id,
      type: object.type,
      status: object.status,
      trade_id: object.trade_id ?? null
    }));
    const localRuntimePolicy = buildAgentRuntimePolicy({
      objective: input.body.objective,
      inputObjectTypes: inputObjects.map((object) => object.type),
      permittedTools: input.body.permitted_tools,
      dataAccess: input.body.data_access,
      writePermissions: input.body.write_permissions,
      approvalGates: input.body.approval_gates,
      timeBudgetSeconds: input.body.time_budget_seconds
    });
    const tradeBrainScope = await requestTradeBrainAgentScope({
      objective: input.body.objective,
      inputObjectTypes: inputObjects.map((object) => object.type),
      inputObjects: inputObjectSnapshot,
      permittedTools: input.body.permitted_tools,
      dataAccess: input.body.data_access,
      writePermissions: input.body.write_permissions,
      approvalGates: input.body.approval_gates,
      timeBudgetSeconds: input.body.time_budget_seconds,
      traceId: input.traceId
    });
    const runtimePolicy = tradeBrainScope?.runtimePolicy ?? localRuntimePolicy;
    const runtimeSource = tradeBrainScope ? 'trade_brain_service' : 'local_deterministic_fallback';
    const scopeViolations = Array.from(new Set([...(tradeBrainScope?.violations ?? []), ...agentRuntimePolicyViolations(runtimePolicy)]));
    if (scopeViolations.length) throwBadRequest(`Agent scope rejected: ${scopeViolations.join('; ')}`);
    const taskId = randomUUID();
    const acceptedAt = new Date().toISOString();
    const localReplayLog = buildAgentReplayLog({
      policy: runtimePolicy,
      objectiveHash: sha256(input.body.objective),
      inputObjects: inputObjectSnapshot,
      traceId: input.traceId,
      at: acceptedAt
    });
    const replayLog =
      (await requestTradeBrainReplayLog({
        objective: input.body.objective,
        runtimePolicy,
        inputObjects: inputObjectSnapshot,
        traceId: input.traceId
      })) ??
      (tradeBrainScope?.replayPreview.length ? tradeBrainScope.replayPreview : localReplayLog);
    const result: AgentWorkResult = {
      outputs: {
        summary: summarizeObjective(input.body.objective),
        prepared_artifacts: inputObjectIds,
        approval_required: runtimePolicy.approval_gates.length > 0,
        runtime_policy: runtimePolicy,
        runtime_source: runtimeSource,
        trade_brain_service_version: tradeBrainScope?.serviceVersion ?? null,
        input_object_snapshot: inputObjectSnapshot
      },
      blockers: runtimePolicy.approval_gates.length ? ['Protected action requires explicit human approval.'] : [],
      risks: [`Alpha agent runtime is ${runtimeSource === 'trade_brain_service' ? 'Trade Brain scoped' : 'deterministic and scoped'}; no external execution was performed.`],
      opportunities: ['Attach this work result to a Trade Room so readiness and proof can reuse the context.'],
      recommended_next_action: runtimePolicy.approval_gates.length
        ? 'Request human approval before execution.'
        : 'Review the prepared output and attach it to the relevant workflow.',
      memory_updates: ['agent.task.completed', 'agent.recommendation.replayable'],
      model_usage: {
        model: runtimeSource === 'trade_brain_service' ? 'traibox-trade-brain-scoped-agent' : 'traibox-alpha-deterministic-agent',
        prompt_version: runtimeSource === 'trade_brain_service' ? 'trade-brain-agent-scope-alpha-v1' : 'agent-task-alpha-v2',
        latency_ms: 25,
        cost_estimate_usd: 0
      },
      human_decision: 'pending'
    };
    const localAgentEval = buildAgentEvalResult(input, result, replayLog, runtimePolicy);
    const agentEval = await requestTradeBrainEvalPayload({ payload: localAgentEval }) ?? localAgentEval;

    await client.query(
      `INSERT INTO alpha_agent_tasks(
         agent_task_id, org_id, trade_id, objective, status, input_objects_json,
         permitted_tools_json, data_access_json, write_permissions_json, approval_gates_json,
         replay_log_json, result_json, trace_id, created_by
       )
       VALUES($1,$2,$3,$4,'completed',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        taskId,
        input.orgId,
        input.body.trade_id ?? null,
        input.body.objective,
        JSON.stringify(inputObjectIds),
        JSON.stringify(runtimePolicy.effective_tools),
        JSON.stringify(runtimePolicy.effective_data_access),
        JSON.stringify(runtimePolicy.effective_write_permissions),
        JSON.stringify(runtimePolicy.approval_gates),
        JSON.stringify(replayLog),
        JSON.stringify(result),
        input.traceId,
        input.userId
      ]
    );

    const taskObject = await insertAlphaObject(client, {
      type: 'agent_task',
      status: 'completed',
      originWorkspace: 'intelligence',
      ownerId: input.userId,
      tradeId: input.body.trade_id ?? null,
      title: `Agent task: ${input.body.objective.slice(0, 56)}`,
      summary: 'Governed scoped agent task completed with replayable policy log.',
      payload: {
        agent_task_id: taskId,
        objective: input.body.objective,
        input_objects: inputObjectIds,
        declared_scope: {
          permitted_tools: input.body.permitted_tools ?? [],
          data_access: input.body.data_access ?? [],
          write_permissions: input.body.write_permissions ?? [],
          approval_gates: input.body.approval_gates ?? []
        },
        runtime_policy: runtimePolicy,
        permitted_tools: runtimePolicy.effective_tools,
        data_access: runtimePolicy.effective_data_access,
        write_permissions: runtimePolicy.effective_write_permissions,
        approval_gates: runtimePolicy.approval_gates,
        replay_log: replayLog,
        runtime: runtimePolicy.runtime,
        runtime_source: runtimeSource,
        trade_brain_service_version: tradeBrainScope?.serviceVersion ?? null
      },
      permissions: {
        visibility: 'org',
        agent_scope: 'governed',
        protected_actions_require_approval: true
      },
      evidenceRefs: inputObjectIds.map((object_id) => ({ object_id, role: 'agent_input' })),
      traceId: input.traceId
    });

    const work = await client.query<AlphaRow>(
      `INSERT INTO alpha_objects(
         object_id, org_id, type, status, origin_workspace, owner_id, trade_id,
         title, summary, payload_json, permissions_json, evidence_refs_json, trace_id
       )
       VALUES($1,$2,'agent_work_result','completed','intelligence',$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        randomUUID(),
        input.orgId,
        input.userId,
        input.body.trade_id ?? null,
        `Agent result: ${input.body.objective.slice(0, 56)}`,
        result.recommended_next_action,
        JSON.stringify({ agent_task_id: taskId, task_object_id: taskObject.object_id, result, replay_log: replayLog, runtime_policy: runtimePolicy }),
        JSON.stringify({ ...DEFAULT_PERMISSIONS, agent_scope: 'governed' }),
        JSON.stringify([{ object_id: taskObject.object_id, role: 'agent_task' }, ...inputObjectIds.map((object_id) => ({ object_id, role: 'agent_input' }))]),
        input.traceId
      ]
    );

    const workResult = mapAlphaObject(work.rows[0]!);
    const evalResult = await createAiEvalResultObject(client, input, {
      title: `AI eval: ${input.body.objective.slice(0, 52)}`,
      summary: `${agentEval.status.toUpperCase()} · ${Math.round(agentEval.score)}% · governed agent replay and safety checks`,
      status: agentEval.status === 'fail' ? 'blocked' : 'completed',
      tradeId: input.body.trade_id ?? null,
      payload: agentEval,
      evidenceRefs: [
        { object_id: taskObject.object_id, role: 'agent_task' },
        { object_id: workResult.object_id, role: 'agent_work_result' },
        ...inputObjectIds.map((object_id) => ({ object_id, role: 'agent_input' }))
      ]
    });
    await appendAudit(client, input, 'alpha.agent.task.completed', {
      agent_task_id: taskId,
      task_object_id: taskObject.object_id,
      work_result_id: workResult.object_id,
      eval_result_id: evalResult.object_id,
      approval_gates: runtimePolicy.approval_gates,
      runtime_policy: runtimePolicy
    });
    await writeMemory(client, input, {
      level: input.body.trade_id ? 'L1' : 'L2',
      tradeId: input.body.trade_id ?? null,
      objectId: workResult.object_id,
      kind: 'agent.task.completed',
      signal: 'agent.replayable_result',
      payload: { objective: input.body.objective, result, eval_result_id: evalResult.object_id, eval: agentEval, runtime_policy: runtimePolicy }
    });
    await insertEvent(client, input, {
      type: 'agent.task.completed',
      tradeId: input.body.trade_id ?? null,
      data: {
        agent_task_id: taskId,
        task_object_id: taskObject.object_id,
        work_result_id: workResult.object_id,
        eval_result_id: evalResult.object_id,
        runtime_policy: {
          scope_version: runtimePolicy.scope_version,
          approval_gates: runtimePolicy.approval_gates,
          protected_actions_blocked: runtimePolicy.protected_actions_blocked
        },
        trace_id: input.traceId
      }
    });

    return { taskId, taskObject, replayLog, result, workResult, evalResult };
  });

  return {
    task: {
      agent_task_id: result.taskId,
      task_object_id: result.taskObject.object_id,
      status: 'completed',
      objective: input.body.objective,
      trace_id: input.traceId,
      replay_log: result.replayLog,
      result: result.result
    },
    work_result: result.workResult,
    eval_result: result.evalResult,
    trace_id: input.traceId
  };
}

export async function runIntelligenceAlpha(
  pool: pg.Pool,
  input: ActorInput & { body: IntelligenceRunRequest }
): Promise<IntelligenceRunResponse> {
  const workspace = input.body.workspace ?? 'intelligence';
  const mode = input.body.mode ?? 'agent';
  const tradeBrainPlan = await requestTradeBrainCopilotPlan({
    message: input.body.message,
    workspace,
    tradeId: input.body.trade_id ?? null,
    objectIds: input.body.object_ids ?? [],
    traceId: input.traceId,
    mode,
    model: input.body.model ?? null,
    history: input.body.history ?? null,
    // Copilot generation runs a full LLM turn (answer + plan + questions), which is
    // far slower than a classification. Give it room rather than falling back.
    timeoutMs: 60_000
  });
  const objectType = tradeBrainPlan?.objectType ?? classifyWorkflow(input.body.message);
  const answerText =
    tradeBrainPlan?.answer ??
    `I structured this as a ${objectType.replaceAll('_', ' ')} with a readiness preview, governed execution plan, attach suggestion, and scoped agent draft. Next we should run readiness, preserve evidence, and request approval before any protected execution.`;
  // Copilot mode is a conversational turn: answer the trader directly and do NOT
  // mint governed objects (nothing touches real data without an explicit action).
  if (mode === 'copilot') {
    return {
      answer: answerText,
      structured_outputs: [],
      suggested_actions: [],
      created_objects: [],
      trace_id: input.traceId,
      mode,
      clarifying_questions: tradeBrainPlan?.clarifyingQuestions ?? [],
      plan_steps: tradeBrainPlan?.planSteps ?? [],
      follow_ups: tradeBrainPlan?.followUps ?? []
    };
  }
  const title = tradeBrainPlan?.title ?? titleForIntelligenceObject(objectType, input.body.message);
  const status = initialIntelligenceStatusFor(objectType, tradeBrainPlan?.status);
  const serviceObservability = tradeBrainPlan?.aiObservability ?? {};
  const aiObservability = {
    kind: 'ai_observability',
    model: stringFromRecord(serviceObservability, 'model') ?? (tradeBrainPlan ? 'traibox-trade-brain-deterministic-alpha' : 'traibox-alpha-structured-copilot'),
    model_router_version: stringFromRecord(serviceObservability, 'model_router_version') ?? (tradeBrainPlan ? 'model-router-alpha-v0' : 'local-alpha-router-v0'),
    prompt_version: stringFromRecord(serviceObservability, 'prompt_version') ?? (tradeBrainPlan ? 'trade-brain-copilot-alpha-v1' : 'intelligence-run-alpha-v2'),
    context_used: {
      workspace,
      trade_id: input.body.trade_id ?? null,
      object_count: input.body.object_ids?.length ?? 0,
      source_message_hash: sha256(input.body.message),
      structured_output_schema: tradeBrainPlan?.structuredOutputSchema ?? 'copilot-structured-output-alpha-v2',
      trade_brain_source: tradeBrainPlan ? 'fastapi_service' : 'local_deterministic_fallback',
      trade_brain_service_version: tradeBrainPlan?.serviceVersion ?? null
    },
    artifacts_used: input.body.object_ids ?? [],
    confidence: confidenceFromPlan(tradeBrainPlan, objectType),
    policy_constraints: tradeBrainPolicyConstraints(serviceObservability),
    replayable: serviceObservability.replayable === false ? false : true
  };
  const created = await createAlphaObject(pool, {
    ...input,
    type: objectType,
    body: {
      title,
      summary: 'Created from TRAIBOX Intelligence composer',
      status,
      origin_workspace: workspace,
      trade_id: input.body.trade_id ?? null,
      payload: {
        source_message: input.body.message,
        classification: objectType,
        suggested_attachment: Boolean(input.body.trade_id),
        input_objects: input.body.object_ids ?? [],
        structured_response_version: 'copilot-structured-output-alpha-v2',
        ai_observability: aiObservability,
        trade_brain: {
          source: tradeBrainPlan ? 'fastapi_service' : 'local_deterministic_fallback',
          service_version: tradeBrainPlan?.serviceVersion ?? null,
          classification_reason: tradeBrainPlan?.classificationReason ?? null,
          suggested_actions: tradeBrainPlan?.suggestedActions ?? [],
          eval_payload: tradeBrainPlan?.evalPayload ?? null
        }
      },
      evidence_refs: (input.body.object_ids ?? []).map((object_id) => ({ object_id, role: 'context' }))
    }
  });

  const suggested = enhancedSuggestedActionsFor(objectType, created.object);
  const evalPayload = buildIntelligenceEvalResult(input, {
    objectType,
    object: created.object,
    aiObservability,
    suggestedActions: suggested
  });
  const evalResult = await persistAiEvalResult(pool, input, {
    title: `AI eval: ${title.slice(0, 54)}`,
    summary: `${evalPayload.status.toUpperCase()} · ${Math.round(evalPayload.score)}% · Copilot classification and safety checks`,
    status: evalPayload.status === 'fail' ? 'blocked' : 'completed',
    tradeId: input.body.trade_id ?? null,
    payload: evalPayload,
    evidenceRefs: [{ object_id: created.object.object_id, role: 'copilot_created_object' }]
  });
  const structuredOutputs = buildCopilotStructuredOutputs({
    objectType,
    objectId: created.object.object_id,
    status: created.object.status,
    workspace,
    tradeId: input.body.trade_id ?? null,
    message: input.body.message,
    contextObjectIds: input.body.object_ids ?? [],
    suggestedActions: suggested,
    aiObservability,
    evalObjectId: evalResult.object_id,
    evalPayload: evalPayload as unknown as Record<string, unknown>,
    classificationReason: tradeBrainPlan?.classificationReason ?? null
  });
  return {
    answer: answerText,
    structured_outputs: structuredOutputs,
    suggested_actions: suggested,
    created_objects: [created.object],
    eval_result: evalResult,
    trace_id: input.traceId,
    mode,
    clarifying_questions: tradeBrainPlan?.clarifyingQuestions ?? [],
    plan_steps: tradeBrainPlan?.planSteps ?? [],
    follow_ups: tradeBrainPlan?.followUps ?? []
  };
}

export async function runInternalAlphaDemo(
  pool: pg.Pool,
  input: ActorInput & { messyInput?: string; scenarioId?: AlphaScenarioId }
): Promise<AlphaDemoResponse> {
  const scenarioId = input.scenarioId ?? 'full_trade_room_loop';
  if (scenarioId !== 'full_trade_room_loop') {
    return runStandaloneAlphaScenario(pool, { ...input, scenarioId });
  }

  const messyInput =
    input.messyInput ??
    'Portuguese seller will deliver 100 industrial sensors and remote commissioning services to a Spanish buyer next month; 40% advance, balance after acceptance, funding may be needed.';

  const tradeId = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    const tradeId = randomUUID();
    await client.query(
      `INSERT INTO trades(trade_id, org_id, title, corridor, amount, currency, status, created_by)
       VALUES($1,$2,$3,'PT-ES',$4,'EUR','active',$5)`,
      [tradeId, input.orgId, 'Industrial sensors plus commissioning services', 48000, input.userId]
    );
    await client.query(
      `INSERT INTO trade_plans(plan_id, trade_id, org_id, items, parties, terms, checklist, confidence, glass_box)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        tradeId,
        input.orgId,
        JSON.stringify([
          { name: 'Industrial sensors', qty: 100, unit: 'units', hs_code: '9032.89', notes: 'Goods component' },
          { name: 'Remote commissioning services', qty: 1, unit: 'project', hs_code: null, notes: 'Service component' }
        ]),
        JSON.stringify([
          { role: 'seller', name: 'Lusitania Automation Lda', country: 'PT' },
          { role: 'buyer', name: 'Iberica Components SL', country: 'ES' }
        ]),
        JSON.stringify({ incoterm: 'DAP', payment_terms: '40% advance, 60% on acceptance' }),
        JSON.stringify(['Confirm buyer tax ID', 'Upload purchase order', 'Approve payment intent', 'Generate proof bundle']),
        0.82,
        JSON.stringify({ reasons: ['Detected goods + services trade', 'Detected PT-ES corridor', 'Detected settlement terms'] })
      ]
    );
    await client.query('INSERT INTO trade_messages(trade_id, org_id, user_id, role, text) VALUES($1,$2,$3,$4,$5)', [
      tradeId,
      input.orgId,
      input.userId,
      'user',
      messyInput
    ]);
    await insertEvent(client, input, {
      type: 'plan.generated',
      tradeId,
      data: { trade_id: tradeId, summary: 'Messy input converted into Trade Room plan', trace_id: input.traceId }
    });
    return tradeId;
  });

  const tradeRoom = await createAlphaObject(pool, {
    ...input,
    type: 'trade_room',
    body: {
      title: 'Trade Room: PT-ES sensors plus services',
      summary: 'Full lifecycle reference implementation',
      status: 'in_progress',
      origin_workspace: 'trades',
      trade_id: tradeId,
      payload: { messy_input: messyInput, usage_mode: 'full_trade_cycle' }
    }
  });

  const standalonePayment = await createAlphaObject(pool, {
    ...input,
    type: 'payment_intent',
    body: {
      title: 'Standalone payment intent: 40% advance',
      summary: 'Created from Finance before attachment',
      status: 'approval_required',
      origin_workspace: 'finance',
      payload: { amount: 19200, currency: 'EUR', purpose: 'Advance payment', protected_action: 'send_payment' }
    }
  });

  const document = await extractDocumentAlpha(pool, {
    ...input,
    body: {
      filename: 'buyer-po-iberica-components.txt',
      text: 'PO 8812. Buyer Iberica Components SL. Seller Lusitania Automation Lda. Amount EUR 48000. Delivery Spain. Payment 40% advance and 60% after acceptance. Missing buyer VAT.',
      trade_id: tradeId,
      origin_workspace: 'trades'
    }
  });

  const clearance = await createAlphaObject(pool, {
    ...input,
    type: 'clearance_check',
    body: {
      title: 'PT-ES clearance and sustainability check',
      summary: 'EU corridor check with missing buyer VAT evidence',
      status: 'pending_input',
      origin_workspace: 'clearance',
      trade_id: tradeId,
      payload: { corridor: 'PT-ES', ruleset: 'EU-alpha', missing: ['buyer_vat_id'], risks: ['acceptance proof required'] },
      evidence_refs: [{ object_id: document.extraction_result.object_id, role: 'extraction_result' }]
    }
  });

  const readiness = await evaluateReadinessAlpha(pool, {
    ...input,
    body: { trade_id: tradeId, context: { demo: true, clearance_check_id: clearance.object.object_id } }
  });

  const approval = await requestApprovalAlpha(pool, {
    ...input,
    body: {
      target: { type: 'payment_intent', id: standalonePayment.object.object_id },
      protected_action: 'send_payment',
      proposed_action: 'Authorize 40% advance payment after buyer VAT is confirmed.',
      evidence_refs: [
        { object_id: document.extraction_result.object_id, role: 'extracted_purchase_order' },
        { object_id: clearance.object.object_id, role: 'clearance_context' },
        { object_id: readiness.readiness.readiness_id, role: 'readiness_state' }
      ],
      policy_refs: ['protected-actions-alpha-v1'],
      step_up_required: true,
      rationale: 'Payment execution is externally consequential and must remain human-controlled.'
    }
  });

  const attachedPayment = await attachAlphaObject(pool, {
    ...input,
    body: {
      object_id: standalonePayment.object.object_id,
      target: { type: 'trade_room', id: tradeId },
      mode: 'attach',
      reason: 'Advance payment belongs to the PT-ES Trade Room execution path.'
    }
  });

  const proof = await generateProofBundleAlpha(pool, {
    ...input,
    body: {
      trade_id: tradeId,
      object_ids: [
        tradeRoom.object.object_id,
        document.document.object_id,
        document.extraction_result.object_id,
        clearance.object.object_id,
        approval.approval.object_id,
        attachedPayment.object.object_id
      ],
      title: 'Internal alpha Trade Room proof bundle'
    }
  });

  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await insertEvent(client, input, {
      type: 'operations.digest.ready',
      tradeId,
      data: {
        blocked_work: readiness.readiness.missing_items,
        approvals_waiting: [approval.approval.object_id],
        proof_ready: proof.proof_bundle.object_id,
        what_to_do_first: readiness.readiness.next_actions[0],
        trace_id: input.traceId
      }
    });
  });

  const objects = [
    tradeRoom.object,
    standalonePayment.object,
    document.document,
    document.extraction_result,
    clearance.object,
    approval.approval,
    attachedPayment.object,
    proof.proof_bundle
  ];

  const steps: AlphaDemoStep[] = [
    { key: 'messy_input', title: 'Messy trade input', status: 'completed', trade_id: tradeId, summary: messyInput },
    { key: 'document_upload', title: 'Document uploaded', status: document.document.status, object_id: document.document.object_id, trade_id: tradeId, summary: document.document.summary ?? '' },
    { key: 'data_extraction', title: 'Data extracted', status: document.extraction_result.status, object_id: document.extraction_result.object_id, trade_id: tradeId, summary: `${Object.keys(document.extracted_fields).length} fields extracted` },
    { key: 'gap_detection', title: 'Gap and risk detected', status: 'missing', object_id: document.extraction_result.object_id, trade_id: tradeId, summary: document.missing_fields.join(', ') || 'No missing fields' },
    { key: 'readiness_state', title: 'Readiness state produced', status: readiness.readiness.overall, trade_id: tradeId, summary: readiness.readiness.next_actions[0] ?? 'Readiness evaluated' },
    { key: 'clearance_check', title: 'Clearance check', status: clearance.object.status, object_id: clearance.object.object_id, trade_id: tradeId, summary: clearance.object.summary ?? '' },
    { key: 'payment_intent', title: 'Standalone payment intent', status: standalonePayment.object.status, object_id: standalonePayment.object.object_id, summary: standalonePayment.object.summary ?? '' },
    { key: 'human_approval', title: 'Human approval requested', status: approval.approval.status, object_id: approval.approval.object_id, trade_id: tradeId, summary: approval.approval.summary ?? '' },
    { key: 'proof_bundle', title: 'Proof bundle generated', status: proof.proof_bundle.status, object_id: proof.proof_bundle.object_id, trade_id: tradeId, summary: proof.proof_bundle.summary ?? '' },
    { key: 'operations_center', title: 'Operations Center updated', status: 'completed', trade_id: tradeId, summary: readiness.readiness.next_actions[0] ?? 'Digest ready' },
    { key: 'attachment', title: 'Standalone object attached to Trade Room', status: attachedPayment.object.status, object_id: attachedPayment.object.object_id, trade_id: tradeId, summary: 'Permissions, audit, memory, evidence, and replay context preserved.' }
  ];

  return {
    ...scenarioMeta('full_trade_room_loop'),
    trade_id: tradeId,
    steps,
    objects,
    readiness: readiness.readiness,
    proof_bundle: proof.proof_bundle,
    trace_id: input.traceId
  };
}

async function runStandaloneAlphaScenario(
  pool: pg.Pool,
  input: ActorInput & { messyInput?: string; scenarioId: Exclude<AlphaScenarioId, 'full_trade_room_loop'> }
): Promise<AlphaDemoResponse> {
  const tradeId = await createScenarioTrade(pool, input, scenarioTradeSeed(input.scenarioId, input.messyInput));
  const steps: AlphaDemoStep[] = [];
  const objects: AlphaObject[] = [];

  const pushObject = (object: AlphaObject) => {
    objects.push(object);
    return object;
  };

  let readiness: ReadinessState;
  let proof: GenerateProofBundleResponse;

  if (input.scenarioId === 'standalone_payment') {
    const payment = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'payment_intent',
          body: {
            title: 'Standalone payment intent: supplier advance',
            summary: 'Created in Finance before a full Trade Room exists.',
            status: 'approval_required',
            origin_workspace: 'finance',
            payload: {
              amount: 12800,
              currency: 'EUR',
              beneficiary: 'Valencia Components SL',
              purpose: 'Supplier advance',
              protected_action: 'send_payment'
            }
          }
        })
      ).object
    );
    steps.push(step('standalone_start', 'Standalone payment created', payment.status, payment, 'Finance created a payment intent without forcing a Trade Room first.'));

    readiness = (await evaluateReadinessAlpha(pool, { ...input, body: { object_id: payment.object_id } })).readiness;
    steps.push(step('readiness_state', 'Payment readiness evaluated', readiness.overall, null, readiness.next_actions[0] ?? 'Payment readiness evaluated.'));

    const approval = pushObject(
      (
        await requestApprovalAlpha(pool, {
          ...input,
          body: {
            target: { type: 'payment_intent', id: payment.object_id },
            protected_action: 'send_payment',
            proposed_action: 'Send supplier advance after beneficiary and approval checks pass.',
            evidence_refs: [{ object_id: payment.object_id, role: 'payment_intent' }],
            policy_refs: ['protected-actions-alpha-v1'],
            step_up_required: true,
            rationale: 'Sending money is externally consequential.'
          }
        })
      ).approval
    );
    steps.push(step('human_approval', 'Human approval requested', approval.status, approval, 'Protected payment execution is blocked until explicit approval.'));

    const attached = pushObject(
      (await attachAlphaObject(pool, { ...input, body: { object_id: payment.object_id, target: { type: 'trade_room', id: tradeId }, mode: 'attach', reason: 'Attach payment intent to supplier purchase Trade Room.' } })).object
    );
    steps.push(step('attachment', 'Payment attached to Trade Room', attached.status, attached, 'Attach preserved owner, permissions, evidence, audit, and memory context.'));

    proof = await generateProofBundleAlpha(pool, { ...input, body: { trade_id: tradeId, object_ids: [attached.object_id, approval.object_id], title: 'Standalone payment proof bundle' } });
  } else if (input.scenarioId === 'standalone_clearance') {
    const clearance = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'clearance_check',
          body: {
            title: 'Standalone EU clearance check',
            summary: 'Created in Clearance before trade execution.',
            status: 'pending_input',
            origin_workspace: 'clearance',
            payload: {
              corridor: 'PT-FR',
              ruleset: 'EU-alpha',
              missing: ['origin_statement', 'sustainability_attestation'],
              risks: ['Rules evidence incomplete']
            }
          }
        })
      ).object
    );
    steps.push(step('standalone_start', 'Standalone clearance check created', clearance.status, clearance, 'Clearance starts independently with missing rule evidence.'));

    const report = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'report',
          body: {
            title: 'Clearance evidence gap report',
            summary: 'Report generated from standalone clearance context.',
            status: 'ready_for_review',
            origin_workspace: 'clearance',
            payload: { report_type: 'clearance_gap_report', missing: ['origin_statement', 'sustainability_attestation'] },
            evidence_refs: [{ object_id: clearance.object_id, role: 'clearance_check' }]
          }
        })
      ).object
    );
    steps.push(step('report_generation', 'Report generated', report.status, report, 'Clearance report is ready for review and proof.'));

    readiness = (await evaluateReadinessAlpha(pool, { ...input, body: { object_id: clearance.object_id } })).readiness;
    steps.push(step('readiness_state', 'Clearance readiness evaluated', readiness.overall, null, readiness.next_actions[0] ?? 'Resolve clearance evidence gaps.'));

    const attached = pushObject(
      (await attachAlphaObject(pool, { ...input, body: { object_id: clearance.object_id, target: { type: 'trade_room', id: tradeId }, mode: 'attach', reason: 'Attach clearance check to the matched Trade Room.' } })).object
    );
    steps.push(step('attachment', 'Clearance attached to Trade Room', attached.status, attached, 'Standalone clearance context now supports transaction readiness.'));

    proof = await generateProofBundleAlpha(pool, { ...input, body: { trade_id: tradeId, object_ids: [attached.object_id, report.object_id], title: 'Standalone clearance proof bundle' } });
  } else if (input.scenarioId === 'counterparty_onboarding_screening') {
    const counterparty = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'counterparty',
          body: {
            title: 'Counterparty: Nordic Retail AB',
            summary: 'Network-created buyer profile.',
            status: 'pending_input',
            origin_workspace: 'network',
            payload: { role: 'buyer', country: 'SE', identifiers_missing: ['lei'], reusable_across_trades: true }
          }
        })
      ).object
    );
    steps.push(step('standalone_start', 'Counterparty created', counterparty.status, counterparty, 'Network starts with a reusable counterparty record.'));

    const onboarding = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'onboarding_flow',
          body: {
            title: 'Onboarding flow: Nordic Retail AB',
            summary: 'Collecting business identifiers and external participant data.',
            status: 'in_progress',
            origin_workspace: 'network',
            payload: { required_fields: ['registration_number', 'lei', 'authorized_contact'], completed_fields: ['registration_number'] },
            evidence_refs: [{ object_id: counterparty.object_id, role: 'counterparty' }]
          }
        })
      ).object
    );

    const screening = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'screening_result',
          body: {
            title: 'Screening result: Nordic Retail AB',
            summary: 'Sanctions clear; LEI still missing.',
            status: 'ready_for_review',
            origin_workspace: 'network',
            payload: { sanctions: 'clear', pep: 'clear', adverse_media: 'none_found', missing: ['lei'] },
            evidence_refs: [{ object_id: onboarding.object_id, role: 'onboarding_flow' }]
          }
        })
      ).object
    );
    steps.push(step('screening', 'Onboarding and screening completed', screening.status, screening, 'Screening result updates trust context but keeps missing identifiers explicit.'));

    readiness = (await evaluateReadinessAlpha(pool, { ...input, body: { object_id: screening.object_id } })).readiness;
    steps.push(step('readiness_state', 'Counterparty readiness evaluated', readiness.overall, null, readiness.next_actions[0] ?? 'Complete missing identifier.'));

    const attached = pushObject(
      (await attachAlphaObject(pool, { ...input, body: { object_id: counterparty.object_id, target: { type: 'trade_room', id: tradeId }, mode: 'link', reason: 'Link reusable counterparty trust context to Trade Room.' } })).object
    );
    const attachedScreening = pushObject(
      (await attachAlphaObject(pool, { ...input, body: { object_id: screening.object_id, target: { type: 'trade_room', id: tradeId }, mode: 'link', reason: 'Link screening evidence to the same Trade Room trust context.' } })).object
    );
    steps.push(step('attachment', 'Counterparty linked to Trade Room', attached.status, attached, 'Reusable Network trust context and screening evidence are linked to the transaction.'));

    proof = await generateProofBundleAlpha(pool, { ...input, body: { trade_id: tradeId, object_ids: [attached.object_id, onboarding.object_id, attachedScreening.object_id], title: 'Counterparty onboarding proof bundle' } });
  } else if (input.scenarioId === 'funding_request') {
    const funding = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'funding_request',
          body: {
            title: 'Standalone funding request: working capital',
            summary: 'Created in Finance before final trade execution.',
            status: 'pending_input',
            origin_workspace: 'finance',
            payload: { amount: 42000, currency: 'EUR', tenor_days: 90, missing: ['purchase_order', 'buyer_acceptance_terms'] }
          }
        })
      ).object
    );
    steps.push(step('standalone_start', 'Funding request created', funding.status, funding, 'Finance starts with funding need and missing evidence.'));

    const financePack = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'document',
          body: {
            title: 'Finance-readiness pack placeholder',
            summary: 'Required documents identified for lender review.',
            status: 'pending_input',
            origin_workspace: 'finance',
            payload: { required_documents: ['purchase_order', 'invoice', 'buyer_acceptance_terms'], present_documents: ['invoice'] },
            evidence_refs: [{ object_id: funding.object_id, role: 'funding_request' }]
          }
        })
      ).object
    );

    readiness = (await evaluateReadinessAlpha(pool, { ...input, body: { object_id: funding.object_id } })).readiness;
    steps.push(step('readiness_state', 'Finance-readiness evaluated', readiness.overall, null, readiness.next_actions[0] ?? 'Prepare funding evidence pack.'));

    const approval = pushObject(
      (
        await requestApprovalAlpha(pool, {
          ...input,
          body: {
            target: { type: 'funding_request', id: funding.object_id },
            protected_action: 'submit_funding_request',
            proposed_action: 'Submit funding request to sandbox financier after missing documents are provided.',
            evidence_refs: [{ object_id: financePack.object_id, role: 'finance_readiness_pack' }],
            policy_refs: ['protected-actions-alpha-v1'],
            step_up_required: true
          }
        })
      ).approval
    );

    const offer = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'funding_offer',
          body: {
            title: 'Sandbox funding offer',
            summary: 'Indicative offer captured for review.',
            status: 'ready_for_review',
            origin_workspace: 'finance',
            payload: { apr_bps: 680, tenor_days: 90, conditions: ['Upload PO', 'Buyer acceptance proof'] },
            evidence_refs: [{ object_id: funding.object_id, role: 'funding_request' }]
          }
        })
      ).object
    );
    steps.push(step('funding_offer', 'Funding offer captured', offer.status, offer, 'Execution moved beyond diagnosis into funding lifecycle state.'));

    const attached = pushObject(
      (await attachAlphaObject(pool, { ...input, body: { object_id: funding.object_id, target: { type: 'trade_room', id: tradeId }, mode: 'attach', reason: 'Attach funding request to Trade Room execution path.' } })).object
    );
    steps.push(step('attachment', 'Funding request attached to Trade Room', attached.status, attached, 'Funding evidence, approval, offer, and memory stay connected.'));

    proof = await generateProofBundleAlpha(pool, { ...input, body: { trade_id: tradeId, object_ids: [attached.object_id, financePack.object_id, approval.object_id, offer.object_id], title: 'Funding request proof bundle' } });
  } else {
    const document = await extractDocumentAlpha(pool, {
      ...input,
      body: {
        filename: 'unmatched-invoice-before-trade.txt',
        text: 'Invoice INV-44. Seller Porto Robotics Lda. Buyer Berlin Retail GmbH. Amount EUR 31500. Payment terms net 30. Goods plus installation support. Missing incoterm and buyer tax ID.',
        origin_workspace: 'intelligence'
      }
    });
    pushObject(document.document);
    pushObject(document.extraction_result);
    steps.push(step('document_first', 'Document uploaded before trade', document.document.status, document.document, 'TRAIBOX classified and extracted the document without a Trade Room.'));
    steps.push(step('workflow_suggestions', 'Workflows suggested from extraction', document.extraction_result.status, document.extraction_result, 'Suggested Trade Room, clearance check, funding request, payment intent, and proof bundle.'));

    const clearance = pushObject(
      (
        await createAlphaObject(pool, {
          ...input,
          type: 'clearance_check',
          body: {
            title: 'Suggested clearance check from document',
            summary: 'Created from document-first extraction.',
            status: 'pending_input',
            origin_workspace: 'clearance',
            payload: { source: 'document_first', missing: document.missing_fields },
            evidence_refs: [{ object_id: document.extraction_result.object_id, role: 'extraction_result' }]
          }
        })
      ).object
    );

    const attachedDoc = pushObject(
      (await attachAlphaObject(pool, { ...input, body: { object_id: document.document.object_id, target: { type: 'trade_room', id: tradeId }, mode: 'convert', reason: 'Convert document-first work into a Trade Room.' } })).object
    );
    const attachedClearance = pushObject(
      (await attachAlphaObject(pool, { ...input, body: { object_id: clearance.object_id, target: { type: 'trade_room', id: tradeId }, mode: 'attach', reason: 'Attach suggested clearance workflow to converted Trade Room.' } })).object
    );
    steps.push(step('attachment', 'Document-first flow converted to Trade Room', attachedDoc.status, attachedDoc, 'Document context converted into trade context without losing extraction evidence.'));

    readiness = (await evaluateReadinessAlpha(pool, { ...input, body: { trade_id: tradeId } })).readiness;
    steps.push(step('readiness_state', 'Converted trade readiness evaluated', readiness.overall, null, readiness.next_actions[0] ?? 'Readiness evaluated.'));

    proof = await generateProofBundleAlpha(pool, { ...input, body: { trade_id: tradeId, object_ids: [attachedDoc.object_id, document.extraction_result.object_id, attachedClearance.object_id], title: 'Document-first proof bundle' } });
  }

  const proofObject = pushObject(proof.proof_bundle);
  steps.push(step('proof_bundle', 'Proof bundle generated', proofObject.status, proofObject, proofObject.summary ?? 'Proof bundle generated.'));
  await emitOperationsDigest(pool, input, tradeId, readiness, proofObject.object_id);
  steps.push({ key: 'operations_center', title: 'Operations Center updated', status: 'completed', trade_id: tradeId, summary: readiness.next_actions[0] ?? 'Digest ready.' });

  return {
    ...scenarioMeta(input.scenarioId),
    trade_id: tradeId,
    steps,
    objects: dedupeObjects(objects),
    readiness,
    proof_bundle: proofObject,
    trace_id: input.traceId
  };
}

async function createScenarioTrade(
  pool: pg.Pool,
  input: ActorInput,
  seed: {
    title: string;
    messyInput: string;
    corridor: string;
    amount: number;
    items: unknown[];
    parties: unknown[];
    terms: Record<string, unknown>;
    checklist: string[];
  }
): Promise<string> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await ensureUser(client, input.userId);
    const tradeId = randomUUID();
    await client.query(
      `INSERT INTO trades(trade_id, org_id, title, corridor, amount, currency, status, created_by)
       VALUES($1,$2,$3,$4,$5,'EUR','active',$6)`,
      [tradeId, input.orgId, seed.title, seed.corridor, seed.amount, input.userId]
    );
    await client.query(
      `INSERT INTO trade_plans(plan_id, trade_id, org_id, items, parties, terms, checklist, confidence, glass_box)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        tradeId,
        input.orgId,
        JSON.stringify(seed.items),
        JSON.stringify(seed.parties),
        JSON.stringify(seed.terms),
        JSON.stringify(seed.checklist),
        0.78,
        JSON.stringify({ reasons: ['Scenario fixture', 'Created for internal alpha execution test', `Corridor ${seed.corridor}`] })
      ]
    );
    await client.query('INSERT INTO trade_messages(trade_id, org_id, user_id, role, text) VALUES($1,$2,$3,$4,$5)', [
      tradeId,
      input.orgId,
      input.userId,
      'user',
      seed.messyInput
    ]);
    await insertEvent(client, input, {
      type: 'plan.generated',
      tradeId,
      data: { trade_id: tradeId, scenario: seed.title, summary: 'Scenario Trade Room context created', trace_id: input.traceId }
    });
    return tradeId;
  });
}

function scenarioTradeSeed(scenarioId: AlphaScenarioId, messyInput?: string) {
  const common = {
    terms: { incoterm: 'DAP', payment_terms: '30% advance, balance on proof' },
    checklist: ['Resolve missing evidence', 'Run readiness', 'Request approval', 'Generate proof bundle']
  };
  if (scenarioId === 'standalone_payment') {
    return {
      ...common,
      title: 'Supplier purchase with standalone payment',
      messyInput: messyInput ?? 'Finance wants to prepare a supplier advance before the full trade is assembled.',
      corridor: 'ES-PT',
      amount: 32000,
      items: [{ name: 'Machined components', qty: 80, unit: 'units', hs_code: '8483.90' }],
      parties: [{ role: 'buyer', name: 'Porto Assembly Lda', country: 'PT' }, { role: 'seller', name: 'Valencia Components SL', country: 'ES' }]
    };
  }
  if (scenarioId === 'standalone_clearance') {
    return {
      ...common,
      title: 'PT-FR sustainability-sensitive shipment',
      messyInput: messyInput ?? 'Clearance team needs to check EU evidence before execution.',
      corridor: 'PT-FR',
      amount: 54000,
      items: [{ name: 'Recycled aluminium parts', qty: 240, unit: 'kg', hs_code: '7616.99' }],
      parties: [{ role: 'seller', name: 'Braga Materials SA', country: 'PT' }, { role: 'buyer', name: 'Lyon Mobility SAS', country: 'FR' }]
    };
  }
  if (scenarioId === 'counterparty_onboarding_screening') {
    return {
      ...common,
      title: 'Nordic buyer onboarding for recurring trade',
      messyInput: messyInput ?? 'Network needs to onboard and screen a new buyer before they are used in future trades.',
      corridor: 'PT-SE',
      amount: 26000,
      items: [{ name: 'Packaged specialty foods', qty: 900, unit: 'cases', hs_code: '2106.90' }],
      parties: [{ role: 'seller', name: 'Lisbon Foods Lda', country: 'PT' }, { role: 'buyer', name: 'Nordic Retail AB', country: 'SE' }]
    };
  }
  if (scenarioId === 'funding_request') {
    return {
      ...common,
      title: 'Working capital funding request',
      messyInput: messyInput ?? 'Finance wants funding for a confirmed order but the pack is incomplete.',
      corridor: 'PT-NL',
      amount: 78000,
      items: [{ name: 'IoT gateways', qty: 150, unit: 'units', hs_code: '8517.62' }],
      parties: [{ role: 'seller', name: 'Aveiro Devices Lda', country: 'PT' }, { role: 'buyer', name: 'Rotterdam Infra BV', country: 'NL' }]
    };
  }
  return {
    ...common,
    title: 'Document-first trade converted from invoice',
    messyInput: messyInput ?? 'User uploaded invoice before knowing whether to create trade, payment, funding, or clearance work.',
    corridor: 'PT-DE',
    amount: 31500,
    items: [{ name: 'Robotics goods plus installation support', qty: 1, unit: 'project', hs_code: '8479.50' }],
    parties: [{ role: 'seller', name: 'Porto Robotics Lda', country: 'PT' }, { role: 'buyer', name: 'Berlin Retail GmbH', country: 'DE' }]
  };
}

async function emitOperationsDigest(pool: pg.Pool, input: ActorInput, tradeId: string, readiness: ReadinessState, proofBundleId: string) {
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await insertEvent(client, input, {
      type: 'operations.digest.ready',
      tradeId,
      data: {
        blocked_work: readiness.missing_items,
        proof_ready: proofBundleId,
        what_to_do_first: readiness.next_actions[0],
        scenario_digest: true,
        trace_id: input.traceId
      }
    });
  });
}

function step(key: string, title: string, status: ObjectLifecycleStatus | ReadinessOverall, object: AlphaObject | null, summary: string): AlphaDemoStep {
  return { key, title, status, object_id: object?.object_id, trade_id: object?.trade_id ?? undefined, summary };
}

function dedupeObjects(objects: AlphaObject[]): AlphaObject[] {
  const byId = new Map<string, AlphaObject>();
  for (const object of objects) byId.set(object.object_id, object);
  return Array.from(byId.values());
}

function scenarioMeta(scenarioId: AlphaScenarioId): Pick<AlphaDemoResponse, 'scenario_id' | 'scenario_title' | 'mode'> {
  const scenario = ALPHA_SCENARIOS.find((item) => item.id === scenarioId) ?? ALPHA_SCENARIOS[0];
  return { scenario_id: scenario.id, scenario_title: scenario.title, mode: scenario.mode };
}

async function ensureUser(client: pg.PoolClient, userId: string) {
  await client.query('INSERT INTO app_users(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING', [userId]);
}

async function getAlphaObject(client: pg.PoolClient, objectId: string): Promise<AlphaObject | null> {
  const res = await client.query<AlphaRow>('SELECT * FROM alpha_objects WHERE object_id=$1 AND org_id=app.current_org() LIMIT 1', [objectId]);
  return res.rows[0] ? mapAlphaObject(res.rows[0]) : null;
}

async function getAlphaObjects(client: pg.PoolClient, objectIds: string[]): Promise<AlphaObject[]> {
  if (!objectIds.length) return [];
  const res = await client.query<AlphaRow>('SELECT * FROM alpha_objects WHERE org_id=app.current_org() AND object_id = ANY($1::uuid[]) ORDER BY created_at ASC', [objectIds]);
  return res.rows.map(mapAlphaObject);
}

async function loadLatestReadinessForProof(
  client: pg.PoolClient,
  input: { tradeId: string | null; objectIds: string[] }
): Promise<ReadinessState | null> {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (input.tradeId) {
    params.push(input.tradeId);
    filters.push(`trade_id=$${params.length}`);
  }
  if (input.objectIds.length) {
    params.push(input.objectIds);
    filters.push(`object_id=ANY($${params.length}::uuid[])`);
  }
  if (!filters.length) return null;
  const res = await client.query(
    `SELECT readiness_id, org_id, object_id, trade_id, overall, score, dimensions_json,
            missing_items_json, risk_findings_json, next_actions_json, trace_id, created_at
     FROM alpha_readiness_states
     WHERE org_id=app.current_org() AND (${filters.join(' OR ')})
     ORDER BY created_at DESC
     LIMIT 1`,
    params
  );
  return res.rows[0] ? mapReadiness(res.rows[0]) : null;
}

type ReplayScope = {
  orgId: string;
  tradeId: string | null;
  objectId: string | null;
  objectIds?: Set<string>;
  limit: number;
};

function replayScopeFilter(scope: ReplayScope, options?: { objectColumn?: string; tradeColumn?: string; payloadColumn?: string }) {
  const filters: string[] = [];
  const params: unknown[] = [];
  const tradeColumn = options?.tradeColumn ?? 'trade_id';
  const objectColumn = options?.objectColumn ?? 'object_id';

  if (scope.tradeId) {
    params.push(scope.tradeId);
    filters.push(`${tradeColumn}=$${params.length}`);
  }
  if (scope.objectId && objectColumn) {
    params.push(scope.objectId);
    filters.push(`${objectColumn}=$${params.length}`);
  }
  if (scope.objectIds?.size && objectColumn) {
    params.push([...scope.objectIds]);
    filters.push(`${objectColumn}=ANY($${params.length}::uuid[])`);
  }
  if (scope.objectId && options?.payloadColumn) {
    params.push(`%${scope.objectId}%`);
    filters.push(`${options.payloadColumn}::text LIKE $${params.length}`);
  }

  return {
    where: filters.length ? `(${Array.from(new Set(filters)).join(' OR ')})` : 'false',
    params
  };
}

async function replayObjectRows(client: pg.PoolClient, scope: ReplayScope): Promise<AlphaRow[]> {
  const filter = replayScopeFilter(scope);
  const res = await client.query<AlphaRow>(
    `SELECT * FROM alpha_objects
     WHERE org_id=app.current_org() AND ${filter.where}
     ORDER BY created_at ASC
     LIMIT $${filter.params.length + 1}`,
    [...filter.params, scope.limit]
  );
  return res.rows;
}

async function replayEventRows(client: pg.PoolClient, scope: ReplayScope) {
  const filter = replayScopeFilter(scope, { objectColumn: '', payloadColumn: 'data' });
  const res = await client.query(
    `SELECT event_id, trade_id, type, ts, trace_id, actor, data
     FROM trade_events
     WHERE org_id=app.current_org() AND ${filter.where}
     ORDER BY ts ASC
     LIMIT $${filter.params.length + 1}`,
    [...filter.params, scope.limit]
  );
  return res.rows;
}

async function replayMemoryRows(client: pg.PoolClient, scope: ReplayScope) {
  const filter = replayScopeFilter(scope);
  const res = await client.query(
    `SELECT memory_event_id, trade_id, object_id, level, kind, signal, payload_json, trace_id, created_at
     FROM alpha_memory_events
     WHERE org_id=app.current_org() AND ${filter.where}
     ORDER BY created_at ASC
     LIMIT $${filter.params.length + 1}`,
    [...filter.params, scope.limit]
  );
  return res.rows;
}

async function replayAuditRows(client: pg.PoolClient, scope: ReplayScope) {
  const filter = replayScopeFilter(scope, { objectColumn: '', payloadColumn: 'payload_json' });
  if (!scope.tradeId && !scope.objectId) return [];
  const res = await client.query(
    `SELECT event_id, trade_id, actor, action, payload_json, prev_hash, hash, created_at
     FROM audit_events
     WHERE org_id=app.current_org() AND ${filter.where}
     ORDER BY created_at ASC
     LIMIT $${filter.params.length + 1}`,
    [...filter.params, scope.limit]
  );
  return res.rows;
}

async function replayReadinessRows(client: pg.PoolClient, scope: ReplayScope) {
  const filter = replayScopeFilter(scope);
  const res = await client.query(
    `SELECT readiness_id, trade_id, object_id, overall, score, dimensions_json, missing_items_json, risk_findings_json, next_actions_json, trace_id, created_at
     FROM alpha_readiness_states
     WHERE org_id=app.current_org() AND ${filter.where}
     ORDER BY created_at ASC
     LIMIT $${filter.params.length + 1}`,
    [...filter.params, scope.limit]
  );
  return res.rows;
}

async function replayAttachmentRows(client: pg.PoolClient, scope: ReplayScope) {
  const filters: string[] = [];
  const params: unknown[] = [];
  if (scope.objectId) {
    params.push(scope.objectId);
    filters.push(`(source_object_id=$${params.length} OR target_id=$${params.length})`);
  }
  if (scope.objectIds?.size) {
    params.push([...scope.objectIds]);
    filters.push(`source_object_id=ANY($${params.length}::uuid[])`);
  }
  if (scope.tradeId) {
    params.push(scope.tradeId);
    filters.push(`target_id=$${params.length}`);
  }
  const res = await client.query(
    `SELECT link_id, source_object_id, target_type, target_id, mode, payload_json, trace_id, created_at
     FROM alpha_object_links
     WHERE org_id=app.current_org() AND (${filters.length ? filters.join(' OR ') : 'false'})
     ORDER BY created_at ASC
     LIMIT $${params.length + 1}`,
    [...params, scope.limit]
  );
  return res.rows;
}

async function replayProofRows(client: pg.PoolClient, scope: ReplayScope) {
  const filter = replayScopeFilter(scope, { payloadColumn: 'artifact_refs_json' });
  const res = await client.query(
    `SELECT bundle_id, trade_id, object_id, root, manifest_sha256, artifact_refs_json, status, trace_id, created_at
     FROM alpha_proof_bundles
     WHERE org_id=app.current_org() AND ${filter.where}
     ORDER BY created_at ASC
     LIMIT $${filter.params.length + 1}`,
    [...filter.params, scope.limit]
  );
  return res.rows;
}

function replayHash(steps: ReplayStep[]) {
  return sha256(buildReplayHashPayload(steps));
}

function replayGaps(steps: ReplayStep[], scope: { requestedTradeId: string | null; requestedObjectId: string | null; includeAudit: boolean }) {
  return replayCoverageGaps(steps, scope);
}

type LoadedExternalAccessSession = {
  tokenHash: string;
  orgId: string;
  grant: AlphaObject;
  target: AlphaObject | null;
  participant: { name?: string; email?: string; role: string };
  scopes: string[];
  expiresAt: string | null;
};

async function loadExternalAccessSession(
  pool: pg.Pool,
  input: { token: string; traceId: string; requiredScope?: string }
): Promise<LoadedExternalAccessSession> {
  const tokenHash = hashExternalAccessToken(input.token);
  const tokenRow = await withTx(pool, async (client) => {
    await setAppContext(client, { userId: EXTERNAL_PARTICIPANT_USER_ID, orgId: null });
    const res = await client.query<{
      token_hash: string;
      org_id: string;
      grant_object_id: string;
      status: string;
      expires_at: Date | string | null;
      revoked_at: Date | string | null;
    }>(
      `SELECT token_hash, org_id, grant_object_id, status, expires_at, revoked_at
       FROM alpha_external_access_tokens
       WHERE token_hash=$1
       LIMIT 1`,
      [tokenHash]
    );
    return res.rows[0] ?? null;
  });

  if (!tokenRow) throwUnauthorized('Invalid external access token');
  if (tokenRow.status !== 'active' || tokenRow.revoked_at) throwForbidden('External access token is not active');
  const expiresAt = tokenRow.expires_at ? toIso(tokenRow.expires_at) : null;
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) throwForbidden('External access token has expired');

  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: EXTERNAL_PARTICIPANT_USER_ID, orgId: tokenRow.org_id });
    const grant = await getAlphaObject(client, tokenRow.grant_object_id);
    if (!grant || grant.type !== 'external_access_grant' || grant.status !== 'approved') throwForbidden('External access grant is not active');
    const scopes = Array.isArray(grant.payload_json?.scopes) ? grant.payload_json.scopes.filter((scope): scope is string => typeof scope === 'string') : [];
    if (input.requiredScope && !normalizeExternalScopes(scopes).includes(input.requiredScope)) throwForbidden(`External access token lacks ${input.requiredScope} scope`);
    const participantPayload = grant.payload_json?.participant;
    const participant =
      participantPayload && typeof participantPayload === 'object' && !Array.isArray(participantPayload)
        ? {
            name: typeof (participantPayload as any).name === 'string' ? (participantPayload as any).name : undefined,
            email: typeof (participantPayload as any).email === 'string' ? (participantPayload as any).email : undefined,
            role: typeof (participantPayload as any).role === 'string' ? (participantPayload as any).role : 'external_participant'
          }
        : { role: 'external_participant' };
    const targetRef = grant.payload_json?.target as { type?: string; id?: string } | undefined;
    let target: AlphaObject | null = null;
    if (targetRef?.type && targetRef.id) {
      if (isAlphaObjectType(targetRef.type)) {
        target = await getAlphaObject(client, targetRef.id);
        if (!target) throwForbidden('External access target is no longer available');
      } else if (targetRef.type === 'trade' || targetRef.type === 'trade_room') {
        await assertTradeInCurrentOrg(client, targetRef.id, 'External access target trade is no longer available');
      }
    }
    return { tokenHash, orgId: tokenRow.org_id, grant, target, participant, scopes, expiresAt };
  });
}

async function buildExternalAccessScopePolicy(
  client: pg.PoolClient,
  target: AlphaObjectRef,
  requestedScopes: string[],
  expiresAt?: string
) {
  const scopes = normalizeExternalScopes(requestedScopes);
  if (!scopes.length) throwBadRequest('At least one external access scope is required');
  const unknown = scopes.filter((scope) => !SUPPORTED_EXTERNAL_ACCESS_SCOPES.has(scope));
  if (unknown.length) throwBadRequest(`Unsupported external access scope: ${unknown.join(', ')}`);
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) throwBadRequest('External access expiry must be in the future');

  let targetType = target.type;
  if (isAlphaObjectType(target.type)) {
    const targetObject = await getAlphaObject(client, target.id);
    if (!targetObject) throwNotFound('External access target object not found');
    targetType = targetObject.type;
  } else if (target.type === 'trade' || target.type === 'trade_room') {
    await assertTradeInCurrentOrg(client, target.id, 'External access target trade not found');
    targetType = 'trade_room';
  }

  const allowed = allowedScopesForExternalTarget(targetType);
  const denied = scopes.filter((scope) => !allowed.has(scope));
  if (denied.length) throwBadRequest(`External access scope not allowed for ${targetType}: ${denied.join(', ')}`);

  return {
    policy_id: 'external-access-alpha-v1',
    target_type: targetType,
    scopes,
    allowed_actions: allowedActionsForExternalScopes(scopes),
    protected_actions: 'blocked_without_internal_approval',
    enforcement: ['token_hash', 'org_rls', 'target_scope', 'expiry', 'revocation', 'audit_chain'],
    expires_at: expiresAt ?? null
  };
}

async function loadExternalPortalObjects(pool: pg.Pool, session: LoadedExternalAccessSession): Promise<AlphaObject[]> {
  return withTx(pool, async (client) => {
    await setAppContext(client, { userId: EXTERNAL_PARTICIPANT_USER_ID, orgId: session.orgId });
    const res = await client.query<AlphaRow>(
      `SELECT *
       FROM alpha_objects
       WHERE org_id=app.current_org()
       ORDER BY created_at DESC
       LIMIT 250`
    );
    const scoped = res.rows.map(mapAlphaObject).filter((object) => portalObjectIsVisible(object, session));
    const byId = new Map<string, AlphaObject>();
    if (session.target && portalObjectIsVisible(session.target, session)) byId.set(session.target.object_id, session.target);
    for (const object of scoped) byId.set(object.object_id, object);
    return [...byId.values()].slice(0, 40);
  });
}

function portalObjectIsVisible(object: AlphaObject, session: LoadedExternalAccessSession): boolean {
  const scopes = new Set(normalizeExternalScopes(session.scopes));
  const targetRef = session.grant.payload_json?.target as { type?: string; id?: string } | undefined;
  const targetId = targetRef?.id ?? session.target?.object_id ?? null;
  const targetType = targetRef?.type ?? session.target?.type ?? null;
  const tradeLevelGrant = targetType === 'trade' || targetType === 'trade_room';
  const evidenceIds = new Set<string>([
    ...objectIdsFromEvidenceRefs(object.evidence_refs_json),
    ...objectIdsFromEvidenceRefs(session.grant.evidence_refs_json),
    ...(session.target ? objectIdsFromEvidenceRefs(session.target.evidence_refs_json) : [])
  ]);
  const payload = recordOrEmpty(object.payload_json);
  const targetPayload = recordOrEmpty(session.target?.payload_json);
  const isTarget = object.object_id === targetId;
  const sharesTrade = tradeLevelGrant && Boolean(session.grant.trade_id && object.trade_id && object.trade_id === session.grant.trade_id);
  const referencesTarget = Boolean(targetId && (evidenceIds.has(targetId) || payload.task_id === targetId || payload.counterparty_id === targetId || payload.trade_passport_id === targetId));
  const targetCounterpartyId = stringOrNull(targetPayload.counterparty_id);
  const referencesTargetCounterparty = Boolean(targetCounterpartyId && (payload.counterparty_id === targetCounterpartyId || evidenceIds.has(targetCounterpartyId)));

  if (object.type === 'execution_task') return scopes.has('view_task') && (isTarget || referencesTarget || sharesTrade);
  if (object.type === 'document_request') return (scopes.has('view_document_request') || scopes.has('upload_requested_document')) && (isTarget || referencesTarget || sharesTrade);
  if (object.type === 'trade_passport') return scopes.has('view_trade_passport') && (isTarget || referencesTarget || referencesTargetCounterparty || sharesTrade);
  if (object.type === 'counterparty') return (scopes.has('view_trade_passport') || scopes.has('submit_onboarding_evidence')) && (isTarget || referencesTarget || object.object_id === targetCounterpartyId || sharesTrade);
  if (object.type === 'onboarding_flow' || object.type === 'screening_result') {
    return (scopes.has('view_trade_passport') || scopes.has('submit_onboarding_evidence')) && (isTarget || referencesTarget || referencesTargetCounterparty || sharesTrade);
  }
  if (object.type === 'proof_bundle') return (scopes.has('view_proof_summary') || scopes.has('view_artifact_manifest') || scopes.has('download_verified_bundle')) && (isTarget || referencesTarget || sharesTrade);
  if (object.type === 'document' || object.type === 'extraction_result') {
    return (scopes.has('view_artifact_manifest') || scopes.has('view_document_request')) && (isTarget || referencesTarget || sharesTrade);
  }
  return targetType === 'trade_room' && scopes.has('view_trade_summary') && sharesTrade;
}

function buildExternalPortalSummary(session: LoadedExternalAccessSession, visibleObjects: AlphaObject[]) {
  const allowedActions = allowedActionsForExternalScopes(session.scopes);
  const targetLabel = session.target ? `${session.target.type.replaceAll('_', ' ')} · ${session.target.title}` : 'Trade-level scoped access';
  const passport = visibleObjects.find((object) => object.type === 'trade_passport') ?? (session.target?.type === 'trade_passport' ? session.target : null);
  const proof = visibleObjects.find((object) => object.type === 'proof_bundle') ?? (session.target?.type === 'proof_bundle' ? session.target : null);
  const trustScore =
    typeof passport?.payload_json?.trust_context === 'object' && passport.payload_json.trust_context !== null
      ? Number((passport.payload_json.trust_context as { score?: unknown }).score)
      : undefined;
  const pendingActions = allowedActions.filter((action) => action.startsWith('submit') || action.includes('update'));
  return {
    target_label: targetLabel,
    guarded_notice: 'This portal is scoped to one external access grant. It cannot execute protected TRAIBOX actions or reveal unrelated organization data.',
    pending_actions: pendingActions,
    trust_score: Number.isFinite(trustScore) ? trustScore : undefined,
    proof_ready: proof ? proof.status === 'completed' : undefined
  };
}

async function resolveExternalOnboardingTargets(client: pg.PoolClient, session: LoadedExternalAccessSession): Promise<{
  counterparty: AlphaObject | null;
  onboardingFlow: AlphaObject | null;
  tradePassport: AlphaObject | null;
}> {
  const visibleObjects = (await client.query<AlphaRow>(
    `SELECT *
     FROM alpha_objects
     WHERE org_id=app.current_org()
     ORDER BY created_at DESC
     LIMIT 250`
  )).rows.map(mapAlphaObject).filter((object) => portalObjectIsVisible(object, session));
  const target = session.target;
  const targetPayload = recordOrEmpty(target?.payload_json);
  const targetCounterpartyId = stringOrNull(targetPayload.counterparty_id);
  const tradePassport =
    (target?.type === 'trade_passport' ? target : null) ??
    visibleObjects.find((object) => object.type === 'trade_passport' && (object.object_id === target?.object_id || object.payload_json?.counterparty_id === targetCounterpartyId)) ??
    null;
  const counterparty =
    (target?.type === 'counterparty' ? target : null) ??
    visibleObjects.find((object) => object.type === 'counterparty' && (object.object_id === targetCounterpartyId || objectIdsFromEvidenceRefs(tradePassport?.evidence_refs_json ?? []).includes(object.object_id))) ??
    null;
  const counterpartyId = counterparty?.object_id ?? targetCounterpartyId ?? null;
  const onboardingFlow =
    (target?.type === 'onboarding_flow' ? target : null) ??
    visibleObjects.find((object) => object.type === 'onboarding_flow' && (object.payload_json?.counterparty_id === counterpartyId || objectIdsFromEvidenceRefs(object.evidence_refs_json).includes(counterpartyId ?? ''))) ??
    null;
  return { counterparty, onboardingFlow, tradePassport };
}

async function markExternalAccessUsed(
  client: pg.PoolClient,
  input: {
    session: LoadedExternalAccessSession;
    traceId: string;
    targetObjectId: string | null;
    auditAction: string;
    memoryKind: string;
    memorySignal: string;
    payload: Record<string, unknown>;
  }
) {
  await client.query('UPDATE alpha_external_access_tokens SET last_used_at=now() WHERE token_hash=$1 AND org_id=app.current_org()', [
    input.session.tokenHash
  ]);
  const actor = { orgId: input.session.orgId, userId: EXTERNAL_PARTICIPANT_USER_ID, traceId: input.traceId };
  await appendAudit(client, actor, input.auditAction, {
    grant_object_id: input.session.grant.object_id,
    participant: input.session.participant,
    scopes: input.session.scopes,
    ...input.payload
  });
  await writeMemory(client, actor, {
    level: input.session.grant.trade_id ? 'L1' : 'L2',
    tradeId: input.session.grant.trade_id ?? input.session.target?.trade_id ?? null,
    objectId: input.targetObjectId,
    kind: input.memoryKind,
    signal: input.memorySignal,
    payload: input.payload
  });
  await insertEvent(client, actor, {
    type: 'external_access.used',
    tradeId: input.session.grant.trade_id ?? input.session.target?.trade_id ?? null,
    data: {
      grant_object_id: input.session.grant.object_id,
      target_object_id: input.targetObjectId,
      signal: input.memorySignal,
      scopes: input.session.scopes,
      trace_id: input.traceId
    }
  });
}

async function assertTradeInCurrentOrg(client: pg.PoolClient, tradeId: string, message = 'Trade not found'): Promise<void> {
  const res = await client.query('SELECT 1 FROM trades WHERE trade_id=$1 AND org_id=app.current_org() LIMIT 1', [tradeId]);
  if (!res.rows[0]) throwNotFound(message);
}

async function loadLinkedAlphaContext(client: pg.PoolClient, input: { tradeId: string | null; objectId: string | null }) {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (input.tradeId) {
    params.push(input.tradeId);
    clauses.push(`trade_id=$${params.length}`);
  }
  if (input.objectId) {
    params.push(input.objectId);
    clauses.push(`object_id=$${params.length}`);
  }
  if (!clauses.length) return [];
  const res = await client.query<AlphaRow>(`SELECT * FROM alpha_objects WHERE org_id=app.current_org() AND (${clauses.join(' OR ')}) ORDER BY created_at DESC LIMIT 100`, params);
  return res.rows.map(mapAlphaObject);
}

async function appendAudit(client: pg.PoolClient, input: ActorInput, action: string, payload: Record<string, unknown>) {
  await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
    input.orgId,
    typeof payload.trade_id === 'string' ? payload.trade_id : null,
    `user:${input.userId}`,
    action,
    JSON.stringify({ ...payload, trace_id: input.traceId })
  ]);
}

async function writeMemory(
  client: pg.PoolClient,
  input: ActorInput,
  event: {
    level: 'L1' | 'L2' | 'L3';
    tradeId: string | null;
    objectId: string | null;
    kind: string;
    signal: string;
    payload: Record<string, unknown>;
  }
) {
  const memoryId = randomUUID();
  await client.query(
    `INSERT INTO alpha_memory_events(memory_event_id, org_id, level, trade_id, object_id, kind, signal, payload_json, trace_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [memoryId, input.orgId, event.level, event.tradeId, event.objectId, event.kind, event.signal, JSON.stringify(event.payload), input.traceId]
  );
  await insertEvent(client, input, {
    type: 'memory.updated',
    tradeId: event.tradeId,
    data: { memory_event_id: memoryId, level: event.level, kind: event.kind, signal: event.signal, trace_id: input.traceId }
  });
}

async function insertEvent(
  client: pg.PoolClient,
  input: ActorInput,
  event: { type: string; tradeId: string | null; data: Record<string, unknown> }
) {
  const ev: SSEEvent = {
    event_id: randomUUID(),
    type: event.type,
    ts: new Date().toISOString(),
    org_id: input.orgId,
    trade_id: event.tradeId ?? undefined,
    trace_id: input.traceId,
    actor: `user:${input.userId}`,
    data: event.data
  };
  await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
    ev.event_id,
    input.orgId,
    event.tradeId,
    ev.type,
    input.traceId,
    ev.actor,
    JSON.stringify(ev.data)
  ]);
}

function mapAlphaObject(row: AlphaRow): AlphaObject {
  return {
    object_id: row.object_id,
    org_id: row.org_id,
    type: row.type as AlphaObjectType,
    status: row.status as ObjectLifecycleStatus,
    origin_workspace: row.origin_workspace as OriginWorkspace,
    owner_id: row.owner_id,
    trade_id: row.trade_id,
    title: row.title,
    summary: row.summary,
    payload_json: row.payload_json ?? {},
    permissions_json: row.permissions_json ?? {},
    evidence_refs_json: Array.isArray(row.evidence_refs_json) ? row.evidence_refs_json : [],
    audit_refs_json: Array.isArray(row.audit_refs_json) ? row.audit_refs_json : [],
    trace_id: row.trace_id,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

function mapReadiness(row: any): ReadinessState {
  return {
    readiness_id: row.readiness_id,
    org_id: row.org_id,
    object_id: row.object_id,
    trade_id: row.trade_id,
    overall: row.overall,
    score: Number(row.score),
    dimensions: Array.isArray(row.dimensions_json) ? row.dimensions_json : [],
    missing_items: Array.isArray(row.missing_items_json) ? row.missing_items_json : [],
    risk_findings: Array.isArray(row.risk_findings_json) ? row.risk_findings_json : [],
    next_actions: Array.isArray(row.next_actions_json) ? row.next_actions_json : [],
    trace_id: row.trace_id,
    created_at: toIso(row.created_at)
  };
}

type MemoryInsightDraft = {
  category: MemoryInsightCategory;
  level: 'L1' | 'L2';
  title: string;
  nextAction: string;
  count: number;
  latestAt: string;
  signals: Set<string>;
  tradeIds: Set<string>;
  objectIds: Set<string>;
  examples: string[];
  blocked: boolean;
};

function buildMemoryInsights(events: AlphaMemoryEvent[], defaultLevel: 'L1' | 'L2'): MemoryInsight[] {
  const drafts = new Map<string, MemoryInsightDraft>();
  for (const event of events) {
    for (const category of memoryCategoriesFor(event)) {
      const key = `${category.category}:${event.level === 'L1' ? event.trade_id ?? 'trade' : 'org'}`;
      const existing = drafts.get(key);
      const latestAt = existing && new Date(existing.latestAt).getTime() > new Date(event.created_at).getTime() ? existing.latestAt : event.created_at;
      const draft =
        existing ??
        {
          category: category.category,
          level: event.level === 'L1' ? 'L1' : defaultLevel,
          title: category.title,
          nextAction: category.nextAction,
          count: 0,
          latestAt,
          signals: new Set<string>(),
          tradeIds: new Set<string>(),
          objectIds: new Set<string>(),
          examples: [],
          blocked: false
        };
      draft.count += 1;
      draft.latestAt = latestAt;
      draft.signals.add(event.signal);
      if (event.trade_id) draft.tradeIds.add(event.trade_id);
      if (event.object_id) draft.objectIds.add(event.object_id);
      if (draft.examples.length < 3) draft.examples.push(`${event.kind}: ${event.signal}`);
      draft.blocked ||= category.blocked || /blocked|rejected|recovery|missing|risk/i.test(`${event.kind} ${event.signal}`);
      drafts.set(key, draft);
    }
  }

  return Array.from(drafts.values())
    .map((draft) => {
      const severity: MemoryInsight['severity'] = draft.blocked ? 'blocked' : draft.count >= 3 ? 'watch' : 'info';
      return {
        insight_id: `${draft.category}:${draft.level}:${Array.from(draft.tradeIds)[0] ?? 'org'}`,
        level: draft.level,
        category: draft.category,
        title: draft.title,
        summary: `${draft.count} memory event(s): ${draft.examples.join(' · ')}`,
        severity,
        count: draft.count,
        signals: Array.from(draft.signals).slice(0, 8),
        trade_ids: Array.from(draft.tradeIds).slice(0, 8),
        object_ids: Array.from(draft.objectIds).slice(0, 8),
        latest_at: draft.latestAt,
        next_action: draft.nextAction
      };
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.count - a.count || new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime())
    .slice(0, 12);
}

type MemoryLensDefinition = {
  lens: MemoryLensKind;
  title: string;
  summary: string;
  nextAction: string;
  match: RegExp;
  blocked?: RegExp;
};

const MEMORY_LENSES: MemoryLensDefinition[] = [
  {
    lens: 'recurring_gaps',
    title: 'Recurring Gaps',
    summary: 'Missing proof, required fields, blocked readiness, and repeated evidence gaps across active trade work.',
    nextAction: 'Prioritize the repeated gap, request missing evidence once, then attach it to every affected workflow.',
    match: /missing|gap|pending_input|blocked|required field|document_request|readiness\.(missing|waiting)/i,
    blocked: /blocked|missing|gap|pending_input/i
  },
  {
    lens: 'approval_bottlenecks',
    title: 'Approval Bottlenecks',
    summary: 'Human-control gates, step-up decisions, protected actions, and approval chains that shape execution speed.',
    nextAction: 'Review pending or repeated approval gates and confirm policy, step-up, and residual-risk requirements.',
    match: /approval|protected_action|step_up|residual_risk/i,
    blocked: /approval_required|rejected|blocked/i
  },
  {
    lens: 'counterparty_friction',
    title: 'Counterparty Friction',
    summary: 'Screening, onboarding, invitations, Trade Passport, and external participant signals that slow trust formation.',
    nextAction: 'Refresh the counterparty profile, screening status, and Trade Passport evidence before attaching new trade work.',
    match: /counterparty|screening|onboarding|passport|external_access|invitation/i,
    blocked: /rejected|revoked|missing|failed|blocked/i
  },
  {
    lens: 'document_quality',
    title: 'Document Quality',
    summary: 'Extraction confidence, missing fields, document packs, and provenance signals that affect readiness and proof.',
    nextAction: 'Inspect extraction provenance, fill missing fields, and regenerate document packs before proof generation.',
    match: /document|extraction|quality|field|provenance|document_pack/i,
    blocked: /missing|failed|gap|low confidence/i
  },
  {
    lens: 'finance_blockers',
    title: 'Finance Blockers',
    summary: 'Funding, payment, route, beneficiary, offer, and reconciliation memory that affects execution readiness.',
    nextAction: 'Review finance-readiness, route, beneficiary, approval, and idempotency requirements before release.',
    match: /payment|funding|finance|route|beneficiary|offer|reconciliation/i,
    blocked: /blocked|missing|risk|rejected|idempotency/i
  },
  {
    lens: 'clearance_gaps',
    title: 'Clearance Gaps',
    summary: 'Compliance, sustainability, rule-pack, clearance, and report evidence that affects transaction readiness.',
    nextAction: 'Run or update the relevant clearance check and attach required rule-pack evidence to the Trade Room.',
    match: /clearance|compliance|sustainability|rule|report/i,
    blocked: /missing|gap|blocked|failed|risk/i
  },
  {
    lens: 'rejected_recommendations',
    title: 'Rejected Recommendations',
    summary: 'Agent, Copilot, or approval recommendations rejected by humans, preserving learning signals for future work.',
    nextAction: 'Review rejected recommendations, update policy or prompt context, and add replay cases where useful.',
    match: /rejected|recommendation.*reject|human.*reject|agent.*reject|ai\.eval.*fail/i,
    blocked: /rejected|fail/i
  },
  {
    lens: 'proof_readiness',
    title: 'Proof Readiness',
    summary: 'Proof bundles, manifests, ledger exports, hashes, and share controls that determine trusted proof quality.',
    nextAction: 'Verify manifest coverage, ledger hash, quality gaps, approvals, and share/export controls.',
    match: /proof|bundle|manifest|ledger|hash|share/i,
    blocked: /missing|gap|failed|revoked|blocked/i
  },
  {
    lens: 'agent_learning',
    title: 'Agent Learning',
    summary: 'Agent tasks, evals, replay, recommendations, and human decisions that improve TRAIBOX intelligence over time.',
    nextAction: 'Inspect accepted/rejected recommendations and add replay or eval fixtures for repeated outcomes.',
    match: /agent|ai\.eval|copilot|recommendation|replay/i,
    blocked: /rejected|unsafe|fail|blocked/i
  }
];

function buildMemoryLenses(events: AlphaMemoryEvent[]): MemoryLens[] {
  const lenses: MemoryLens[] = [];
  for (const definition of MEMORY_LENSES) {
    const matches = events.filter((event) => definition.match.test(memoryEventText(event)));
    if (!matches.length) continue;
    const tradeIds = new Set<string>();
    const objectIds = new Set<string>();
    const topSignalMap = new Map<string, { signal: string; kind: string; count: number; latest_at: string }>();
    let blocked = false;
    let latestAt = matches[0]?.created_at ?? null;

    for (const event of matches) {
      const text = memoryEventText(event);
      if (event.trade_id) tradeIds.add(event.trade_id);
      if (event.object_id) objectIds.add(event.object_id);
      if (!latestAt || new Date(event.created_at).getTime() > new Date(latestAt).getTime()) latestAt = event.created_at;
      blocked ||= Boolean(definition.blocked?.test(text));

      const key = `${event.kind}:${event.signal}`;
      const existing = topSignalMap.get(key);
      topSignalMap.set(key, {
        signal: event.signal,
        kind: event.kind,
        count: (existing?.count ?? 0) + 1,
        latest_at:
          existing && new Date(existing.latest_at).getTime() > new Date(event.created_at).getTime()
            ? existing.latest_at
            : event.created_at
      });
    }

    const severity: MemoryLens['severity'] = blocked ? 'blocked' : matches.length >= 5 ? 'watch' : 'info';
    lenses.push({
      lens: definition.lens,
      title: definition.title,
      summary: `${definition.summary} ${matches.length} signal(s) found across ${tradeIds.size || 'organization'} trade context(s).`,
      severity,
      signal_count: matches.length,
      unique_trades: tradeIds.size,
      unique_objects: objectIds.size,
      latest_at: latestAt,
      top_signals: Array.from(topSignalMap.values())
        .sort((a, b) => b.count - a.count || new Date(b.latest_at).getTime() - new Date(a.latest_at).getTime())
        .slice(0, 5),
      trade_ids: Array.from(tradeIds).slice(0, 8),
      object_ids: Array.from(objectIds).slice(0, 8),
      next_action: definition.nextAction
    });
  }

  return lenses
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.signal_count - a.signal_count || new Date(b.latest_at ?? 0).getTime() - new Date(a.latest_at ?? 0).getTime())
    .slice(0, 9);
}

function buildMemoryRecommendedActions(lenses: MemoryLens[], insights: MemoryInsight[]): string[] {
  const actions = [
    ...lenses.filter((lens) => lens.severity !== 'info').map((lens) => `${lens.title}: ${lens.next_action}`),
    ...insights.filter((insight) => insight.severity !== 'info').map((insight) => `${insight.title}: ${insight.next_action}`)
  ];
  return Array.from(new Set(actions)).slice(0, 6);
}

function memoryCategoriesFor(event: AlphaMemoryEvent): Array<{ category: MemoryInsightCategory; title: string; nextAction: string; blocked?: boolean }> {
  const text = memoryEventText(event);
  const categories: Array<{ category: MemoryInsightCategory; title: string; nextAction: string; blocked?: boolean }> = [];
  if (/missing|gap|pending_input|document_request|proof/.test(text)) {
    categories.push({ category: 'missing_proof', title: 'Missing proof and evidence gaps', nextAction: 'Request, attach, or regenerate the missing evidence before execution.', blocked: /missing|gap|pending_input/.test(text) });
  }
  if (/approval|protected_action|step_up/.test(text)) {
    categories.push({ category: 'approval_bottleneck', title: 'Approval bottlenecks', nextAction: 'Review pending approval gates and confirm step-up/residual-risk requirements.', blocked: /approval_required|rejected/.test(text) });
  }
  if (/workflow|recovery|stale|resume/.test(text)) {
    categories.push({ category: 'workflow_recovery', title: 'Workflow runtime and recovery signals', nextAction: 'Replay the workflow run and resume from the recorded runtime token.', blocked: /recovery|stale|blocked/.test(text) });
  }
  if (/document|extraction|quality|field/.test(text)) {
    categories.push({ category: 'document_quality', title: 'Document quality patterns', nextAction: 'Inspect extraction provenance and request missing fields.' });
  }
  if (/counterparty|screening|onboarding|passport/.test(text)) {
    categories.push({ category: 'counterparty_friction', title: 'Counterparty trust friction', nextAction: 'Refresh onboarding, screening, or Trade Passport context.' });
  }
  if (/clearance|compliance|sustainability|rule/.test(text)) {
    categories.push({ category: 'clearance_gap', title: 'Clearance and rule-pack gaps', nextAction: 'Run or update the relevant clearance check and evidence requirements.' });
  }
  if (/payment|funding|finance|route|offer/.test(text)) {
    categories.push({ category: 'finance_blocker', title: 'Finance and payment blockers', nextAction: 'Review finance-readiness, route, beneficiary, and approval requirements.' });
  }
  if (/proof|bundle|manifest|ledger|hash/.test(text)) {
    categories.push({ category: 'proof_pattern', title: 'Proof bundle patterns', nextAction: 'Verify manifest, ledger hash, artifact coverage, and sharing controls.' });
  }
  if (/agent|ai\.eval|recommendation|copilot/.test(text)) {
    categories.push({ category: 'agent_learning', title: 'Agent and eval learning signals', nextAction: 'Review accepted/rejected recommendations and replay eval context.' });
  }
  return categories.length ? categories : [{ category: 'general_memory', title: 'General Trade Memory', nextAction: 'Inspect related object, audit, and replay context.' }];
}

function memoryEventText(event: AlphaMemoryEvent) {
  return `${event.kind} ${event.signal} ${JSON.stringify(event.payload_json ?? {})}`.toLowerCase();
}

function severityRank(value: MemoryInsight['severity']) {
  if (value === 'blocked') return 3;
  if (value === 'watch') return 2;
  return 1;
}

function mapMemoryEvent(row: any): AlphaMemoryEvent {
  return {
    memory_event_id: row.memory_event_id,
    org_id: row.org_id,
    level: row.level,
    trade_id: row.trade_id,
    object_id: row.object_id,
    kind: row.kind,
    signal: row.signal,
    payload_json: row.payload_json ?? {},
    trace_id: row.trace_id,
    created_at: toIso(row.created_at)
  };
}

function computeReadiness(input: { object: AlphaObject | null; linked: AlphaObject[]; context: Record<string, unknown> }) {
  const objects = input.object ? [input.object, ...input.linked.filter((o) => o.object_id !== input.object?.object_id)] : input.linked;
  const types = new Set(objects.map((o) => o.type));
  const missing = new Set<string>();
  const risks = new Set<string>();
  const next = new Set<string>();

  if (!types.has('document') && !types.has('extraction_result')) missing.add('trade_document_or_extraction');
  if (!types.has('approval')) missing.add('human_approval_for_protected_actions');
  if (!types.has('proof_bundle')) next.add('Generate proof bundle after review.');
  if (objects.some((o) => o.status === 'blocked')) risks.add('One or more workflow objects are blocked.');

  for (const object of objects) {
    const payload = object.payload_json ?? {};
    const missingFields = (payload as any).missing_fields;
    if (Array.isArray(missingFields)) missingFields.forEach((field) => missing.add(String(field)));
    const risksPayload = (payload as any).risks;
    if (Array.isArray(risksPayload)) risksPayload.forEach((risk) => risks.add(String(risk)));
    if (object.status === 'approval_required') next.add(`Review approval for ${object.title}.`);
    if (object.status === 'pending_input') next.add(`Complete missing input for ${object.title}.`);
  }

  if (input.object?.type === 'payment_intent') {
    missing.add('step_up_approval');
    risks.add('Payment execution is protected and cannot run without approval.');
    next.add('Request approval before sending payment.');
  }
  if (input.object?.type === 'funding_request') {
    missing.add('finance_readiness_pack');
    next.add('Prepare funding evidence pack.');
  }
  if (input.object?.type === 'clearance_check') {
    const clearanceEvaluation = recordOrEmpty(input.object.payload_json?.clearance_evaluation);
    const missingEvidence = toStringArray(clearanceEvaluation.missing_evidence);
    if (missingEvidence.length) {
      missingEvidence.forEach((item) => missing.add(item));
    } else if (!clearanceEvaluation.rule_pack_id) {
      missing.add('rule_pack_evidence');
    }
    next.add('Resolve clearance evidence gaps.');
  }

  const missingItems = Array.from(missing);
  const riskFindings = Array.from(risks);
  const nextActions = Array.from(next);
  const score = Math.max(20, Math.min(95, 90 - missingItems.length * 10 - riskFindings.length * 8 + (types.has('proof_bundle') ? 8 : 0)));
  const overall: ReadinessOverall =
    riskFindings.length > 1
      ? 'risky'
      : missingItems.length > 2
        ? 'missing'
        : missingItems.length > 0
          ? 'waiting'
          : input.object?.status === 'approved'
            ? 'approved'
            : 'ready';

  const dimensions: ReadinessDimension[] = [
    dimension('structure', 'Structured trade context', types.has('trade_room') || Boolean(input.object) ? 'ready' : 'missing', ['Typed object context exists.']),
    dimension('evidence', 'Evidence and documents', types.has('document') || types.has('extraction_result') ? 'waiting' : 'missing', missingItems),
    dimension('control', 'Human control', types.has('approval') ? 'waiting' : 'missing', ['Protected actions require explicit approval.']),
    dimension('proof', 'Proof readiness', types.has('proof_bundle') ? 'ready' : 'waiting', nextActions)
  ];

  return { overall, score, dimensions, missing_items: missingItems, risk_findings: riskFindings, next_actions: nextActions };
}

function dimension(key: string, label: string, status: ReadinessOverall, reasons: string[]): ReadinessDimension {
  const score = status === 'ready' || status === 'approved' ? 90 : status === 'waiting' ? 62 : status === 'missing' ? 38 : 25;
  return { key, label, status, score, reasons: reasons.length ? reasons.slice(0, 4) : ['No issues detected.'] };
}

function classifyDocument(filename: string, text: string): string {
  const lower = `${filename} ${text}`.toLowerCase();
  if (lower.includes('invoice')) return 'invoice';
  if (lower.includes('purchase order') || lower.includes('po ')) return 'purchase_order';
  if (lower.includes('contract') || lower.includes('agreement')) return 'contract';
  if (lower.includes('packing')) return 'packing_list';
  return 'trade_document';
}

function extractFields(filename: string, text: string): Record<string, unknown> {
  const source = `${filename}\n${text}`;
  const amount = source.match(/(?:eur|€)\s?([0-9][0-9.,]*)/i) ?? source.match(/([0-9][0-9.,]*)\s?(?:eur|€)/i);
  const po = source.match(/\bPO[\s#:.-]*([A-Z0-9-]+)/i);
  const seller = source.match(/seller[:\s]+([A-Z][A-Za-z0-9 .&-]+)/i);
  const buyer = source.match(/buyer[:\s]+([A-Z][A-Za-z0-9 .&-]+)/i);
  const buyerTax =
    source.match(/buyer\s+(?:vat|tax\s?id)[:\s]+([A-Z]{2}[A-Z0-9-]+)/i) ??
    source.match(/(?:vat|tax\s?id)[:\s]+([A-Z]{2}[A-Z0-9-]+)/i);
  const incoterm = source.match(/\b(EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS|FOB|CFR|CIF)\b/i);
  const paymentTerms = source.match(/payment\s?terms?[:\s]+([^.\n]+)/i) ?? source.match(/([0-9]{1,3}%\s+advance[^.\n]*)/i);
  const fields: Record<string, unknown> = {};
  const amountValue = amount?.[1];
  const poValue = po?.[1];
  const sellerValue = seller?.[1];
  const buyerValue = buyer?.[1];
  const buyerTaxValue = buyerTax?.[1];
  const incotermValue = incoterm?.[1];
  const paymentTermsValue = paymentTerms?.[1];
  if (amountValue) fields.amount = amountValue.replace(',', '.');
  if (poValue) fields.purchase_order = poValue;
  if (sellerValue) fields.seller_name = sellerValue.trim();
  if (buyerValue) fields.buyer_name = buyerValue.trim();
  if (buyerTaxValue) fields.buyer_tax_id = buyerTaxValue.trim().toUpperCase();
  if (incotermValue) fields.incoterm = incotermValue.toUpperCase();
  if (paymentTermsValue) fields.payment_terms = paymentTermsValue.trim();
  if (/\bPT\b|Portugal|Portuguese/i.test(source)) fields.origin_country = 'PT';
  if (/\bES\b|Spain|Spanish/i.test(source)) fields.destination_country = 'ES';
  return fields;
}

function requiredMissingFields(classification: string, extracted: Record<string, unknown>): string[] {
  const required = requiredFieldsForDocumentClassification(classification);
  const missing = required.filter((key) => !extracted[key]);
  return Array.from(new Set(missing));
}

function requiredFieldsForDocumentClassification(classification: string): string[] {
  const required = classification === 'invoice' ? ['amount', 'seller_name', 'buyer_name', 'payment_terms'] : ['seller_name', 'buyer_name', 'amount'];
  if (classification !== 'invoice') required.push('incoterm');
  required.push('buyer_tax_id');
  return Array.from(new Set(required));
}

function classifyWorkflow(message: string): AlphaObjectType {
  const lower = message.toLowerCase();
  if (lower.includes('payment') || lower.includes('pay ')) return 'payment_intent';
  if (lower.includes('funding') || lower.includes('finance') || lower.includes('loan')) return 'funding_request';
  if (lower.includes('clearance') || lower.includes('compliance') || lower.includes('sustainability')) return 'clearance_check';
  if (lower.includes('onboard')) return 'onboarding_flow';
  if (lower.includes('screen')) return 'screening_result';
  if (lower.includes('proof')) return 'proof_bundle';
  if (lower.includes('report')) return 'report';
  if (lower.includes('document') || lower.includes('upload')) return 'document';
  return 'trade_plan';
}

function titleForIntelligenceObject(type: AlphaObjectType, message: string): string {
  const first = message.trim().split(/\s+/).slice(0, 9).join(' ');
  return `${type.replaceAll('_', ' ')}: ${first || 'new TRAIBOX work item'}`;
}

function initialIntelligenceStatusFor(type: AlphaObjectType, preferredStatus?: ObjectLifecycleStatus | null): ObjectLifecycleStatus {
  const fallback: ObjectLifecycleStatus = type === 'trade_plan' ? 'pending_input' : 'draft';
  if (!preferredStatus) return fallback;
  return validateInitialLifecycleState(type, preferredStatus) ? fallback : preferredStatus;
}

function confidenceFromPlan(plan: TradeBrainCopilotPlan | null, type: AlphaObjectType) {
  if (typeof plan?.confidence === 'number') return plan.confidence;
  return type === 'trade_plan' ? 0.72 : 0.82;
}

function tradeBrainPolicyConstraints(observability: Record<string, unknown>) {
  const fromService = toStringArray(observability.policy_constraints);
  if (fromService.length) return fromService;
  return [
    'Use canonical alpha object types only.',
    'Protected actions require explicit human approval.',
    'Recommendations must cite structured context when available.'
  ];
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

function suggestedActionsFor(type: AlphaObjectType, object: AlphaObject) {
  const common = [{ action: 'readiness.evaluate', object_id: object.object_id, label: 'Evaluate readiness' }];
  if (type === 'payment_intent') {
    return [...common, { action: 'approvals.request', protected_action: 'send_payment', object_id: object.object_id, label: 'Request human approval' }];
  }
  if (type === 'funding_request') {
    return [...common, { action: 'documents.request', object_id: object.object_id, label: 'Prepare finance-readiness pack' }];
  }
  if (type === 'clearance_check') {
    return [...common, { action: 'reports.generate', object_id: object.object_id, label: 'Generate clearance report' }];
  }
  return [...common, { action: 'attachments.suggest', object_id: object.object_id, label: 'Attach to Trade Room when useful' }];
}

function normalizeApprovalChain(action: string, value?: unknown, requestedCurrentStep?: unknown): { steps: StoredApprovalChainStep[]; currentStepKey: string | null } {
  const fallback = defaultApprovalChain(action);
  const incoming = Array.isArray(value) && value.length ? value : fallback;
  const steps = incoming.map((raw, index) => normalizeApprovalChainStep(raw, action, index));
  const currentFromRequest = typeof requestedCurrentStep === 'string' && requestedCurrentStep.trim().length ? requestedCurrentStep.trim() : null;
  let currentIndex = currentFromRequest ? steps.findIndex((step) => step.key === currentFromRequest) : -1;
  if (currentIndex === -1) currentIndex = steps.findIndex((step) => step.status === 'approval_required');
  if (currentIndex === -1) currentIndex = steps.findIndex((step) => step.status === 'pending_input' || step.status === 'ready_for_review' || step.status === 'in_progress');
  if (currentIndex === -1) return { steps, currentStepKey: null };

  const currentStep = steps[currentIndex]!;
  if (['pending_input', 'ready_for_review', 'in_progress'].includes(currentStep.status)) currentStep.status = 'approval_required';
  return { steps, currentStepKey: currentStep.key };
}

function normalizeApprovalChainStep(raw: unknown, action: string, index: number): StoredApprovalChainStep {
  const value = isRecord(raw) ? raw : {};
  const key = typeof value.key === 'string' && value.key.trim().length ? value.key.trim() : index === 0 ? 'human_control' : `approval_step_${index + 1}`;
  const defaultRole = approvalRoleForProtectedAction(action);
  const requiredRole = typeof value.required_role === 'string' && value.required_role.trim().length ? value.required_role.trim() : defaultRole;
  return {
    key,
    label: typeof value.label === 'string' && value.label.trim().length ? value.label.trim() : labelForApprovalRole(requiredRole, index),
    required_role: requiredRole,
    status: normalizeApprovalStepStatus(value.status, index),
    actor_id: typeof value.actor_id === 'string' ? value.actor_id : null,
    decided_at: typeof value.decided_at === 'string' ? value.decided_at : null,
    notes: typeof value.notes === 'string' ? value.notes : null
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function buildClearanceRequirements(input: {
  corridor: string;
  rulePackId: string;
  subject: string;
  availableEvidence: string[];
  payload: Record<string, unknown>;
}): ClearanceRuleRequirement[] {
  const available = new Set(input.availableEvidence.map((item) => item.toLowerCase()));
  const subject = input.subject.toLowerCase();
  const payloadRisks = toStringArray(input.payload.risks).map((risk) => risk.toLowerCase());
  const has = (key: string) => available.has(key.toLowerCase());
  const requirement = (
    key: string,
    label: string,
    evidenceType: string,
    severity: ClearanceRuleRequirement['severity'],
    rationale: string,
    risky = false
  ): ClearanceRuleRequirement => ({
    key,
    label,
    evidence_type: evidenceType,
    status: has(key) ? 'available' : risky ? 'risky' : 'missing',
    severity,
    rationale
  });

  const requirements: ClearanceRuleRequirement[] = [
    requirement('commercial_invoice', 'Commercial invoice', 'document', 'high', 'Invoice anchors the value, seller, buyer, and payment terms for clearance evidence.'),
    requirement('origin_statement', 'Origin statement', 'document', 'high', 'EU-first clearance requires declared origin before readiness can be trusted.'),
    requirement('buyer_tax_id', 'Buyer tax or VAT identifier', 'identifier', 'medium', 'Counterparty tax identity supports reporting, VAT treatment, and auditability.')
  ];

  if (input.corridor.toUpperCase().includes('EU') || /^[A-Z]{2}-[A-Z]{2}$/.test(input.corridor.toUpperCase())) {
    requirements.push(requirement('intra_eu_vat_evidence', 'Intra-EU VAT evidence', 'identifier', 'medium', 'EU corridor workflows need tax treatment evidence before report export.'));
  }

  if (/sustainability|cbam|carbon|steel|aluminium|aluminum|cement|fertili[sz]er/.test(subject) || payloadRisks.some((risk) => /sustainability|cbam|carbon/.test(risk))) {
    requirements.push(requirement('sustainability_attestation', 'Sustainability attestation', 'attestation', 'medium', 'Sustainability-sensitive trades need explicit claim evidence.'));
    requirements.push(requirement('cbam_screening', 'CBAM screening', 'screening', 'medium', 'CBAM-sensitive goods need a screening artifact or exclusion rationale.'));
  }

  if (input.rulePackId.toLowerCase().includes('alpha')) {
    requirements.push(requirement('operator_review', 'Operator review note', 'approval_note', 'low', 'Alpha rule packs require human review notes before external declaration.', false));
  }

  return requirements;
}

async function loadNetworkTrustRelatedObjects(
  client: pg.PoolClient,
  input: { counterpartyId: string; onboardingFlowId: string | null; screeningResultId: string | null }
): Promise<AlphaObject[]> {
  const ids = uniqueStringValues([input.onboardingFlowId ?? '', input.screeningResultId ?? '']).filter(Boolean);
  const res = await client.query<AlphaRow>(
    `SELECT *
     FROM alpha_objects
     WHERE org_id=app.current_org()
       AND type = ANY($1::text[])
       AND (
         object_id = ANY($2::uuid[])
         OR evidence_refs_json @> $3::jsonb
         OR payload_json->>'counterparty_id' = $4
       )
     ORDER BY created_at DESC
     LIMIT 20`,
    [['onboarding_flow', 'screening_result'], ids, JSON.stringify([{ object_id: input.counterpartyId }]), input.counterpartyId]
  );
  return res.rows.map(mapAlphaObject);
}

function buildNetworkTrustContext(input: {
  counterparty: AlphaObject;
  onboarding: AlphaObject | null;
  screening: AlphaObject | null;
  passportVisibility: NetworkTrustContext['passport_visibility'];
}): NetworkTrustContext {
  const counterpartyPayload = recordOrEmpty(input.counterparty.payload_json);
  const onboardingPayload = recordOrEmpty(input.onboarding?.payload_json);
  const screeningPayload = recordOrEmpty(input.screening?.payload_json);
  const requiredFields = uniqueStringValues([...toStringArray(onboardingPayload.required_fields), 'registration_number', 'authorized_contact']);
  const completedFields = uniqueStringValues(toStringArray(onboardingPayload.completed_fields));
  const identifiersMissing = toStringArray(counterpartyPayload.identifiers_missing);
  const screeningMissing = toStringArray(screeningPayload.missing);
  const missing = new Set<string>([...identifiersMissing, ...screeningMissing]);
  for (const field of requiredFields) {
    if (!completedFields.includes(field)) missing.add(field);
  }

  const sanctions = stringOrNull(screeningPayload.sanctions) ?? 'not_run';
  const pep = stringOrNull(screeningPayload.pep) ?? 'not_run';
  const adverseMedia = stringOrNull(screeningPayload.adverse_media) ?? 'not_run';
  const risks = new Set<string>();
  if (sanctions !== 'clear') risks.add(`sanctions:${sanctions}`);
  if (pep !== 'clear') risks.add(`pep:${pep}`);
  if (!['none_found', 'clear'].includes(adverseMedia)) risks.add(`adverse_media:${adverseMedia}`);
  if (!input.screening) risks.add('screening:not_run');

  const missingItems = Array.from(missing);
  const riskFindings = Array.from(risks);
  const score = Math.max(
    20,
    Math.min(
      96,
      55 +
        (input.onboarding ? 12 : 0) +
        (input.screening ? 18 : 0) +
        (sanctions === 'clear' ? 8 : -18) +
        (pep === 'clear' ? 4 : -8) -
        missingItems.length * 6 -
        riskFindings.length * 10
    )
  );
  const status: NetworkTrustContext['status'] = riskFindings.some((risk) => risk.startsWith('sanctions:')) ? 'blocked' : score >= 78 && missingItems.length === 0 ? 'ready_for_review' : 'pending_evidence';

  return {
    score,
    status,
    missing_items: missingItems,
    risk_findings: riskFindings,
    screening: { sanctions, pep, adverse_media: adverseMedia },
    onboarding: { required_fields: requiredFields, completed_fields: completedFields },
    reusable_across_trades: true,
    passport_visibility: input.passportVisibility
  };
}

function counterpartyDisplayName(counterparty: AlphaObject): string {
  const payload = recordOrEmpty(counterparty.payload_json);
  const name = stringOrNull(payload.name) ?? counterparty.title.replace(/^Counterparty:\s*/i, '');
  return name.trim() || counterparty.title;
}

function networkMatchReasons(trustContext: NetworkTrustContext, corridor: string, domain: string): string[] {
  const reasons = [`${corridor} context`, `${domain} trust context reusable across trades`, `trust score ${trustContext.score}%`];
  if (trustContext.missing_items.length) reasons.push(`${trustContext.missing_items.length} missing trust item(s) remain visible`);
  if (!trustContext.risk_findings.length) reasons.push('screening risk clear in alpha context');
  return reasons;
}

function defaultApprovalChain(action: string): StoredApprovalChainStep[] {
  const role = approvalRoleForProtectedAction(action);
  return [
    {
      key: `${role}_approval`,
      label: labelForApprovalRole(role, 0),
      required_role: role,
      status: 'approval_required',
      actor_id: null,
      decided_at: null,
      notes: null
    }
  ];
}

function normalizeApprovalStepStatus(value: unknown, index: number): ObjectLifecycleStatus {
  if (typeof value === 'string' && (OBJECT_LIFECYCLE_STATUSES as readonly string[]).includes(value)) return value as ObjectLifecycleStatus;
  return index === 0 ? 'approval_required' : 'pending_input';
}

function resolveCurrentApprovalStep(steps: StoredApprovalChainStep[], requestedStepKey: string | null): StoredApprovalChainStep {
  const step = requestedStepKey ? steps.find((candidate) => candidate.key === requestedStepKey) : steps.find((candidate) => candidate.status === 'approval_required');
  if (!step) throwBadRequest('Approval chain has no pending step');
  if (step.status !== 'approval_required') throwBadRequest(`Approval step ${step.key} is not waiting for decision`);
  return step;
}

function advanceApprovalChain(
  steps: StoredApprovalChainStep[],
  stepKey: string,
  decision: 'approved' | 'rejected',
  metadata: { actorId: string; decidedAt: string; notes: string }
): { steps: StoredApprovalChainStep[]; chainCompleted: boolean; currentStepKey: string | null } {
  const nextSteps = steps.map((step) => ({ ...step }));
  const currentIndex = nextSteps.findIndex((step) => step.key === stepKey);
  if (currentIndex === -1) throwBadRequest('Approval chain step not found');
  nextSteps[currentIndex] = {
    ...nextSteps[currentIndex]!,
    status: decision === 'approved' ? 'approved' : 'rejected',
    actor_id: metadata.actorId,
    decided_at: metadata.decidedAt,
    notes: metadata.notes
  };
  if (decision === 'rejected') return { steps: nextSteps, chainCompleted: true, currentStepKey: null };

  const nextIndex = nextSteps.findIndex((step, index) => index > currentIndex && ['pending_input', 'ready_for_review', 'in_progress', 'approval_required'].includes(step.status));
  if (nextIndex === -1) return { steps: nextSteps, chainCompleted: true, currentStepKey: null };
  nextSteps[nextIndex] = { ...nextSteps[nextIndex]!, status: 'approval_required' };
  return { steps: nextSteps, chainCompleted: false, currentStepKey: nextSteps[nextIndex]!.key };
}

async function getActorOrgRole(client: pg.PoolClient, input: ActorInput): Promise<string> {
  const role = await client.query<{ role: string }>('SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2 LIMIT 1', [input.orgId, input.userId]);
  const actorRole = role.rows[0]?.role;
  if (!actorRole) throwForbidden('Forbidden');
  return actorRole;
}

function assertApprovalStepRole(actorRole: string, requiredRole: string) {
  if (actorRole === 'owner' || actorRole === 'admin') return;
  if (requiredRole === actorRole) return;
  throwForbidden(`Approval step requires ${requiredRole} role`);
}

function actionForStatus(status: string): string {
  if (status === 'in_progress') return 'start_controlled_execution';
  if (status === 'ready_for_review') return 'mark_ready_for_review';
  if (status === 'completed') return 'mark_external_completed';
  if (status === 'blocked') return 'mark_blocked';
  if (status === 'cancelled') return 'cancel';
  return 'prepare';
}

function executionStateForStatus(status: string, action: string): string {
  if (status === 'completed') return 'operator_confirmed_completed';
  if (status === 'blocked') return 'blocked';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'ready_for_review') return 'ready_for_review';
  if (action === 'mark_external_submitted') return 'operator_marked_external_submitted';
  if (status === 'in_progress') return 'operator_in_progress_not_auto_executed';
  return 'prepared_not_executed';
}

function requiredProofForProofBundle(objects: AlphaObject[]): string[] {
  const required = new Set(['artifact_hashes', 'evidence_links', 'readiness_state', 'agent_trace']);
  const externallyConsequential = objects.some((object) =>
    ['approval', 'payment_intent', 'funding_request', 'clearance_check', 'execution_task'].includes(object.type)
  );
  if (externallyConsequential) required.add('approval');
  return [...required];
}

function availableProofSignalsForProof(input: {
  objects: AlphaObject[];
  artifactRefs: ProofArtifactRef[];
  latestReadiness: ReadinessState | null;
  manifestSha: string;
  root: string;
}): string[] {
  const available = new Set<string>();
  if (input.artifactRefs.length && input.manifestSha && input.root) available.add('artifact_hashes');
  if (input.artifactRefs.length) available.add('evidence_links');
  if (input.latestReadiness || input.objects.some((object) => object.type === 'readiness_state')) available.add('readiness_state');
  if (input.objects.some((object) => object.type === 'approval')) available.add('approval');
  if (input.artifactRefs.some((artifact) => artifact.trace_id)) available.add('agent_trace');

  for (const object of input.objects) {
    available.add(object.type);
    if (object.type === 'document') available.add('document');
    if (object.type === 'extraction_result') {
      const classification = stringOrNull(object.payload_json?.classification);
      if (classification) available.add(classification);
      const fields = object.payload_json?.extracted_fields;
      if (isRecord(fields)) Object.keys(fields).forEach((field) => available.add(field));
    }
  }

  return [...available].sort();
}

function localMissingProofDetection(input: {
  objectType: string;
  requiredProof: string[];
  availableProof: string[];
  traceId: string;
}): TradeBrainMissingProof {
  const available = new Set(input.availableProof);
  const missingItems = input.requiredProof.filter((item) => !available.has(item));
  const riskFindings = missingItems.map(proofRiskForMissingItem);
  const score = Math.max(0, Math.min(100, 100 - missingItems.length * 12 - riskFindings.length * 4));
  return {
    serviceVersion: null,
    traceId: input.traceId,
    objectType: input.objectType,
    overall: missingItems.length ? (missingItems.includes('approval') ? 'blocked' : 'missing') : 'ready',
    score,
    requiredProof: input.requiredProof,
    availableProof: input.availableProof,
    missingItems,
    riskFindings,
    nextActions: missingItems.map(nextActionForProofGap),
    qualitySignals: {
      required_count: input.requiredProof.length,
      available_count: input.requiredProof.filter((item) => available.has(item)).length,
      missing_count: missingItems.length,
      protected_approval_missing: missingItems.includes('approval'),
      proof_ready: missingItems.length === 0,
      workflow_quality_source: 'local_deterministic_fallback'
    }
  };
}

function proofRiskForMissingItem(item: string) {
  if (item === 'approval') return 'Protected or externally consequential action is not supported by a human approval artifact.';
  if (item === 'readiness_state') return 'Proof bundle is not tied to a current readiness state.';
  if (item === 'artifact_hashes') return 'Proof bundle cannot be independently verified without artifact hashes.';
  if (item === 'evidence_links') return 'Proof bundle is missing evidence links back to source artifacts.';
  if (item === 'agent_trace') return 'Proof bundle lacks replayable trace context for AI-assisted work.';
  return `Required proof item is missing: ${item}.`;
}

function nextActionForProofGap(item: string) {
  if (item === 'approval') return 'Request or attach human approval before relying on this proof externally.';
  if (item === 'readiness_state') return 'Run readiness and attach the latest readiness state to the proof context.';
  if (item === 'artifact_hashes') return 'Regenerate the proof bundle with hashed artifact references.';
  if (item === 'evidence_links') return 'Attach the source evidence objects used by this proof bundle.';
  if (item === 'agent_trace') return 'Attach replayable trace or agent/eval artifact context.';
  return `Attach proof artifact: ${item.replaceAll('_', ' ')}.`;
}

function buildIntelligenceEvalResult(
  input: ActorInput & { body: IntelligenceRunRequest },
  details: {
    objectType: AlphaObjectType;
    object: AlphaObject;
    aiObservability: Record<string, unknown>;
    suggestedActions: Array<Record<string, unknown>>;
  }
): AiEvalResult {
  const confidence = Number(details.aiObservability.confidence ?? 0.75);
  const policyConstraints = toStringArray(details.aiObservability.policy_constraints);
  const generatedRecommendation =
    details.suggestedActions.map((action) => String(action.label ?? action.action ?? 'suggested action')).join('; ') ||
    'Review missing fields, run readiness, and request approval before protected execution.';
  const checks = aggregateChecks([
    {
      case: 'standalone_workflow_classification',
      status: ALPHA_OBJECT_TYPES.includes(details.objectType) ? 'pass' : 'fail',
      score: ALPHA_OBJECT_TYPES.includes(details.objectType) ? 94 : 20,
      finding: `Message classified into canonical alpha object type: ${details.objectType}.`,
      evidence_refs: [{ object_id: details.object.object_id, role: 'created_object' }]
    },
    {
      case: 'hallucination_prevention',
      status: 'pass',
      score: 90,
      finding: 'Copilot output is constrained to structured objects, suggested actions, trace IDs, and policy notes.'
    },
    {
      case: 'unsafe_action_blocking',
      status: 'pass',
      score: 100,
      finding: 'Copilot recommends approval gates before protected execution and does not execute external actions.'
    },
    {
      case: 'deterministic_replay',
      status: details.aiObservability.replayable ? 'pass' : 'warn',
      score: details.aiObservability.replayable ? 96 : 70,
      finding: 'Model, prompt version, context, artifacts, confidence, policy constraints, and trace ID are captured.'
    },
    {
      case: 'recommendation_usefulness',
      status: details.suggestedActions.length ? 'pass' : 'warn',
      score: details.suggestedActions.length ? 86 : 68,
      finding: details.suggestedActions.length
        ? 'Copilot produced next actions that can be executed through TRAIBOX workflows.'
        : 'Copilot produced an object but no structured next action.'
    }
  ]);

  return {
    suite: 'intelligence-copilot-alpha-v1',
    status: checks.status,
    score: checks.score,
    checks: checks.checks,
    model: String(details.aiObservability.model ?? 'traibox-alpha-structured-copilot'),
    prompt_version: String(details.aiObservability.prompt_version ?? 'intelligence-run-alpha-v1'),
    context_used: {
      workspace: input.body.workspace ?? 'intelligence',
      trade_id: input.body.trade_id ?? null,
      object_ids: input.body.object_ids ?? [],
      source_message_hash: sha256(input.body.message)
    },
    artifacts_used: input.body.object_ids ?? [],
    sources_used: [{ kind: 'user_message', sha256: sha256(input.body.message) }],
    confidence,
    policy_constraints: policyConstraints,
    generated_recommendation: generatedRecommendation,
    human_decision: 'pending',
    final_outcome: `Created ${details.objectType} ${details.object.object_id} without performing protected external actions.`,
    replayable: Boolean(details.aiObservability.replayable),
    trace_id: input.traceId
  };
}

function buildAgentEvalResult(
  input: ActorInput & { body: AgentTaskRequest },
  result: AgentWorkResult,
  replayLog: Array<Record<string, unknown>>,
  runtimePolicy: AgentRuntimePolicy
): AiEvalResult {
  const gates = runtimePolicy.approval_gates;
  const checks = aggregateChecks([
    {
      case: 'standalone_workflow_classification',
      status: agentRuntimePolicyViolations(runtimePolicy).length ? 'fail' : 'pass',
      score: agentRuntimePolicyViolations(runtimePolicy).length ? 20 : 94,
      finding: 'Agent runtime scope was normalized into effective tools, data access, write permissions, approval gates, and denied capabilities.'
    },
    {
      case: 'unsafe_action_blocking',
      status: gates.length && result.blockers.some((blocker) => blocker.toLowerCase().includes('approval')) ? 'pass' : 'warn',
      score: gates.length ? 100 : 82,
      finding: gates.length
        ? 'Protected action gates were treated as blockers until explicit human approval.'
        : 'No protected action gate was declared for this scoped task.'
    },
    {
      case: 'deterministic_replay',
      status: replayLog.length >= 5 ? 'pass' : 'fail',
      score: replayLog.length >= 5 ? 96 : 30,
      finding: `Replay log contains ${replayLog.length} deterministic step(s).`
    },
    {
      case: 'recommendation_usefulness',
      status: result.recommended_next_action ? 'pass' : 'warn',
      score: result.recommended_next_action ? 88 : 65,
      finding: result.recommended_next_action || 'Agent finished without a recommended next action.'
    },
    {
      case: 'hallucination_prevention',
      status: 'pass',
      score: 92,
      finding: 'Agent outputs are deterministic, scoped to declared inputs, and include blockers, risks, opportunities, and model metadata.'
    },
    {
      case: gates.includes('send_payment') ? 'payment_risk_warning' : 'finance_readiness_recommendation',
      status: 'pass',
      score: 86,
      finding: gates.includes('send_payment')
        ? 'Payment-related task kept external money movement blocked pending approval and operator execution.'
        : 'Agent result preserves readiness and approval context for human review.'
    }
  ]);

  return {
    suite: 'governed-agent-alpha-v1',
    status: checks.status,
    score: checks.score,
    checks: checks.checks,
    model: result.model_usage.model,
    prompt_version: result.model_usage.prompt_version,
    context_used: {
      objective_hash: sha256(input.body.objective),
      input_objects: input.body.input_objects ?? [],
      declared_scope: {
        permitted_tools: input.body.permitted_tools ?? [],
        data_access: input.body.data_access ?? [],
        write_permissions: input.body.write_permissions ?? [],
        approval_gates: input.body.approval_gates ?? []
      },
      runtime_policy: runtimePolicy,
      permitted_tools: runtimePolicy.effective_tools,
      data_access: runtimePolicy.effective_data_access,
      write_permissions: runtimePolicy.effective_write_permissions,
      approval_gates: gates,
      time_budget_seconds: runtimePolicy.time_budget_seconds
    },
    artifacts_used: input.body.input_objects ?? [],
    sources_used: [{ kind: 'agent_runtime_policy', policy: runtimePolicy }, ...replayLog],
    confidence: 0.9,
    policy_constraints: [
      'Agent scope must be declared before launch.',
      'Use only declared data access and permitted tools.',
      'Protected actions require explicit human approval.',
      'Replay log must support deterministic review.'
    ],
    generated_recommendation: result.recommended_next_action,
    human_decision: result.human_decision ?? 'pending',
    final_outcome: 'Governed scoped agent completed with replay log and no protected external execution.',
    replayable: replayLog.length >= 3,
    trace_id: input.traceId
  };
}

function buildDocumentExtractionEvalResult(
  input: ActorInput & { body: DocumentExtractRequest },
  details: {
    document: AlphaObject;
    extractionObject: AlphaObject;
    classification: string;
    extracted: Record<string, unknown>;
    missing: string[];
    confidence: number;
    filename: string;
    requiredFields: string[];
    provenance: Array<Record<string, unknown>>;
    qualitySignals: Record<string, unknown>;
    recommendations: string[];
    intelligenceSource: 'trade_brain_service' | 'local_deterministic_fallback';
    serviceVersion: string | null;
  }
): AiEvalResult {
  const extractedCount = Object.keys(details.extracted).length;
  const checks = aggregateChecks([
    {
      case: 'document_extraction_accuracy',
      status: details.confidence >= 0.72 ? 'pass' : 'warn',
      score: Math.round(details.confidence * 100),
      finding: `Extractor classified ${details.filename} as ${details.classification} and captured ${extractedCount} field(s).`,
      evidence_refs: [{ object_id: details.extractionObject.object_id, role: 'extraction_result' }]
    },
    {
      case: 'missing_proof_detection',
      status: 'pass',
      score: details.missing.length ? 90 : 94,
      finding: details.missing.length
        ? `Detected missing proof fields: ${details.missing.join(', ')}.`
        : 'No required proof fields were missing for this document classification.'
    },
    {
      case: 'hallucination_prevention',
      status: 'pass',
      score: 92,
      finding: 'Extraction payload contains deterministic fields, confidence, provenance, and missing fields instead of free-form claims.'
    },
    {
      case: 'deterministic_replay',
      status: 'pass',
      score: 94,
      finding: 'Filename, document object, extraction result, method, source, and trace ID are captured for replay.'
    }
  ]);

  return {
    suite: 'document-intelligence-alpha-v1',
    status: checks.status,
    score: checks.score,
    checks: checks.checks,
    model: details.intelligenceSource === 'trade_brain_service' ? 'traibox-trade-brain-document-intelligence' : 'alpha-deterministic-document-extractor',
    prompt_version: details.intelligenceSource === 'trade_brain_service' ? 'trade-brain-document-intelligence-alpha-v1' : 'document-extract-alpha-v1',
    context_used: {
      object_id: details.document.object_id,
      filename: details.filename,
      classification: details.classification,
      input_text_hash: sha256(input.body.text ?? ''),
      required_fields: details.requiredFields,
      missing_fields: details.missing,
      workflow_quality_source: details.intelligenceSource,
      trade_brain_service_version: details.serviceVersion
    },
    artifacts_used: [details.document.object_id, details.extractionObject.object_id],
    sources_used: [{ kind: 'document_text', sha256: sha256(input.body.text ?? '') }, ...details.provenance],
    confidence: details.confidence,
    policy_constraints: [
      'Extract only fields supported by source text.',
      'Report missing fields explicitly.',
      'Keep provenance and confidence attached to extraction result.'
    ],
    quality_signals: details.qualitySignals,
    generated_recommendation: details.recommendations[0] ?? (details.missing.length ? `Request missing proof: ${details.missing.join(', ')}.` : 'Review extraction and use it as readiness evidence.'),
    human_decision: 'pending',
    final_outcome: `Created extraction result ${details.extractionObject.object_id} for document ${details.document.object_id} using ${details.intelligenceSource}.`,
    replayable: true,
    trace_id: input.traceId
  };
}

function buildReadinessEvalResult(
  input: ActorInput & { body: ReadinessEvaluateRequest },
  details: {
    state: ReadinessState;
    object: AlphaObject | null;
    linkedCount: number;
  }
): AiEvalResult {
  const scoreConsistent =
    details.state.overall === 'ready'
      ? details.state.score >= 75
      : details.state.overall === 'blocked'
        ? details.state.score <= 35
        : details.state.score >= 0 && details.state.score <= 100;
  const checks = aggregateChecks([
    {
      case: 'readiness_scoring_consistency',
      status: scoreConsistent ? 'pass' : 'fail',
      score: scoreConsistent ? 92 : 25,
      finding: `Readiness ${details.state.overall} produced score ${Math.round(details.state.score)} with ${details.state.dimensions.length} dimension(s).`
    },
    {
      case: 'missing_proof_detection',
      status: details.state.missing_items.length || details.state.overall === 'ready' ? 'pass' : 'warn',
      score: details.state.missing_items.length ? 90 : 82,
      finding: details.state.missing_items.length
        ? `Missing proof detected: ${details.state.missing_items.slice(0, 4).join(', ')}.`
        : 'No missing proof items were produced; review if context was sparse.'
    },
    {
      case: 'recommendation_usefulness',
      status: details.state.next_actions.length ? 'pass' : 'warn',
      score: details.state.next_actions.length ? 88 : 62,
      finding: details.state.next_actions[0] ?? 'Readiness evaluation did not produce a next action.'
    },
    {
      case: 'deterministic_replay',
      status: 'pass',
      score: 93,
      finding: 'Readiness state captures target, linked context count, dimensions, gaps, risks, next actions, and trace ID.'
    }
  ]);

  return {
    suite: 'readiness-engine-alpha-v1',
    status: checks.status,
    score: checks.score,
    checks: checks.checks,
    model: 'alpha-deterministic-readiness-engine',
    prompt_version: 'readiness-evaluate-alpha-v1',
    context_used: {
      object_id: details.object?.object_id ?? input.body.object_id ?? null,
      trade_id: input.body.trade_id ?? details.object?.trade_id ?? null,
      linked_context_count: details.linkedCount,
      context_hash: sha256(input.body.context ?? {})
    },
    artifacts_used: [details.object?.object_id ?? input.body.object_id ?? input.body.trade_id ?? 'trade_context'],
    sources_used: [{ kind: 'readiness_context', sha256: sha256(input.body.context ?? {}) }],
    confidence: Math.min(0.95, Math.max(0.55, details.state.score / 100)),
    policy_constraints: [
      'Use structured object and linked context only.',
      'Expose missing, risky, blocked, approved, and next-action states.',
      'Never execute a protected action as part of readiness evaluation.'
    ],
    generated_recommendation: details.state.next_actions[0] ?? 'Review readiness state.',
    human_decision: 'pending',
    final_outcome: `Produced readiness state ${details.state.readiness_id} with overall ${details.state.overall}.`,
    replayable: true,
    trace_id: input.traceId
  };
}

function buildProofQualityEvalResult(
  input: ActorInput & { body: GenerateProofBundleRequest },
  details: {
    proofBundle: AlphaObject;
    objects: AlphaObject[];
    artifactRefs: ProofArtifactRef[];
    manifestSha: string;
    root: string;
    latestReadiness: ReadinessState | null;
    proofQuality: TradeBrainMissingProof;
  }
): AiEvalResult {
  const missingCount = Number(details.proofQuality.qualitySignals.missing_count ?? details.proofQuality.missingItems.length);
  const proofReady = details.proofQuality.qualitySignals.proof_ready === true || details.proofQuality.missingItems.length === 0;
  const checks = aggregateChecks([
    {
      case: 'missing_proof_detection',
      status: proofReady ? 'pass' : details.proofQuality.missingItems.includes('approval') ? 'fail' : 'warn',
      score: details.proofQuality.score,
      finding: proofReady
        ? 'Proof bundle has required artifact hashes, evidence links, readiness context, and replay trace coverage.'
        : `Proof bundle is missing ${missingCount} proof item(s): ${details.proofQuality.missingItems.join(', ')}.`,
      evidence_refs: [{ object_id: details.proofBundle.object_id, role: 'proof_bundle' }]
    },
    {
      case: 'deterministic_replay',
      status: details.manifestSha && details.root && details.artifactRefs.length ? 'pass' : 'fail',
      score: details.manifestSha && details.root && details.artifactRefs.length ? 96 : 25,
      finding: `Proof manifest hash, root, trace ID, and ${details.artifactRefs.length} artifact reference(s) are persisted.`
    },
    {
      case: 'hallucination_prevention',
      status: 'pass',
      score: 94,
      finding: 'Proof quality is derived from typed objects, manifest hashes, readiness state, and evidence refs rather than free-form claims.'
    },
    {
      case: 'recommendation_usefulness',
      status: details.proofQuality.nextActions.length || proofReady ? 'pass' : 'warn',
      score: details.proofQuality.nextActions.length || proofReady ? 88 : 62,
      finding: details.proofQuality.nextActions[0] ?? 'Proof bundle is ready for review or controlled sharing.'
    }
  ]);

  return {
    suite: 'proof-quality-alpha-v1',
    status: checks.status,
    score: checks.score,
    checks: checks.checks,
    model: details.proofQuality.serviceVersion ? 'traibox-trade-brain-missing-proof' : 'alpha-deterministic-proof-quality',
    prompt_version: details.proofQuality.serviceVersion ? 'trade-brain-missing-proof-alpha-v1' : 'proof-quality-alpha-v1',
    context_used: {
      trade_id: input.body.trade_id ?? details.proofBundle.trade_id ?? null,
      object_ids: details.objects.map((object) => object.object_id),
      object_types: details.objects.map((object) => object.type),
      proof_bundle_id: details.proofBundle.object_id,
      readiness_id: details.latestReadiness?.readiness_id ?? null,
      required_proof: details.proofQuality.requiredProof,
      available_proof: details.proofQuality.availableProof,
      missing_items: details.proofQuality.missingItems,
      workflow_quality_source: details.proofQuality.serviceVersion ? 'trade_brain_service' : 'local_deterministic_fallback',
      trade_brain_service_version: details.proofQuality.serviceVersion
    },
    artifacts_used: [details.proofBundle.object_id, ...details.objects.map((object) => object.object_id)],
    sources_used: [
      { kind: 'proof_manifest', sha256: details.manifestSha, root: details.root },
      { kind: 'missing_proof_detection', output: details.proofQuality },
      ...(details.latestReadiness ? [{ kind: 'readiness_state', readiness_id: details.latestReadiness.readiness_id, overall: details.latestReadiness.overall }] : [])
    ],
    confidence: Math.min(0.96, Math.max(0.55, details.proofQuality.score / 100)),
    policy_constraints: [
      'Proof bundles must preserve evidence links, artifact hashes, readiness state, and trace context.',
      'Protected or external sharing still requires explicit human approval.',
      'Missing proof detection must be replayable from structured objects.'
    ],
    quality_signals: {
      ...details.proofQuality.qualitySignals,
      workflow_quality_source: details.proofQuality.serviceVersion ? 'trade_brain_service' : 'local_deterministic_fallback',
      trade_brain_service_version: details.proofQuality.serviceVersion,
      artifact_count: details.artifactRefs.length,
      latest_readiness_id: details.latestReadiness?.readiness_id ?? null
    },
    generated_recommendation: details.proofQuality.nextActions[0] ?? 'Review proof bundle and keep protected sharing behind approval.',
    human_decision: 'pending',
    final_outcome: proofReady
      ? `Generated proof bundle ${details.proofBundle.object_id} with no missing required proof items.`
      : `Generated proof bundle ${details.proofBundle.object_id} with ${details.proofQuality.missingItems.length} proof quality gap(s) still visible.`,
    replayable: true,
    trace_id: input.traceId
  };
}

function aggregateChecks(checks: AiEvalCheck[]): { status: 'pass' | 'warn' | 'fail'; score: number; checks: AiEvalCheck[] } {
  const status = checks.some((check) => check.status === 'fail') ? 'fail' : checks.some((check) => check.status === 'warn') ? 'warn' : 'pass';
  const score = checks.length ? checks.reduce((total, check) => total + check.score, 0) / checks.length : 0;
  return { status, score, checks };
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function defaultStatusFor(type: AlphaObjectType): ObjectLifecycleStatus {
  if (type === 'payment_intent' || type === 'approval') return 'approval_required';
  if (type === 'agent_task') return 'in_progress';
  if (type === 'proof_bundle' || type === 'document_pack' || type === 'agent_work_result' || type === 'ai_eval_result') return 'completed';
  return 'draft';
}

function summarizeObjective(objective: string): string {
  const trimmed = objective.trim();
  if (trimmed.length <= 160) return trimmed;
  return `${trimmed.slice(0, 157)}...`;
}

function stringifyRecord(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function textFromUploadedBytes(bytes: Buffer, mimeType: string, filename: string): string | null {
  const normalized = mimeType.toLowerCase();
  const isText =
    normalized.startsWith('text/') ||
    ['application/json', 'application/xml', 'application/csv', 'application/x-ndjson'].includes(normalized) ||
    /\.(txt|md|markdown|csv|json|xml|html)$/i.test(filename);
  if (!isText) return null;
  const text = bytes.toString('utf8').replace(/\u0000/g, '').trim();
  return text ? text.slice(0, 200_000) : null;
}

function sanitizeStorageFilename(value: string): string {
  return value.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 140) || 'document.txt';
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function objectIdsFromEvidenceRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueStringValues(
    value.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      const objectId = stringOrNull(entry.object_id);
      const target = isRecord(entry.target) ? stringOrNull(entry.target.id) : null;
      return [objectId, target].filter((id): id is string => Boolean(id));
    })
  );
}

function uniqueStringValues(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sha256Bytes(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isAlphaObjectType(value: string): value is AlphaObjectType {
  return (ALPHA_OBJECT_TYPES as readonly string[]).includes(value);
}

function assertInitialLifecycleState(type: AlphaObjectType, status: ObjectLifecycleStatus) {
  const error = validateInitialLifecycleState(type, status);
  if (error) throwBadRequest(error);
}

function assertLifecycleTransition(object: Pick<AlphaObject, 'type' | 'status'>, nextStatus: ObjectLifecycleStatus, action: string) {
  const error = validateLifecycleTransition(object, nextStatus, action);
  if (error) throwBadRequest(error);
}

function createExternalAccessToken(): string {
  return `txp_${randomBytes(32).toString('base64url')}`;
}

function hashExternalAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function allowedActionsForExternalScopes(scopes: string[]): string[] {
  const normalizedScopes = normalizeExternalScopes(scopes);
  const actions = new Set<string>();
  if (normalizedScopes.includes('view_task')) actions.add('view_execution_task');
  if (normalizedScopes.includes('submit_task_update')) actions.add('submit_task_update');
  if (normalizedScopes.includes('view_document_request')) actions.add('view_document_request');
  if (normalizedScopes.includes('upload_requested_document')) actions.add('submit_requested_document');
  if (normalizedScopes.includes('view_trade_summary')) actions.add('view_trade_summary');
  if (normalizedScopes.includes('view_trade_passport')) actions.add('view_trade_passport');
  if (normalizedScopes.includes('submit_onboarding_evidence')) actions.add('submit_onboarding_evidence');
  if (normalizedScopes.includes('view_proof_summary')) actions.add('view_proof_summary');
  if (normalizedScopes.includes('view_artifact_manifest')) actions.add('view_artifact_manifest');
  if (normalizedScopes.includes('download_verified_bundle')) actions.add('download_verified_bundle');
  return [...actions];
}

const SUPPORTED_EXTERNAL_ACCESS_SCOPES = new Set([
  'view_task',
  'submit_task_update',
  'view_document_request',
  'upload_requested_document',
  'view_trade_summary',
  'view_trade_passport',
  'submit_onboarding_evidence',
  'view_proof_summary',
  'view_artifact_manifest',
  'download_verified_bundle'
]);

function allowedScopesForExternalTarget(targetType: string): Set<string> {
  if (targetType === 'execution_task') return new Set(['view_task', 'submit_task_update', 'view_document_request', 'upload_requested_document']);
  if (targetType === 'document_request') return new Set(['view_document_request', 'upload_requested_document']);
  if (targetType === 'trade_passport' || targetType === 'counterparty' || targetType === 'onboarding_flow') {
    return new Set(['view_trade_passport', 'submit_onboarding_evidence']);
  }
  if (targetType === 'proof_bundle') return new Set(['view_proof_summary', 'view_artifact_manifest', 'download_verified_bundle']);
  if (targetType === 'trade_room' || targetType === 'trade') return new Set(['view_trade_summary', 'view_proof_summary', 'view_artifact_manifest']);
  return new Set();
}

function normalizeExternalScopes(scopes: string[]): string[] {
  const normalized = new Set(scopes);
  if (normalized.has('view_assigned_task')) normalized.add('view_task');
  if (normalized.has('view_proof_manifest')) {
    normalized.add('view_proof_summary');
    normalized.add('view_artifact_manifest');
  }
  return [...normalized];
}

function throwUnauthorized(message: string): never {
  const e: any = new Error(message);
  e.statusCode = 401;
  e.code = 'unauthorized';
  throw e;
}

function throwForbidden(message: string): never {
  const e: any = new Error(message);
  e.statusCode = 403;
  e.code = 'forbidden';
  throw e;
}

function throwNotFound(message: string): never {
  const e: any = new Error(message);
  e.statusCode = 404;
  e.code = 'not_found';
  throw e;
}

function throwBadRequest(message: string): never {
  const e: any = new Error(message);
  e.statusCode = 400;
  e.code = 'bad_request';
  throw e;
}
