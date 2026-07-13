"""Governed outcome execution (Phase 4 §§D1–D4).

Pipeline: authenticated Capital task → exact mandate → exact outcome
definition → authorized evidence (typed input facts + untrusted documents) →
deterministic calculation tools → typed evidence bundle → structured
synthesis → recommendation → versioned Capital artifact draft → persisted
outcome result (persistence is owned by the TypeScript API).

No stage creates canonical Finance state. Material arithmetic happens only in
the Workbench; the model port contributes wording. Execution is deterministic
for a fixed request (stable claim ids, stable calculation idempotency keys,
stable hashes) — replays produce identical results.
"""

from __future__ import annotations

from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..agents.framework.authority import authority_rank, validate_level
from ..agents.framework.definition import AgentDefinition
from ..agents.framework.errors import FrameworkViolation, MandateViolation
from ..agents.framework.mandate import Mandate, validate_mandate
from ..workbench.context import WorkbenchExecutionContext, execute_authorized_calculation
from ..workbench.errors import WorkbenchError
from ..workbench.registry import WorkbenchRegistry, _comparable_value as comparable_value, _expand_material_paths, resolve_path as wb_resolve_path
from ..workbench.request import CalculationRequest, CalculationResult, FinancialCalculationRunDraft, build_run_draft
from .artifacts import CapitalArtifactDraft, CalculationAppendixEntry, GeneratedBy, build_evidence_index
from .claims import ClaimFactory, EvidenceBundle
from .definition import EXECUTION_STATUSES, PERSISTED_STATUS_FOR_EXECUTION, OutcomeDefinition, OutcomeDefinitionRegistry
from .recommendation import AlternativeConsidered, Recommendation, RecommendationCondition, RecommendationRisk
from .synthesis import SynthesisResult, synthesize

OUTCOME_EXECUTION_CONTRACT_VERSION = "capital-outcome-execution-v1"
OUTCOME_RESULT_CONTRACT_VERSION = "capital-outcome-result-v1"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class InputFact(_Strict):
    """Provenance declaration for one CALLER-SUPPLIED outcome input path.

    Trust model (Phase 4.1 §5): the caller can never self-declare canonical
    verification — a caller-supplied kind of 'verified_fact' is DOWNGRADED to
    user_provided at intake. Verified facts exist only through
    canonical_snapshots resolved server-side by the TypeScript API."""

    input_path: str = Field(min_length=1)
    kind: Literal["verified_fact", "user_provided", "assumption", "estimate", "derived", "unresolved"]
    statement: str | None = None
    claim_source: str | None = None
    as_of: str | None = None
    category: str | None = None
    contradicts_paths: list[str] = Field(default_factory=list)


class CanonicalFieldFact(_Strict):
    """One field from a canonical snapshot (provenance-binding closure §3).

    STRUCTURED FIRST: `value` (with `value_type` and unit semantics) is the
    authoritative comparison value for calculator-input bindings; the
    human-readable `statement` is derived presentation and never compared."""

    input_path: str = Field(min_length=1)
    statement: str = Field(min_length=1)
    field_path: str | None = None  # canonical field path; defaults to input_path
    value: str | None = None
    value_type: Literal["decimal", "integer", "boolean", "string", "date"] | None = None
    currency: str | None = None
    unit: str | None = None
    category: str | None = None
    as_of: str | None = None

    def canonical_field_path(self) -> str:
        return self.field_path or self.input_path


class EvidenceBindingRequest(_Strict):
    """A caller-PROPOSED mapping from a canonical snapshot field to a specific
    calculator input path (§4). The proposal grants nothing: the governed
    engine verifies snapshot ownership, freshness, non-contradiction, and an
    exact normalized value match before any input becomes verified."""

    calculator_key: str = Field(min_length=1)
    input_path: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    source_field_path: str = Field(min_length=1)


class CanonicalSnapshot(_Strict):
    """A canonical object snapshot resolved by the AUTHENTICATED API under the
    organization/principal RLS context (Phase 4.1 §6). The Trade Brain never
    queries canonical state itself; it receives these normalized snapshots
    with auditable identity + freshness and turns their facts into VERIFIED
    claims with typed canonical source references."""

    object_type: str = Field(min_length=1)
    source_layer: Literal["relational", "alpha_object", "external"]
    object_id: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    principal_id: str = Field(min_length=1)
    retrieved_at: str = Field(min_length=1)
    as_of: str | None = None
    freshness: Literal["current", "recent", "stale", "unknown"] = "current"
    facts: list[CanonicalFieldFact] = Field(default_factory=list)


