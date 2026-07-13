export type UUID = string;

export * from './workflow-runtime';

export type Locale = string; // BCP-47

export interface GlassBox {
  reasons: string[];
}

export interface PendingQuestion {
  field: string;
  question: string;
  options: string[];
}

// ---- Trade plan (API + UI) ----

export interface PlanItem {
  name: string;
  qty: number;
  unit: string;
  hs_code: string | null;
  hs_candidates?: string[];
  nace_code?: string | null;
  notes?: string | null;
}

export type PartyRole = 'buyer' | 'seller' | 'carrier' | 'financier' | 'other' | (string & {});

export interface PlanParty {
  role: PartyRole;
  name?: string;
  country?: string;
  lei?: string;
}

export interface PlanTerms {
  incoterm?: string | null;
  incoterm_candidates?: string[];
  payment_terms?: string | null;
}

export interface TradePlan {
  items: PlanItem[];
  parties: PlanParty[];
  terms: PlanTerms;
  checklist: string[];
}

export type TradePlanStatus = 'ready' | 'needs_input';

export interface ParseTradeRequest {
  intent_text: string;
  hints?: {
    corridor?: string;
    incoterms_default?: string;
    urgency?: 'instant' | 'standard';
    currency?: string;
    items?: string[];
  };
}

// ---- Trade chat ----

export type ChatRole = 'user' | 'assistant' | 'system';

export interface TradeMessage {
  message_id: UUID;
  role: ChatRole;
  text: string;
  attachments?: unknown;
  created_at: string;
}

export interface ListTradeMessagesResponse {
  messages: TradeMessage[];
  trace_id: string;
}

export interface OrgMessageItem extends TradeMessage {
  trade_id: UUID;
  trade_title?: string | null;
}

export interface ListOrgMessagesResponse {
  messages: OrgMessageItem[];
  trace_id: string;
}

export interface CreateTradeMessageRequest {
  text: string;
}

export interface CreateTradeMessageResponse {
  message: TradeMessage | null;
  trace_id: string;
}

export interface TradePlanResponse {
  trade_id: UUID;
  plan: TradePlan;
  confidence: number; // 0..1
  glass_box: GlassBox;
  pending_questions?: PendingQuestion[];
  trace_id: string;
  status: TradePlanStatus;
}

export type AmbiguityError = 'ambiguous_incoterm' | 'ambiguous_hs' | 'insufficient_context';

export interface AmbiguityResponse {
  error: AmbiguityError;
  message: string;
  questions: PendingQuestion[];
  trace_id: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  hint?: string;
  trace_id: string;
  status_code?: number;
  category?: ApiErrorCategory;
  retryable?: boolean;
  docs_url?: string;
}

export type ApiErrorCategory = 'auth' | 'validation' | 'permission' | 'idempotency' | 'protected_action' | 'not_found' | 'external' | 'system';

export interface ApiErrorDefinition {
  code: string;
  status_code: number;
  category: ApiErrorCategory;
  default_message: string;
  retryable: boolean;
  hint?: string;
}

export const API_ERROR_TAXONOMY = [
  {
    code: 'unauthorized',
    status_code: 401,
    category: 'auth',
    default_message: 'Authentication is required.',
    retryable: false,
    hint: 'Send a valid Bearer token, partner token, or scoped external participant token.'
  },
  {
    code: 'forbidden',
    status_code: 403,
    category: 'permission',
    default_message: 'The caller is not allowed to perform this action.',
    retryable: false,
    hint: 'Check org membership, RBAC role, ABAC policy, external scope, or participant target.'
  },
  {
    code: 'missing_org',
    status_code: 400,
    category: 'validation',
    default_message: 'Organization context is required.',
    retryable: false,
    hint: 'Send X-Org-Id for org-scoped endpoints.'
  },
  {
    code: 'validation_error',
    status_code: 400,
    category: 'validation',
    default_message: 'The request payload or query does not match the endpoint contract.',
    retryable: false
  },
  {
    code: 'not_found',
    status_code: 404,
    category: 'not_found',
    default_message: 'The requested resource was not found in the caller scope.',
    retryable: false
  },
  {
    code: 'request_error',
    status_code: 400,
    category: 'validation',
    default_message: 'The request could not be processed.',
    retryable: false
  },
  {
    code: 'missing_idempotency',
    status_code: 400,
    category: 'idempotency',
    default_message: 'An idempotency key is required for this write.',
    retryable: false,
    hint: 'Send X-Idempotency-Key for protected or externally consequential write routes.'
  },
  {
    code: 'idempotency_conflict',
    status_code: 409,
    category: 'idempotency',
    default_message: 'The idempotency key was reused with a different request body.',
    retryable: false,
    hint: 'Retry with the original body or create a new idempotency key for a distinct operation.'
  },
  {
    code: 'approval_required',
    status_code: 409,
    category: 'protected_action',
    default_message: 'A protected action requires explicit human approval.',
    retryable: false
  },
  {
    code: 'protected_action_not_approved',
    status_code: 409,
    category: 'protected_action',
    default_message: 'The protected action has not been approved for controlled execution.',
    retryable: false
  },
  {
    code: 'unsafe_action_blocked',
    status_code: 403,
    category: 'protected_action',
    default_message: 'TRAIBOX blocked an unsafe or externally consequential action.',
    retryable: false,
    hint: 'Use the approval flow and review evidence, risks, and policy constraints.'
  },
  {
    code: 'external_provider_error',
    status_code: 502,
    category: 'external',
    default_message: 'An upstream provider failed or returned an invalid response.',
    retryable: true
  },
  {
    code: 'internal_error',
    status_code: 500,
    category: 'system',
    default_message: 'TRAIBOX could not complete the request.',
    retryable: true
  }
] as const satisfies readonly ApiErrorDefinition[];

export type ApiErrorCode = (typeof API_ERROR_TAXONOMY)[number]['code'];

export function findApiError(code: string): ApiErrorDefinition | undefined {
  return API_ERROR_TAXONOMY.find((error) => error.code === code);
}

// ---- Orgs ----

export type OrgRole = 'owner' | 'admin' | 'finance' | 'ops' | 'member' | 'auditor' | (string & {});

export interface OrgSummary {
  org_id: UUID;
  name: string;
  country?: string | null;
  role: OrgRole;
}

export interface CreateOrgRequest {
  name: string;
  country?: string;
}

export interface CreateOrgResponse {
  org_id: UUID;
  trace_id: string;
}

export interface ListOrgsResponse {
  orgs: OrgSummary[];
  trace_id: string;
}

export interface OrgMemberSummary {
  user_id: UUID;
  email?: string | null;
  display_name?: string | null;
  role: OrgRole;
  created_at: string;
}

export interface OrgInviteSummary {
  invite_id: UUID;
  email: string;
  role: OrgRole;
  created_at: string;
  accepted_at?: string | null;
}

export interface OrgAccessResponse {
  org: OrgSummary;
  members: OrgMemberSummary[];
  invites: OrgInviteSummary[];
  trace_id: string;
}

export interface OrgInviteRequest {
  email: string;
  role?: OrgRole;
}

export interface OkResponse {
  ok: boolean;
  trace_id: string;
}

// ---- TRAIBOX internal alpha spine ----

export const OBJECT_LIFECYCLE_STATUSES = [
  'draft',
  'pending_input',
  'ready_for_review',
  'approval_required',
  'approved',
  'blocked',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
  'attached',
  'archived'
] as const;

export type ObjectLifecycleStatus = (typeof OBJECT_LIFECYCLE_STATUSES)[number];

export const ORIGIN_WORKSPACES = ['intelligence', 'trades', 'finance', 'network', 'clearance', 'operations', 'settings'] as const;

export type OriginWorkspace = (typeof ORIGIN_WORKSPACES)[number];

export const ALPHA_OBJECT_TYPES = [
  'trade_plan',
  'trade_room',
  'document_request',
  'document',
  'extraction_result',
  'document_pack',
  'clearance_check',
  'trade_passport',
  'counterparty',
  'screening_result',
  'onboarding_flow',
  'funding_request',
  'funding_offer',
  'payment_intent',
  'payment_route',
  'trade_finance_instrument',
  'approval',
  'workflow_run',
  'execution_task',
  'external_access_grant',
  'agent_task',
  'agent_work_result',
  'ai_eval_result',
  'proof_bundle',
  'matchmaking_result',
  'network',
  'report',
  'risk_finding',
  'readiness_state',
  'memory_event'
] as const;

export type AlphaObjectType = (typeof ALPHA_OBJECT_TYPES)[number];

export const ATTACH_MODES = ['attach', 'link', 'convert'] as const;

export type AttachMode = (typeof ATTACH_MODES)[number];

export const PROTECTED_ACTIONS = [
  'send_payment',
  'submit_funding_request',
  'accept_funding_offer',
  'send_documents_externally',
  'invite_external_counterparty',
  'change_verified_identity',
  'change_compliance_data',
  'release_escrow_or_conditions',
  'submit_clearance_declaration',
  'submit_compliance_declaration',
  'make_binding_trade_commitment',
  'approve_trade_execution',
  'share_proof_bundle_externally'
] as const;

export type ProtectedActionKind = (typeof PROTECTED_ACTIONS)[number];

export const TRAIBOX_API_VERSION = 'v1' as const;

export type ApiHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ApiAuthMode = 'public' | 'user' | 'org_user' | 'external_participant' | 'partner' | 'webhook';
export type ApiEndpointStability = 'alpha' | 'beta' | 'stable';
export type ApiIdempotencyPolicy = 'required' | 'recommended' | 'not_supported';

