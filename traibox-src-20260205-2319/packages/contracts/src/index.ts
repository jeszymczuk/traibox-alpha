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
