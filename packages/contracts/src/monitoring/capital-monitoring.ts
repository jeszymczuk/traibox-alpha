import type { UUID } from '../index';
import type { CanonicalObjectRef, MandateBinding, PrincipalType } from '../agents/common';

/**
 * Company-side monitoring contracts (spec §16/§23). Monitoring produces
 * ANALYSIS and RECOMMENDATIONS only — it never authorizes or performs
 * canonical Finance transitions (those remain Finance-domain workflow under
 * policy, per decision CA-102).
 */

export const MONITORING_STATUSES = ['active', 'paused', 'completed', 'expired', 'cancelled'] as const;
export type CapitalMonitoringStatus = (typeof MONITORING_STATUSES)[number];

export interface MonitoringCondition {
  condition_id: UUID;
  description: string;
  /** Deterministic evaluator id in the Workbench (e.g. capital.evaluate_instrument_conditions). */
  evaluator_id: string;
  evaluator_version?: string;
  parameters?: Record<string, unknown>;
}

export interface CapitalMonitoringState {
  monitoring_id: UUID;
  organization_id: UUID;
  principal_id: UUID;
  principal_type: PrincipalType;
  mandate: MandateBinding;
  /** What is being watched — referenced canonically, never copied. */
  monitored_object_ref: CanonicalObjectRef;
  conditions: MonitoringCondition[];
  /** Cron-like schedule or event trigger description. */
  schedule?: string;
  trigger?: string;
  status: CapitalMonitoringStatus;
  last_evaluated_at?: string;
  /** Snapshot of the last deterministic evaluation (calculation-run backed). */
  last_evaluation?: {
    calculation_run_id?: UUID;
    summary: string;
    findings_claim_ids?: UUID[];
  };
  next_evaluation_at?: string;
  /** Outputs are recommendations/outcomes — never executed transitions. */
  generated_outcome_ids: UUID[];
  generated_recommendation_ids: UUID[];
  trace_id: string;
  audit_refs?: unknown[];
  created_at: string;
  updated_at: string;
}
