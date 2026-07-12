import type { UUID } from '../index';

/**
 * Principal-neutral agent foundation contracts (Capital Agent v1.1 Phase 1).
 *
 * Only the `company` principal is activated by initial policies; `financier`
 * and `platform_internal` are reserved so future financier functionality is
 * additive (decision CA-101). Nothing here is a canonical Finance object and
 * nothing here grants execution authority (decisions CA-102, spec §5.1).
 */

export const PRINCIPAL_TYPES = ['company', 'financier', 'platform_internal'] as const;
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

/** Who an agent invocation serves. Loaded from authenticated tenancy/role context — never inferred from conversation. */
export interface PrincipalRef {
  principal_id: UUID;
  principal_type: PrincipalType;
  organization_id: UUID;
  /** Acting human, when the invocation is user-initiated. */
  acting_user_id?: UUID;
  role_profile_id?: string;
  data_boundary_id?: string;
}

export const DATA_SENSITIVITIES = ['public', 'internal', 'confidential', 'restricted_financial', 'regulated_personal'] as const;
export type DataSensitivity = (typeof DATA_SENSITIVITIES)[number];

/**
 * Authority the agent may exercise. Deliberately excludes approve/bind/commit/
 * execute/clear/lend/sign/release_funds/move_money/underwrite_of_record —
 * those are human or Finance-domain powers and MUST NOT appear here.
 */
export const CAPITAL_AUTHORITY_LEVELS = ['observe', 'calculate', 'analyse', 'recommend', 'draft', 'monitor', 'propose_protected_action'] as const;
export type CapitalAuthorityLevel = (typeof CAPITAL_AUTHORITY_LEVELS)[number];

/** Actions that are structurally outside any agent authority level (spec §5.1). */
export const PROHIBITED_AGENT_AUTHORITIES = [
  'approve',
  'bind',
  'commit',
  'clear',
  'custody',
  'lend',
  'underwrite_of_record',
  'execute_payment',
  'release_funds',
  'accept_offer',
  'sign',
  'file_regulatory_declaration'
] as const;

/** Canonical seven-class specialist taxonomy (spec §3.4, decision CA-107). */
export const SPECIALIST_AGENT_CLASSES = [
  'capital_agent',
  'compliance_agent',
  'risk_agent',
  'market_network_agent',
  'trade_operations_agent',
  'audit_monitoring_agent',
  'concierge_coordinator'
] as const;
export type SpecialistAgentClass = (typeof SPECIALIST_AGENT_CLASSES)[number];

/**
 * Typed reference to a canonical object in another domain (decision CA-105).
 * The repository holds Finance state in two disconnected layers — relational
 * tables and alpha objects — whose identifiers are NOT interchangeable; the
 * source layer is therefore mandatory and consumers MUST NOT join ids across
 * layers.
 */
export interface CanonicalObjectRef {
  /** Which system-of-record layer the id belongs to. */
  source_layer: 'relational' | 'alpha_object' | 'external';
  /** Owning domain, e.g. 'finance', 'trades', 'compliance'. */
  domain: string;
  /** Table name (relational), alpha object type, or external system object type. */
  object_type: string;
  object_id: string;
  organization_id: UUID;
  principal_id?: UUID;
  trade_id?: UUID | null;
  object_version?: string | number;
  /** When this reference was observed; staleness must be visible downstream. */
  observed_at?: string;
  access_scope?: string;
}

/**
 * A mandate is the agent's authorized professional remit for one principal.
 * Immutable during an invocation; changes create a new version (spec §4.5).
 */
export interface AgentMandate {
  mandate_id: UUID;
  version: number;
  principal: PrincipalRef;
  agent_class: SpecialistAgentClass;
  status: 'draft' | 'active' | 'suspended' | 'expired' | 'revoked';
  allowed_outcome_types: string[];
  permitted_tool_classes: string[];
  permitted_data_classes: string[];
  permitted_specialist_reads: SpecialistAgentClass[];
  permitted_proposal_kinds: string[];
  /** Highest authority this mandate can ever grant. */
  authority_ceiling: CapitalAuthorityLevel;
  /** Explicit denials, checked in addition to the ceiling. */
  prohibited_actions: string[];
  max_sensitivity: DataSensitivity;
  disclosure_policy_id: string;
  jurisdiction_policy_ids?: string[];
  model_policy_id?: string;
  retention_policy_id?: string;
  conflict_policy_id?: string;
  effective_from: string;
  expires_at?: string | null;
  issued_by: UUID;
  accepted_at?: string | null;
  audit_refs?: unknown[];
}

/** Binds a task to the exact mandate version it ran under. */
export interface MandateBinding {
  mandate_id: UUID;
  mandate_version: number;
}

export interface AgentProvenance {
  agent_class: SpecialistAgentClass;
  agent_definition_version: string;
  model_provider?: string;
  model_id?: string;
  prompt_version?: string;
  policy_versions?: Record<string, string>;
  trace_id: string;
}
