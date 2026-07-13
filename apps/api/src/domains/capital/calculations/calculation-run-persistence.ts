import type { ClientBase } from 'pg';
import type {
  CalculationInputManifest,
  CalculationResultEnvelope,
  FinancialCalculationRun,
  FinancialCalculationRunDraft
} from '@traibox/contracts';
import { canonicalJson, deterministicCalculationHash } from './calculation-run-hashing';
import { parseCalculationRunDraft } from './calculation-run-schema';

/**
 * Production calculation-run persistence adapter (Part B §B4).
 *
 * Runs INSIDE a caller-owned, already-authenticated, RLS-scoped database
 * transaction (app.current_org / app.current_principal_* established by the
 * API request pipeline — never from unauthenticated request values). The
 * adapter:
 *   1. validates the draft's runtime shape strictly;
 *   2. verifies the transaction's RLS context matches the draft;
 *   3. verifies the org-backed active company mandate binding;
 *   4. verifies task and (optional) outcome ownership;
 *   5. independently recomputes BOTH hashes from the persisted manifests and
 *      rejects any record whose hashes cannot be reproduced;
 *   6. verifies the query-oriented projections agree with the result
 *      envelope (projections must never contradict the audit payload);
 *   7. inserts the append-only run and returns the typed record;
 *   8. never creates or mutates canonical Finance state.
 *
 * Idempotency (§B6): (org_id, idempotency_key) is deterministic — the first
 * valid request inserts; an exact repeat returns the existing record; a
 * repeat with a materially different payload raises
 * CalculationIdempotencyConflict and never overwrites or silently returns.
 */

export class CalculationPersistenceError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class CalculationIdempotencyConflict extends CalculationPersistenceError {
  constructor(details: Record<string, unknown>) {
    super('calculation.idempotency_conflict', 'idempotency key was already used with a materially different calculation payload', details);
  }
}

function requireAgreement(condition: boolean, code: string, message: string, details: Record<string, unknown> = {}): void {
  if (!condition) throw new CalculationPersistenceError(code, message, details);
}