export interface ApiEndpointContract {
  method: ApiHttpMethod;
  path: `/${typeof TRAIBOX_API_VERSION}/${string}` | '/healthz' | `/webhooks/${string}`;
  operation_id: string;
  summary: string;
  workspace: OriginWorkspace | 'platform' | 'partner' | 'external';
  auth: ApiAuthMode;
  roles?: OrgRole[];
  tags: string[];
  stability: ApiEndpointStability;
  idempotency?: ApiIdempotencyPolicy;
  protected_action?: ProtectedActionKind;
  request_type?: string;
  response_type?: string;
  emits_events?: string[];
}

export const TRAIBOX_API_ENDPOINTS: readonly ApiEndpointContract[] = [
  {
    method: 'GET',
    path: '/v1/api/catalog',
    operation_id: 'getApiCatalog',
    summary: 'Return the versioned TRAIBOX API catalog, error taxonomy, and idempotency policy.',
    workspace: 'platform',
    auth: 'public',
    tags: ['API Productization'],
    stability: 'alpha',
    response_type: 'ApiCatalogResponse'
  },
  {
    method: 'GET',
    path: '/v1/openapi.json',
    operation_id: 'getOpenApiDocument',
    summary: 'Return a machine-readable OpenAPI 3.1 document generated from the TRAIBOX contract catalog.',
    workspace: 'platform',
    auth: 'public',
    tags: ['API Productization'],
    stability: 'alpha',
    response_type: 'OpenAPIObject'
  },
  {
    method: 'POST',
    path: '/v1/intelligence/run',
    operation_id: 'runIntelligence',
    summary: 'Run action-oriented Copilot orchestration and return structured trade actions.',
    workspace: 'intelligence',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Intelligence', 'Trade Brain'],
    stability: 'alpha',
    request_type: 'IntelligenceRunRequest',
    response_type: 'IntelligenceRunResponse',
    emits_events: ['memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/agents/tasks',
    operation_id: 'launchAgentTask',
    summary: 'Launch a governed scoped agent task with explicit inputs, permissions, gates, and replay output.',
    workspace: 'intelligence',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Agents', 'Governance'],
    stability: 'alpha',
    request_type: 'AgentTaskRequest',
    response_type: 'AgentTaskResponse',
    emits_events: ['agent.task.completed', 'ai.eval.completed']
  },
  {
    method: 'POST',
    path: '/v1/trade/parse',
    operation_id: 'parseTradeIntent',
    summary: 'Convert messy trade intent into a structured trade plan and pending questions.',
    workspace: 'trades',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Trades'],
    stability: 'alpha',
    request_type: 'ParseTradeRequest',
    response_type: 'TradePlanResponse'
  },
  {
    method: 'POST',
    path: '/v1/documents/extract',
    operation_id: 'extractDocument',
    summary: 'Classify and extract document data with confidence, provenance, and missing-field signals.',
    workspace: 'trades',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Documents', 'Trade Brain'],
    stability: 'alpha',
    request_type: 'DocumentExtractRequest',
    response_type: 'DocumentExtractResponse',
    emits_events: ['document.extracted', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/documents/upload',
    operation_id: 'uploadDocument',
    summary: 'Upload a trade document artifact and persist document quality/provenance metadata.',
    workspace: 'trades',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Documents'],
    stability: 'alpha',
    response_type: 'DocumentUploadResponse',
    emits_events: ['document.uploaded', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/readiness/evaluate',
    operation_id: 'evaluateReadiness',
    summary: 'Evaluate readiness for a Trade Room or standalone object and return missing/risky/next-action state.',
    workspace: 'trades',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Readiness'],
    stability: 'alpha',
    request_type: 'ReadinessEvaluateRequest',
    response_type: 'ReadinessEvaluateResponse',
    emits_events: ['readiness.evaluated', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/objects/{type}',
    operation_id: 'createAlphaObject',
    summary: 'Create a typed standalone object with origin workspace, lifecycle state, permissions, and evidence links.',
    workspace: 'platform',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Objects'],
    stability: 'alpha',
    request_type: 'CreateAlphaObjectRequest',
    response_type: 'CreateAlphaObjectResponse',
    emits_events: ['object.created', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/attachments',
    operation_id: 'attachObject',
    summary: 'Attach, link, or convert a standalone object to broader trade context without losing audit or memory.',
    workspace: 'platform',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Objects', 'Composability'],
    stability: 'alpha',
    request_type: 'AttachObjectRequest',
    response_type: 'AttachObjectResponse',
    emits_events: ['object.attached', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/approvals',
    operation_id: 'requestApproval',
    summary: 'Request human approval for a protected or governed action.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops'],
    tags: ['Approvals', 'Governance'],
    stability: 'alpha',
    request_type: 'ApprovalRequest',
    response_type: 'ApprovalResponse',
    emits_events: ['approval.requested', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/approvals/{approvalId}/decision',
    operation_id: 'decideApproval',
    summary: 'Approve or reject a protected action with step-up and residual-risk evidence.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops'],
    tags: ['Approvals', 'Governance'],
    stability: 'alpha',
    request_type: 'ApprovalDecisionRequest',
    response_type: 'ApprovalDecisionResponse',
    emits_events: ['approval.decided', 'workflow.run.created', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/proofs/bundles',
    operation_id: 'generateProofBundle',
    summary: 'Generate a trusted proof bundle from trade-bound or standalone artifacts.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Proof'],
    stability: 'alpha',
    request_type: 'GenerateProofBundleRequest',
    response_type: 'GenerateProofBundleResponse',
    emits_events: ['proof.bundle.ready', 'memory.updated']
  },
  {
    method: 'GET',
    path: '/v1/query',
    operation_id: 'queryAlphaObjects',
    summary: 'Query structured trade activity by workspace, owner, status, object type, trade context, and memory signal.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member', 'auditor'],
    tags: ['Query', 'Operations'],
    stability: 'alpha',
    request_type: 'QueryAlphaObjectsRequest',
    response_type: 'QueryAlphaObjectsResponse'
  },
  {
    method: 'GET',
    path: '/v1/replay',
    operation_id: 'queryReplay',
    summary: 'Replay object, event, memory, audit, readiness, attachment, and proof context for a trade or object.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member', 'auditor'],
    tags: ['Replay', 'Audit'],
    stability: 'alpha',
    request_type: 'ReplayQueryRequest',
    response_type: 'ReplayQueryResponse'
  },
  {
    method: 'GET',
    path: '/v1/memory/insights',
    operation_id: 'queryMemoryInsights',
    summary: 'Return L1/L2 Trade Memory insights, product lenses, and recommended actions.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member', 'auditor'],
    tags: ['Memory', 'Operations'],
    stability: 'alpha',
    request_type: 'MemoryInsightsRequest',
    response_type: 'MemoryInsightsResponse'
  },
  {
    method: 'GET',
    path: '/v1/governance/audit-chain',
    operation_id: 'verifyAuditChain',
    summary: 'Verify the tenant-scoped audit chain and return hash-link integrity results.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'ops', 'auditor'],
    tags: ['Governance', 'Audit'],
    stability: 'alpha',
    response_type: 'AuditChainVerificationResponse'
  },
  {
    method: 'POST',
    path: '/v1/execution/tasks',
    operation_id: 'createExecutionTask',
    summary: 'Create an operator-controlled execution task for governed follow-through.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops'],
    tags: ['Execution', 'Governance'],
    stability: 'alpha',
    request_type: 'ExecutionTaskRequest',
    response_type: 'ExecutionTaskResponse',
    emits_events: ['execution.task.created', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/execution/tasks/{taskId}/status',
    operation_id: 'updateExecutionTaskStatus',
    summary: 'Advance an operator-controlled execution task without TRAIBOX auto-executing protected external actions.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops'],
    tags: ['Execution', 'Governance'],
    stability: 'alpha',
    request_type: 'ExecutionTaskStatusRequest',
    response_type: 'ExecutionTaskStatusResponse',
    emits_events: ['execution.task.updated', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/external-access/grants',
    operation_id: 'createExternalAccessGrant',
    summary: 'Create a scoped guest access grant with target-bound permissions, expiry, token hash, audit, and memory.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'ops'],
    tags: ['External Access', 'Governance'],
    stability: 'alpha',
    request_type: 'ExternalAccessGrantRequest',
    response_type: 'ExternalAccessGrantResponse',
    emits_events: ['external_access.granted', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/external-access/grants/{grantId}/revoke',
    operation_id: 'revokeExternalAccessGrant',
    summary: 'Revoke a scoped guest access grant while preserving audit, proof, and memory history.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'ops'],
    tags: ['External Access', 'Governance'],
    stability: 'alpha',
    request_type: 'ExternalAccessRevokeRequest',
    response_type: 'ExternalAccessRevokeResponse',
    emits_events: ['external_access.revoked', 'memory.updated']
  },
  {
    method: 'GET',
    path: '/v1/external-participants/session',
    operation_id: 'getExternalParticipantSession',
    summary: 'Resolve a scoped guest token into the limited participant portal session.',
    workspace: 'external',
    auth: 'external_participant',
    tags: ['External Access'],
    stability: 'alpha',
    response_type: 'ExternalParticipantSessionResponse'
  },
  {
    method: 'POST',
    path: '/v1/external-participants/exchange',
    operation_id: 'exchangeExternalParticipantAccess',
    summary: 'Consume a one-time external access credential and issue a bounded server-held participant credential.',
    workspace: 'external',
    auth: 'external_participant',
    tags: ['External Access'],
    stability: 'alpha',
    response_type: 'ExternalParticipantExchangeResponse'
  },
  {
    method: 'POST',
    path: '/v1/external-participants/execution-tasks/{taskId}/updates',
    operation_id: 'submitExternalExecutionTaskUpdate',
    summary: 'Allow a scoped participant to submit task updates only for their granted execution task.',
    workspace: 'external',
    auth: 'external_participant',
    tags: ['External Access', 'Execution'],
    stability: 'alpha',
    request_type: 'ExternalParticipantTaskUpdateRequest',
    response_type: 'ExternalParticipantTaskUpdateResponse',
    emits_events: ['external_access.used', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/external-participants/document-requests/{requestId}/submissions',
    operation_id: 'submitExternalDocumentRequest',
    summary: 'Allow a scoped participant to upload requested evidence for a granted document request.',
    workspace: 'external',
    auth: 'external_participant',
    tags: ['External Access', 'Documents'],
    stability: 'alpha',
    request_type: 'DocumentRequestSubmissionRequest',
    response_type: 'DocumentRequestSubmissionResponse',
    emits_events: ['external_access.used', 'document_request.submitted', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/payments/intents/{paymentIntentId}/execute',
    operation_id: 'executePaymentIntent',
    summary: 'Prepare an approved payment intent for provider execution with idempotency and human-control gates.',
    workspace: 'finance',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance'],
    tags: ['Payments', 'Protected Actions'],
    stability: 'alpha',
    idempotency: 'required',
    protected_action: 'send_payment',
    request_type: 'ExecutePaymentIntentRequest',
    response_type: 'ExecutePaymentIntentResponse',
    emits_events: ['payment.executing', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/payments/execute',
    operation_id: 'executePayment',
    summary: 'Execute an approval-bound payment command through the payment adapter with required idempotency.',
    workspace: 'finance',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance'],
    tags: ['Payments', 'Protected Actions'],
    stability: 'alpha',
    idempotency: 'required',
    protected_action: 'send_payment',
    request_type: 'ExecutePaymentRequest',
    response_type: 'Payment'
  },
  {
    method: 'POST',
    path: '/v1/finance/offers/{offerId}/accept',
    operation_id: 'acceptFundingOffer',
    summary: 'Accept an exact funding offer using its approved frozen terms with required idempotency.',
    workspace: 'finance',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance'],
    tags: ['Funding', 'Protected Actions'],
    stability: 'alpha',
    idempotency: 'required',
    protected_action: 'accept_funding_offer',
    request_type: 'AcceptFundingOfferRequest',
    response_type: 'AcceptOfferResponse'
  },
  {
    method: 'POST',
    path: '/v1/finance/offers',
    operation_id: 'requestFundingOffers',
    summary: 'Request indicative funding offers for a trade or finance workflow.',
    workspace: 'finance',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance'],
    tags: ['Funding'],
    stability: 'alpha',
    idempotency: 'recommended',
    request_type: 'OfferRequest',
    response_type: 'OfferResponse'
  },
  {
    method: 'POST',
    path: '/v1/clearance/checks/{clearanceCheckId}/evaluate',
    operation_id: 'evaluateClearanceCheck',
    summary: 'Evaluate clearance, compliance, sustainability, and rule-pack evidence for a check.',
    workspace: 'clearance',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Clearance'],
    stability: 'alpha',
    request_type: 'EvaluateClearanceCheckRequest',
    response_type: 'EvaluateClearanceCheckResponse',
    emits_events: ['clearance.evaluated', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/network/counterparties/{counterpartyId}/trust-context',
    operation_id: 'buildNetworkTrustContext',
    summary: 'Build reusable counterparty trust context, onboarding, screening, and Trade Passport visibility.',
    workspace: 'network',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member'],
    tags: ['Network'],
    stability: 'alpha',
    request_type: 'BuildNetworkTrustRequest',
    response_type: 'BuildNetworkTrustResponse',
    emits_events: ['network.trust.updated', 'memory.updated']
  },
  {
    method: 'POST',
    path: '/v1/utg/recall',
    operation_id: 'utgRecall',
    summary: 'Project typed trade activity into the Unified Trade Graph phase-one recall response.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'finance', 'ops', 'member', 'auditor'],
    tags: ['UTG', 'Graph'],
    stability: 'alpha',
    request_type: 'UTGRecallRequest',
    response_type: 'UTGRecallResponse'
  },
  {
    method: 'POST',
    path: '/v1/evals/trade-brain/run',
    operation_id: 'runTradeBrainEval',
    summary: 'Run Trade Brain eval suites and persist quality artifacts for release gating.',
    workspace: 'operations',
    auth: 'org_user',
    roles: ['owner', 'admin', 'ops'],
    tags: ['Evals', 'Trade Brain'],
    stability: 'alpha',
    request_type: 'RunTradeBrainEvalRequest',
    response_type: 'RunTradeBrainEvalResponse',
    emits_events: ['ai.eval.trade_brain.persisted', 'memory.updated']
  }
];

export interface ApiCatalogResponse {
  version: typeof TRAIBOX_API_VERSION;
  generated_at: string;
  endpoints: ApiEndpointContract[];
  errors: ApiErrorDefinition[];
  idempotency: {
    header: 'X-Idempotency-Key';
    required_for: string[];
    recommended_for: string[];
    conflict_error: 'idempotency_conflict';
  };
  trace_header: 'X-Trace-Id';
  org_header: 'X-Org-Id';
}

export function buildApiCatalog(generatedAt = new Date().toISOString()): ApiCatalogResponse {
  return {
    version: TRAIBOX_API_VERSION,
    generated_at: generatedAt,
    endpoints: [...TRAIBOX_API_ENDPOINTS],
    errors: [...API_ERROR_TAXONOMY],
    idempotency: {
      header: 'X-Idempotency-Key',
      required_for: TRAIBOX_API_ENDPOINTS.filter((endpoint) => endpoint.idempotency === 'required').map((endpoint) => `${endpoint.method} ${endpoint.path}`),
      recommended_for: TRAIBOX_API_ENDPOINTS.filter((endpoint) => endpoint.idempotency === 'recommended').map((endpoint) => `${endpoint.method} ${endpoint.path}`),
      conflict_error: 'idempotency_conflict'
    },
    trace_header: 'X-Trace-Id',
    org_header: 'X-Org-Id'
  };
}

export function buildTraiboxOpenApiDocument(input: { serverUrl?: string; generatedAt?: string } = {}) {
  const catalog = buildApiCatalog(input.generatedAt);
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of catalog.endpoints) {
    const path = endpoint.path.replaceAll('{', '{').replaceAll('}', '}');
    paths[path] ??= {};
    paths[path][endpoint.method.toLowerCase()] = {
      operationId: endpoint.operation_id,
      summary: endpoint.summary,
      tags: endpoint.tags,
      security: openApiSecurity(endpoint.auth),
      parameters: openApiParameters(endpoint),
      requestBody: endpoint.request_type
        ? {
            required: endpoint.method !== 'GET',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${endpoint.request_type}` }
              }
            }
          }
        : undefined,
      responses: {
        '200': {
          description: endpoint.response_type ?? 'Success',
          content: {
            'application/json': {
              schema: endpoint.response_type ? { $ref: `#/components/schemas/${endpoint.response_type}` } : { type: 'object' }
            }
          }
        },
        '400': { $ref: '#/components/responses/BadRequest' },
        '401': { $ref: '#/components/responses/Unauthorized' },
        '403': { $ref: '#/components/responses/Forbidden' },
        '409': { $ref: '#/components/responses/Conflict' },
        '500': { $ref: '#/components/responses/InternalError' }
      },
      'x-traibox': {
        workspace: endpoint.workspace,
        stability: endpoint.stability,
        auth: endpoint.auth,
        roles: endpoint.roles ?? [],
        idempotency: endpoint.idempotency ?? 'not_supported',
        protected_action: endpoint.protected_action ?? null,
        emits_events: endpoint.emits_events ?? []
      }
    };
  }
  const contractSchemas = Object.fromEntries(
    Array.from(new Set(catalog.endpoints.flatMap((endpoint) => [endpoint.request_type, endpoint.response_type]).filter((name): name is string => Boolean(name)))).map((name) => [
      name,
      { type: 'object', additionalProperties: true, description: `${name} is defined in @traibox/contracts.` }
    ])
  );
  Object.assign(contractSchemas, {
    ExecutePaymentRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['approval_id', 'payment_intent_id', 'route_id', 'from_account_id', 'creditor_name', 'creditor_iban', 'amount', 'currency', 'e2e_id'],
      properties: {
        approval_id: { type: 'string', format: 'uuid' },
        payment_intent_id: { type: 'string', format: 'uuid' },
        trade_id: { type: 'string', format: 'uuid' },
        route_id: { type: 'string', minLength: 1 },
        from_account_id: { type: 'string', format: 'uuid' },
        creditor_name: { type: 'string', minLength: 1 },
        creditor_iban: { type: 'string', minLength: 8 },
        amount: { type: 'number', exclusiveMinimum: 0 },
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        remittance: { type: 'string' },
        e2e_id: { type: 'string', minLength: 1 }
      }
    },
    ExecutePaymentIntentRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['approval_id'],
      properties: {
        approval_id: { type: 'string', format: 'uuid' }
      }
    },
    AcceptFundingOfferRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['approval_id'],
      properties: { approval_id: { type: 'string', format: 'uuid' } }
    }
  });

  return {
    openapi: '3.1.0',
    info: {
      title: 'TRAIBOX API',
      version: catalog.version,
      summary: 'AI-native trade readiness, governed execution, proof, memory, and graph API.',
      description: `Generated from TRAIBOX shared contracts at ${catalog.generated_at}.`
    },
    servers: [{ url: input.serverUrl ?? 'http://localhost:3001' }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
        externalParticipantToken: { type: 'apiKey', in: 'query', name: 'token' },
        partnerBearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
      },
      responses: {
        BadRequest: { description: 'Bad request', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Unauthorized: { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Forbidden: { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        Conflict: { description: 'Conflict', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        InternalError: { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } }
      },
      schemas: {
        ...contractSchemas,
        ErrorResponse: {
          type: 'object',
          required: ['error', 'message', 'trace_id'],
          properties: {
            error: { type: 'string' },
            message: { type: 'string' },
            hint: { type: 'string' },
            trace_id: { type: 'string' },
            status_code: { type: 'integer' },
            category: { type: 'string' },
            retryable: { type: 'boolean' },
            docs_url: { type: 'string' }
          }
        },
        ApiCatalogResponse: { type: 'object', additionalProperties: true }
      }
    },
    'x-traibox-error-taxonomy': catalog.errors,
    'x-traibox-idempotency': catalog.idempotency
  };
}

function openApiSecurity(auth: ApiAuthMode) {
  if (auth === 'public' || auth === 'webhook') return [];
  if (auth === 'external_participant') return [{ externalParticipantToken: [] }];
  if (auth === 'partner') return [{ partnerBearerAuth: [] }];
  return [{ bearerAuth: [] }];
}

function openApiParameters(endpoint: ApiEndpointContract) {
  const params: Array<Record<string, unknown>> = [];
  if (endpoint.auth === 'org_user') {
    params.push({ name: 'X-Org-Id', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } });
  }
  if (endpoint.idempotency === 'required' || endpoint.idempotency === 'recommended') {
    params.push({ name: 'X-Idempotency-Key', in: 'header', required: endpoint.idempotency === 'required', schema: { type: 'string' } });
  }
  params.push({ name: 'X-Trace-Id', in: 'header', required: false, schema: { type: 'string' } });
  return params;
}

export const AI_EVAL_CASES = [
  'trade_intent_parsing',
  'standalone_workflow_classification',
  'document_extraction_accuracy',
  'missing_proof_detection',
  'readiness_scoring_consistency',
  'compliance_explanation_quality',
  'finance_readiness_recommendation',
  'payment_risk_warning',
  'hallucination_prevention',
  'unsafe_action_blocking',
  'recommendation_usefulness',
  'deterministic_replay'
] as const;

export type AiEvalCase = (typeof AI_EVAL_CASES)[number];

export interface AiEvalCheck {
  case: AiEvalCase;
  status: 'pass' | 'warn' | 'fail';
  score: number;
  finding: string;
  evidence_refs?: unknown[];
}

export interface AiEvalResult {
  suite: string;
  status: 'pass' | 'warn' | 'fail';
  score: number;
  checks: AiEvalCheck[];
  model: string;
  prompt_version: string;
  context_used: Record<string, unknown>;
  artifacts_used: unknown[];
  sources_used: unknown[];
  confidence: number;
  policy_constraints: string[];
  quality_signals?: Record<string, unknown>;
  generated_recommendation: string;
  human_decision: 'accepted' | 'rejected' | 'pending';
  final_outcome: string;
  replayable: boolean;
  trace_id: string;
}

export type TradeBrainEvalStatus = 'pass' | 'warn' | 'fail';

export interface TradeBrainEvalSuiteSummary {
  suite_id: string;
  case_count: number;
  path?: string;
}

export interface TradeBrainEvalCheck {
  case: string;
  status: TradeBrainEvalStatus;
  finding: string;
  score?: number;
}

export interface TradeBrainEvalCaseResult {
  id: string;
  dataset: string;
  kind: string;
  tags: string[];
  status: TradeBrainEvalStatus;
  checks: TradeBrainEvalCheck[];
  summary: Record<string, unknown>;
}

export interface TradeBrainEvalReport {
  run_id: UUID;
  generated_at: string;
  harness_version: string;
  service_version: string;
  suite_id: string;
  case_count: number;
  passed: number;
  failed: number;
  score: number;
  status: TradeBrainEvalStatus;
  results: TradeBrainEvalCaseResult[];
}

export interface TradeBrainEvalRun {
  run_id: UUID;
  eval_object_id?: UUID | null;
  suite_id: string;
  status: TradeBrainEvalStatus;
  score: number;
  case_count: number;
  passed: number;
  failed: number;
  harness_version: string;
  service_version: string;
  artifact_refs: unknown[];
  trace_id: string;
  created_at: string;
}

export interface ListTradeBrainEvalSuitesResponse {
  service_version?: string | null;
  suites: TradeBrainEvalSuiteSummary[];
  trace_id: string;
}

export interface RunTradeBrainEvalRequest {
  suite_id?: string;
  persist?: boolean;
}

export interface RunTradeBrainEvalResponse {
  run: TradeBrainEvalRun;
  eval_result?: AlphaObject;
  report: TradeBrainEvalReport;
  trace_id: string;
}

export interface ListTradeBrainEvalRunsRequest {
  suite_id?: string;
  status?: TradeBrainEvalStatus;
  limit?: number;
}

export interface ListTradeBrainEvalRunsResponse {
  runs: TradeBrainEvalRun[];
  trace_id: string;
}

export type ReadinessOverall = 'ready' | 'missing' | 'risky' | 'blocked' | 'approved' | 'waiting';

export const ALPHA_SCENARIOS = [
  {
    id: 'full_trade_room_loop',
    title: 'Full Trade Room Loop',
    mode: 'full_trade_cycle',
    summary: 'Messy trade input becomes a Trade Room with documents, readiness, approval, proof, Operations update, and an attached standalone payment.'
  },
  {
    id: 'standalone_payment',
    title: 'Standalone Payment',
    mode: 'standalone_job',
    summary: 'A payment intent starts in Finance, requires readiness and human approval, then attaches to a Trade Room without losing audit or memory.'
  },
  {
    id: 'standalone_clearance',
    title: 'Standalone Clearance Check',
    mode: 'standalone_job',
    summary: 'A compliance or sustainability check starts in Clearance, identifies missing evidence, produces a report, and attaches to trade context.'
  },
  {
    id: 'counterparty_onboarding_screening',
    title: 'Counterparty Onboarding and Screening',
    mode: 'standalone_job',
    summary: 'A counterparty starts in Network, moves through onboarding and screening, updates trust context, and can be reused by a Trade Room.'
  },
  {
    id: 'funding_request',
    title: 'Funding Request',
    mode: 'standalone_job',
    summary: 'A funding request starts in Finance, checks finance-readiness, requests approval, captures an offer, and attaches to a Trade Room.'
  },
  {
    id: 'document_first',
    title: 'Document-First Flow',
    mode: 'composable_workflow',
    summary: 'Documents are uploaded before trade creation, extracted, used to suggest workflows, then converted into a Trade Room with proof.'
  }
] as const;

export type AlphaScenarioId = (typeof ALPHA_SCENARIOS)[number]['id'];

export const PILOT_SESSION_OUTCOMES = ['scheduled', 'in_progress', 'completed', 'blocked', 'cancelled'] as const;

export type PilotSessionOutcome = (typeof PILOT_SESSION_OUTCOMES)[number];

export const PILOT_ISSUE_SEVERITIES = ['none', 'low', 'medium', 'high', 'critical'] as const;

export type PilotIssueSeverity = (typeof PILOT_ISSUE_SEVERITIES)[number];

export interface PilotSessionPayload {
  artifact_kind: 'controlled_pilot_session';
  schema_version: 'pilot-session-v1';
  participant_alias: string;
  scenario_id: AlphaScenarioId;
  outcome: PilotSessionOutcome;
  issue_severity: PilotIssueSeverity;
  notes?: string;
  recorded_at: string;
  evidence: {
    trade_id?: UUID | null;
    trace_ids?: string[];
    proof_bundle_ids?: UUID[];
    screenshot_refs?: string[];
  };
}

export interface AlphaScenarioSummary {
  id: AlphaScenarioId;
  title: string;
  mode: 'full_trade_cycle' | 'standalone_job' | 'composable_workflow';
  summary: string;
}

export interface AlphaObject {
  object_id: UUID;
  org_id: UUID;
  type: AlphaObjectType;
  status: ObjectLifecycleStatus;
  origin_workspace: OriginWorkspace;
  owner_id: UUID;
  trade_id?: UUID | null;
  title: string;
  summary?: string | null;
  payload_json: Record<string, unknown>;
  permissions_json: Record<string, unknown>;
  evidence_refs_json: unknown[];
  audit_refs_json: unknown[];
  trace_id: string;
  created_at: string;
  updated_at: string;
}

export interface AlphaObjectRef {
  type: AlphaObjectType | 'trade_room' | 'trade' | 'counterparty';
  id: UUID;
}

export interface CreateAlphaObjectRequest {
  title: string;
  summary?: string;
  status?: ObjectLifecycleStatus;
  origin_workspace: OriginWorkspace;
  trade_id?: UUID | null;
  payload?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  evidence_refs?: unknown[];
}

export interface CreateAlphaObjectResponse {
  object: AlphaObject;
  trace_id: string;
}

export interface AttachObjectRequest {
  object_id: UUID;
  target: AlphaObjectRef;
  mode?: AttachMode;
  reason?: string;
  payload?: Record<string, unknown>;
}

export interface AttachObjectResponse {
  object: AlphaObject;
  link: {
    link_id: UUID;
    source_object_id: UUID;
    target_type: string;
    target_id: UUID;
    mode: AttachMode;
    trace_id: string;
    created_at: string;
  };
  trace_id: string;
}

export interface QueryAlphaObjectsRequest {
  origin_workspace?: OriginWorkspace;
  owner_id?: UUID;
  status?: ObjectLifecycleStatus;
  type?: AlphaObjectType;
  trade_id?: UUID | null;
  payment_provider?: PaymentRailProvider;
  adapter_id?: string;
  limit?: number;
}

export interface QueryAlphaObjectsResponse {
  objects: AlphaObject[];
  readiness_states: ReadinessState[];
  memory_events: AlphaMemoryEvent[];
  trace_id: string;
}

export type ReplayStepSource = 'object' | 'event' | 'memory' | 'audit' | 'readiness' | 'attachment' | 'proof';

export interface ReplayStep {
  step_id: string;
  source: ReplayStepSource;
  kind: string;
  title: string;
  summary?: string | null;
  occurred_at: string;
  trade_id?: UUID | null;
  object_id?: UUID | null;
  trace_id?: string | null;
  actor?: string | null;
  status?: string | null;
  payload_json: Record<string, unknown>;
  hash?: string | null;
  prev_hash?: string | null;
}

export interface ReplayQueryRequest {
  trade_id?: UUID;
  object_id?: UUID;
  limit?: number;
  include_audit?: boolean;
}

export interface ReplayQueryResponse {
  target: {
    trade_id?: UUID | null;
    object_id?: UUID | null;
  };
  steps: ReplayStep[];
  deterministic_hash: string;
  coverage: {
    objects: number;
    events: number;
    memory_events: number;
    audit_events: number;
    readiness_states: number;
    attachments: number;
    proof_bundles: number;
  };
  gaps: string[];
  trace_id: string;
}

export interface ReadinessDimension {
  key: string;
  label: string;
  status: ReadinessOverall;
  score: number;
  reasons: string[];
}

export interface ReadinessState {
  readiness_id: UUID;
  org_id: UUID;
  object_id?: UUID | null;
  trade_id?: UUID | null;
  overall: ReadinessOverall;
  score: number;
  dimensions: ReadinessDimension[];
  missing_items: string[];
  risk_findings: string[];
  next_actions: string[];
  trace_id: string;
  created_at: string;
}

export interface AlphaMemoryEvent {
  memory_event_id: UUID;
  org_id: UUID;
  level: 'L1' | 'L2' | 'L3';
  trade_id?: UUID | null;
  object_id?: UUID | null;
  kind: string;
  signal: string;
  payload_json: Record<string, unknown>;
  trace_id: string;
  created_at: string;
}

export type MemoryInsightCategory =
  | 'missing_proof'
  | 'approval_bottleneck'
  | 'workflow_recovery'
  | 'document_quality'
  | 'counterparty_friction'
  | 'clearance_gap'
  | 'finance_blocker'
  | 'proof_pattern'
  | 'agent_learning'
  | 'general_memory';

export interface MemoryInsight {
  insight_id: string;
  level: 'L1' | 'L2';
  category: MemoryInsightCategory;
  title: string;
  summary: string;
  severity: 'info' | 'watch' | 'blocked';
  count: number;
  signals: string[];
  trade_ids: UUID[];
  object_ids: UUID[];
  latest_at: string;
  next_action: string;
}

export type MemoryLensKind =
  | 'recurring_gaps'
  | 'approval_bottlenecks'
  | 'counterparty_friction'
  | 'document_quality'
  | 'finance_blockers'
  | 'clearance_gaps'
  | 'rejected_recommendations'
  | 'proof_readiness'
  | 'agent_learning';

export interface MemoryLensSignal {
  signal: string;
  kind: string;
  count: number;
  latest_at: string;
}

export interface MemoryLens {
  lens: MemoryLensKind;
  title: string;
  summary: string;
  severity: 'info' | 'watch' | 'blocked';
  signal_count: number;
  unique_trades: number;
  unique_objects: number;
  latest_at?: string | null;
  top_signals: MemoryLensSignal[];
  trade_ids: UUID[];
  object_ids: UUID[];
  next_action: string;
}

export interface MemoryInsightsRequest {
  trade_id?: UUID;
  level?: 'L1' | 'L2';
  limit?: number;
}

export interface MemoryInsightsResponse {
  insights: MemoryInsight[];
  lenses: MemoryLens[];
  recommended_actions: string[];
  source_events: number;
  trace_id: string;
}

export interface ReadinessEvaluateRequest {
  object_id?: UUID;
  trade_id?: UUID;
  context?: Record<string, unknown>;
}

export interface ReadinessEvaluateResponse {
  readiness: ReadinessState;
  eval_result?: AlphaObject;
  trace_id: string;
}

export interface DocumentExtractRequest {
  object_id?: UUID;
  filename?: string;
  mime_type?: string;
  text?: string;
  trade_id?: UUID | null;
  origin_workspace?: OriginWorkspace;
}

export interface DocumentExtractResponse {
  document: AlphaObject;
  extraction_result: AlphaObject;
  extracted_fields: Record<string, unknown>;
  missing_fields: string[];
  confidence: number;
  eval_result?: AlphaObject;
  trace_id: string;
}

export interface DocumentUploadResponse {
  document: AlphaObject;
  extraction_result?: AlphaObject;
  eval_result?: AlphaObject;
  file_url: string;
  sha256: string;
  byte_size: number;
  extracted_text_available: boolean;
  trace_id: string;
}

export interface DocumentPackGenerateRequest {
  trade_id?: UUID | null;
  object_ids?: UUID[];
  title?: string;
}

export interface DocumentPackGenerateResponse {
  document_pack: AlphaObject;
  file_url: string;
  manifest_sha256: string;
  document_count: number;
  extraction_count: number;
  missing_fields: string[];
  trace_id: string;
}

export interface ApprovalChainStep {
  key: string;
  label: string;
  required_role: OrgRole;
  status?: ObjectLifecycleStatus;
  actor_id?: UUID | null;
  decided_at?: string | null;
  notes?: string | null;
}

export interface ApprovalRequest {
  target: AlphaObjectRef;
  protected_action: ProtectedActionKind;
  proposed_action: string;
  execution_payload?: PaymentExecutionPayload;
  evidence_refs?: unknown[];
  policy_refs?: string[];
  step_up_required?: boolean;
  rationale?: string;
  approval_chain?: ApprovalChainStep[];
  current_approval_step?: string;
}

export interface ApprovalResponse {
  approval: AlphaObject;
  protected_action: ProtectedActionKind;
  trace_id: string;
}

export interface ApprovalDecisionRequest {
  decision: 'approved' | 'rejected';
  notes?: string;
  step_up_verified?: boolean;
  residual_risks_acknowledged?: boolean;
  approval_step?: string;
}

export interface ApprovalDecisionResponse {
  approval: AlphaObject;
  target?: AlphaObject | null;
  execution_task?: AlphaObject | null;
  decision: 'approved' | 'rejected';
  trace_id: string;
}

export interface ExecutionTaskRequest {
  title: string;
  summary?: string;
  trade_id?: UUID | null;
  target?: AlphaObjectRef;
  assigned_to_role?: string;
  assigned_to_user_id?: UUID;
  due_at?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  external_participant?: {
    name?: string;
    email?: string;
    role: string;
    scopes: string[];
  };
  evidence_refs?: unknown[];
}

export interface ExecutionTaskResponse {
  task: AlphaObject;
  external_access_grant?: AlphaObject | null;
  external_access_token?: string;
  external_access_url?: string;
  trace_id: string;
}

export const EXECUTION_ACTION_KINDS = [
  'prepare',
  'start_controlled_execution',
  'mark_ready_for_review',
  'mark_external_submitted',
  'mark_external_completed',
  'mark_blocked',
  'cancel'
] as const;

export type ExecutionActionKind = (typeof EXECUTION_ACTION_KINDS)[number];

export interface ExecutionTaskStatusRequest {
  status: ObjectLifecycleStatus;
  note?: string;
  execution_action?: ExecutionActionKind;
  operator_confirmation?: boolean;
  residual_risks_acknowledged?: boolean;
  external_reference?: string;
  idempotency_key?: string;
}

export interface ExecutionTaskStatusResponse {
  task: AlphaObject;
  trace_id: string;
}

export interface ExternalAccessGrantRequest {
  target: AlphaObjectRef;
  trade_id?: UUID | null;
  participant: {
    name?: string;
    email?: string;
    role: string;
  };
  scopes: string[];
  expires_at?: string;
  reason?: string;
}

export interface ExternalAccessGrantResponse {
  grant: AlphaObject;
  access_token?: string;
  access_url?: string;
  trace_id: string;
}

export interface ExternalAccessRevokeRequest {
  reason: string;
}

export interface ExternalAccessRevokeResponse {
  grant: AlphaObject;
  revoked_tokens: number;
  trace_id: string;
}

export interface AuditChainVerificationFailure {
  event_id: UUID;
  action: string;
  reason: string;
  expected_hash?: string | null;
  actual_hash?: string | null;
  expected_prev_hash?: string | null;
  actual_prev_hash?: string | null;
}

export interface AuditChainVerificationResponse {
  valid: boolean;
  checked_events: number;
  head_hash?: string | null;
  tail_prev_hash?: string | null;
  first_event_at?: string | null;
  last_event_at?: string | null;
  failures: AuditChainVerificationFailure[];
  trace_id: string;
}

export interface DocumentRequestCreateRequest {
  title: string;
  summary?: string;
  trade_id?: UUID | null;
  task_id?: UUID;
  requested_items: string[];
  due_at?: string;
  reason?: string;
  requested_from?: {
    name?: string;
    email?: string;
    role: string;
  };
}

export interface DocumentRequestCreateResponse {
  request: AlphaObject;
  external_access_grant?: AlphaObject | null;
  external_access_token?: string;
  external_access_url?: string;
  trace_id: string;
}

export interface DocumentRequestSubmissionRequest {
  filename: string;
  mime_type?: string;
  text: string;
  submitted_by?: {
    name?: string;
    email?: string;
    role?: string;
  };
}

export interface DocumentRequestSubmissionResponse {
  request: AlphaObject;
  document: AlphaObject;
  extraction_result: AlphaObject;
  readiness: ReadinessState;
  proof_bundle: AlphaObject;
  trace_id: string;
}

export interface ExternalPortalSummary {
  target_label: string;
  guarded_notice: string;
  pending_actions: string[];
  trust_score?: number;
  proof_ready?: boolean;
}

export interface ExternalParticipantSessionResponse {
  grant: AlphaObject;
  target: AlphaObject | null;
  visible_objects: AlphaObject[];
  portal_summary: ExternalPortalSummary;
  trade_id?: UUID | null;
  participant: {
    name?: string;
    email?: string;
    role: string;
  };
  scopes: string[];
  allowed_actions: string[];
  expires_at?: string | null;
  trace_id: string;
}

export interface ExternalParticipantExchangeResponse {
  access_token: string;
  session: ExternalParticipantSessionResponse;
  expires_at: string;
  trace_id: string;
}

export interface ExternalParticipantTaskUpdateRequest {
  status?: Extract<ObjectLifecycleStatus, 'in_progress' | 'ready_for_review' | 'blocked'>;
  note: string;
}

export interface ExternalParticipantTaskUpdateResponse {
  task: AlphaObject;
  trace_id: string;
}

export interface ExternalOnboardingEvidenceRequest {
  filename: string;
  mime_type?: string;
  text: string;
  evidence_type?: string;
  completed_fields?: string[];
  submitted_by?: {
    name?: string;
    email?: string;
    role?: string;
  };
}

export interface ExternalOnboardingEvidenceResponse {
  counterparty?: AlphaObject | null;
  onboarding_flow?: AlphaObject | null;
  trade_passport?: AlphaObject | null;
  document: AlphaObject;
  extraction_result: AlphaObject;
  readiness: ReadinessState;
  proof_bundle: AlphaObject;
  trace_id: string;
}

export interface ClearanceRuleRequirement {
  key: string;
  label: string;
  evidence_type: string;
  status: 'available' | 'missing' | 'risky';
  severity: 'low' | 'medium' | 'high';
  rationale: string;
}

export interface EvaluateClearanceCheckRequest {
  rule_pack_id?: string;
  corridor?: string;
  available_evidence?: string[];
  subject?: string;
}

export interface EvaluateClearanceCheckResponse {
  clearance_check: AlphaObject;
  report: AlphaObject;
  readiness: ReadinessState;
  rule_pack_id: string;
  requirements: ClearanceRuleRequirement[];
  missing_evidence: string[];
  risk_findings: string[];
  trace_id: string;
}

export interface NetworkTrustContext {
  score: number;
  status: 'pending_evidence' | 'ready_for_review' | 'blocked';
  missing_items: string[];
  risk_findings: string[];
  screening: {
    sanctions?: string;
    pep?: string;
    adverse_media?: string;
  };
  onboarding: {
    required_fields: string[];
    completed_fields: string[];
  };
  reusable_across_trades: boolean;
  passport_visibility: 'internal' | 'controlled_external' | 'network';
}

export interface BuildNetworkTrustRequest {
  onboarding_flow_id?: UUID;
  screening_result_id?: UUID;
  passport_visibility?: 'internal' | 'controlled_external' | 'network';
  invite?: {
    name?: string;
    email: string;
    role: string;
    scopes?: string[];
    reason?: string;
  };
  match_context?: {
    corridor?: string;
    domain?: 'finance' | 'payments' | 'logistics' | 'sourcing' | 'buyer' | 'supplier' | (string & {});
  };
}

export interface BuildNetworkTrustResponse {
  counterparty: AlphaObject;
  trade_passport: AlphaObject;
  matchmaking_result: AlphaObject;
  approval?: AlphaObject;
  trust_context: NetworkTrustContext;
  trace_id: string;
}

export interface GenerateProofBundleRequest {
  trade_id?: UUID;
  object_ids?: UUID[];
  title?: string;
  shareable?: boolean;
}

export interface GenerateProofBundleResponse {
  proof_bundle: AlphaObject;
  root: string;
  manifest_sha256: string;
  artifact_refs: unknown[];
  eval_result?: AlphaObject;
  trace_id: string;
}

export interface ProofShareRequest {
  proof_bundle_id: UUID;
  recipient: {
    name?: string;
    email?: string;
    role: string;
  };
  scopes?: string[];
  reason?: string;
  expires_at?: string;
}

export interface ProofShareResponse {
  proof_bundle: AlphaObject;
  approval: AlphaObject;
  protected_action: 'share_proof_bundle_externally';
  share_policy: Record<string, unknown>;
  trace_id: string;
}

export type IntelligenceMode = 'copilot' | 'plan' | 'agent';

export interface IntelligenceTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface IntelligenceRunRequest {
  message: string;
  workspace?: OriginWorkspace;
  trade_id?: UUID | null;
  object_ids?: UUID[];
  /** copilot = conversational answer; plan/agent = governed run. Defaults to agent. */
  mode?: IntelligenceMode;
  /** Optional model override forwarded to the Trade Brain (else its configured default). */
  model?: string;
  /** Prior turns for multi-turn context (most recent last). */
  history?: IntelligenceTurn[];
}

export interface IntelligenceRunResponse {
  answer: string;
  structured_outputs: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  created_objects: AlphaObject[];
  eval_result?: AlphaObject;
  trace_id: string;
  mode?: IntelligenceMode;
  clarifying_questions?: string[];
  plan_steps?: string[];
  follow_ups?: string[];
}

export interface AgentTaskRequest {
  objective: string;
  input_objects?: UUID[];
  permitted_tools?: string[];
  data_access?: string[];
  write_permissions?: string[];
  approval_gates?: ProtectedActionKind[];
  trade_id?: UUID | null;
  time_budget_seconds?: number;
}

export interface AgentWorkResult {
  outputs: Record<string, unknown>;
  blockers: string[];
  risks: string[];
  opportunities: string[];
  recommended_next_action: string;
  memory_updates: string[];
  model_usage: {
    model: string;
    prompt_version: string;
    latency_ms: number;
    cost_estimate_usd?: number;
  };
  human_decision?: 'accepted' | 'rejected' | 'pending';
}

export interface AgentTaskResponse {
  task: {
    agent_task_id: UUID;
    task_object_id?: UUID;
    status: ObjectLifecycleStatus;
    objective: string;
    trace_id: string;
    replay_log: unknown[];
    result: AgentWorkResult;
  };
  work_result: AlphaObject;
  eval_result?: AlphaObject;
  trace_id: string;
}

export interface AlphaDemoStep {
  key: string;
  title: string;
  status: ObjectLifecycleStatus | ReadinessOverall;
  object_id?: UUID;
  trade_id?: UUID;
  summary: string;
}

export interface AlphaDemoResponse {
  scenario_id: AlphaScenarioId;
  scenario_title: string;
  mode: AlphaScenarioSummary['mode'];
  trade_id: UUID;
  steps: AlphaDemoStep[];
  objects: AlphaObject[];
  readiness: ReadinessState;
  proof_bundle: AlphaObject;
  trace_id: string;
}

// ---- Trades (workspace views) ----

export type TradeStatus = 'draft' | 'active' | 'closed' | (string & {});

export interface TradeSummary {
  trade_id: UUID;
  title: string | null;
  corridor: string | null;
  status: TradeStatus;
  created_at: string;
  confidence?: number | null;
}

export interface ListTradesResponse {
  trades: TradeSummary[];
  trace_id: string;
}

export interface TradeRecord {
  trade_id: UUID;
  title: string | null;
  corridor: string | null;
  amount: number | null;
  currency: string | null;
  status: TradeStatus;
  created_at: string;
}

export interface TradePlanRecord {
  items: PlanItem[];
  parties: PlanParty[];
  terms: PlanTerms;
  checklist: string[];
  confidence: number | null;
  glass_box: GlassBox | null;
  created_at: string;
}

export interface ComplianceReportRecord {
  overall: ComplianceOverall;
  risk_level: 'low' | 'medium' | 'high' | null;
  report_id: UUID | null;
  pdf_url: string | null;
  created_at: string;
}

export interface OfferRequestRecord {
  request_id: UUID;
  status: string;
  created_at: string;
}

export interface FinanceOfferRecord {
  offer_id: UUID;
  financier_id: string;
  financier_name: string;
  apr_bps: number;
  fees: number;
  tenor_days: number;
  currency: string;
  sustainability_grade: SustainabilityGrade;
  sustainability_tag: SustainabilityTag;
  explanations: string[] | null;
  allocation_json: unknown;
  expires_at: string | null;
  created_at: string;
}

export interface AllocationRankingItem {
  offer_id: UUID;
  financier_id: string;
  score: number;
  reasons: string[];
}

export interface AllocationDecisionRecord {
  decision_id: UUID;
  market: string;
  policy_id: string;
  winner: string;
  reasons_json: string[] | null;
  ranking_json: AllocationRankingItem[] | null;
  timestamp: string;
}

export interface ReservationRecord {
  reservation_id: UUID;
  offer_id: UUID;
  expires_at: string;
  status: string;
  created_at: string;
}

export interface PaymentSummary {
  payment_id: UUID;
  scheme: string;
  provider?: PaymentRailProvider;
  provider_mode?: string | null;
  adapter_id?: string | null;
  provider_fallback?: boolean;
  status: PaymentStatus;
  iso_status: string | null;
  created_at: string;
}

export interface ProofBundleSummary {
  bundle_url: string;
  root: string;
  manifest_sha256: string;
  created_at: string;
  artifact_count?: number;
}

export interface TradeWorkspaceResponse {
  trade: TradeRecord | null;
  plan: TradePlanRecord | null;
  compliance: ComplianceReportRecord | null;
  offer_request: OfferRequestRecord | null;
  offers: FinanceOfferRecord[];
  allocation: AllocationDecisionRecord | null;
  reservation: ReservationRecord | null;
  payments: PaymentSummary[];
  proofs: ProofBundleSummary | null;
  trace_id: string;
}

// ---- Compliance ----

export type ComplianceCheckType =
  | 'KYC'
  | 'KYB'
  | 'SANCTIONS'
  | 'PEP'
  | 'ADVERSE_MEDIA'
  | 'EXPORT'
  | 'JURISDICTION'
  | 'ESG'
  | 'CBAM'
  | 'AML';

export type ComplianceCheckStatus = 'pass' | 'warn' | 'fail';
export type ComplianceOverall = 'passed' | 'warnings' | 'failed';

export interface ComplianceRequest {
  trade_id: UUID;
  policy_id?: string;
  flags?: { deep_export_check?: boolean };
}

export interface ComplianceCheck {
  type: ComplianceCheckType;
  status: ComplianceCheckStatus;
  score?: number;
  reasons?: string[];
  provider?: string;
  provider_ref?: string;
  updated_at: string; // ISO
}

export interface ComplianceResponse {
  trade_id: UUID;
  overall: ComplianceOverall;
  risk_level?: 'low' | 'medium' | 'high';
  checks: ComplianceCheck[];
  next_actions?: string[];
  report_url: string;
  trace_id: string;
}

// ---- Finance + STF ----

export type SustainabilityTag = 'green_uop' | 'sustainability_linked' | 'none';
export type SustainabilityGrade = 'aligned' | 'eligible' | 'not_sustainable' | 'insufficient_data';
export type VerificationLevel = 'registry' | 'third_party' | 'self';

export interface OfferItem {
  offer_id: UUID;
  financier: string;
  apr_bps: number;
  fees: number;
  tenor_days: number;
  currency?: string;
  sustainability_tag: SustainabilityTag;
  sustainability_grade: SustainabilityGrade;
  verification_level?: VerificationLevel;
  sustainable_pricing_delta_bps?: number;
  explanations?: string[];
  allocation?: { score: number; policy_id: string; reasons: string[] };
  expires_at?: string;
}

export interface OfferRequest {
  trade_id: UUID;
  amount: number;
  tenor_days: number;
  sustainable?: {
    enabled?: boolean;
    path?: 'uop' | 'sltf';
    minimum_grade?: 'eligible' | 'aligned';
    evidence_ids?: UUID[];
  };
}

export interface FinanceOfferItem {
  offer_id: UUID;
  request_id?: UUID | null;
  financier_id: string;
  financier_name: string;
  apr_bps: number;
  fees: number;
  tenor_days: number;
  currency: string;
  sustainability_tag: string;
  sustainability_grade: string;
  verification_level?: string | null;
  sustainable_pricing_delta_bps?: number | null;
  expires_at?: string | null;
  created_at: string;
}

export interface FundingRequestItem {
  request_id: UUID;
  trade_id: UUID;
  trade_title?: string | null;
  amount: number;
  currency: string;
  tenor_days: number;
  sustainable?: Record<string, unknown> | null;
  status: string;
  created_at: string;
  offers: FinanceOfferItem[];
}

export interface FinanceReservationItem {
  reservation_id: UUID;
  offer_id: UUID;
  trade_id: UUID;
  trade_title?: string | null;
  financier_ref?: string | null;
  financier_name: string;
  apr_bps: number;
  fees: number;
  tenor_days: number;
  currency: string;
  amount?: number | null;
  expires_at: string;
  status: string;
  created_at: string;
}

export interface FinanceFundingResponse {
  requests: FundingRequestItem[];
  reservations: FinanceReservationItem[];
  trace_id: string;
}

export interface OfferResponse {
  trade_id: UUID;
  offers: OfferItem[];
  recommended_offer_id?: UUID | null;
  trace_id: string;
  status: 'offers_ready' | 'partial' | 'error';
}

export interface AcceptResponse {
  reservation: { offer_id: UUID; expires_at: string; financier_ref?: string };
  trace_id: string;
}

export type EvidenceType = 'standard_cert' | 'esg_score' | 'attestation' | 'lca_carbon' | 'uop_declaration';

export interface Evidence {
  evidence_id?: UUID;
  trade_id: UUID;
  type: EvidenceType;
  scheme_code?: string;
  issuer?: string;
  valid_from?: string; // YYYY-MM-DD
  valid_to?: string; // YYYY-MM-DD
  verification_level?: 'self' | 'third_party' | 'registry';
  file_url?: string;
  links?: Array<{ hs_code?: string; partner_id?: string }>;
}

export interface EvidenceSaved {
  evidence_id: UUID;
  trace_id: string;
}

export interface GradeRequest {
  trade_id: UUID;
  path?: 'uop' | 'sltf';
  minimum_grade?: 'eligible' | 'aligned';
  evidence_ids?: UUID[];
}

export interface GradeResponse {
  trade_id: UUID;
  path: 'uop' | 'sltf';
  grade: 'aligned' | 'eligible' | 'insufficient';
  details: string[];
  verification_level?: VerificationLevel;
  dns_h_ms_passed?: boolean;
  cbam_flag?: boolean;
  glass_box?: string[];
}

// ---- Payments ----

export const PAYMENT_RAIL_PROVIDERS = ['manual', 'truelayer', 'ibanfirst', 'internal'] as const;
export type PaymentRailProvider = (typeof PAYMENT_RAIL_PROVIDERS)[number] | (string & {});

export const PAYMENT_RAIL_CAPABILITIES = [
  'manual_transfer',
  'open_banking_ais',
  'open_banking_pis',
  'pay_by_bank',
  'cross_border_payment',
  'fx_conversion',
  'currency_account',
  'beneficiary_management',
  'payment_tracking',
  'webhook_reconciliation'
] as const;
export type PaymentRailCapability = (typeof PAYMENT_RAIL_CAPABILITIES)[number] | (string & {});

export interface PaymentRailProviderDescriptor {
  provider: PaymentRailProvider;
  display_name: string;
  status: 'active' | 'planned' | 'disabled' | 'degraded';
  capabilities: PaymentRailCapability[];
  protected_actions: ProtectedActionKind[];
  requires_license_boundary: boolean;
  fallback_provider?: PaymentRailProvider;
}

export const PAYMENT_RAIL_PROVIDER_CATALOG = [
  {
    provider: 'manual',
    display_name: 'Manual bank transfer',
    status: 'active',
    capabilities: ['manual_transfer', 'payment_tracking'],
    protected_actions: ['send_payment'],
    requires_license_boundary: false
  },
  {
    provider: 'truelayer',
    display_name: 'TrueLayer',
    status: 'active',
    capabilities: ['open_banking_ais', 'open_banking_pis', 'pay_by_bank', 'webhook_reconciliation'],
    protected_actions: ['send_payment'],
    requires_license_boundary: true,
    fallback_provider: 'manual'
  },
  {
    provider: 'ibanfirst',
    display_name: 'iBanFirst',
    status: 'planned',
    capabilities: ['cross_border_payment', 'fx_conversion', 'currency_account', 'beneficiary_management', 'payment_tracking', 'webhook_reconciliation'],
    protected_actions: ['send_payment'],
    requires_license_boundary: true,
    fallback_provider: 'manual'
  },
  {
    provider: 'internal',
    display_name: 'TRAIBOX-owned rail',
    status: 'planned',
    capabilities: [],
    protected_actions: ['send_payment'],
    requires_license_boundary: true,
    fallback_provider: 'manual'
  }
] as const satisfies readonly PaymentRailProviderDescriptor[];

export const LEDGER_RAIL_PROVIDERS = ['evm_event', 'notary', 'internal'] as const;
export type LedgerRailProvider = (typeof LEDGER_RAIL_PROVIDERS)[number] | (string & {});

export const LEDGER_RAIL_CAPABILITIES = ['proof_anchor', 'artifact_hash_anchor', 'trade_finance_evidence', 'contract_event_anchor'] as const;
export type LedgerRailCapability = (typeof LEDGER_RAIL_CAPABILITIES)[number] | (string & {});

export interface LedgerRailProviderDescriptor {
  provider: LedgerRailProvider;
  display_name: string;
  status: 'active' | 'planned' | 'disabled' | 'degraded';
  capabilities: LedgerRailCapability[];
  default_network?: string;
  stores_pii_on_chain: false;
}

export const LEDGER_RAIL_PROVIDER_CATALOG = [
  {
    provider: 'evm_event',
    display_name: 'EVM event anchoring',
    status: 'active',
    capabilities: ['proof_anchor', 'artifact_hash_anchor', 'trade_finance_evidence', 'contract_event_anchor'],
    default_network: 'xdc',
    stores_pii_on_chain: false
  },
  {
    provider: 'notary',
    display_name: 'External notary rail',
    status: 'planned',
    capabilities: ['proof_anchor', 'artifact_hash_anchor'],
    stores_pii_on_chain: false
  },
  {
    provider: 'internal',
    display_name: 'TRAIBOX proof infrastructure',
    status: 'planned',
    capabilities: ['proof_anchor', 'artifact_hash_anchor'],
    stores_pii_on_chain: false
  }
] as const satisfies readonly LedgerRailProviderDescriptor[];

export const SMART_CONTRACT_RAIL_PROVIDERS = ['evm_contract', 'partner_escrow', 'internal'] as const;
export type SmartContractRailProvider = (typeof SMART_CONTRACT_RAIL_PROVIDERS)[number] | (string & {});

export const SMART_CONTRACT_RAIL_CAPABILITIES = [
  'contract_draft',
  'deployment_request',
  'condition_tracking',
  'escrow_style_conditions',
  'tokenized_trade_finance_instrument'
] as const;
export type SmartContractRailCapability = (typeof SMART_CONTRACT_RAIL_CAPABILITIES)[number] | (string & {});

export interface SmartContractRailProviderDescriptor {
  provider: SmartContractRailProvider;
  display_name: string;
  status: 'active' | 'planned' | 'disabled' | 'degraded';
  capabilities: SmartContractRailCapability[];
  protected_actions: ProtectedActionKind[];
  real_value_execution_enabled: boolean;
}

export const SMART_CONTRACT_RAIL_PROVIDER_CATALOG = [
  {
    provider: 'evm_contract',
    display_name: 'EVM smart-contract rail',
    status: 'planned',
    capabilities: ['contract_draft', 'deployment_request', 'condition_tracking', 'escrow_style_conditions', 'tokenized_trade_finance_instrument'],
    protected_actions: ['release_escrow_or_conditions', 'make_binding_trade_commitment', 'approve_trade_execution'],
    real_value_execution_enabled: false
  },
  {
    provider: 'partner_escrow',
    display_name: 'Licensed partner escrow rail',
    status: 'planned',
    capabilities: ['condition_tracking', 'escrow_style_conditions'],
    protected_actions: ['release_escrow_or_conditions'],
    real_value_execution_enabled: false
  },
  {
    provider: 'internal',
    display_name: 'TRAIBOX-owned programmable rail',
    status: 'planned',
    capabilities: ['contract_draft', 'deployment_request'],
    protected_actions: ['release_escrow_or_conditions', 'make_binding_trade_commitment', 'approve_trade_execution'],
    real_value_execution_enabled: false
  }
] as const satisfies readonly SmartContractRailProviderDescriptor[];

export interface RoutesRequest {
  trade_id?: UUID;
  from_account_id: UUID;
  to_iban: string;
  amount: number;
  currency: string;
  urgency?: 'instant' | 'standard';
  purpose?: string;
}

export interface PaymentRoute {
  route_id: string;
  scheme: 'SEPA' | 'SEPA_INSTANT' | (string & {});
  provider?: PaymentRailProvider;
  capabilities?: PaymentRailCapability[];
  fee: number;
  eta_minutes: number;
  recommended?: boolean;
  fallback?: boolean;
}

export interface RoutesResponse {
  routes: PaymentRoute[];
}

export type PaymentStatus =
  | 'created'
  | 'pending_sca'
  | 'authorized'
  | 'executing'
  | 'executed'
  | 'failed'
  | 'returned'
  | 'refunded';

export interface Payment {
  payment_id: UUID;
  scheme: string;
  status: PaymentStatus;
  provider?: PaymentRailProvider;
  provider_mode?: string | null;
  adapter_id?: string | null;
  provider_fallback?: boolean;
  provider_reason?: string | null;
  iso_status?: string;
  return_reason?: string;
  redirect_url?: string;
  trace_id: string;
}

export interface PaymentExecutionPayload {
  trade_id?: UUID;
  route_id: string;
  from_account_id: UUID;
  creditor_name: string;
  creditor_iban: string;
  amount: number;
  currency: string;
  remittance?: string;
  e2e_id: string;
}

export interface ExecutePaymentRequest extends PaymentExecutionPayload {
  approval_id: UUID;
  payment_intent_id: UUID;
}

export interface ExecutePaymentIntentRequest {
  approval_id: UUID;
}

export interface AcceptFundingOfferRequest {
  approval_id: UUID;
}

export interface ExecutePaymentIntentResponse {
  payment_intent: AlphaObject;
  approval: AlphaObject;
  payment: Payment;
  trace_id: string;
}

export interface PaymentListItem {
  payment_id: UUID;
  trade_id?: UUID | null;
  scheme: string;
  debtor_account_id: UUID;
  creditor_name: string;
  creditor_iban: string;
  amount: number;
  currency: string;
  purpose?: string | null;
  remittance?: string | null;
  status: PaymentStatus;
  iso_status?: string | null;
  return_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListPaymentsResponse {
  payments: PaymentListItem[];
  trace_id: string;
}

// ---- Banks / Accounts (AIS/PIS) ----

export type ConsentType = 'AIS' | 'PIS';
export type ConsentStatus = 'pending' | 'granted' | 'revoked' | 'expired' | 'updated' | (string & {});

export interface BankConsent {
  consent_id: UUID;
  provider: string;
  type: ConsentType;
  status: ConsentStatus;
  expires_at?: string | null;
}

export interface ListConsentsResponse {
  consents: BankConsent[];
  trace_id: string;
}

export interface BankAccount {
  account_id: UUID;
  provider_id: string;
  iban: string;
  currency: string;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  bank_name?: string | null;
}

export interface ListBankAccountsResponse {
  accounts: BankAccount[];
  trace_id: string;
}

export interface ListBankConsentsResponse {
  consents: BankConsent[];
  trace_id: string;
}

// ---- Ledger / Proofs ----

export interface LedgerProofsResponse {
  bundle_url: string;
  manifest_sha256: string;
  root: string;
  created_at?: string;
  artifacts?: LedgerProofArtifact[];
  artifact_count?: number;
  anchor?: {
    status: 'off' | 'pending' | 'anchored' | 'failed';
    network?: string;
    tx_hash?: string;
    block_number?: number;
    anchored_at?: string;
  };
  trace_id: string;
}

export interface LedgerProofArtifact {
  path: string;
  mime: string;
  bytes: number | null;
  sha256: string;
  created_at?: string;
}

export interface LedgerVerifyResponse {
  valid: boolean;
  reasons: string[];
  root?: string;
  anchored?: boolean;
  network?: string;
  tx?: string;
  bundle_sha256?: string;
  artifact_count?: number;
}

export interface LedgerVerifyStoredRequest {
  trade_id?: UUID;
  bundle_url?: string;
}

export interface LedgerVerifyStoredResponse extends LedgerVerifyResponse {
  bundle_url: string;
  expected_root: string;
  manifest_sha256: string;
  verified_at: string;
  trace_id: string;
}

export interface LedgerExportRequest {
  trade_ids: UUID[];
}

export interface LedgerExportResponse {
  url: string;
  hash: string;
  trade_count: number;
  trace_id: string;
}

// ---- UTG (Postgres-backed v1 stub) ----

export interface UTGRecallRequest {
  trade_id: UUID;
  hops?: number;
  include?: string[];
  limit_nodes?: number;
}

export interface UTGNode {
  id: string;
  label: string;
  props?: Record<string, unknown>;
}

export interface UTGEdge {
  from: string;
  to: string;
  type: string;
  props?: Record<string, unknown>;
}

export interface UTGProjectionSummary {
  adapter: string;
  phase: 'utg_phase_1' | (string & {});
  generated_at: string;
  trade_id: UUID;
  source_counts: Record<string, number>;
  coverage: Record<string, number>;
  latest_source_at?: string | null;
  freshness_lag_ms?: number | null;
}

export interface UTGRecallResponse {
  nodes: UTGNode[];
  edges: UTGEdge[];
  projection?: UTGProjectionSummary;
  trace_id: string;
}

export interface UTGPartnerFeaturesRequest {
  domain: 'finance' | 'payments' | 'logistics' | 'sourcing' | (string & {});
  trade_id: UUID;
  partner_ids: string[];
}

export interface UTGPartnerFeature {
  partner_id: string;
  fit: number;
  capability: number;
  performance: number;
  trust: number;
  esg: number;
  net_proximity: number;
  reasons: string[];
}

export interface UTGPartnerFeaturesResponse {
  features: UTGPartnerFeature[];
  trace_id: string;
}

// ---- Events (SSE) ----

export interface SSEEvent<TType extends string = string, TData = unknown> {
  event_id: UUID;
  type: TType;
  ts: string;
  org_id: UUID;
  trade_id?: UUID;
  trace_id: string;
  actor?: string;
  data: TData;
}

export type SSEEventType =
  | 'plan.generated'
  | 'plan.corrected'
  | 'trade.message.created'
  | 'compliance.running'
  | 'compliance.passed'
  | 'compliance.warnings'
  | 'compliance.failed'
  | 'offers.requested'
  | 'offers.ready'
  | 'offer.accepted'
  | 'offer.expired'
  | 'evidence.uploaded'
  | 'evidence.validated'
  | 'evidence.rejected'
  | 'payments.routes_ready'
  | 'payment.executing'
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.returned'
  | 'payment.refunded'
  | 'banks.consent.updated'
  | 'ledger.bundle.ready'
  | 'ledger.anchor.started'
  | 'ledger.anchor.completed'
  | 'ledger.anchor.failed'
  | 'ledger.bundle.verified'
  | 'ledger.export.ready'
  | 'network.matched'
  | 'network.trust.updated'
  | 'identity.verified'
  | 'identity.revoked'
  | 'allocation.ranked'
  | 'allocation.decided'
  | 'allocation.capped'
  | 'object.created'
  | 'object.attached'
  | 'document_request.created'
  | 'document_request.submitted'
  | 'document.extracted'
  | 'readiness.evaluated'
  | 'approval.requested'
  | 'approval.decided'
  | 'workflow.run.created'
  | 'workflow.run.updated'
  | 'execution.task.created'
  | 'execution.task.updated'
  | 'external_access.granted'
  | 'external_access.revoked'
  | 'external_access.used'
  | 'governance.audit_chain.verified'
  | 'proof.bundle.ready'
  | 'proof.share.requested'
  | 'agent.task.completed'
  | 'ai.eval.completed'
  | 'memory.updated'
  | 'operations.digest.ready';
