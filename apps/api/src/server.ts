import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import {
  ALPHA_OBJECT_TYPES,
  ALPHA_SCENARIOS,
  ATTACH_MODES,
  OBJECT_LIFECYCLE_STATUSES,
  ORIGIN_WORKSPACES,
  PROTECTED_ACTIONS,
  buildApiCatalog,
  buildTraiboxOpenApiDocument,
  findApiError,
  type AmbiguityResponse,
  type AlphaObjectType,
  type AlphaScenarioId,
  type ApprovalDecisionRequest,
  type ApprovalRequest,
  type AttachObjectRequest,
  type BuildNetworkTrustRequest,
  type ComplianceRequest,
  type ComplianceResponse,
  type CreateAlphaObjectRequest,
  type DocumentPackGenerateRequest,
  type DocumentExtractRequest,
  type DocumentRequestCreateRequest,
  type DocumentRequestSubmissionRequest,
  type EvaluateClearanceCheckRequest,
  type ErrorResponse,
  type ExecutionTaskRequest,
  type ExecutionTaskStatusRequest,
  type ExecutePaymentIntentRequest,
  type ExecutePaymentRequest,
  type ExternalAccessGrantRequest,
  type ExternalAccessRevokeRequest,
  type ExternalOnboardingEvidenceRequest,
  type ExternalParticipantTaskUpdateRequest,
  type GenerateProofBundleRequest,
  type IntelligenceRunRequest,
  type ListTradeBrainEvalRunsRequest,
  type AgentTaskRequest,
  type LedgerExportResponse,
  type MemoryInsightsRequest,
  type QueryAlphaObjectsRequest,
  type ProofShareRequest,
  type ReplayQueryRequest,
  type ReadinessEvaluateRequest,
  type RunTradeBrainEvalRequest,
  type OfferRequest,
  type OfferResponse,
  type ParseTradeRequest,
  type RoutesRequest,
  type RoutesResponse,
  type TradePlanResponse,
  type UUID,
  type LedgerProofsResponse,
  type LedgerVerifyStoredRequest,
  type LedgerVerifyStoredResponse,
  type LedgerVerifyResponse,
  type UTGPartnerFeaturesRequest,
  type UTGRecallRequest,
  type SSEEvent
} from '@traibox/contracts';

import { createPool } from '@traibox/db';
import { setAppContext, withTx } from '@traibox/db';
import { assertRuntimeReady, loadProfileFromFile, validateRuntimeEnvironment } from '@traibox/profiles';
import { verifyBundleZip } from '@traibox/proof';

import { verifyUser } from './services/auth.js';
import { EventHub } from './services/events.js';
import { getIdempotentResponse, putIdempotentResponse } from './services/idempotency.js';
import { LocalStorage, SupabaseStorage, type StorageClient } from './services/storage.js';
import { parseTradeIntent } from './services/tradebrain.js';
import { runCompliance } from './services/compliance.js';
import { requestOffers, acceptOffer, listFunding, upsertEvidence, deleteEvidence, gradeEvidence } from './services/finance.js';
import { computeRoutes, executePayment, getPaymentStatus, getPaymentDetails, listPayments, completeManualPayment, mockScaComplete } from './services/payments.js';
import { getOrBuildBundle, listAnchors, verifyAnchorTx, exportLedger, verifyStoredBundle } from './services/ledger.js';
import { scoreAllocation } from './services/allocation.js';
import { adminBootstrapPartner, partnerAuthToken, partnerListOfferRequests, partnerSubmitOffers, partnerGetProfile } from './services/partners.js';
import { listTrades, getTrade } from './services/trades.js';
import { listTradeMessages, listOrgMessages, createUserTradeMessage } from './services/messages.js';
import {
  startBankConsent,
  exchangeBankConsent,
  listConsents,
  revokeConsent,
  listAccounts,
  createManualAccount,
  getBalances,
  getTransactions
} from './services/banks.js';
import { uploadPassportDocument, startKybVerification, getKybStatus } from './services/kyb.js';
import { getOrBuildSustainableFinanceReport } from './services/reports.js';
import { handleConsentWebhook, handlePaymentWebhook } from './services/webhooks.js';
import { getTrueLayerConfigFromEnv, verifyWebhookSignature } from './services/truelayer.js';
import { utgPartnerFeatures, utgRecall } from './services/utg.js';
import {
  attachAlphaObject,
  buildNetworkTrustAlpha,
  createAlphaObject,
  createExecutionTaskAlpha,
  createDocumentRequestAlpha,
  createExternalAccessGrantAlpha,
  decideApprovalAlpha,
  evaluateClearanceCheckAlpha,
  evaluateReadinessAlpha,
  extractDocumentAlpha,
  generateDocumentPackAlpha,
  generateProofBundleAlpha,
  getMemoryInsightsAlpha,
  getExternalParticipantSessionAlpha,
  launchAgentTaskAlpha,
  queryAlphaObjects,
  queryAlphaReplay,
  requestApprovalAlpha,
  requestProofShareAlpha,
  revokeExternalAccessGrantAlpha,
  executeApprovedPaymentIntentAlpha,
  runIntelligenceAlpha,
  runIntelligenceStream,
  runInternalAlphaDemo,
  submitDocumentRequestAlpha,
  submitExternalDocumentRequestAlpha,
  submitExternalExecutionTaskUpdateAlpha,
  submitExternalOnboardingEvidenceAlpha,
  uploadDocumentAlpha,
  updateExecutionTaskStatusAlpha,
  verifyAuditChainAlpha
} from './services/alpha.js';
import { listTradeBrainEvalRuns, listTradeBrainEvalSuites, runTradeBrainEvalSuite } from './services/trade-brain-evals.js';

export type StartupStageLogger = (stage: string, details?: Record<string, unknown>) => void;