/** Compare two JSON-safe values canonically (key order and list-order exact). */
function canonicallyEqual(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function verifyHashes(draft: FinancialCalculationRunDraft): void {
  const binding = {
    calculator_id: draft.calculator_id,
    calculator_version: draft.calculator_version,
    formula_version: draft.formula_version
  };
  const inputHash = deterministicCalculationHash(draft.input_manifest, binding);
  requireAgreement(inputHash === draft.input_hash, 'calculation.input_hash_mismatch', 'input_hash cannot be reproduced from the persisted input manifest', {
    declared: draft.input_hash,
    recomputed: inputHash
  });
  const resultHash = deterministicCalculationHash(draft.result_envelope, binding);
  requireAgreement(resultHash === draft.result_hash, 'calculation.result_hash_mismatch', 'result_hash cannot be reproduced from the persisted result envelope', {
    declared: draft.result_hash,
    recomputed: resultHash
  });
}

function verifyProjections(draft: FinancialCalculationRunDraft): void {
  const envelope = draft.result_envelope as CalculationResultEnvelope;
  requireAgreement(envelope.status === draft.status, 'calculation.projection_status_mismatch', 'status projection contradicts the result envelope', {
    projection: draft.status,
    envelope: envelope.status
  });
  requireAgreement(
    envelope.eligibility === draft.eligibility,
    'calculation.projection_eligibility_mismatch',
    'eligibility projection contradicts the result envelope',
    { projection: draft.eligibility, envelope: envelope.eligibility }
  );
  requireAgreement(
    canonicallyEqual(envelope.outputs, draft.result),
    'calculation.projection_result_mismatch',
    'result projection contradicts the result envelope outputs',
    {}
  );
  requireAgreement(
    canonicallyEqual(envelope.warnings, draft.warnings),
    'calculation.projection_warnings_mismatch',
    'warnings projection contradicts the result envelope',
    {}
  );
  requireAgreement(
    canonicallyEqual(envelope.validations, draft.validations),
    'calculation.projection_validations_mismatch',
    'validations projection contradicts the result envelope',
    {}
  );
  // Envelope lists are canonically sorted; projections may carry the
  // calculator's original order but must contain exactly the same items.
  const sorted = (values: string[]) => [...values].sort();
  requireAgreement(
    canonicallyEqual(envelope.missing_fields, sorted(draft.missing_fields)),
    'calculation.projection_missing_fields_mismatch',
    'missing_fields projection contradicts the result envelope',
    {}
  );
  requireAgreement(
    canonicallyEqual(envelope.assumptions_used, sorted(draft.assumptions_used)),
    'calculation.projection_assumptions_mismatch',
    'assumptions_used projection contradicts the result envelope',
    {}
  );
  requireAgreement(
    canonicallyEqual(envelope.contradictions, sorted(draft.contradictions)),
    'calculation.projection_contradictions_mismatch',
    'contradictions projection contradicts the result envelope',
    {}
  );
  const manifest = draft.input_manifest as CalculationInputManifest;
  requireAgreement(
    (manifest.scenario_id ?? null) === (draft.scenario_id ?? null),
    'calculation.projection_scenario_mismatch',
    'scenario identity contradicts the hashed input manifest',
    { projection: draft.scenario_id ?? null, manifest: manifest.scenario_id ?? null }
  );
}

async function verifyRlsContext(client: ClientBase, draft: FinancialCalculationRunDraft): Promise<void> {
  const context = await client.query<{ org_id: string | null }>('SELECT app.current_org()::text AS org_id');
  const orgId = context.rows[0]?.org_id ?? null;
  requireAgreement(
    orgId === draft.organization_id,
    'calculation.rls_context_mismatch',
    'the transaction RLS organization context does not match the draft organization; the adapter never trusts unauthenticated principals',
    { context_org: orgId, draft_org: draft.organization_id }
  );
}

async function verifyBindings(client: ClientBase, draft: FinancialCalculationRunDraft): Promise<void> {
  requireAgreement(
    draft.principal_type === 'company',
    'calculation.principal_not_company',
    'only the active company principal may persist calculation runs in this phase',
    { principal_type: draft.principal_type }
  );
  requireAgreement(
    draft.principal_id === draft.organization_id,
    'calculation.principal_not_org_backed',
    'company principals are org-backed: principal_id must equal organization_id (CA-113)',
    { principal_id: draft.principal_id, organization_id: draft.organization_id }
  );

  const mandate = await client.query(
    `SELECT status, principal_type FROM agent_mandates
     WHERE mandate_id = $1 AND version = $2 AND org_id = $3 AND principal_id = $4 AND principal_type = $5`,
    [draft.mandate_id, draft.mandate_version, draft.organization_id, draft.principal_id, draft.principal_type]
  );
  requireAgreement(mandate.rowCount === 1, 'calculation.mandate_not_found', 'exact mandate version not found for this organization and principal', {
    mandate_id: draft.mandate_id,
    mandate_version: draft.mandate_version
  });
  requireAgreement(mandate.rows[0].status === 'active', 'calculation.mandate_not_active', 'the bound mandate version is not active', {
    status: mandate.rows[0].status
  });

  requireAgreement(draft.task_id !== null, 'calculation.task_required', 'governed calculation runs are always task-bound', {});
  const task = await client.query(
    `SELECT mandate_id, mandate_version FROM alpha_agent_tasks
     WHERE agent_task_id = $1 AND org_id = $2 AND principal_id = $3 AND principal_type = $4`,
    [draft.task_id, draft.organization_id, draft.principal_id, draft.principal_type]
  );
  requireAgreement(task.rowCount === 1, 'calculation.task_not_owned', 'task does not belong to this organization and principal', {
    task_id: draft.task_id
  });
  requireAgreement(
    task.rows[0].mandate_id === draft.mandate_id && task.rows[0].mandate_version === draft.mandate_version,
    'calculation.task_mandate_mismatch',
    'the task is bound to a different mandate than the calculation run',
    { task_mandate: task.rows[0].mandate_id, run_mandate: draft.mandate_id }
  );

  if (draft.outcome_id) {
    const outcome = await client.query(
      `SELECT 1 FROM agent_outcomes
       WHERE outcome_id = $1 AND task_id = $2 AND org_id = $3 AND principal_id = $4 AND principal_type = $5
         AND mandate_id = $6 AND mandate_version = $7`,
      [draft.outcome_id, draft.task_id, draft.organization_id, draft.principal_id, draft.principal_type, draft.mandate_id, draft.mandate_version]
    );
    requireAgreement(outcome.rowCount === 1, 'calculation.outcome_not_owned', 'outcome does not belong to the same task, principal, and mandate', {
      outcome_id: draft.outcome_id
    });
  }
}

interface RunRow {
  run_id: string;
  calculator_id: string;
  calculator_version: string;
  formula_version: string;
  org_id: string;
  principal_id: string;
  principal_type: FinancialCalculationRun['principal_type'];
  mandate_id: string;
  mandate_version: number;
  task_id: string | null;
  outcome_id: string | null;
  scenario_id: string | null;
  input_snapshot_json: Record<string, unknown>;
  input_provenance_json: FinancialCalculationRun['input_provenance'];
  assumption_claim_ids_json: string[];
  result_json: Record<string, unknown>;
  currency_policy_json: FinancialCalculationRun['currency_policy'];
  rounding_policy_json: FinancialCalculationRun['rounding_policy'];
  input_hash: string;
  result_hash: string;
  input_manifest_json: CalculationInputManifest;
  result_envelope_json: CalculationResultEnvelope;
  assumptions_used_json: string[];
  contradictions_json: string[];
  warnings_json: FinancialCalculationRun['warnings'];
  validation_results_json: FinancialCalculationRun['validations'];
  status: FinancialCalculationRun['status'];
  eligibility: FinancialCalculationRun['eligibility'] | null;
  missing_fields_json: string[];
  executed_by: 'workbench';
  actor_user_id: string | null;
  trace_id: string;
  idempotency_key: string | null;
  execution_metadata_json: FinancialCalculationRun['execution'];
  created_at: Date;
}

function rowToRun(row: RunRow): FinancialCalculationRun {
  return {
    run_id: row.run_id,
    calculator_id: row.calculator_id,
    calculator_version: row.calculator_version,
    formula_version: row.formula_version,
    organization_id: row.org_id,
    principal_id: row.principal_id,
    principal_type: row.principal_type,
    mandate: { mandate_id: row.mandate_id, mandate_version: row.mandate_version },
    task_id: row.task_id,
    outcome_id: row.outcome_id,
    scenario_id: row.scenario_id,
    input_snapshot: row.input_snapshot_json,
    input_provenance: row.input_provenance_json,
    assumption_refs: row.assumption_claim_ids_json,
    result: row.result_json,
    currency_policy: row.currency_policy_json,
    rounding_policy: row.rounding_policy_json,
    input_hash: row.input_hash,
    result_hash: row.result_hash,
    input_manifest: row.input_manifest_json,
    result_envelope: row.result_envelope_json,
    assumptions_used: row.assumptions_used_json,
    contradictions: row.contradictions_json,
    warnings: row.warnings_json,
    validations: row.validation_results_json,
    status: row.status,
    eligibility: row.eligibility ?? 'not_applicable',
    missing_fields: row.missing_fields_json,
    executed_by: row.executed_by,
    actor_user_id: row.actor_user_id,
    trace_id: row.trace_id,
    idempotency_key: row.idempotency_key ?? '',
    execution: row.execution_metadata_json,
    created_at: row.created_at.toISOString()
  };
}

const RUN_COLUMNS = `run_id, calculator_id, calculator_version, formula_version, org_id, principal_id, principal_type,
  mandate_id, mandate_version, task_id, outcome_id, scenario_id, input_snapshot_json, input_provenance_json,
  assumption_claim_ids_json, result_json, currency_policy_json, rounding_policy_json, input_hash, result_hash,
  input_manifest_json, result_envelope_json, assumptions_used_json, contradictions_json, warnings_json,
  validation_results_json, status, eligibility, missing_fields_json, executed_by, actor_user_id, trace_id,
  idempotency_key, execution_metadata_json, created_at`;

/** Fields that must match EXACTLY for an idempotent replay to return the
 * existing record instead of conflicting (§B6). */
function idempotentReplayMatches(existing: RunRow, draft: FinancialCalculationRunDraft): boolean {
  return (
    existing.principal_id === draft.principal_id &&
    existing.principal_type === draft.principal_type &&
    existing.mandate_id === draft.mandate_id &&
    existing.mandate_version === draft.mandate_version &&
    existing.task_id === draft.task_id &&
    (existing.outcome_id ?? null) === (draft.outcome_id ?? null) &&
    existing.calculator_id === draft.calculator_id &&
    existing.calculator_version === draft.calculator_version &&
    existing.formula_version === draft.formula_version &&
    existing.input_hash === draft.input_hash &&
    existing.result_hash === draft.result_hash
  );
}

/**
 * Persist a Workbench-produced calculation run. `client` must be a caller-
 * owned transaction with the authenticated RLS org context already
 * established. Touches only financial_calculation_runs — never Finance state.
 */
export async function persistCalculationRun(client: ClientBase, rawDraft: unknown): Promise<FinancialCalculationRun> {
  const draft = parseCalculationRunDraft(rawDraft);
  await verifyRlsContext(client, draft);
  await verifyBindings(client, draft);
  verifyHashes(draft);
  verifyProjections(draft);

  const inserted = await client.query<RunRow>(
    `INSERT INTO financial_calculation_runs (
       calculator_id, calculator_version, formula_version, org_id, principal_id, principal_type,
       mandate_id, mandate_version, task_id, outcome_id, scenario_id,
       input_snapshot_json, input_provenance_json, assumption_claim_ids_json, result_json,
       currency_policy_json, rounding_policy_json, input_hash, result_hash,
       input_manifest_json, result_envelope_json, assumptions_used_json, contradictions_json,
       warnings_json, validation_results_json, status, eligibility, missing_fields_json,
       executed_by, actor_user_id, trace_id, idempotency_key, execution_metadata_json
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19,
       $20::jsonb, $21::jsonb, $22::jsonb, $23::jsonb, $24::jsonb, $25::jsonb, $26, $27, $28::jsonb,
       $29, $30, $31, $32, $33::jsonb
     )
     ON CONFLICT (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING ${RUN_COLUMNS}`,
    [
      draft.calculator_id,
      draft.calculator_version,
      draft.formula_version,
      draft.organization_id,
      draft.principal_id,
      draft.principal_type,
      draft.mandate_id,
      draft.mandate_version,
      draft.task_id,
      draft.outcome_id ?? null,
      draft.scenario_id ?? null,
      JSON.stringify(draft.input_snapshot),
      JSON.stringify(draft.input_provenance),
      JSON.stringify(draft.assumption_refs),
      JSON.stringify(draft.result),
      JSON.stringify(draft.currency_policy),
      JSON.stringify(draft.rounding_policy),
      draft.input_hash,
      draft.result_hash,
      JSON.stringify(draft.input_manifest),
      JSON.stringify(draft.result_envelope),
      JSON.stringify(draft.assumptions_used),
      JSON.stringify(draft.contradictions),
      JSON.stringify(draft.warnings),
      JSON.stringify(draft.validations),
      draft.status,
      draft.eligibility,
      JSON.stringify(draft.missing_fields),
      draft.executed_by,
      draft.actor_user_id ?? null,
      draft.trace_id,
      draft.idempotency_key,
      JSON.stringify(draft.execution)
    ]
  );

  const insertedRow = inserted.rows[0];
  if (insertedRow) {
    return rowToRun(insertedRow);
  }

  // Concurrency-safe idempotent path: the key already exists in this org.
  const existing = await client.query<RunRow>(
    `SELECT ${RUN_COLUMNS} FROM financial_calculation_runs WHERE org_id = $1 AND idempotency_key = $2`,
    [draft.organization_id, draft.idempotency_key]
  );
  const record = existing.rows[0];
  if (!record) {
    throw new CalculationPersistenceError('calculation.idempotency_lookup_failed', 'insert conflicted but the existing record could not be read', {
      idempotency_key: draft.idempotency_key
    });
  }
  if (!idempotentReplayMatches(record, draft)) {
    throw new CalculationIdempotencyConflict({
      idempotency_key: draft.idempotency_key,
      existing_run_id: record.run_id,
      existing_input_hash: record.input_hash,
      declared_input_hash: draft.input_hash
    });
  }
  return rowToRun(record);
}
