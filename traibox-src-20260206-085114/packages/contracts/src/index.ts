export type UUID = string;

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

export interface OkResponse {
  ok: boolean;
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
  anchor?: {
    status: 'off' | 'pending' | 'anchored' | 'failed';
    network?: string;
    tx_hash?: string;
    block_number?: number;
    anchored_at?: string;
  };
  trace_id: string;
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

export interface UTGRecallResponse {
  nodes: UTGNode[];
  edges: UTGEdge[];
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
  | 'network.matched'
  | 'identity.verified'
  | 'identity.revoked'
  | 'allocation.ranked'
  | 'allocation.decided'
  | 'allocation.capped';