export async function buildServer(options: { onStartupStage?: StartupStageLogger } = {}) {
  const startupStage = options.onStartupStage ?? (() => undefined);
  const app = Fastify({
    logger: false,
    genReqId: () => nanoid()
  });
  startupStage('fastify.created');

  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : true;
  await app.register(cors, {
    origin: corsOrigin,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Org-Id', 'X-Idempotency-Key', 'X-Locale', 'X-Admin-Secret']
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 }
  });
  startupStage('fastify.plugins_registered');

  // Capture raw JSON body for webhooks so we can verify signatures.
  app.addHook('preParsing', (req, reply, payload, done) => {
    if (!req.url.startsWith('/webhooks')) return done(null, payload);
    const chunks: Buffer[] = [];
    payload.on('data', (c) => chunks.push(Buffer.from(c)));
    payload.on('end', () => {
      const buf = Buffer.concat(chunks);
      (req as any).rawBody = buf;
      done(null, Readable.from(buf));
    });
    payload.on('error', (err) => done(err, payload));
  });

  const profilePath = process.env.DEPLOYMENT_PROFILE_PATH ?? 'packages/profiles/profiles/dev.yaml';
  startupStage('runtime.profile_loading', { profile_path: profilePath });
  const profile = loadProfileFromFile(profilePath);
  const runtimeReport = validateRuntimeEnvironment({ profile, target: 'api' });
  assertRuntimeReady(runtimeReport);
  startupStage('runtime.validated', {
    profile_id: profile.profile_id,
    region: profile.region,
    runtime_status: runtimeReport.status,
    degraded_mode: runtimeReport.degraded_mode
  });

  const pool = createPool(process.env.DATABASE_URL!);
  const eventHub = new EventHub(pool);
  startupStage('database.event_hub_connecting');
  await eventHub.start();
  startupStage('database.event_hub_listening');
  app.addHook('onClose', async () => {
    await eventHub.stop();
    await pool.end();
  });

  const storage: StorageClient =
    process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? new SupabaseStorage({
          supabaseUrl: process.env.SUPABASE_URL,
          serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
        })
      : new LocalStorage({ rootDir: 'tmp/local-storage' });

  app.setErrorHandler((error, req, reply) => {
    const traceId = (req as any).trace_id as string | undefined;
    const isValidationError = error instanceof z.ZodError;
    const statusCode = isValidationError ? 400 : (error as any).statusCode && Number.isInteger((error as any).statusCode) ? (error as any).statusCode : 500;
    const code =
      isValidationError
        ? 'validation_error'
        : (error as any).code && typeof (error as any).code === 'string'
        ? (error as any).code
        : statusCode >= 500
          ? 'internal_error'
          : 'request_error';
    const message = isValidationError ? 'Validation error' : statusCode >= 500 ? 'Internal error' : error instanceof Error ? error.message : 'Request error';
    const hint = isValidationError ? error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).slice(0, 3).join('; ') : undefined;
    if (statusCode >= 500) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'API request failed',
          service: 'traibox-api',
          trace_id: traceId,
          method: req.method,
          route: req.routeOptions?.url ?? req.url,
          error_name: normalized.name,
          error_message: normalized.message,
          error_stack: normalized.stack
        })
      );
    }
    return reply.status(statusCode).send(err(code, message, traceId ?? `trc_${nanoid(10)}`, hint));
  });

  app.addHook('onRequest', async (req, reply) => {
    const traceId = (req.headers['x-trace-id'] as string | undefined) ?? `trc_${nanoid(10)}`;
    (req as any).trace_id = traceId;

    if (
      req.url.startsWith('/healthz') ||
      req.url.startsWith('/readyz') ||
      req.url.startsWith('/metrics') ||
      req.url.startsWith('/webhooks') ||
      req.url.startsWith('/v1/api/catalog') ||
      req.url.startsWith('/v1/openapi.json') ||
      req.url.startsWith('/v1/partners') ||
      req.url.startsWith('/v1/external-participants')
    )
      return;

    const authz = req.headers.authorization;
    if (!authz?.startsWith('Bearer ')) {
      // EventSource can't set headers, and file downloads are often plain GETs.
      // For those endpoints we accept `?token=<access_token>` as an alternative.
      if (req.url.startsWith('/v1/events') || req.url.startsWith('/v1/files')) {
        const token = (req.query as any)?.token as string | undefined;
        if (token) {
          const user = await verifyUser(token).catch(() => null);
          if (!user) return reply.status(401).send(err('unauthorized', 'Invalid token', traceId));
          (req as any).user = user;
          return;
        }
      }
      return reply.status(401).send(err('unauthorized', 'Missing Authorization header', traceId));
    }
    const token = authz.slice('Bearer '.length);
    const user = await verifyUser(token).catch(() => null);
    if (!user) return reply.status(401).send(err('unauthorized', 'Invalid token', traceId));
    (req as any).user = user;
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/v1') && !req.url.startsWith('/webhooks')) return;
    if (
      req.url.startsWith('/v1/orgs') ||
      req.url.startsWith('/v1/api/catalog') ||
      req.url.startsWith('/v1/openapi.json') ||
      req.url.startsWith('/v1/partners') ||
      req.url.startsWith('/v1/external-participants') ||
      req.url.startsWith('/healthz') ||
      req.url.startsWith('/readyz') ||
      req.url.startsWith('/metrics') ||
      req.url.startsWith('/webhooks')
    )
      return;
    const orgId = ((req.headers['x-org-id'] as string | undefined) ?? ((req.query as any)?.org_id as string | undefined)) ?? undefined;
    if (!orgId) return reply.status(400).send(err('missing_org', 'X-Org-Id header is required', (req as any).trace_id));
    (req as any).org_id = orgId;

    // Membership check (defense-in-depth): ensure the authenticated user belongs to X-Org-Id.
    // Without this, a user could set app.current_org to another org and RLS would allow access.
    const user = (req as any).user as { user_id: string } | undefined;
    if (!user?.user_id) return reply.status(401).send(err('unauthorized', 'Missing user context', (req as any).trace_id));
    const role = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId: null });
      const res = await client.query('SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2 LIMIT 1', [orgId, user.user_id]);
      return (res.rows[0]?.role as string | undefined) ?? null;
    });
    if (!role) return reply.status(403).send(err('forbidden', 'Not a member of this org', (req as any).trace_id));
    (req as any).org_role = role;
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: 'traibox-api',
    profile_id: profile.profile_id,
    region: profile.region,
    runtime_status: runtimeReport.status,
    degraded_mode: runtimeReport.degraded_mode,
    uptime_seconds: Math.round(process.uptime())
  }));

  app.get('/readyz', async (req, reply) => {
    const started = Date.now();
    const report = validateRuntimeEnvironment({ profile, target: 'api' });
    const db = await pool
      .query('SELECT 1 AS ok')
      .then(() => ({ ok: true, latency_ms: Date.now() - started }))
      .catch((error) => ({ ok: false, latency_ms: Date.now() - started, error: error instanceof Error ? error.message : 'database_error' }));
    const ready = report.status !== 'fail' && db.ok;
    return reply.status(ready ? 200 : 503).send({
      ok: ready,
      service: 'traibox-api',
      profile_id: profile.profile_id,
      region: profile.region,
      runtime: report,
      database: db,
      uptime_seconds: Math.round(process.uptime())
    });
  });

  app.get('/metrics', async (_req, reply) => {
    const report = validateRuntimeEnvironment({ profile, target: 'api' });
    const statusValue = report.status === 'pass' ? 1 : report.status === 'warn' ? 0.5 : 0;
    const metrics = [
      '# HELP traibox_api_runtime_status Runtime readiness status: pass=1 warn=0.5 fail=0.',
      '# TYPE traibox_api_runtime_status gauge',
      `traibox_api_runtime_status{profile="${profile.profile_id}",region="${profile.region}"} ${statusValue}`,
      '# HELP traibox_api_degraded_mode Whether degraded mode is active.',
      '# TYPE traibox_api_degraded_mode gauge',
      `traibox_api_degraded_mode{profile="${profile.profile_id}"} ${report.degraded_mode ? 1 : 0}`,
      '# HELP traibox_api_uptime_seconds Process uptime in seconds.',
      '# TYPE traibox_api_uptime_seconds gauge',
      `traibox_api_uptime_seconds ${Math.round(process.uptime())}`,
      '# HELP traibox_api_runtime_check_failures Number of failing runtime checks.',
      '# TYPE traibox_api_runtime_check_failures gauge',
      `traibox_api_runtime_check_failures{profile="${profile.profile_id}"} ${report.checks.filter((check) => check.severity === 'fail').length}`,
      ''
    ].join('\n');
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return reply.status(200).send(metrics);
  });

  app.get('/v1/api/catalog', async (req, reply) => {
    const traceId = ((req as any).trace_id as string | undefined) ?? `trc_${nanoid(10)}`;
    return reply.status(200).send({ ...buildApiCatalog(), trace_id: traceId });
  });

  app.get('/v1/openapi.json', async (req, reply) => {
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
    const host = req.headers.host ?? 'localhost:3001';
    return reply.status(200).send(buildTraiboxOpenApiDocument({ serverUrl: `${proto}://${host}` }));
  });

  async function requireOrgRole(input: { orgId: string; userId: string; allowed: string[] }) {
    const row = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: input.userId, orgId: input.orgId });
      const res = await client.query('SELECT role FROM org_members WHERE org_id=$1 AND user_id=$2 LIMIT 1', [input.orgId, input.userId]);
      return res.rows[0] ?? null;
    });
    if (!row || !input.allowed.includes(row.role)) {
      const e: any = new Error('Forbidden');
      e.statusCode = 403;
      e.code = 'forbidden';
      throw e;
    }
    return row.role as string;
  }

  function requireRequestRole(req: any, allowed: string[]) {
    const role = (req as any).org_role as string | undefined;
    if (!role || !allowed.includes(role)) {
      const e: any = new Error('Forbidden');
      e.statusCode = 403;
      e.code = 'forbidden';
      throw e;
    }
    return role;
  }

  const alphaObjectTypeSchema = z.enum(ALPHA_OBJECT_TYPES);
  const alphaStatusSchema = z.enum(OBJECT_LIFECYCLE_STATUSES);
  const originWorkspaceSchema = z.enum(ORIGIN_WORKSPACES);
  const attachModeSchema = z.enum(ATTACH_MODES);
  const protectedActionSchema = z.enum(PROTECTED_ACTIONS);
  const evalStatusSchema = z.enum(['pass', 'warn', 'fail']);
  const approvalChainStepSchema = z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    required_role: z.string().min(1),
    status: alphaStatusSchema.optional(),
    actor_id: z.string().uuid().nullable().optional(),
    decided_at: z.string().nullable().optional(),
    notes: z.string().nullable().optional()
  });
  const executionActionSchema = z.enum([
    'prepare',
    'start_controlled_execution',
    'mark_ready_for_review',
    'mark_external_submitted',
    'mark_external_completed',
    'mark_blocked',
    'cancel'
  ]);
  const alphaScenarioSchema = z.enum(ALPHA_SCENARIOS.map((scenario) => scenario.id) as [AlphaScenarioId, ...AlphaScenarioId[]]);

  const alphaObjectBodySchema = z.object({
    title: z.string().min(1),
    summary: z.string().optional(),
    status: alphaStatusSchema.optional(),
    origin_workspace: originWorkspaceSchema,
    trade_id: z.string().uuid().nullable().optional(),
    payload: z.record(z.any()).optional(),
    permissions: z.record(z.any()).optional(),
    evidence_refs: z.array(z.any()).optional()
  });

  const alphaRefSchema = z.object({
    type: z.union([alphaObjectTypeSchema, z.enum(['trade_room', 'trade', 'counterparty'])]),
    id: z.string().uuid()
  });

  // ---- Webhooks (TrueLayer / others) ----
  app.post('/webhooks/payments', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const payload = z.record(z.any()).parse((req.body ?? {}) as Record<string, unknown>);
    const paymentId =
      coerceString(payload['payment_id']) ??
      coerceString(payload['paymentId']) ??
      coerceString(payload['id']) ??
      coerceString(payload['resource_id']);
    const statusRaw =
      coerceString(payload['status']) ??
      coerceString(payload['payment_status']) ??
      coerceString(payload['paymentStatus']) ??
      coerceString(payload['type']);
    const status = normalizePaymentStatus(statusRaw);
    const isoStatus = coerceString(payload['iso_status']) ?? coerceString(payload['isoStatus']);
    const returnReason = coerceString(payload['return_reason']) ?? coerceString(payload['returnReason']) ?? coerceString(payload['reason']);
    if (!paymentId || !status) return reply.status(400).send({ ok: false });

    const tl = getTrueLayerConfigFromEnv();
    const secret = tl?.webhookSecret;
    const rawBody = ((req as any).rawBody as Buffer | undefined) ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const sigHeader =
      (req.headers['tl-signature'] as string | undefined) ??
      (req.headers['x-tl-signature'] as string | undefined) ??
      (req.headers['x-truelayer-signature'] as string | undefined);
    const signatureOk = secret ? verifyWebhookSignature({ rawBody, secret, headerValue: sigHeader }) : true;
    const shouldVerify = Boolean(secret && profile.payments.truelayer.webhooks.verify_signatures);
    if (shouldVerify && !signatureOk) return reply.status(401).send({ ok: false });

    const webhookId =
      (req.headers['tl-webhook-id'] as string | undefined) ??
      (req.headers['x-tl-webhook-id'] as string | undefined) ??
      (req.headers['x-webhook-id'] as string | undefined) ??
      undefined;
    const dedupeKey = webhookId ? `id:${webhookId}` : `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;

    await handlePaymentWebhook(pool, {
      providerId: 'truelayer',
      paymentIdOrRef: paymentId,
      status,
      iso_status: isoStatus ?? undefined,
      return_reason: returnReason ?? undefined,
      payload,
      signatureOk,
      dedupeKey,
      traceId
    });
    return reply.status(200).send({ ok: true });
  });

  app.post('/webhooks/consents', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const payload = z.record(z.any()).parse((req.body ?? {}) as Record<string, unknown>);
    const consentId = coerceString(payload['consent_id']) ?? coerceString(payload['consentId']) ?? coerceString(payload['id']);
    const status = coerceString(payload['status']) ?? coerceString(payload['consent_status']) ?? coerceString(payload['consentStatus']);
    if (!consentId || !status) return reply.status(400).send({ ok: false });
    if (!z.string().uuid().safeParse(consentId).success) return reply.status(400).send({ ok: false });

    const tl = getTrueLayerConfigFromEnv();
    const secret = tl?.webhookSecret;
    const rawBody = ((req as any).rawBody as Buffer | undefined) ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const sigHeader =
      (req.headers['tl-signature'] as string | undefined) ??
      (req.headers['x-tl-signature'] as string | undefined) ??
      (req.headers['x-truelayer-signature'] as string | undefined);
    const signatureOk = secret ? verifyWebhookSignature({ rawBody, secret, headerValue: sigHeader }) : true;
    const shouldVerify = Boolean(secret && profile.payments.truelayer.webhooks.verify_signatures);
    if (shouldVerify && !signatureOk) return reply.status(401).send({ ok: false });

    const webhookId =
      (req.headers['tl-webhook-id'] as string | undefined) ??
      (req.headers['x-tl-webhook-id'] as string | undefined) ??
      (req.headers['x-webhook-id'] as string | undefined) ??
      undefined;
    const dedupeKey = webhookId ? `id:${webhookId}` : `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;

    await handleConsentWebhook(pool, {
      providerId: 'truelayer',
      consentId,
      status,
      payload,
      signatureOk,
      dedupeKey,
      traceId
    });
    return reply.status(200).send({ ok: true });
  });

  // ---- Orgs ----
  app.post('/v1/orgs', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const body = z.object({ name: z.string().min(1), country: z.string().optional() }).parse(req.body ?? {});
    const user = (req as any).user as { user_id: string; email?: string };

    const orgId = cryptoUuid();

    const result = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('INSERT INTO app_users(user_id, email) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET email=excluded.email', [
        user.user_id,
        user.email ?? null
      ]);
      await client.query('INSERT INTO orgs(org_id, name, country) VALUES($1,$2,$3)', [orgId, body.name, body.country ?? null]);
      await client.query('INSERT INTO org_members(org_id, user_id, role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [
        orgId,
        user.user_id,
        'owner'
      ]);
      return { org_id: orgId };
    });

    return reply.status(200).send({ ...result, trace_id: traceId });
  });

  app.get('/v1/orgs', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const user = (req as any).user as { user_id: string; email?: string };
    const rows = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId: null });
      const res = await client.query(
        `SELECT o.org_id, o.name, o.country, m.role
         FROM org_members m
         JOIN orgs o ON o.org_id = m.org_id
         WHERE m.user_id = $1
         ORDER BY o.created_at DESC`,
        [user.user_id]
      );
      return res.rows;
    });
    return reply.status(200).send({ orgs: rows, trace_id: traceId });
  });

  app.get('/v1/orgs/:orgId/access', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req.params as any)['orgId'] as string;
    const user = (req as any).user as { user_id: string };

    const role = await requireOrgRole({ orgId, userId: user.user_id, allowed: ['owner', 'admin', 'finance', 'ops', 'member', 'auditor'] });
    const data = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      const org = await client.query('SELECT org_id, name, country FROM orgs WHERE org_id=$1 LIMIT 1', [orgId]);
      const members = await client.query(
        `SELECT m.user_id, u.email, u.display_name, m.role, m.created_at
         FROM org_members m
         LEFT JOIN app_users u ON u.user_id = m.user_id
         WHERE m.org_id=$1
         ORDER BY m.created_at ASC`,
        [orgId]
      );
      const invites = await client.query(
        `SELECT invite_id, email, role, created_at, accepted_at
         FROM org_invites
         WHERE org_id=$1
         ORDER BY created_at DESC
         LIMIT 50`,
        [orgId]
      );
      return {
        org: { ...org.rows[0], role },
        members: members.rows,
        invites: invites.rows
      };
    });

    return reply.status(200).send({ ...data, trace_id: traceId });
  });

  app.post('/v1/orgs/:orgId/invites', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req.params as any)['orgId'] as string;
    const body = z.object({ email: z.string().email(), role: z.string().default('member') }).parse(req.body ?? {});
    const user = (req as any).user as { user_id: string };

    await requireOrgRole({ orgId, userId: user.user_id, allowed: ['owner', 'admin'] });
    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('INSERT INTO org_invites(org_id, email, role, invited_by) VALUES($1,$2,$3,$4)', [
        orgId,
        body.email,
        body.role,
        user.user_id
      ]);
    });

    return reply.status(200).send({ ok: true, trace_id: traceId });
  });

  app.post('/v1/orgs/:orgId/members/:userId/role', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req.params as any)['orgId'] as string;
    const userId = (req.params as any)['userId'] as string;
    const body = z.object({ role: z.string().min(1) }).parse(req.body ?? {});
    const user = (req as any).user as { user_id: string };

    await requireOrgRole({ orgId, userId: user.user_id, allowed: ['owner', 'admin'] });
    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('UPDATE org_members SET role=$1 WHERE org_id=$2 AND user_id=$3', [body.role, orgId, userId]);
    });

    return reply.status(200).send({ ok: true, trace_id: traceId });
  });

  // ---- Trades ----
  app.get('/v1/trades', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const data = await listTrades(pool, { orgId, userId: user.user_id });
    return reply.status(200).send({ ...data, trace_id: traceId });
  });

  app.get('/v1/trades/:tradeId', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const tradeId = (req.params as any)['tradeId'] as string;
    const data = await getTrade(pool, { orgId, userId: user.user_id, tradeId });
    return reply.status(200).send({ ...data, trace_id: traceId });
  });

  app.get('/v1/messages', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const limit = z.coerce.number().int().min(1).max(500).optional().parse((req.query as any)?.limit);
    const data = await listOrgMessages(pool, { orgId, userId: user.user_id, limit });
    return reply.status(200).send({ ...data, trace_id: traceId });
  });

  app.get('/v1/trades/:tradeId/messages', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const tradeId = z.string().uuid().parse((req.params as any)['tradeId']);
    const limit = z.coerce.number().int().min(1).max(500).optional().parse((req.query as any)?.limit);
    const data = await listTradeMessages(pool, { orgId, userId: user.user_id, tradeId, limit });
    return reply.status(200).send({ ...data, trace_id: traceId });
  });

  app.post('/v1/trades/:tradeId/messages', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const tradeId = z.string().uuid().parse((req.params as any)['tradeId']);
    const body = z.object({ text: z.string().min(1).max(4000) }).parse(req.body ?? {});
    const data = await createUserTradeMessage(pool, { orgId, userId: user.user_id, tradeId, traceId, text: body.text });
    return reply.status(200).send({ ...data, trace_id: traceId });
  });

  // ---- UTG (Postgres-backed stub) ----
  app.post('/v1/utg/recall', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };

    const body = z
      .object({
        trade_id: z.string().uuid(),
        hops: z.number().int().min(1).max(4).optional(),
        include: z.array(z.string()).optional(),
        limit_nodes: z.number().int().min(1).max(500).optional()
      })
      .parse(req.body ?? {}) as UTGRecallRequest;

    const data = await utgRecall(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(data);
  });

  app.post('/v1/utg/partner/features', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };

    const body = z
      .object({
        domain: z.string().min(1),
        trade_id: z.string().uuid(),
        partner_ids: z.array(z.string().min(1)).max(50)
      })
      .parse(req.body ?? {}) as UTGPartnerFeaturesRequest;

    const data = await utgPartnerFeatures(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(data);
  });

  app.post('/v1/trade/parse', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string; email?: string };

    const body = z.object({ intent_text: z.string().min(1), hints: z.any().optional() }).parse(req.body ?? {}) as ParseTradeRequest;

    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idemKey) {
      const idem = await getIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/trade/parse',
        key: idemKey,
        requestHash: hashBody(body)
      });
      if (idem) return reply.status(idem.status_code).send(idem.response_json);
    }

    const parsed = parseTradeIntent(body, { profile });
    if ('error' in parsed) {
      const amb = parsed as AmbiguityResponse;
      return reply.status(422).send({ ...amb, trace_id: traceId });
    }

    const tradeId = cryptoUuid();
    const planId = cryptoUuid();

    const plan = parsed as Omit<TradePlanResponse, 'trade_id' | 'trace_id'>;

    const response = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('INSERT INTO app_users(user_id, email) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET email=excluded.email', [
        user.user_id,
        user.email ?? null
      ]);
      await client.query(
        'INSERT INTO trades(trade_id, org_id, title, corridor, amount, currency, status, created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [tradeId, orgId, plan.plan.items[0]?.name ?? 'New trade', parsed.corridor ?? null, null, body.hints?.currency ?? 'EUR', 'active', user.user_id]
      );
      await client.query(
        'INSERT INTO trade_plans(plan_id, trade_id, org_id, items, parties, terms, checklist, confidence, glass_box) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [
          planId,
          tradeId,
          orgId,
          JSON.stringify(plan.plan.items),
          JSON.stringify(plan.plan.parties),
          JSON.stringify(plan.plan.terms),
          JSON.stringify(plan.plan.checklist),
          plan.confidence,
          JSON.stringify(plan.glass_box)
        ]
      );
      await client.query('INSERT INTO trade_messages(trade_id, org_id, user_id, role, text) VALUES($1,$2,$3,$4,$5)', [
        tradeId,
        orgId,
        user.user_id,
        'user',
        body.intent_text
      ]);

      const ev: SSEEvent = {
        event_id: cryptoUuid(),
        type: 'plan.generated',
        ts: new Date().toISOString(),
        org_id: orgId,
        trade_id: tradeId,
        trace_id: traceId,
        actor: `user:${user.user_id}`,
        data: { trade_id: tradeId, confidence: plan.confidence, summary: 'Plan generated', trace_id: traceId }
      };
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        ev.event_id,
        orgId,
        tradeId,
        ev.type,
        traceId,
        ev.actor,
        JSON.stringify(ev.data)
      ]);

      return ev;
    });

    const out: TradePlanResponse = {
      trade_id: tradeId,
      ...plan,
      trace_id: traceId
    };

    if (idemKey) {
      await putIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/trade/parse',
        key: idemKey,
        requestHash: hashBody(body),
        statusCode: 200,
        responseJson: out
      });
    }

    return reply.status(200).send(out);
  });

  // ---- TRAIBOX v1 internal alpha spine ----
  app.post('/v1/objects/:type', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const type = alphaObjectTypeSchema.parse((req.params as any).type) as AlphaObjectType;
    const body = alphaObjectBodySchema.parse(req.body ?? {}) as CreateAlphaObjectRequest;
    const resp = await createAlphaObject(pool, { orgId, userId: user.user_id, traceId, type, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/attachments', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        object_id: z.string().uuid(),
        target: alphaRefSchema,
        mode: attachModeSchema.optional(),
        reason: z.string().optional(),
        payload: z.record(z.any()).optional()
      })
      .parse(req.body ?? {}) as AttachObjectRequest;
    const resp = await attachAlphaObject(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.get('/v1/query', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };

    const q = req.query as any;
    const tradeIdRaw = q.trade_id as string | undefined;
    const query = {
      origin_workspace: q.origin_workspace ? originWorkspaceSchema.parse(q.origin_workspace) : undefined,
      owner_id: q.owner_id ? z.string().uuid().parse(q.owner_id) : undefined,
      status: q.status ? alphaStatusSchema.parse(q.status) : undefined,
      type: q.type ? alphaObjectTypeSchema.parse(q.type) : undefined,
      trade_id: tradeIdRaw === 'null' ? null : tradeIdRaw ? z.string().uuid().parse(tradeIdRaw) : undefined,
      payment_provider: q.payment_provider ? z.enum(['manual', 'truelayer', 'ibanfirst', 'mock']).parse(q.payment_provider) : undefined,
      adapter_id: q.adapter_id ? z.string().min(1).max(120).parse(q.adapter_id) : undefined,
      limit: q.limit ? z.coerce.number().int().min(1).max(200).parse(q.limit) : undefined
    } satisfies QueryAlphaObjectsRequest;

    const resp = await queryAlphaObjects(pool, { orgId, userId: user.user_id, traceId, query });
    return reply.status(200).send(resp);
  });

  app.get('/v1/memory/insights', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member', 'auditor']);

    const q = req.query as any;
    const query = {
      trade_id: q.trade_id ? z.string().uuid().parse(q.trade_id) : undefined,
      level: q.level ? z.enum(['L1', 'L2']).parse(q.level) : undefined,
      limit: q.limit ? z.coerce.number().int().min(1).max(500).parse(q.limit) : undefined
    } satisfies MemoryInsightsRequest;

    const resp = await getMemoryInsightsAlpha(pool, { orgId, userId: user.user_id, traceId, query });
    return reply.status(200).send(resp);
  });

  app.get('/v1/replay', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member', 'auditor']);

    const q = req.query as any;
    const query = z
      .object({
        trade_id: z.string().uuid().optional(),
        object_id: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(300).optional(),
        include_audit: z
          .enum(['true', 'false'])
          .optional()
          .transform((value) => (value == null ? undefined : value === 'true'))
      })
      .refine((value) => Boolean(value.trade_id || value.object_id), { message: 'trade_id or object_id is required' })
      .parse(q) as ReplayQueryRequest;

    const resp = await queryAlphaReplay(pool, { orgId, userId: user.user_id, traceId, query });
    return reply.status(200).send(resp);
  });

  app.get('/v1/governance/audit-chain', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops', 'auditor']);
    const limit = z.coerce.number().int().min(1).max(1000).optional().parse((req.query as any)?.limit);
    const resp = await verifyAuditChainAlpha(pool, { orgId, userId: user.user_id, traceId, limit });
    return reply.status(200).send(resp);
  });

  app.post('/v1/documents/extract', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        object_id: z.string().uuid().optional(),
        filename: z.string().optional(),
        mime_type: z.string().optional(),
        text: z.string().optional(),
        trade_id: z.string().uuid().nullable().optional(),
        origin_workspace: originWorkspaceSchema.optional()
      })
      .parse(req.body ?? {}) as DocumentExtractRequest;
    const resp = await extractDocumentAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/documents/upload', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const part = await req.file();
    if (!part) return reply.status(400).send(err('missing_file', 'A document file is required', traceId));
    const bytes = await part.toBuffer();
    const tradeId = multipartFieldString(part.fields.trade_id);
    const originWorkspace = multipartFieldString(part.fields.origin_workspace);
    const extract = multipartFieldString(part.fields.extract);
    const resp = await uploadDocumentAlpha(pool, storage, {
      orgId,
      userId: user.user_id,
      traceId,
      body: {
        filename: part.filename,
        mimeType: part.mimetype,
        bytes,
        tradeId: tradeId ? z.string().uuid().parse(tradeId) : null,
        originWorkspace: originWorkspace ? originWorkspaceSchema.parse(originWorkspace) : 'intelligence',
        extract: extract === undefined ? true : extract !== 'false'
      }
    });
    return reply.status(200).send(resp);
  });

  app.post('/v1/documents/packs', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        trade_id: z.string().uuid().nullable().optional(),
        object_ids: z.array(z.string().uuid()).optional(),
        title: z.string().optional()
      })
      .refine((value) => Boolean(value.trade_id || value.object_ids?.length), { message: 'trade_id or object_ids is required' })
      .parse(req.body ?? {}) as DocumentPackGenerateRequest;
    const resp = await generateDocumentPackAlpha(pool, storage, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/readiness/evaluate', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        object_id: z.string().uuid().optional(),
        trade_id: z.string().uuid().optional(),
        context: z.record(z.any()).optional()
      })
      .refine((v) => Boolean(v.object_id || v.trade_id), { message: 'object_id or trade_id is required' })
      .parse(req.body ?? {}) as ReadinessEvaluateRequest;
    const resp = await evaluateReadinessAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/approvals', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);

    const body = z
      .object({
        target: alphaRefSchema,
        protected_action: protectedActionSchema,
        proposed_action: z.string().min(1),
        evidence_refs: z.array(z.any()).optional(),
        policy_refs: z.array(z.string()).optional(),
        step_up_required: z.boolean().optional(),
        rationale: z.string().optional(),
        approval_chain: z.array(approvalChainStepSchema).optional(),
        current_approval_step: z.string().optional()
      })
      .parse(req.body ?? {}) as ApprovalRequest;
    const resp = await requestApprovalAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/approvals/:approvalId/decision', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);

    const approvalId = z.string().uuid().parse((req.params as any).approvalId);
    const body = z
      .object({
        decision: z.enum(['approved', 'rejected']),
        notes: z.string().optional(),
        step_up_verified: z.boolean().optional(),
        residual_risks_acknowledged: z.boolean().optional(),
        approval_step: z.string().optional()
      })
      .parse(req.body ?? {}) as ApprovalDecisionRequest;
    const resp = await decideApprovalAlpha(pool, { orgId, userId: user.user_id, traceId, approvalId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/execution/tasks', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        title: z.string().min(1),
        summary: z.string().optional(),
        trade_id: z.string().uuid().nullable().optional(),
        target: alphaRefSchema.optional(),
        assigned_to_role: z.string().optional(),
        assigned_to_user_id: z.string().uuid().optional(),
        due_at: z.string().optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
        external_participant: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
            role: z.string().min(1),
            scopes: z.array(z.string()).min(1)
          })
          .optional(),
        evidence_refs: z.array(z.any()).optional()
      })
      .parse(req.body ?? {}) as ExecutionTaskRequest;
    const resp = await createExecutionTaskAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/execution/tasks/:taskId/status', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const taskId = z.string().uuid().parse((req.params as any).taskId);
    const body = z
      .object({
        status: alphaStatusSchema,
        note: z.string().optional(),
        execution_action: executionActionSchema.optional(),
        operator_confirmation: z.boolean().optional(),
        residual_risks_acknowledged: z.boolean().optional(),
        external_reference: z.string().optional(),
        idempotency_key: z.string().optional()
      })
      .parse(req.body ?? {}) as ExecutionTaskStatusRequest;
    const resp = await updateExecutionTaskStatusAlpha(pool, { orgId, userId: user.user_id, traceId, taskId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/external-access/grants', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);

    const body = z
      .object({
        target: alphaRefSchema,
        trade_id: z.string().uuid().nullable().optional(),
        participant: z.object({
          name: z.string().optional(),
          email: z.string().optional(),
          role: z.string().min(1)
        }),
        scopes: z.array(z.string()).min(1),
        expires_at: z.string().optional(),
        reason: z.string().optional()
      })
      .parse(req.body ?? {}) as ExternalAccessGrantRequest;
    const resp = await createExternalAccessGrantAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/external-access/grants/:grantId/revoke', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops']);

    const grantId = z.string().uuid().parse((req.params as any).grantId);
    const body = z
      .object({
        reason: z.string().min(1)
      })
      .parse(req.body ?? {}) as ExternalAccessRevokeRequest;
    const resp = await revokeExternalAccessGrantAlpha(pool, { orgId, userId: user.user_id, traceId, grantId, body });
    return reply.status(200).send(resp);
  });

  app.get('/v1/external-participants/session', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const token = z.string().min(1).parse((req.query as any)?.token);
    const resp = await getExternalParticipantSessionAlpha(pool, { token, traceId });
    return reply.status(200).send(resp);
  });

  app.post('/v1/external-participants/execution-tasks/:taskId/updates', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const taskId = z.string().uuid().parse((req.params as any).taskId);
    const body = z
      .object({
        token: z.string().min(1),
        status: z.enum(['in_progress', 'ready_for_review', 'blocked']).optional(),
        note: z.string().min(1)
      })
      .parse(req.body ?? {});
    const { token, ...update } = body;
    const resp = await submitExternalExecutionTaskUpdateAlpha(pool, { token, traceId, taskId, body: update as ExternalParticipantTaskUpdateRequest });
    return reply.status(200).send(resp);
  });

  app.post('/v1/external-participants/onboarding-evidence', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const body = z
      .object({
        token: z.string().min(1),
        filename: z.string().min(1),
        mime_type: z.string().optional(),
        text: z.string().min(1),
        evidence_type: z.string().optional(),
        completed_fields: z.array(z.string().min(1)).optional(),
        submitted_by: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
            role: z.string().optional()
          })
          .optional()
      })
      .parse(req.body ?? {});
    const { token, ...submission } = body;
    const resp = await submitExternalOnboardingEvidenceAlpha(pool, { token, traceId, body: submission as ExternalOnboardingEvidenceRequest });
    return reply.status(200).send(resp);
  });

  app.post('/v1/external-participants/document-requests/:requestId/submissions', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const requestId = z.string().uuid().parse((req.params as any).requestId);
    const body = z
      .object({
        token: z.string().min(1),
        filename: z.string().min(1),
        mime_type: z.string().optional(),
        text: z.string().min(1),
        submitted_by: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
            role: z.string().optional()
          })
          .optional()
      })
      .parse(req.body ?? {});
    const { token, ...submission } = body;
    const resp = await submitExternalDocumentRequestAlpha(pool, { token, traceId, requestId, body: submission });
    return reply.status(200).send(resp);
  });

  app.post('/v1/document-requests', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        title: z.string().min(1),
        summary: z.string().optional(),
        trade_id: z.string().uuid().nullable().optional(),
        task_id: z.string().uuid().optional(),
        requested_items: z.array(z.string().min(1)).min(1),
        due_at: z.string().optional(),
        reason: z.string().optional(),
        requested_from: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
            role: z.string().min(1)
          })
          .optional()
      })
      .parse(req.body ?? {}) as DocumentRequestCreateRequest;
    const resp = await createDocumentRequestAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/document-requests/:requestId/submissions', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const requestId = z.string().uuid().parse((req.params as any).requestId);
    const body = z
      .object({
        filename: z.string().min(1),
        mime_type: z.string().optional(),
        text: z.string().min(1),
        submitted_by: z
          .object({
            name: z.string().optional(),
            email: z.string().optional(),
            role: z.string().optional()
          })
          .optional()
      })
      .parse(req.body ?? {}) as DocumentRequestSubmissionRequest;
    const resp = await submitDocumentRequestAlpha(pool, { orgId, userId: user.user_id, traceId, requestId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/proofs/bundles', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'auditor']);

    const body = z
      .object({
        trade_id: z.string().uuid().optional(),
        object_ids: z.array(z.string().uuid()).optional(),
        title: z.string().optional(),
        shareable: z.boolean().optional()
      })
      .refine((v) => Boolean(v.trade_id || (v.object_ids && v.object_ids.length > 0)), { message: 'trade_id or object_ids is required' })
      .parse(req.body ?? {}) as GenerateProofBundleRequest;
    const resp = await generateProofBundleAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/proofs/share-requests', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops']);

    const body = z
      .object({
        proof_bundle_id: z.string().uuid(),
        recipient: z.object({
          name: z.string().optional(),
          email: z.string().email().optional(),
          role: z.string().min(1)
        }),
        scopes: z.array(z.string().min(1)).optional(),
        reason: z.string().optional(),
        expires_at: z.string().datetime().optional()
      })
      .parse(req.body ?? {}) as ProofShareRequest;
    const resp = await requestProofShareAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/agents/tasks', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);

    const body = z
      .object({
        objective: z.string().min(1),
        input_objects: z.array(z.string().uuid()).optional(),
        permitted_tools: z.array(z.string()).optional(),
        data_access: z.array(z.string()).optional(),
        write_permissions: z.array(z.string()).optional(),
        approval_gates: z.array(protectedActionSchema).optional(),
        trade_id: z.string().uuid().nullable().optional(),
        time_budget_seconds: z.number().int().positive().optional()
      })
      .parse(req.body ?? {}) as AgentTaskRequest;
    const resp = await launchAgentTaskAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/intelligence/run', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        message: z.string().min(1),
        workspace: originWorkspaceSchema.optional(),
        trade_id: z.string().uuid().nullable().optional(),
        object_ids: z.array(z.string().uuid()).optional(),
        mode: z.enum(['copilot', 'plan', 'agent']).optional(),
        model: z.string().min(1).max(64).optional(),
        agent: z.string().min(1).max(64).optional(),
        history: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) }))
          .max(20)
          .optional()
      })
      .parse(req.body ?? {}) as IntelligenceRunRequest;
    const resp = await runIntelligenceAlpha(pool, { orgId, userId: user.user_id, traceId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/intelligence/stream', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'member']);

    const body = z
      .object({
        message: z.string().min(1),
        workspace: originWorkspaceSchema.optional(),
        trade_id: z.string().uuid().nullable().optional(),
        mode: z.enum(['copilot', 'plan', 'agent']).optional(),
        model: z.string().min(1).max(64).optional(),
        agent: z.string().min(1).max(64).optional(),
        history: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000) }))
          .max(20)
          .optional()
      })
      .parse(req.body ?? {}) as IntelligenceRunRequest;

    reply.hijack();
    // hijack() bypasses the CORS onSend hook, so set the header on the raw response.
    const reqOrigin = (req.headers.origin as string | undefined) ?? '';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(reqOrigin ? { 'Access-Control-Allow-Origin': reqOrigin, Vary: 'Origin' } : {})
    });
    const emit = (event: Record<string, unknown>) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await runIntelligenceStream(pool, { orgId, userId: user.user_id, traceId, body }, emit);
    } catch (err) {
      emit({ type: 'error', message: 'The intelligence service hit an error. Please try again.' });
    } finally {
      reply.raw.end();
    }
  });

  app.get('/v1/evals/trade-brain/suites', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    requireRequestRole(req, ['owner', 'admin', 'ops', 'auditor']);

    const resp = await listTradeBrainEvalSuites({ traceId });
    return reply.status(200).send(resp);
  });

  app.post('/v1/evals/trade-brain/run', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops']);

    const body = z
      .object({
        suite_id: z.string().min(1).optional(),
        persist: z.boolean().optional()
      })
      .parse(req.body ?? {}) as RunTradeBrainEvalRequest;
    const resp = await runTradeBrainEvalSuite(pool, { orgId, userId: user.user_id, traceId, suiteId: body.suite_id, persist: body.persist });
    return reply.status(200).send(resp);
  });

  app.get('/v1/evals/trade-brain/runs', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops', 'auditor']);

    const q = req.query as any;
    const query = {
      suite_id: q.suite_id ? z.string().min(1).parse(q.suite_id) : undefined,
      status: q.status ? evalStatusSchema.parse(q.status) : undefined,
      limit: q.limit ? z.coerce.number().int().min(1).max(200).parse(q.limit) : undefined
    } satisfies ListTradeBrainEvalRunsRequest;
    const resp = await listTradeBrainEvalRuns(pool, { orgId, userId: user.user_id, traceId, query });
    return reply.status(200).send(resp);
  });

  app.post('/v1/demo/internal-alpha', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);

    const body = z.object({ messy_input: z.string().optional(), scenario_id: alphaScenarioSchema.optional() }).parse(req.body ?? {});
    const resp = await runInternalAlphaDemo(pool, { orgId, userId: user.user_id, traceId, messyInput: body.messy_input, scenarioId: body.scenario_id });
    return reply.status(200).send(resp);
  });

  // ---- SSE ----
  app.get('/v1/events', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const tradeId = z.string().uuid().optional().parse((req.query as any)?.trade_id);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache'
    });

    const sub = eventHub.subscribe({ orgId, tradeId }, (ev) => {
      reply.raw.write(`id: ${ev.event_id}\n`);
      reply.raw.write(`event: message\n`);
      reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    });

    // heartbeat
    const hb = setInterval(() => {
      reply.raw.write(`: ping ${traceId}\n\n`);
    }, 15000);

    req.raw.on('close', () => {
      clearInterval(hb);
      sub.unsubscribe();
    });
  });

  // ---- File proxy (local dev + optional Supabase) ----
  app.get('/v1/files', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const url = z.string().min(1).parse((req.query as any)?.url);

    let bucket: string;
    try {
      bucket = parseStorageUrl(url).bucket;
    } catch {
      return reply.status(400).send(err('invalid_url', 'Invalid storage URL', traceId));
    }
    const authorized = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      if (bucket === 'reports') {
        const res = await client.query('SELECT 1 FROM compliance_reports WHERE org_id=$1 AND pdf_url=$2 LIMIT 1', [orgId, url]);
        return Boolean(res.rows[0]);
      }
      if (bucket === 'bundles') {
        const res = await client.query('SELECT 1 FROM proof_bundles WHERE org_id=$1 AND bundle_url=$2 LIMIT 1', [orgId, url]);
        return Boolean(res.rows[0]);
      }
      if (bucket === 'exports') {
        const res = await client.query('SELECT 1 FROM ledger_exports WHERE org_id=$1 AND url=$2 LIMIT 1', [orgId, url]);
        return Boolean(res.rows[0]);
      }
      if (bucket === 'evidence') {
        const res = await client.query('SELECT 1 FROM passport_documents WHERE org_id=$1 AND file_url=$2 LIMIT 1', [orgId, url]);
        return Boolean(res.rows[0]);
      }
      if (bucket === 'documents' || bucket === 'document-packs') {
        const res = await client.query(
          `SELECT 1
           FROM alpha_objects
           WHERE org_id=$1
             AND type = ANY($2::text[])
             AND (payload_json->>'file_url'=$3 OR payload_json #>> '{storage,url}' = $3)
           LIMIT 1`,
          [orgId, url.includes('document-packs') ? ['document_pack'] : ['document', 'document_pack'], url]
        );
        return Boolean(res.rows[0]);
      }
      return false;
    });

    if (!authorized) return reply.status(404).send(err('not_found', 'File not found', traceId));

    const bytes = await storage.getObjectByUrl(url);
    const filename = guessFilename(url);
    reply.header('Content-Type', guessContentType(filename));
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.status(200).send(bytes);
  });

  // ---- Compliance ----
  app.post('/v1/compliance/check', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops', 'finance']);
    const body = z.object({ trade_id: z.string().uuid(), policy_id: z.string().optional(), flags: z.any().optional() }).parse(req.body ?? {}) as ComplianceRequest;

    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idemKey) {
      const idem = await getIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/compliance/check',
        key: idemKey,
        requestHash: hashBody(body)
      });
      if (idem) return reply.status(idem.status_code).send(idem.response_json);
    }

    const resp = await runCompliance(pool, storage, { orgId, userId: user.user_id, traceId, profile, input: body });

    if (idemKey) {
      await putIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/compliance/check',
        key: idemKey,
        requestHash: hashBody(body),
        statusCode: 200,
        responseJson: resp
      });
    }

    return reply.status(200).send(resp satisfies ComplianceResponse);
  });

  app.post('/v1/clearance/checks/:clearanceCheckId/evaluate', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops', 'finance']);
    const clearanceCheckId = z.string().uuid().parse((req.params as any).clearanceCheckId);
    const body = z
      .object({
        rule_pack_id: z.string().optional(),
        corridor: z.string().optional(),
        available_evidence: z.array(z.string().min(1)).optional(),
        subject: z.string().optional()
      })
      .parse(req.body ?? {}) as EvaluateClearanceCheckRequest;
    const resp = await evaluateClearanceCheckAlpha(pool, { orgId, userId: user.user_id, traceId, clearanceCheckId, body });
    return reply.status(200).send(resp);
  });

  app.get('/v1/compliance/reports/:tradeId', async (req, reply) => {
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const tradeId = (req.params as any)['tradeId'] as string;
    const format = ((req.query as any)?.format as string | undefined) ?? 'pdf';
    const data = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      const res = await client.query('SELECT json_blob, pdf_url FROM compliance_reports WHERE trade_id=$1 ORDER BY created_at DESC LIMIT 1', [
        tradeId
      ]);
      return res.rows[0] ?? null;
    });
    if (!data) return reply.status(404).send(err('not_found', 'Report not found', (req as any).trace_id));
    if (format === 'json') return reply.status(200).send(data.json_blob);
    if (!data.pdf_url) return reply.status(404).send(err('not_found', 'PDF not available', (req as any).trace_id));
    const file = await storage.getObjectByUrl(data.pdf_url);
    reply.header('Content-Type', 'application/pdf');
    return reply.status(200).send(file);
  });

  // ---- Finance / STF ----
  app.get('/v1/finance/funding', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const limitRaw = Number((req.query as any)?.limit);
    const resp = await listFunding(pool, { orgId, userId: user.user_id, limit: Number.isFinite(limitRaw) ? limitRaw : undefined });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.post('/v1/finance/offers', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z
      .object({ trade_id: z.string().uuid(), amount: z.number().positive(), tenor_days: z.number().int().positive(), sustainable: z.any().optional() })
      .parse(req.body ?? {}) as OfferRequest;

    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idemKey) {
      const idem = await getIdempotentResponse(pool, { orgId, userId: user.user_id, route: 'POST /v1/finance/offers', key: idemKey, requestHash: hashBody(body) });
      if (idem) return reply.status(idem.status_code).send(idem.response_json);
    }

    const resp = await requestOffers(pool, { orgId, userId: user.user_id, traceId, profile, input: body });

    if (idemKey) {
      await putIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/finance/offers',
        key: idemKey,
        requestHash: hashBody(body),
        statusCode: 200,
        responseJson: resp
      });
    }

    return reply.status(200).send(resp satisfies OfferResponse);
  });

  app.post('/v1/finance/offers/:offerId/accept', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const offerId = (req.params as any)['offerId'] as string;
    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (!idemKey) return reply.status(400).send(err('missing_idempotency', 'X-Idempotency-Key is required', traceId));

    const idem = await getIdempotentResponse(pool, { orgId, userId: user.user_id, route: `POST /v1/finance/offers/${offerId}/accept`, key: idemKey, requestHash: hashBody(req.body ?? {}) });
    if (idem) return reply.status(idem.status_code).send(idem.response_json);

    const resp = await acceptOffer(pool, { orgId, userId: user.user_id, traceId, offerId });

    await putIdempotentResponse(pool, {
      orgId,
      userId: user.user_id,
      route: `POST /v1/finance/offers/${offerId}/accept`,
      key: idemKey,
      requestHash: hashBody(req.body ?? {}),
      statusCode: 200,
      responseJson: resp
    });

    return reply.status(200).send(resp);
  });

  app.post('/v1/sustainability/evidence', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const body = z.any().parse(req.body ?? {});
    const resp = await upsertEvidence(pool, { orgId, userId: user.user_id, traceId, input: body });
    return reply.status(200).send(resp);
  });

  app.delete('/v1/sustainability/evidence/:evidenceId', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const evidenceId = (req.params as any)['evidenceId'] as string;
    await deleteEvidence(pool, { orgId, userId: user.user_id, evidenceId });
    return reply.status(204).send();
  });

  app.post('/v1/sustainability/evidence/grade', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const body = z.any().parse(req.body ?? {});
    const resp = await gradeEvidence(pool, { orgId, userId: user.user_id, traceId, profile, input: body });
    return reply.status(200).send(resp);
  });

  // ---- Payments ----
  app.get('/v1/payments', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const limitRaw = Number((req.query as any)?.limit);
    const resp = await listPayments(pool, { orgId, userId: user.user_id, limit: Number.isFinite(limitRaw) ? limitRaw : undefined });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.post('/v1/payments/routes', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z.any().parse(req.body ?? {}) as RoutesRequest;
    const resp = await computeRoutes(pool, { orgId, userId: user.user_id, traceId, profile, input: body });
    return reply.status(200).send(resp satisfies RoutesResponse);
  });

  // ---- Bank connectivity (AIS/PIS) ----
  app.post('/v1/banks/link', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z
      .object({
        type: z.enum(['AIS', 'PIS']),
        provider: z.string().optional(),
        redirect_url: z.string().url().optional(),
        trade_id: z.string().uuid().optional()
      })
      .parse(req.body ?? {});

    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idemKey) {
      const idem = await getIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/banks/link',
        key: idemKey,
        requestHash: hashBody(body)
      });
      if (idem) return reply.status(idem.status_code).send(idem.response_json);
    }

    const resp = await startBankConsent(pool, { orgId, userId: user.user_id, traceId, profile, body });

    const response = { ...resp, trace_id: traceId };
    if (idemKey) {
      await putIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/banks/link',
        key: idemKey,
        requestHash: hashBody(body),
        statusCode: 200,
        responseJson: response
      });
    }

    return reply.status(200).send(response);
  });

  app.post('/v1/banks/exchange', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z.object({ consent_id: z.string().uuid(), code: z.string().min(1), state: z.string().optional() }).parse(req.body ?? {});

    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (idemKey) {
      const idem = await getIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/banks/exchange',
        key: idemKey,
        requestHash: hashBody(body)
      });
      if (idem) return reply.status(idem.status_code).send(idem.response_json);
    }

    const resp = await exchangeBankConsent(pool, { orgId, userId: user.user_id, traceId, profile, body });

    const response = { ...resp, trace_id: traceId };
    if (idemKey) {
      await putIdempotentResponse(pool, {
        orgId,
        userId: user.user_id,
        route: 'POST /v1/banks/exchange',
        key: idemKey,
        requestHash: hashBody(body),
        statusCode: 200,
        responseJson: response
      });
    }

    return reply.status(200).send(response);
  });

  app.get('/v1/banks/consents', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const resp = await listConsents(pool, { orgId, userId: user.user_id });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.delete('/v1/banks/consents/:consentId', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const consentId = (req.params as any)['consentId'] as string;
    await revokeConsent(pool, { orgId, userId: user.user_id, traceId, consentId });
    return reply.status(204).send();
  });

  app.get('/v1/banks/accounts', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const resp = await listAccounts(pool, { orgId, userId: user.user_id });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.post('/v1/banks/manual/accounts', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z
      .object({
        iban: z.string().min(8),
        currency: z.string().min(3).default('EUR'),
        name: z.string().optional(),
        bank_name: z.string().optional(),
        type: z.string().optional()
      })
      .parse(req.body ?? {});
    const out = await createManualAccount(pool, { orgId, userId: user.user_id, body });
    return reply.status(200).send({ ...out, trace_id: traceId });
  });

  app.get('/v1/banks/accounts/:accountId/balances', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const accountId = (req.params as any)['accountId'] as string;
    const resp = await getBalances(pool, { orgId, userId: user.user_id, profile, accountId });
    return reply.status(200).send({ balance: resp ?? null, trace_id: traceId });
  });

  app.get('/v1/banks/accounts/:accountId/transactions', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const accountId = (req.params as any)['accountId'] as string;
    const from = (req.query as any)?.from as string | undefined;
    const to = (req.query as any)?.to as string | undefined;
    const cursor = (req.query as any)?.cursor as string | undefined;
    const resp = await getTransactions(pool, { orgId, userId: user.user_id, profile, accountId, from, to, cursor });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.post('/v1/payments/execute', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z.any().parse(req.body ?? {}) as ExecutePaymentRequest;
    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (!idemKey) return reply.status(400).send(err('missing_idempotency', 'X-Idempotency-Key is required', traceId));

    const idem = await getIdempotentResponse(pool, { orgId, userId: user.user_id, route: 'POST /v1/payments/execute', key: idemKey, requestHash: hashBody(body) });
    if (idem) return reply.status(idem.status_code).send(idem.response_json);

    const resp = await executePayment(pool, { orgId, userId: user.user_id, traceId, profile, input: body, idempotencyKey: idemKey });

    await putIdempotentResponse(pool, {
      orgId,
      userId: user.user_id,
      route: 'POST /v1/payments/execute',
      key: idemKey,
      requestHash: hashBody(body),
      statusCode: 200,
      responseJson: resp
    });

    return reply.status(200).send(resp);
  });

  app.post('/v1/payments/intents/:paymentIntentId/execute', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const paymentIntentId = z.string().uuid().parse((req.params as any).paymentIntentId);
    const body = z
      .object({
        approval_id: z.string().uuid(),
        route_id: z.string().min(1).optional(),
        from_account_id: z.string().uuid(),
        creditor_name: z.string().min(1).optional(),
        creditor_iban: z.string().min(8).optional(),
        amount: z.number().positive().optional(),
        currency: z.string().min(3).optional(),
        remittance: z.string().optional(),
        e2e_id: z.string().min(1).optional()
      })
      .parse(req.body ?? {}) as ExecutePaymentIntentRequest;
    const idemKey = req.headers['x-idempotency-key'] as string | undefined;
    if (!idemKey) return reply.status(400).send(err('missing_idempotency', 'X-Idempotency-Key is required', traceId));

    const route = 'POST /v1/payments/intents/:paymentIntentId/execute';
    const requestHash = hashBody({ payment_intent_id: paymentIntentId, ...body });
    const idem = await getIdempotentResponse(pool, { orgId, userId: user.user_id, route, key: idemKey, requestHash });
    if (idem) return reply.status(idem.status_code).send(idem.response_json);

    const resp = await executeApprovedPaymentIntentAlpha(pool, {
      orgId,
      userId: user.user_id,
      traceId,
      profile,
      paymentIntentId,
      body,
      idempotencyKey: idemKey
    });

    await putIdempotentResponse(pool, {
      orgId,
      userId: user.user_id,
      route,
      key: idemKey,
      requestHash,
      statusCode: 200,
      responseJson: resp
    });

    return reply.status(200).send(resp);
  });

  app.get('/v1/payments/status/:paymentId', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const paymentId = (req.params as any)['paymentId'] as string;
    const resp = await getPaymentStatus(pool, { orgId, userId: user.user_id, traceId, paymentId });
    return reply.status(200).send(resp);
  });

  app.post('/v1/payments/manual/complete', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    if (!profile.payments.manual.allow_completion) return reply.status(404).send(err('not_found', 'Not found', traceId));
    const body = z
      .object({ payment_id: z.string().uuid(), status: z.enum(['executed', 'failed']).default('executed') })
      .parse(req.body ?? {});
    const resp = await completeManualPayment(pool, { orgId, userId: user.user_id, traceId, paymentId: body.payment_id, status: body.status });
    return reply.status(200).send(resp);
  });

  app.get('/v1/payments/:paymentId', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const paymentId = (req.params as any)['paymentId'] as string;
    const resp = await getPaymentDetails(pool, { orgId, userId: user.user_id, paymentId });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.post('/v1/payments/refund', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z.object({ payment_id: z.string().uuid(), amount: z.number().positive().optional(), reason: z.string().optional() }).parse(req.body ?? {});
    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('UPDATE payments SET status=$1 WHERE payment_id=$2', ['refunded', body.payment_id]);
      await client.query('INSERT INTO payment_attempts(org_id, payment_id, status, code, raw) VALUES($1,$2,$3,$4,$5)', [
        orgId,
        body.payment_id,
        'refunded',
        null,
        JSON.stringify({ amount: body.amount ?? null, reason: body.reason ?? null })
      ]);
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) SELECT $1, org_id, trade_id, $2, $3, $4, $5 FROM payments WHERE payment_id=$6', [
        cryptoUuid(),
        'payment.refunded',
        traceId,
        `user:${user.user_id}`,
        JSON.stringify({ payment_id: body.payment_id, trace_id: traceId }),
        body.payment_id
      ]);
    });
    return reply.status(200).send({ ok: true, trace_id: traceId });
  });

  app.post('/v1/payments/beneficiary/verify', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z.object({ name: z.string().min(1), iban: z.string().min(8) }).parse(req.body ?? {});
    return reply.status(200).send({ match: 'yes', notes: 'MVP mock verification', trace_id: traceId });
  });

  app.post('/v1/payments/mock/sca-complete', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    if ((process.env.AUTH_MODE ?? 'dev') !== 'dev') return reply.status(404).send(err('not_found', 'Not found', traceId));
    const body = z.object({ payment_id: z.string().uuid(), status: z.enum(['executed', 'failed']).default('executed') }).parse(req.body ?? {});
    const resp = await mockScaComplete(pool, { orgId, userId: user.user_id, traceId, paymentId: body.payment_id, status: body.status });
    return reply.status(200).send(resp);
  });

  // ---- Ledger / Proofs ----
  app.get('/v1/ledger/proofs', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const tradeId = z.string().uuid().parse((req.query as any)?.trade_id);
    const resp = await getOrBuildBundle(pool, storage, {
      orgId,
      userId: user.user_id,
      traceId,
      profile,
      tradeId
    });
    return reply.status(200).send(resp satisfies LedgerProofsResponse);
  });

  app.post('/v1/ledger/verify', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const mp = await req.file();
    if (!mp) return reply.status(400).send(err('missing_file', 'bundle.zip is required', traceId));
    const zipBytes = await mp.toBuffer();
    const off = await verifyBundleZip(zipBytes, { ed25519_public_key_pem: process.env.LEDGER_MANIFEST_SIGNING_PUBLIC_KEY });
    let anchored: LedgerVerifyResponse | null = null;
    const tx = (req.query as any)?.tx as string | undefined;
    if (tx && process.env.EVM_RPC_URL) {
      const chain = await verifyAnchorTx({ txHash: tx, rpcUrl: process.env.EVM_RPC_URL, registryAddress: process.env.EVM_ANCHOR_REGISTRY_ADDRESS });
      anchored = {
        valid: off.valid && chain.root === off.root,
        reasons: [...off.reasons, ...(chain.root === off.root ? [] : ['On-chain root mismatch'])],
        root: off.root,
        anchored: chain.ok,
        network: 'xdc',
        tx,
        bundle_sha256: off.bundleSha256
      };
    }
    const out: LedgerVerifyResponse = anchored ?? {
      valid: off.valid,
      reasons: off.reasons,
      root: off.root,
      anchored: false,
      bundle_sha256: off.bundleSha256
    };
    return reply.status(200).send(out);
  });

  app.post('/v1/ledger/proofs/verify', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops', 'auditor']);
    const body = z
      .object({
        trade_id: z.string().uuid().optional(),
        bundle_url: z.string().min(1).optional()
      })
      .refine((value) => Boolean(value.trade_id || value.bundle_url), { message: 'trade_id or bundle_url is required' })
      .parse(req.body ?? {}) as LedgerVerifyStoredRequest;
    const resp = await verifyStoredBundle(pool, storage, {
      orgId,
      userId: user.user_id,
      traceId,
      tradeId: body.trade_id,
      bundleUrl: body.bundle_url,
      verifier: (bytes) => verifyBundleZip(bytes, { ed25519_public_key_pem: process.env.LEDGER_MANIFEST_SIGNING_PUBLIC_KEY })
    });
    return reply.status(200).send(resp satisfies LedgerVerifyStoredResponse);
  });

  app.get('/v1/ledger/anchors', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'auditor']);
    const since = (req.query as any)?.since as string | undefined;
    const resp = await listAnchors(pool, { orgId, userId: user.user_id, since });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.post('/v1/ledger/export', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'auditor']);
    const body = z.object({ trade_ids: z.array(z.string().uuid()).min(1) }).parse(req.body ?? {});
    const resp = await exportLedger(pool, storage, { orgId, userId: user.user_id, traceId, tradeIds: body.trade_ids });
    return reply.status(200).send({ ...resp, trade_count: body.trade_ids.length, trace_id: traceId } satisfies LedgerExportResponse);
  });

  // ---- Reports ----
  app.get('/v1/reports/sustainable-finance', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const tradeId = z.string().uuid().parse((req.query as any)?.trade_id);
    const type = z.enum(['uop', 'sltf']).parse((req.query as any)?.type);
    const format = ((req.query as any)?.format as string | undefined) ?? 'pdf';
    const out = await getOrBuildSustainableFinanceReport(pool, storage, { orgId, userId: user.user_id, tradeId, type });
    if (format === 'json') return reply.status(200).send(out.json);
    const pdf = await storage.getObjectByUrl(out.pdf_url);
    reply.header('Content-Type', 'application/pdf');
    return reply.status(200).send(pdf);
  });

  // ---- Trade Passport + KYB/KYC ----
  app.post('/v1/passport/documents', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string; email?: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const type = ((req.query as any)?.type as string | undefined) ?? undefined;
    const mp = await req.file();
    if (!mp) return reply.status(400).send(err('missing_file', 'file is required', traceId));
    const buf = await mp.toBuffer();

    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('INSERT INTO app_users(user_id, email) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET email=excluded.email', [
        user.user_id,
        user.email ?? null
      ]);
    });

    const out = await uploadPassportDocument(pool, storage, { orgId, userId: user.user_id, mime: mp.mimetype, bytes: buf, filename: mp.filename, type });
    return reply.status(200).send({ ...out, trace_id: traceId });
  });

  app.post('/v1/kyb/verify', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string; email?: string };
    requireRequestRole(req, ['owner', 'admin', 'ops']);
    const body = z.object({ vendor: z.string().optional() }).parse(req.body ?? {});

    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('INSERT INTO app_users(user_id, email) VALUES($1,$2) ON CONFLICT (user_id) DO UPDATE SET email=excluded.email', [
        user.user_id,
        user.email ?? null
      ]);
    });

    const out = await startKybVerification(pool, { orgId, userId: user.user_id, vendor: body.vendor });
    return reply.status(200).send({ ...out, trace_id: traceId });
  });

  app.get('/v1/kyb/status', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance', 'ops']);
    const out = await getKybStatus(pool, { orgId, userId: user.user_id });
    return reply.status(200).send({ status: out ?? null, trace_id: traceId });
  });

  // ---- Allocation ----
  app.post('/v1/allocation/score', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const body = z.any().parse(req.body ?? {});
    const resp = await scoreAllocation(pool, { orgId, userId: user.user_id, traceId, input: body });
    return reply.status(200).send(resp);
  });

  app.get('/v1/allocation/policies', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    requireRequestRole(req, ['owner', 'admin', 'finance']);
    const rows = await withTx(pool, async (client) => {
      const res = await client.query(
        'SELECT policy_id, market, weights_json, caps_json, eligibility_json, fairness_json, risk_json, version, created_at, locked_at FROM allocation_policies ORDER BY created_at DESC LIMIT 200'
      );
      return res.rows;
    });
    return reply.status(200).send({ policies: rows, trace_id: traceId });
  });

  app.post('/v1/allocation/policies', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    requireRequestRole(req, ['owner', 'admin']);
    const body = z
      .object({
        policy_id: z.string().min(1),
        market: z.string().min(1),
        weights_json: z.any(),
        caps_json: z.any().optional(),
        eligibility_json: z.any().optional(),
        fairness_json: z.any().optional(),
        risk_json: z.any().optional(),
        version: z.number().int().optional()
      })
      .parse(req.body ?? {});

    await withTx(pool, async (client) => {
      await client.query(
        `INSERT INTO allocation_policies(policy_id, market, weights_json, caps_json, eligibility_json, fairness_json, risk_json, version)
         VALUES($1,$2,$3,$4,$5,$6,$7, COALESCE($8,1))
         ON CONFLICT (policy_id) DO UPDATE SET market=excluded.market, weights_json=excluded.weights_json, caps_json=excluded.caps_json, eligibility_json=excluded.eligibility_json, fairness_json=excluded.fairness_json, risk_json=excluded.risk_json, version=excluded.version`,
        [
          body.policy_id,
          body.market,
          JSON.stringify(body.weights_json),
          JSON.stringify(body.caps_json ?? null),
          JSON.stringify(body.eligibility_json ?? null),
          JSON.stringify(body.fairness_json ?? null),
          JSON.stringify(body.risk_json ?? null),
          body.version ?? null
        ]
      );
    });

    return reply.status(200).send({ ok: true, trace_id: traceId });
  });

  // ---- Network ----
  app.post('/v1/network/counterparties/:counterpartyId/trust-context', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    requireRequestRole(req, ['owner', 'admin', 'ops']);
    const counterpartyId = z.string().uuid().parse((req.params as any).counterpartyId);
    const body = z
      .object({
        onboarding_flow_id: z.string().uuid().optional(),
        screening_result_id: z.string().uuid().optional(),
        passport_visibility: z.enum(['internal', 'controlled_external', 'network']).optional(),
        invite: z
          .object({
            name: z.string().optional(),
            email: z.string().email(),
            role: z.string().min(1),
            scopes: z.array(z.string().min(1)).optional(),
            reason: z.string().optional()
          })
          .optional(),
        match_context: z
          .object({
            corridor: z.string().optional(),
            domain: z.string().optional()
          })
          .optional()
      })
      .parse(req.body ?? {}) as BuildNetworkTrustRequest;
    const resp = await buildNetworkTrustAlpha(pool, { orgId, userId: user.user_id, traceId, counterpartyId, body });
    return reply.status(200).send(resp);
  });

  app.post('/v1/network/match', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };
    const body = z.object({ trade_id: z.string().uuid(), domain: z.enum(['finance', 'payments', 'logistics', 'sourcing']), top_k: z.number().int().optional() }).parse(req.body ?? {});
    const data = await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      const res = await client.query('SELECT partner_id, display_name, domains, corridors, rails, stf_ready FROM partners ORDER BY created_at DESC LIMIT $1', [
        body.top_k ?? 10
      ]);
      return res.rows;
    });
    const shortlist = data.map((p: any) => ({
      partner_id: p.partner_id,
      display_name: p.display_name,
      badges: [p.stf_ready ? 'STF-ready' : undefined].filter(Boolean),
      score: 0.7,
      reasons: ['Pilot shortlist'],
      trust: { sanctions: 'clear' }
    }));

    const ev: SSEEvent = {
      event_id: cryptoUuid(),
      type: 'network.matched',
      ts: new Date().toISOString(),
      org_id: orgId,
      trade_id: body.trade_id,
      trace_id: traceId,
      actor: `user:${user.user_id}`,
      data: { trade_id: body.trade_id, domain: body.domain, count: shortlist.length, trace_id: traceId }
    };
    await withTx(pool, async (client) => {
      await setAppContext(client, { userId: user.user_id, orgId });
      await client.query('INSERT INTO trade_events(event_id, org_id, trade_id, type, trace_id, actor, data) VALUES($1,$2,$3,$4,$5,$6,$7)', [
        ev.event_id,
        orgId,
        body.trade_id,
        ev.type,
        traceId,
        ev.actor,
        JSON.stringify(ev.data)
      ]);
    });

    return reply.status(200).send({ trade_id: body.trade_id, domain: body.domain, shortlist, trace_id: traceId });
  });

  // ---- Admin: partner bootstrap (MVP) ----
  app.post('/v1/admin/partners/bootstrap', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const orgId = (req as any).org_id as string;
    const user = (req as any).user as { user_id: string };

    const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
    const isDev = (process.env.AUTH_MODE ?? 'dev').toLowerCase() === 'dev';
    if (!isDev && !secret) return reply.status(403).send(err('forbidden', 'Not enabled', traceId));
    if (secret) {
      const provided = req.headers['x-admin-secret'] as string | undefined;
      if (!provided || provided !== secret) return reply.status(403).send(err('forbidden', 'Invalid admin secret', traceId));
    }

    await requireOrgRole({ orgId, userId: user.user_id, allowed: ['owner', 'admin'] });

    const body = z
      .object({
        display_name: z.string().min(1),
        domains: z.array(z.string()).optional(),
        corridors: z.array(z.string()).optional(),
        rails: z.array(z.string()).optional(),
        stf_ready: z.boolean().optional(),
        webhook_url: z.string().url().optional(),
        push_mode: z.boolean().optional(),
        key_label: z.string().optional()
      })
      .parse(req.body ?? {});

    const resp = await adminBootstrapPartner(pool, {
      orgId,
      userId: user.user_id,
      traceId,
      body
    });
    return reply.status(200).send(resp);
  });

  // ---- Partner API ----
  app.post('/v1/partners/auth/token', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const body = z.object({ api_key: z.string().min(10) }).parse(req.body ?? {});
    const resp = await partnerAuthToken(pool, { apiKey: body.api_key, jwtSecret: process.env.PARTNER_JWT_SECRET ?? 'dev-secret', traceId });
    return reply.status(200).send(resp);
  });

  app.get('/v1/partners/offer-requests', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const partner = await partnerGetProfile(pool, { req, jwtSecret: process.env.PARTNER_JWT_SECRET ?? 'dev-secret' });
    const status = ((req.query as any)?.status as string | undefined) ?? 'pending';
    const resp = await partnerListOfferRequests(pool, { partnerId: partner.partner_id, status });
    return reply.status(200).send({ ...resp, trace_id: traceId });
  });

  app.post('/v1/partners/offer-requests/:requestId/offers', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const partner = await partnerGetProfile(pool, { req, jwtSecret: process.env.PARTNER_JWT_SECRET ?? 'dev-secret' });
    const requestId = (req.params as any)['requestId'] as string;
    const body = z.any().parse(req.body ?? {});
    const resp = await partnerSubmitOffers(pool, { partner, requestId, body, traceId });
    return reply.status(200).send(resp);
  });

  app.get('/v1/partners/profile', async (req, reply) => {
    const traceId = (req as any).trace_id as string;
    const partner = await partnerGetProfile(pool, { req, jwtSecret: process.env.PARTNER_JWT_SECRET ?? 'dev-secret' });
    return reply.status(200).send({ ...partner, trace_id: traceId });
  });

  startupStage('routes.registered');
  return app;
}