class OutcomeDocument(_Strict):
    source_id: str = Field(min_length=1)
    content: str
    media_type: str | None = None


class OutcomeExecutionRequest(_Strict):
    contract_version: Literal["capital-outcome-execution-v1"]
    outcome_type: str = Field(min_length=1)
    definition_version: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    principal_id: str = Field(min_length=1)
    principal_type: Literal["company", "financier", "platform_internal"]
    mandate_id: str = Field(min_length=1)
    mandate_version: int = Field(gt=0)
    task_id: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    requested_authority: str = Field(min_length=1)
    tool_scope: list[str] = Field(default_factory=lambda: ["calculation"])
    data_scope: list[str] = Field(default_factory=lambda: ["finance_read", "trade_context"])
    inputs: dict[str, Any] = Field(default_factory=dict)
    input_facts: list[InputFact] = Field(default_factory=list)
    authorized_object_refs: list[dict[str, Any]] = Field(default_factory=list)
    canonical_snapshots: list[CanonicalSnapshot] = Field(default_factory=list)
    evidence_bindings: list[EvidenceBindingRequest] = Field(default_factory=list)
    documents: list[OutcomeDocument] = Field(default_factory=list)
    currency_policy: dict[str, Any]
    rounding_policy: dict[str, Any] | None = None
    trace_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    actor_user_id: str | None = None


class CalculationSummary(_Strict):
    key: str
    calculator_id: str
    calculator_version: str
    formula_version: str
    status: str
    eligibility: str
    input_hash: str
    result_hash: str
    idempotency_key: str
    outputs: dict[str, Any] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)


class OutcomeResult(_Strict):
    contract_version: Literal["capital-outcome-result-v1"] = OUTCOME_RESULT_CONTRACT_VERSION
    outcome_type: str
    definition_version: str
    execution_status: Literal["completed", "needs_information", "abstained", "failed"]
    persisted_status: str
    organization_id: str
    principal_id: str
    principal_type: str
    mandate_id: str
    mandate_version: int
    task_id: str
    objective: str
    evidence: EvidenceBundle
    calculation_drafts: list[FinancialCalculationRunDraft] = Field(default_factory=list)
    calculations: list[CalculationSummary] = Field(default_factory=list)
    composed: dict[str, Any] = Field(default_factory=dict)
    recommendation: Recommendation | None = None
    artifact: CapitalArtifactDraft | None = None
    unresolved_questions: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    targeted_questions: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "medium"
    # Phase 4.1 §7: per-category evidence status (verified | user_provided |
    # stale | contradictory | missing) + trust-model downgrade notes (§5).
    evidence_coverage: dict[str, str] = Field(default_factory=dict)
    trust_notes: list[str] = Field(default_factory=list)
    provisional: bool = False
    policy_violations: list[dict[str, Any]] = Field(default_factory=list)
    replay_events: list[dict[str, Any]] = Field(default_factory=list)
    synthesis_source: str = "deterministic"
    injection_findings: list[str] = Field(default_factory=list)
    abstention_reason: str | None = None
    trace_id: str
    idempotency_key: str


def _confidence(gaps: list[str], assumptions: list[str], contradictions: list[str]) -> str:
    if contradictions:
        return "low"
    if gaps:
        return "low" if len(gaps) > 2 else "medium"
    if assumptions:
        return "medium"
    return "high"


def _capped_confidence(gaps: list[str], assumptions: list[str], contradictions: list[str], provisional_categories: list[str]) -> str:
    """§7: required categories satisfied only by user-provided evidence cap
    confidence at medium — high confidence requires canonical verification."""
    base = _confidence(gaps, assumptions, contradictions)
    if provisional_categories and base == "high":
        return "medium"
    return base


