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

export interface IntelligenceRunRequest {
  message: string;
  workspace?: OriginWorkspace;
  trade_id?: UUID | null;
  object_ids?: UUID[];
}

export interface IntelligenceRunResponse {
  answer: string;
  structured_outputs: Array<Record<string, unknown>>;
  suggested_actions: Array<Record<string, unknown>>;
  created_objects: AlphaObject[];
  eval_result?: AlphaObject;
  trace_id: string;
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
  status: PaymentStatus;
  iso_status: string | null;
  created_at: string;
}

export interface ProofBundleSummary {
  bundle_url: string;
  root: string;
  manifest_sha256: string;
  created_at: string;
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
  fee: number;
  eta_minutes: number;
  recommended?: boolean;
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
  iso_status?: string;
  return_reason?: string;
  redirect_url?: string;
  trace_id: string;
}

export interface ExecutePaymentRequest {
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

export interface ExecutePaymentIntentRequest {
  approval_id: UUID;
  route_id?: string;
  from_account_id: UUID;
  creditor_name?: string;
  creditor_iban?: string;
  amount?: number;
  currency?: string;
  remittance?: string;
  e2e_id?: string;
}

export interface ExecutePaymentIntentResponse {
  payment_intent: AlphaObject;
  approval: AlphaObject;
  payment: Payment;
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