function err(code: string, message: string, traceId: string, hint?: string): ErrorResponse {
  const definition = findApiError(code);
  return {
    error: code,
    message,
    hint: hint ?? definition?.hint,
    trace_id: traceId,
    status_code: definition?.status_code,
    category: definition?.category,
    retryable: definition?.retryable,
    docs_url: definition ? `/v1/api/catalog#errors-${definition.code}` : undefined
  };
}

function cryptoUuid(): UUID {
  return randomUUID();
}

function hashBody(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
}

function coerceString(v: unknown): string | null {
  if (typeof v === 'string') {
    const trimmed = v.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function multipartFieldString(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const field = value as { value?: unknown };
  if (typeof field.value === 'string') return field.value;
  if (typeof field.value === 'number' || typeof field.value === 'boolean') return String(field.value);
  return undefined;
}

function normalizePaymentStatus(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('executed') || s.includes('settled') || s.includes('completed') || s.includes('succeeded') || s === 'acsc') return 'executed';
  if (s.includes('returned')) return 'returned';
  if (s.includes('refund')) return 'refunded';
  if (s.includes('fail') || s.includes('reject') || s.includes('cancel') || s.includes('declin') || s === 'rjct') return 'failed';
  return s;
}

function parseStorageUrl(url: string): { scheme: string; bucket: string; key: string } {
  const idx = url.indexOf('://');
  if (idx < 0) throw new Error('invalid storage url');
  const scheme = url.slice(0, idx);
  const rest = url.slice(idx + 3);
  const [bucket, ...keyParts] = rest.split('/');
  if (!bucket) throw new Error('invalid storage url');
  return { scheme, bucket, key: keyParts.join('/') };
}

function guessFilename(url: string): string {
  const { key } = parseStorageUrl(url);
  const name = key.split('/').pop();
  return name && name.length > 0 ? name : 'download.bin';
}

function guessContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.zip')) return 'application/zip';
  if (lower.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}