def execute_outcome(
    raw_request: OutcomeExecutionRequest | dict[str, Any],
    *,
    definitions: OutcomeDefinitionRegistry,
    workbench: WorkbenchRegistry,
    mandate_loader: Callable[[str, int], Mandate | None],
    agent_definition: AgentDefinition,
    model_port: Any = None,
    model_provider: str = "deterministic",
    model_id: str = "none",
) -> OutcomeResult:
    request = raw_request if isinstance(raw_request, OutcomeExecutionRequest) else OutcomeExecutionRequest.model_validate(raw_request)
    replay: list[dict[str, Any]] = []

    def event(name: str, **payload: Any) -> None:
        replay.append({"event": name, "trace_id": request.trace_id, **payload})

    def fail(code: str, message: str, **extra: Any) -> OutcomeResult:
        event("outcome.failed_closed", code=code)
        return OutcomeResult(
            outcome_type=request.outcome_type,
            definition_version=request.definition_version,
            execution_status="failed",
            persisted_status=PERSISTED_STATUS_FOR_EXECUTION["failed"],
            organization_id=request.organization_id,
            principal_id=request.principal_id,
            principal_type=request.principal_type,
            mandate_id=request.mandate_id,
            mandate_version=request.mandate_version,
            task_id=request.task_id,
            objective=request.objective,
            evidence=EvidenceBundle(),
            policy_violations=[{"code": code, "message": message, **extra}],
            replay_events=replay,
            trace_id=request.trace_id,
            idempotency_key=request.idempotency_key,
        )

    # ------------------------------------------------------------------
    # 1. Authority, principal, mandate, definition — before any content.
    # ------------------------------------------------------------------
    try:
        validate_level(request.requested_authority)
    except FrameworkViolation as violation:
        return fail(violation.code, violation.message)
    event("outcome.requested", outcome_type=request.outcome_type, definition_version=request.definition_version)

    mandate = mandate_loader(request.mandate_id, request.mandate_version)
    if mandate is None:
        return fail("mandate.not_found", f"mandate {request.mandate_id}@{request.mandate_version} not found")
    try:
        validate_mandate(
            mandate=mandate,
            definition=agent_definition,
            org_id=request.organization_id,
            principal_id=request.principal_id,
            principal_type=request.principal_type,
            requested_outcome_type=request.outcome_type,
            requested_authority=request.requested_authority,
        )
    except FrameworkViolation as violation:  # MandateViolation, AuthorityViolation
        return fail(violation.code, violation.message)

    try:
        definition = definitions.get(request.outcome_type, request.definition_version)
    except FrameworkViolation as violation:
        return fail(violation.code, violation.message)
    if request.principal_type not in definition.supported_principal_types:
        return fail(
            "outcome.principal_not_supported",
            f"outcome {definition.outcome_type} is not executable for principal type '{request.principal_type}' — financier-direct functionality is inactive",
        )
    if authority_rank(request.requested_authority) < authority_rank(definition.required_authority):
        return fail(
            "outcome.insufficient_authority",
            f"outcome requires authority '{definition.required_authority}'; requested '{request.requested_authority}'",
        )
    if "calculation" not in request.tool_scope and definition.calculations:
        return fail("outcome.tool_scope_missing_calculation", "the task tool scope does not permit calculation tools")

    # ------------------------------------------------------------------
    # 2. Evidence claims — trust model (Phase 4.1 §§5–6).
    #
    # VERIFIED facts come only from canonical snapshots the authenticated API
    # resolved server-side. Caller-supplied facts can never self-declare
    # verification: a caller 'verified_fact' is downgraded to user_provided
    # and the downgrade is recorded.
    # ------------------------------------------------------------------
    claims = ClaimFactory(principal_id=request.principal_id, principal_type=request.principal_type, trace_id=request.trace_id)
    bundle_claims = []
    from .claims import ClaimSourceRef  # local import to keep module top clean

    trust_notes: list[str] = []
    category_evidence: dict[str, set[str]] = {}

    def record_category(category: str | None, kind: str) -> None:
        if category:
            category_evidence.setdefault(category, set()).add(kind)

    claim_id_by_path: dict[str, str] = {}
    canonical_fact_index: dict[tuple[str, str], tuple[CanonicalSnapshot, CanonicalFieldFact, Any]] = {}
    for snapshot in request.canonical_snapshots:
        if snapshot.organization_id != request.organization_id or snapshot.principal_id != request.principal_id:
            return fail(
                "outcome.snapshot_principal_mismatch",
                f"canonical snapshot {snapshot.object_type}:{snapshot.object_id} was resolved for a different organization/principal",
            )
        source = ClaimSourceRef(
            source_type="canonical_object",
            object_ref={
                "object_type": snapshot.object_type,
                "source_layer": snapshot.source_layer,
                "object_id": snapshot.object_id,
                "organization_id": snapshot.organization_id,
                "retrieved_at": snapshot.retrieved_at,
                "freshness": snapshot.freshness,
            },
            detail=f"{snapshot.source_layer}:{snapshot.object_type}:{snapshot.object_id}",
        )
        for fact in snapshot.facts:
            claim = claims.verified_fact(fact.statement, source=source, as_of=fact.as_of or snapshot.as_of or snapshot.retrieved_at)
            if snapshot.freshness in ("stale", "unknown"):
                # Stale canonical data is auditable but not CURRENTLY verified.
                claim = claim.model_copy(update={"verification_status": "unverified", "confidence": "medium"})
                trust_notes.append(f"snapshot {snapshot.object_type}:{snapshot.object_id} is {snapshot.freshness}; its facts are not treated as currently verified")
                record_category(fact.category, "stale")
            else:
                record_category(fact.category, "verified")
            bundle_claims.append(claim)
            claim_id_by_path[fact.input_path] = claim.claim_id
            canonical_fact_index[(snapshot.object_id, fact.canonical_field_path())] = (snapshot, fact, claim)

    for fact in request.input_facts:
        statement = fact.statement or f"{fact.input_path} = {_resolve_input(request.inputs, fact.input_path)!r}"
        effective_kind = fact.kind
        if fact.kind == "verified_fact":
            effective_kind = "user_provided"
            trust_notes.append(
                f"caller-declared verification for '{fact.input_path}' was downgraded to user_provided — verification requires a canonical object read"
            )
        if effective_kind == "user_provided":
            claim = claims.user_provided(statement)
            record_category(fact.category, "user_provided")
        elif effective_kind == "assumption":
            claim = claims.assumption(statement)
            record_category(fact.category, "assumption")
        elif effective_kind in ("estimate", "derived"):
            claim = claims.estimate(statement)
            record_category(fact.category, "assumption")
        else:  # unresolved
            claim = claims.unresolved_question(fact.statement or f"value for {fact.input_path} is unresolved")
            record_category(fact.category, "unresolved")
        bundle_claims.append(claim)
        claim_id_by_path[fact.input_path] = claim.claim_id
    for fact in request.input_facts:
        if fact.contradicts_paths:
            contradicted = [claim_id_by_path[path] for path in fact.contradicts_paths if path in claim_id_by_path]
            own = claim_id_by_path.get(fact.input_path)
            statement = f"'{fact.input_path}' contradicts {', '.join(fact.contradicts_paths)}"
            bundle_claims.append(claims.contradiction(statement, contradicts=[c for c in ([own] if own else []) + contradicted]))
            record_category(fact.category, "contradictory")
    event("outcome.evidence_assembled", claims=len(bundle_claims), snapshots=len(request.canonical_snapshots), trust_downgrades=len(trust_notes))

    # ------------------------------------------------------------------
    # 2b. Required evidence categories are executable policy (Phase 4.1 §7;
    # coverage is computed AFTER the calculations, bound to consumed inputs).
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 3. Deterministic calculations through the governed Workbench path.
    # ------------------------------------------------------------------
    context = WorkbenchExecutionContext(
        organization_id=request.organization_id,
        principal_id=request.principal_id,
        principal_type=request.principal_type,  # type: ignore[arg-type]
        mandate_id=request.mandate_id,
        mandate_version=request.mandate_version,
        task_id=request.task_id,
        requested_authority=request.requested_authority,
        effective_authority=request.requested_authority,
        effective_tool_classes=list(request.tool_scope),
        effective_data_classes=list(request.data_scope),
        trace_id=request.trace_id,
    )
    drafts: list[FinancialCalculationRunDraft] = []
    summaries: list[CalculationSummary] = []
    results_by_key: dict[str, CalculationResult] = {}
    material_gaps: list[str] = []
    hard_failures: list[dict[str, Any]] = []
    # Per-(calculator key, input path) provenance kind AFTER trust
    # normalization + engine binding — the basis for §7 category coverage.
    bound_kind_by_path: dict[tuple[str, str], str] = {}
    material_paths_by_key: dict[str, list[str]] = {}
    stale_binding_categories: set[str] = set()
    bindings_by_key: dict[str, list[EvidenceBindingRequest]] = {}
    for binding in request.evidence_bindings:
        bindings_by_key.setdefault(binding.calculator_key, []).append(binding)

    for required in definition.calculations:
        spec = required.builder(request.inputs)
        if spec is None:
            event("outcome.calculation_skipped", key=required.key)
            continue

        # --------------------------------------------------------------
        # Trust normalization (§1): caller-supplied calculator-section
        # provenance can NEVER independently establish verification — nested
        # 'verified_fact' is downgraded exactly like top-level input_facts.
        # --------------------------------------------------------------
        normalized_provenance: dict[str, dict[str, Any]] = {}
        for raw_entry in spec.get("provenance", []):
            entry = dict(raw_entry)
            if entry.get("kind") == "verified_fact":
                entry = {"input_path": entry["input_path"], "kind": "user_provided"}
                trust_notes.append(
                    f"caller-declared verification for calculator input '{required.key}.{raw_entry['input_path']}' was downgraded to user_provided — "
                    "verification requires a canonical evidence binding"
                )
            normalized_provenance[str(entry["input_path"])] = entry

        # --------------------------------------------------------------
        # Engine-generated evidence bindings (§§2, 4): a proposed canonical
        # field ↔ calculator input mapping becomes 'verified_fact' ONLY when
        # the snapshot belongs to this principal (enforced above), is fresh,
        # is not contradicted, and its STRUCTURED value exactly matches the
        # calculator input value after normalization.
        # --------------------------------------------------------------
        contradicted_claim_ids = {contradicted for claim in bundle_claims if claim.claim_type == "contradiction" for contradicted in claim.contradicts_claim_ids}
        for binding in bindings_by_key.get(required.key, []):
            indexed = canonical_fact_index.get((binding.object_id, binding.source_field_path))
            if indexed is None:
                trust_notes.append(f"binding for '{required.key}.{binding.input_path}' references unknown canonical field {binding.object_id}:{binding.source_field_path}; not verified")
                continue
            snapshot, fact, canonical_claim = indexed
            if fact.value is None:
                trust_notes.append(f"canonical field {binding.source_field_path} has no structured value; a prose statement cannot verify '{required.key}.{binding.input_path}'")
                continue
            if snapshot.freshness not in ("current", "recent"):
                trust_notes.append(f"canonical field {binding.source_field_path} is {snapshot.freshness}; a stale source cannot create a current verified binding for '{required.key}.{binding.input_path}'")
                if fact.category:
                    stale_binding_categories.add(fact.category)
                continue
            if canonical_claim.claim_id in contradicted_claim_ids:
                trust_notes.append(f"canonical field {binding.source_field_path} is contradicted; it cannot verify '{required.key}.{binding.input_path}'")
                continue
            present, input_value = wb_resolve_path(spec["inputs"], binding.input_path)
            if not present:
                trust_notes.append(f"binding for '{required.key}.{binding.input_path}' targets an absent calculator input; not verified")
                continue
            if comparable_value(input_value) != comparable_value(fact.value):
                statement = (
                    f"canonical {snapshot.object_type} field '{binding.source_field_path}' has value {fact.value}, but the calculator input "
                    f"'{required.key}.{binding.input_path}' was supplied as {input_value} — the values do not match"
                )
                bundle_claims.append(claims.contradiction(statement, contradicts=[canonical_claim.claim_id]))
                record_category(fact.category, "contradictory")
                trust_notes.append(f"binding value mismatch for '{required.key}.{binding.input_path}'; the input is NOT verified")
                continue
            normalized_provenance[binding.input_path] = {
                "input_path": binding.input_path,
                "kind": "verified_fact",
                "claim_id": canonical_claim.claim_id,
                "source_ref": {
                    "object_type": snapshot.object_type,
                    "source_layer": snapshot.source_layer,
                    "object_id": snapshot.object_id,
                    "organization_id": snapshot.organization_id,
                    "principal_id": snapshot.principal_id,
                },
                "source_field_path": binding.source_field_path,
                "source_value": str(fact.value),
                "as_of": fact.as_of or snapshot.as_of or snapshot.retrieved_at,
                "freshness": snapshot.freshness,
                "verification_status": "verified",
            }
            bound_kind_by_path[(required.key, binding.input_path)] = "verified_fact"
            event("outcome.input_verified", key=required.key, path=binding.input_path, claim_id=canonical_claim.claim_id)
        for path, entry in normalized_provenance.items():
            bound_kind_by_path.setdefault((required.key, path), str(entry.get("kind")))

        calc_request = CalculationRequest(
            calculator_id=required.calculator_id,
            calculator_version=required.calculator_version,
            formula_version=required.formula_version,
            organization_id=request.organization_id,
            principal_id=request.principal_id,
            principal_type=request.principal_type,  # type: ignore[arg-type]
            mandate_id=request.mandate_id,
            mandate_version=request.mandate_version,
            task_id=request.task_id,
            inputs=spec["inputs"],
            input_provenance=list(normalized_provenance.values()),
            assumption_refs=spec.get("assumption_refs", []),
            currency_policy=request.currency_policy,
            rounding_policy=request.rounding_policy or {},
            trace_id=request.trace_id,
            idempotency_key=f"{request.idempotency_key}:calc:{required.key}",
        )
        wb_definition = workbench.get(required.calculator_id, required.calculator_version)
        material_paths_by_key[required.key] = [
            path
            for path in _expand_material_paths(wb_definition.material_input_paths, spec["inputs"])
            if wb_resolve_path(spec["inputs"], path)[0] or normalized_provenance.get(path, {}).get("kind") == "unresolved"
        ]
        try:
            result, draft = execute_authorized_calculation(workbench, calc_request, context)
        except (WorkbenchError, FrameworkViolation) as violation:
            return fail(getattr(violation, "code", "calculation.error"), str(violation), calculation=required.key)
        draft = build_run_draft(calc_request, result, actor_user_id=request.actor_user_id, duration_ms=None)
        drafts.append(draft)
        results_by_key[required.key] = result
        summaries.append(
            CalculationSummary(
                key=required.key,
                calculator_id=result.calculator_id,
                calculator_version=result.calculator_version,
                formula_version=result.formula_version,
                status=result.status,
                eligibility=result.eligibility,
                input_hash=result.input_hash,
                result_hash=result.result_hash,
                idempotency_key=calc_request.idempotency_key,
                outputs=draft.result,
                missing_fields=list(result.missing_fields),
            )
        )
        event("outcome.calculation_completed", key=required.key, status=result.status, result_hash=result.result_hash)
        if result.status == "completed":
            key_outputs = {k: v for k, v in list(draft.result.items())[:6]}
            statement = f"{required.key}: " + ", ".join(f"{k}={v}" for k, v in key_outputs.items() if not isinstance(v, (dict, list)))
            bundle_claims.append(claims.calculation(statement or f"{required.key} completed", result=result, draft=draft, materiality="critical" if required.material else "material"))
        elif result.status == "insufficient_information":
            for missing in result.missing_fields:
                bundle_claims.append(claims.unresolved_question(f"{required.key}: missing material input '{missing}'"))
            if required.material:
                material_gaps.extend(f"{required.key}:{missing}" for missing in result.missing_fields)
        else:  # invalid_input | failed
            hard_failures.append({"key": required.key, "status": result.status, "errors": draft.result.get("errors", [])})
        for contradiction in result.contradictions:
            bundle_claims.append(claims.contradiction(f"{required.key}: contradictory evidence for {contradiction}", contradicts=[]))

    if hard_failures:
        result = fail("outcome.calculation_invalid", "a material calculation rejected its inputs", failures=hard_failures)
        # Preserve evidence + calculation lineage even on failure.
        return result.model_copy(update={"evidence": EvidenceBundle(claims=bundle_claims), "calculation_drafts": drafts, "calculations": summaries, "replay_events": replay})

    # ------------------------------------------------------------------
    # 4. Compose (CODE-owned material content; numbers only from results).
    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Required evidence categories bound to CONSUMED inputs (§7): a category
    # tied to executed calculations is verified only when every present
    # material input path of those calculations carries a verified binding —
    # an unrelated canonical claim in the category grants nothing. Categories
    # with no executed calculation fall back to claim-tag coverage.
    # ------------------------------------------------------------------
    evidence_coverage: dict[str, str] = {}
    evidence_gaps: list[str] = []
    provisional_categories: list[str] = []
    for category in definition.required_evidence_categories:
        kinds = category_evidence.get(category, set())
        relevant_keys = [required.key for required in definition.calculations if required.evidence_category == category and required.key in results_by_key]
        if relevant_keys:
            path_kinds: list[str] = []
            for key in relevant_keys:
                for path in material_paths_by_key.get(key, []):
                    path_kinds.append(bound_kind_by_path.get((key, path), "user_provided"))
            if "contradictory" in kinds:
                status_label = "contradictory"
            elif any(kind == "unresolved" for kind in path_kinds) or not path_kinds:
                status_label = "missing"
            elif all(kind == "verified_fact" for kind in path_kinds):
                status_label = "verified"
            elif category in stale_binding_categories:
                status_label = "stale"
            else:
                status_label = "user_provided"
        else:
            if "contradictory" in kinds:
                status_label = "contradictory"
            elif "verified" in kinds:
                status_label = "verified"
            elif "stale" in kinds:
                status_label = "stale"
            elif "user_provided" in kinds or "assumption" in kinds:
                status_label = "user_provided"
            else:
                status_label = "missing"
        evidence_coverage[category] = status_label
        if status_label in ("missing", "contradictory", "stale"):
            evidence_gaps.append(f"required evidence category '{category}' is {status_label}")
        elif status_label == "user_provided":
            provisional_categories.append(category)

    composed = definition.composer(request.inputs, {key: result for key, result in results_by_key.items()})
    if "abstain" in composed:
        event("outcome.abstained", reason=composed["abstain"])
        bundle = EvidenceBundle(claims=bundle_claims)
        return OutcomeResult(
            outcome_type=request.outcome_type,
            definition_version=request.definition_version,
            execution_status="abstained",
            persisted_status=PERSISTED_STATUS_FOR_EXECUTION["abstained"],
            organization_id=request.organization_id,
            principal_id=request.principal_id,
            principal_type=request.principal_type,
            mandate_id=request.mandate_id,
            mandate_version=request.mandate_version,
            task_id=request.task_id,
            objective=request.objective,
            evidence=bundle,
            calculation_drafts=drafts,
            calculations=summaries,
            composed=composed,
            unresolved_questions=[c.statement for c in bundle.unresolved_questions()],
            contradictions=[c.statement for c in bundle.contradictions()],
            confidence="low",
            evidence_coverage=evidence_coverage,
            trust_notes=trust_notes,
            abstention_reason=str(composed["abstain"]),
            replay_events=replay,
            trace_id=request.trace_id,
            idempotency_key=request.idempotency_key,
        )
    composed_gaps = [str(gap) for gap in composed.get("missing_information", [])]
    all_gaps = material_gaps + composed_gaps + evidence_gaps
    bundle = EvidenceBundle(claims=bundle_claims)
    contradictions = [claim.statement for claim in bundle.contradictions()]
    unresolved = [claim.statement for claim in bundle.unresolved_questions()] + evidence_gaps
    assumptions = [claim.statement for claim in bundle.by_type("assumption")]
    for key, result in results_by_key.items():
        assumptions.extend(f"{key}: {assumption}" for assumption in result.assumptions_used)

    # ------------------------------------------------------------------
    # 5. Synthesis (wording only) + targeted questions.
    # ------------------------------------------------------------------
    synthesis: SynthesisResult = synthesize(
        purpose=definition.synthesis_purpose or definition.outcome_type,
        composed=composed,
        gaps=all_gaps,
        contradictions=contradictions,
        documents=list(request.documents),
        model_port=model_port,
        model_id=model_id,
        provider=model_provider,
        trace_id=request.trace_id,
    )
    trust_notes.extend(synthesis.guard_notes)
    event("outcome.synthesis", source=synthesis.source, guard_notes=len(synthesis.guard_notes))

    # A missing/contradictory/stale REQUIRED evidence category blocks
    # completion (§7): calculator-shaped input data alone never completes an
    # outcome. User-provided-only categories keep the outcome provisional.
    needs_information = bool(material_gaps) or bool(composed.get("blocking_gaps")) or bool(evidence_gaps)
    execution_status = "needs_information" if needs_information else "completed"
    assert execution_status in EXECUTION_STATUSES

    # ------------------------------------------------------------------
    # 6. Recommendation (code-owned lineage; model wording).
    # ------------------------------------------------------------------
    recommendation: Recommendation | None = None
    calculation_claims = bundle.by_type("calculation")
    if execution_status == "completed" and definition.recommendation.enabled and authority_rank(request.requested_authority) >= authority_rank(definition.recommendation.requires_authority):
        recommendation_type = str(composed.get("recommendation_type", definition.recommendation.allowed_types[0]))
        if recommendation_type not in definition.recommendation.allowed_types:
            return fail("outcome.recommendation_type_not_allowed", f"'{recommendation_type}' is not allowed for {definition.outcome_type}")
        recommendation = Recommendation(
            recommendation_type=recommendation_type,
            summary=synthesis.recommendation_summary,
            rationale=synthesis.recommendation_rationale,
            supporting_claim_ids=[claim.claim_id for claim in calculation_claims],
            supporting_calculation_refs=[summary.idempotency_key for summary in summaries if summary.status == "completed"],
            assumptions=assumptions,
            unresolved_questions=unresolved,
            contradictions=contradictions,
            confidence=_capped_confidence(all_gaps, assumptions, contradictions, provisional_categories),  # type: ignore[arg-type]
            conditions=[RecommendationCondition(**condition) for condition in composed.get("conditions", [])],
            risks=[RecommendationRisk(**risk) for risk in composed.get("risks", [])],
            alternatives_considered=[AlternativeConsidered(**alternative) for alternative in composed.get("alternatives_considered", [])],
            next_step=synthesis.next_step,
        )
        bundle_claims.append(claims.recommendation(recommendation.summary, supporting_claim_ids=recommendation.supporting_claim_ids, confidence=recommendation.confidence))
        bundle = EvidenceBundle(claims=bundle_claims)

    # ------------------------------------------------------------------
    # 7. Artifact draft (structured first; rendering derived).
    # ------------------------------------------------------------------
    artifact: CapitalArtifactDraft | None = None
    if execution_status == "completed" and definition.artifact.artifact_type:
        appendix = [
            CalculationAppendixEntry(
                run_idempotency_key=summary.idempotency_key,
                calculator_id=summary.calculator_id,
                calculator_version=summary.calculator_version,
                formula_version=summary.formula_version,
                input_hash=summary.input_hash,
                result_hash=summary.result_hash,
                status=summary.status,
                key_outputs={k: v for k, v in summary.outputs.items() if not isinstance(v, (dict, list))},
            )
            for summary in summaries
        ]
        artifact = CapitalArtifactDraft(
            artifact_type=definition.artifact.artifact_type,
            organization_id=request.organization_id,
            principal_id=request.principal_id,
            principal_type=request.principal_type,  # type: ignore[arg-type]
            mandate_id=request.mandate_id,
            mandate_version=request.mandate_version,
            task_id=request.task_id,
            outcome_type=request.outcome_type,
            outcome_definition_version=request.definition_version,
            title=str(composed.get("title", f"{definition.outcome_type} — {request.objective}"))[:200],
            summary=synthesis.interpretation,
            facts=[str(fact) for fact in composed.get("facts", [])],
            analysis={key: value for key, value in composed.get("analysis", {}).items()},
            assumptions=assumptions,
            unresolved_questions=unresolved,
            contradictions=contradictions,
            scenarios=[scenario for scenario in composed.get("scenarios", [])],
            options=[option for option in composed.get("options", [])],
            recommendation=recommendation,
            risks=[str(risk.get("description", risk)) if isinstance(risk, dict) else str(risk) for risk in composed.get("risks", [])],
            evidence_index=build_evidence_index(bundle.claims),
            calculation_appendix=appendix,
            generated_by=GeneratedBy(
                agent_definition_version=agent_definition.version,
                outcome_type=request.outcome_type,
                outcome_definition_version=request.definition_version,
                synthesis_source=synthesis.source,  # type: ignore[arg-type]
                model_id=synthesis.model_id,
                trace_id=request.trace_id,
            ),
            trace_id=request.trace_id,
            # Provisional when any gap exists OR a required category is
            # satisfied only by user-provided evidence (§7): never final-looking.
            provisional=bool(all_gaps) or bool(provisional_categories),
        )
        event("outcome.artifact_drafted", artifact_type=artifact.artifact_type, provisional=artifact.provisional)

    targeted = list(synthesis.targeted_questions) if execution_status == "needs_information" else []
    event("outcome.completed", execution_status=execution_status)
    return OutcomeResult(
        outcome_type=request.outcome_type,
        definition_version=request.definition_version,
        execution_status=execution_status,  # type: ignore[arg-type]
        persisted_status=PERSISTED_STATUS_FOR_EXECUTION[execution_status],
        organization_id=request.organization_id,
        principal_id=request.principal_id,
        principal_type=request.principal_type,
        mandate_id=request.mandate_id,
        mandate_version=request.mandate_version,
        task_id=request.task_id,
        objective=request.objective,
        evidence=bundle,
        calculation_drafts=drafts,
        calculations=summaries,
        composed=composed,
        recommendation=recommendation,
        artifact=artifact,
        unresolved_questions=unresolved,
        contradictions=contradictions,
        targeted_questions=targeted,
        confidence=_capped_confidence(all_gaps, assumptions, contradictions, provisional_categories),  # type: ignore[arg-type]
        evidence_coverage=evidence_coverage,
        trust_notes=trust_notes,
        provisional=bool(all_gaps) or bool(provisional_categories),
        replay_events=replay,
        synthesis_source=synthesis.source,
        injection_findings=list(synthesis.injection_findings),
        trace_id=request.trace_id,
        idempotency_key=request.idempotency_key,
    )


def _resolve_input(inputs: dict[str, Any], path: str) -> Any:
    from ..workbench.registry import resolve_path

    present, value = resolve_path(inputs, path)
    return value if present else None
