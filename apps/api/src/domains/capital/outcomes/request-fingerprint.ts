import { createHash } from 'node:crypto';
import { canonicalJson } from '../calculations/calculation-run-hashing';

/**
 * Canonical outcome request/execution fingerprints (Phase 4.1 §3).
 *
 * The request manifest is the SEMANTIC identity of an outcome request:
 * outcome type + definition version, objective, normalized structured inputs,
 * normalized caller input facts, authorized object references, document
 * content hashes + metadata, currency and rounding policies, requested
 * authority, exact principal, and exact mandate version. Volatile transport
 * fields (trace ids, actor session data, timestamps) are structurally
 * excluded — two semantically identical requests hash identically across
 * retries. The execution fingerprint is the immutable identity of what was
 * actually produced.
 */

export const REQUEST_MANIFEST_VERSION = 'capital-outcome-request-v1';

export interface OutcomeRequestIdentity {
  outcome_type: string;
  definition_version: string;
  objective: string;
  inputs: Record<string, unknown>;
  input_facts: Array<Record<string, unknown>>;
  authorized_object_refs: Array<Record<string, unknown>>;
  evidence_bindings?: Array<Record<string, unknown>>;
  documents: Array<{ source_id: string; content: string; media_type?: string | null }>;
  currency_policy: Record<string, unknown>;
  rounding_policy?: Record<string, unknown> | null;
  requested_authority: string;
  organization_id: string;
  principal_id: string;
  principal_type: string;
  mandate_id: string;
  mandate_version: number;
}

function sha256Hex(payload: string): string {
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}

export function buildRequestManifest(identity: OutcomeRequestIdentity): Record<string, unknown> {
  return {
    manifest_version: REQUEST_MANIFEST_VERSION,
    outcome_type: identity.outcome_type,
    definition_version: identity.definition_version,
    objective: identity.objective,
    inputs: identity.inputs,
    input_facts: identity.input_facts,
    authorized_object_refs: identity.authorized_object_refs,
    evidence_bindings: identity.evidence_bindings ?? [],
    // Documents contribute their CONTENT HASH + metadata, not raw content —
    // large uploads hash identically without bloating the manifest.
    documents: identity.documents.map((document) => ({
      source_id: document.source_id,
      media_type: document.media_type ?? null,
      content_sha256: sha256Hex(document.content)
    })),
    currency_policy: identity.currency_policy,
    rounding_policy: identity.rounding_policy ?? null,
    requested_authority: identity.requested_authority,
    principal: { organization_id: identity.organization_id, principal_id: identity.principal_id, principal_type: identity.principal_type },
    mandate: { mandate_id: identity.mandate_id, mandate_version: identity.mandate_version }
  };
}

export function computeRequestHash(identity: OutcomeRequestIdentity): string {
  return sha256Hex(canonicalJson(buildRequestManifest(identity)));
}

/** Immutable result fingerprint saved at persistence time: execution + audit
 * identity of everything the run produced (never trace ids). */
export function computeExecutionHash(result: Record<string, unknown>): string {
  const calculations = (result.calculations as Array<Record<string, unknown>> | undefined) ?? [];
  const payload = {
    fingerprint_version: 'capital-outcome-execution-v1',
    outcome_type: result.outcome_type,
    definition_version: result.definition_version,
    execution_status: result.execution_status,
    persisted_status: result.persisted_status,
    confidence: result.confidence,
    synthesis_source: result.synthesis_source,
    evidence_coverage: result.evidence_coverage ?? {},
    calculation_hashes: calculations
      .map((calculation) => ({ key: calculation.key, input_hash: calculation.input_hash, result_hash: calculation.result_hash, status: calculation.status }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key))),
    unresolved_questions: result.unresolved_questions ?? [],
    contradictions: result.contradictions ?? [],
    recommendation_summary: (result.recommendation as Record<string, unknown> | null)?.summary ?? null
  };
  return sha256Hex(canonicalJson(payload));
}
