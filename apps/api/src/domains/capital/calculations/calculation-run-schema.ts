import { z } from 'zod';
import type { FinancialCalculationRunDraft } from '@traibox/contracts';

/**
 * Runtime validation for FinancialCalculationRunDraft (Part B §B4.2).
 *
 * Strict: unknown keys are rejected, statuses/eligibilities are the unified
 * closed sets, and the audit manifests must be present as objects. Values are
 * never trusted from an unauthenticated request — the persistence adapter
 * additionally verifies every binding against the authenticated RLS-scoped
 * transaction context.
 */

const CALCULATION_STATUS = z.enum(['completed', 'insufficient_information', 'invalid_input', 'failed']);
const CALCULATION_ELIGIBILITY = z.enum(['eligible', 'ineligible', 'insufficient_information', 'not_applicable']);

const structuredWarningSchema = z
  .object({
    code: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(['info', 'warning', 'critical']),
    related_input_paths: z.array(z.string())
  })
  .strict();

const validationFindingSchema = z
  .object({
    check: z.string().min(1),
    status: z.enum(['pass', 'warn', 'fail']),
    finding: z.string().nullable().optional()
  })
  .strict();

const evidenceSourceRefSchema = z
  .object({
    object_type: z.string().min(1),
    source_layer: z.enum(['relational', 'alpha_object', 'external']),
    object_id: z.string().min(1),
    organization_id: z.string().uuid(),
    principal_id: z.string().uuid()
  })
  .strict();

// Provenance-binding closure §5: 'verified_fact' fails closed without the
// COMPLETE typed evidence binding — a kind string alone never verifies.
const provenanceEntrySchema = z
  .object({
    input_path: z.string().min(1),
    kind: z.enum(['verified_fact', 'user_provided', 'assumption', 'estimate', 'derived', 'unresolved']),
    claim_id: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    as_of: z.string().nullable().optional(),
    source_ref: evidenceSourceRefSchema.nullable().optional(),
    source_field_path: z.string().nullable().optional(),
    source_value: z.string().nullable().optional(),
    freshness: z.enum(['current', 'recent', 'stale', 'unknown']).nullable().optional(),
    verification_status: z.enum(['verified', 'unverified', 'conflicting']).nullable().optional(),
    binding_policy_version: z.string().nullable().optional(),
    binding_rule_id: z.string().nullable().optional(),
    semantic_concept: z.string().nullable().optional(),
    source_evidence_category: z.string().nullable().optional(),
    target_evidence_category: z.string().nullable().optional()
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.kind !== 'verified_fact') return;
    const missing = (['claim_id', 'source_ref', 'source_field_path', 'source_value', 'freshness', 'verification_status', 'binding_policy_version', 'binding_rule_id', 'semantic_concept'] as const).filter((key) => !entry[key]);
    if (missing.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `verified_fact for '${entry.input_path}' requires a complete evidence binding; missing: ${missing.join(', ')}` });
      return;
    }
    if (entry.verification_status !== 'verified') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `verified_fact for '${entry.input_path}' must carry verification_status 'verified'` });
    }
    if (entry.freshness !== 'current' && entry.freshness !== 'recent') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `verified_fact for '${entry.input_path}' has unacceptable freshness '${entry.freshness}'` });
    }
  });

const currencyPolicySchema = z
  .object({
    base_currency: z.string().regex(/^[A-Z]{3}$/),
    conversion_allowed: z.boolean(),
    accepted_fx_sources: z.array(z.string()),
    fx_as_of_required: z.boolean(),
    allow_stale_rates: z.boolean(),
    rate_direction: z.literal('base_to_quote')
  })
  .strict();

const roundingPolicySchema = z
  .object({
    mode: z.literal('half_even'),
    monetary_scale: z.literal('currency_minor_units'),
    rate_scale: z.literal(10)
  })
  .strict();

const jsonObjectSchema = z.record(z.unknown());

const inputManifestSchema = jsonObjectSchema.refine(
  (manifest) =>
    typeof manifest.inputs === 'object' &&
    manifest.inputs !== null &&
    typeof manifest.currency_policy === 'object' &&
    typeof manifest.rounding_policy === 'object' &&
    'scenario_id' in manifest &&
    typeof manifest.provenance === 'object',
  { message: 'input_manifest must contain inputs, currency_policy, rounding_policy, scenario_id, and provenance' }
);

const resultEnvelopeSchema = jsonObjectSchema.refine(
  (envelope) =>
    typeof envelope.status === 'string' &&
    typeof envelope.eligibility === 'string' &&
    typeof envelope.outputs === 'object' &&
    envelope.outputs !== null &&
    Array.isArray(envelope.warnings) &&
    Array.isArray(envelope.validations) &&
    Array.isArray(envelope.assumptions_used) &&
    Array.isArray(envelope.missing_fields) &&
    Array.isArray(envelope.contradictions),
  { message: 'result_envelope must contain status, eligibility, outputs, warnings, validations, assumptions_used, missing_fields, and contradictions' }
);

export const financialCalculationRunDraftSchema = z
  .object({
    calculator_id: z.string().min(1),
    calculator_version: z.string().min(1),
    formula_version: z.string().min(1),
    organization_id: z.string().uuid(),
    principal_id: z.string().uuid(),
    principal_type: z.enum(['company', 'financier', 'platform_internal']),
    mandate_id: z.string().uuid(),
    mandate_version: z.number().int().positive(),
    task_id: z.string().uuid().nullable(),
    outcome_id: z.string().uuid().nullable().optional().default(null),
    scenario_id: z.string().nullable().optional().default(null),
    input_snapshot: jsonObjectSchema,
    input_provenance: z.array(provenanceEntrySchema),
    assumption_refs: z.array(z.string()),
    result: jsonObjectSchema,
    currency_policy: currencyPolicySchema,
    rounding_policy: roundingPolicySchema,
    input_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    result_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    input_manifest: inputManifestSchema,
    result_envelope: resultEnvelopeSchema,
    assumptions_used: z.array(z.string()),
    contradictions: z.array(z.string()),
    warnings: z.array(structuredWarningSchema),
    validations: z.array(validationFindingSchema),
    status: CALCULATION_STATUS,
    eligibility: CALCULATION_ELIGIBILITY,
    missing_fields: z.array(z.string()),
    executed_by: z.literal('workbench'),
    actor_user_id: z.string().uuid().nullable().optional().default(null),
    trace_id: z.string().min(1),
    idempotency_key: z.string().min(1),
    execution: z
      .object({
        duration_ms: z.number().int().nonnegative().nullable().optional().default(null),
        engine: z.literal('workbench')
      })
      .strict()
  })
  .strict();

export type ValidatedCalculationRunDraft = z.infer<typeof financialCalculationRunDraftSchema>;

export function parseCalculationRunDraft(raw: unknown): FinancialCalculationRunDraft {
  return financialCalculationRunDraftSchema.parse(raw) as unknown as FinancialCalculationRunDraft;
}
