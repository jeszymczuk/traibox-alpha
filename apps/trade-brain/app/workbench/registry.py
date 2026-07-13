"""Calculator registry + engine (Phase 3 closure §§5–7, 10).

Exact-version resolution only. The engine pipeline: resolve → strict input
validation → provenance enforcement → deterministic compute (explicit status)
→ strict output validation → audit-complete hashing → typed result.

The raw engine is INTERNAL (`_execute_unchecked`): governed callers use
context.execute_authorized_calculation or the governed tool seam. Direct
ungoverned computation is not a supported entry point.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable

from pydantic import BaseModel, ValidationError

from .errors import CalculatorNotFound, WorkbenchError, WorkbenchInputError
from .hashing import canonize, deterministic_hash, sort_unordered_paths
from .request import CalculationRequest, CalculationResult, StructuredWarning, ValidationFinding


@dataclass(frozen=True)
class CalculatorOutcome:
    """Calculator return value. `status` is EXPLICIT (§7) — never derived from
    whether missing_fields happens to be empty."""

    status: str  # completed | insufficient_information | invalid_input | failed
    outputs: dict[str, Any]
    warnings: list[StructuredWarning] = field(default_factory=list)
    validations: list[ValidationFinding] = field(default_factory=list)
    assumptions_used: list[str] = field(default_factory=list)
    missing_fields: list[str] = field(default_factory=list)
    contradictions: list[str] = field(default_factory=list)
    eligibility: str = "not_applicable"

    def __post_init__(self) -> None:
        if self.status not in ("completed", "insufficient_information", "invalid_input", "failed"):
            raise WorkbenchError("calculator.invalid_status", f"calculator returned invalid status '{self.status}'", {})


@dataclass(frozen=True)
class CalculatorDefinition:
    calculator_id: str
    calculator_version: str
    formula_version: str
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    compute: Callable[[BaseModel], CalculatorOutcome]
    # §5: provenance is required for these input paths when populated.
    material_input_paths: tuple[str, ...] = ()
    # Paths that may legitimately default (documented); everything else
    # material must be supplied or the run is insufficient_information.
    may_default_paths: tuple[str, ...] = ()
    # §9.11: scenario overrides are allowlisted per calculator.
    scenario_overridable_paths: tuple[str, ...] = ()
    # §12: declared comparable outputs for the scenario engine.
    comparable_output_keys: tuple[str, ...] = ()
    # §6.3: list paths whose order is NOT semantically meaningful (sorted
    # canonically before hashing). Ordered lists are hashed as supplied.
    unordered_list_paths: tuple[str, ...] = ()
    required_evidence_categories: tuple[str, ...] = ()
    supported_assumptions: tuple[str, ...] = ()
    data_classes: tuple[str, ...] = ("finance_read",)
    sensitivity: str = "confidential"
    input_schema_version: str = "1"
    output_schema_version: str = "1"


class WorkbenchRegistry:
    def __init__(self) -> None:
        self._calculators: dict[tuple[str, str], CalculatorDefinition] = {}

    def register(self, definition: CalculatorDefinition) -> None:
        key = (definition.calculator_id, definition.calculator_version)
        if key in self._calculators:
            raise WorkbenchError("calculator.duplicate", f"{key} already registered", {})
        self._calculators[key] = definition

    def get(self, calculator_id: str, calculator_version: str) -> CalculatorDefinition:
        definition = self._calculators.get((calculator_id, calculator_version))
        if definition is None:
            raise CalculatorNotFound(
                "calculator.not_found",
                f"no calculator {calculator_id}@{calculator_version}",
                {"calculator_id": calculator_id, "calculator_version": calculator_version},
            )
        return definition

    def all_ids(self) -> list[tuple[str, str]]:
        return sorted(self._calculators)


_PATH_TOKEN = re.compile(r"([^.\[\]]+)|\[(\d+)\]")


def resolve_path(data: Any, path: str) -> tuple[bool, Any]:
    """Resolve 'a.b[0].c' against nested dict/list data → (present, value)."""
    current = data
    for match in _PATH_TOKEN.finditer(path):
        key, index = match.group(1), match.group(2)
        if key is not None:
            if not isinstance(current, dict) or key not in current:
                return False, None
            current = current[key]
        else:
            i = int(index)
            if not isinstance(current, list) or i >= len(current):
                return False, None
            current = current[i]
    return True, current


def _expand_material_paths(paths: tuple[str, ...], inputs: dict[str, Any]) -> list[str]:
    """Expand 'components[*].amount' wildcards against the actual inputs."""
    expanded: list[str] = []
    for path in paths:
        if "[*]" not in path:
            expanded.append(path)
            continue
        prefix, _, suffix = path.partition("[*]")
        present, value = resolve_path(inputs, prefix)
        if present and isinstance(value, list):
            for i in range(len(value)):
                expanded.append(f"{prefix}[{i}]{suffix}")
    return expanded


def _comparable_value(value: Any) -> tuple[str, Any]:
    """Normalize a value for source↔input equality: numeric strings compare
    as Decimals, booleans as booleans, dates as ISO strings — a reformatted
    figure that changes meaning never matches; one that keeps meaning does."""
    from datetime import date as _date
    from decimal import Decimal as _Decimal
    from decimal import InvalidOperation as _InvalidOperation

    if isinstance(value, bool):
        return ("bool", value)
    if isinstance(value, (int, _Decimal)):
        return ("num", _Decimal(value))
    if isinstance(value, _date):
        return ("str", value.isoformat())
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "false"):
            return ("bool", lowered == "true")
        try:
            return ("num", _Decimal(value.strip()))
        except _InvalidOperation:
            return ("str", value)
    return ("str", str(value))


def check_provenance(definition: CalculatorDefinition, request: CalculationRequest) -> tuple[list[str], list[str], list[dict[str, Any]]]:
    """§5 (hardened): returns (provenance_gaps, unresolved_material_paths,
    binding_violations). Every 'verified_fact' entry — the model already
    guarantees its binding is COMPLETE — is additionally verified here:
    the source organization/principal must match the calculation request and
    the normalized source value must exactly equal the calculator input at
    that path. The engine fails closed on any violation; a provenance-kind
    string alone can never establish verification."""
    provenance_by_path = {entry.input_path: entry for entry in request.input_provenance}
    gaps: list[str] = []
    unresolved: list[str] = []
    violations: list[dict[str, Any]] = []
    for entry in request.input_provenance:
        if entry.kind != "verified_fact":
            continue
        assert entry.source_ref is not None and entry.source_value is not None  # model-enforced
        if entry.source_ref.organization_id != request.organization_id:
            violations.append({"code": "input.binding_org_mismatch", "path": entry.input_path, "detail": "canonical source belongs to a different organization"})
            continue
        if entry.source_ref.principal_id != request.principal_id:
            violations.append({"code": "input.binding_principal_mismatch", "path": entry.input_path, "detail": "canonical source belongs to a different principal"})
            continue
        present, input_value = resolve_path(request.inputs, entry.input_path)
        if not present:
            violations.append({"code": "input.binding_path_absent", "path": entry.input_path, "detail": "verified binding declared for an absent input path"})
            continue
        if _comparable_value(input_value) != _comparable_value(entry.source_value):
            violations.append(
                {
                    "code": "input.binding_value_mismatch",
                    "path": entry.input_path,
                    "detail": "the canonical source value does not match the calculator input value",
                    "source_value": entry.source_value,
                }
            )
    for path in _expand_material_paths(definition.material_input_paths, request.inputs):
        present, _ = resolve_path(request.inputs, path)
        entry = provenance_by_path.get(path)
        kind = entry.kind if entry is not None else None
        if kind == "unresolved":
            unresolved.append(path)
            continue
        if present and kind is None and path not in definition.may_default_paths:
            gaps.append(path)
    return gaps, unresolved, violations


def _input_manifest(definition: CalculatorDefinition, request: CalculationRequest, inputs: dict[str, Any]) -> dict[str, Any]:
    """§6.1: the complete deterministic calculation manifest.

    Provenance is audit-complete (provenance-binding closure §6): a verified
    input's STABLE binding identity — canonical claim, source object + field,
    normalized matched value, as-of and freshness — is part of the input hash.
    Volatile retrieval timestamps are intentionally NOT part of the semantic
    identity."""

    def provenance_entry(entry: Any) -> Any:
        if entry.kind != "verified_fact":
            return entry.kind
        return {
            "kind": entry.kind,
            "claim_id": entry.claim_id,
            "source": {
                "object_type": entry.source_ref.object_type,
                "source_layer": entry.source_ref.source_layer,
                "object_id": entry.source_ref.object_id,
                "organization_id": entry.source_ref.organization_id,
                "principal_id": entry.source_ref.principal_id,
            },
            "source_field_path": entry.source_field_path,
            "source_value": entry.source_value,
            "as_of": entry.as_of,
            "freshness": entry.freshness,
        }

    return {
        "inputs": sort_unordered_paths(inputs, definition.unordered_list_paths),
        "currency_policy": request.currency_policy.model_dump(),
        "rounding_policy": request.rounding_policy.model_dump(),
        "scenario_id": request.scenario_id,
        # Provenance classification affects behavior (unresolved ⇒
        # insufficient_information) and verified bindings carry the audit
        # identity, so both are hash-relevant (§6.1).
        "provenance": {entry.input_path: provenance_entry(entry) for entry in request.input_provenance},
    }


def _result_envelope(outcome: CalculatorOutcome, outputs: dict[str, Any]) -> dict[str, Any]:
    """§6.2: the full result envelope — never only the output dictionary."""
    return {
        "status": outcome.status,
        "eligibility": outcome.eligibility,
        "outputs": outputs,
        "warnings": [w.model_dump() for w in outcome.warnings],
        "validations": [v.model_dump() for v in outcome.validations],
        "assumptions_used": sorted(outcome.assumptions_used),
        "missing_fields": sorted(outcome.missing_fields),
        "contradictions": sorted(outcome.contradictions),
    }


def _execute_unchecked(registry: WorkbenchRegistry, request: CalculationRequest) -> CalculationResult:
    """INTERNAL engine. Governed callers use execute_authorized_calculation
    (context.py) or the governed tool seam — never this function directly."""
    definition = registry.get(request.calculator_id, request.calculator_version)
    if definition.formula_version != request.formula_version:
        raise CalculatorNotFound(
            "calculator.formula_version_mismatch",
            f"calculator {request.calculator_id}@{request.calculator_version} implements formula "
            f"'{definition.formula_version}', not '{request.formula_version}' — versions are never silently swapped",
            {"registered": definition.formula_version, "requested": request.formula_version},
        )

    def result(outcome: CalculatorOutcome, inputs: dict[str, Any]) -> CalculationResult:
        hash_kwargs = dict(calculator_id=definition.calculator_id, calculator_version=definition.calculator_version, formula_version=definition.formula_version)
        # The manifests are persisted in CANONIZED (tagged, JSON-safe) form so
        # the hashes are independently reproducible from the stored record
        # alone (Part B §B1). canonize() is idempotent, so hashing the stored
        # form equals hashing the original.
        input_manifest = canonize(_input_manifest(definition, request, inputs))
        result_envelope = canonize(_result_envelope(outcome, outcome.outputs))
        input_hash = deterministic_hash(input_manifest, **hash_kwargs)
        result_hash = deterministic_hash(result_envelope, **hash_kwargs)
        return CalculationResult(
            calculator_id=definition.calculator_id,
            calculator_version=definition.calculator_version,
            formula_version=definition.formula_version,
            status=outcome.status,  # type: ignore[arg-type]
            inputs=inputs,
            outputs=outcome.outputs,
            warnings=outcome.warnings,
            validations=outcome.validations,
            assumptions_used=outcome.assumptions_used,
            missing_fields=outcome.missing_fields,
            contradictions=outcome.contradictions,
            eligibility=outcome.eligibility,  # type: ignore[arg-type]
            input_hash=input_hash,
            result_hash=result_hash,
            input_manifest=input_manifest,
            result_envelope=result_envelope,
            trace_id=request.trace_id,
        )

    try:
        model = definition.input_model.model_validate(request.inputs)
    except ValidationError as exc:
        errors = [{"loc": list(e["loc"]), "type": e["type"]} for e in exc.errors()]
        outcome = CalculatorOutcome(status="invalid_input", outputs={"errors": errors})
        return result(outcome, request.inputs)

    gaps, unresolved, binding_violations = check_provenance(definition, request)
    if binding_violations:
        # Fail closed (§5): a 'verified_fact' whose binding fails org/
        # principal/value verification can never run as verified.
        outcome = CalculatorOutcome(status="invalid_input", outputs={"errors": binding_violations})
        return result(outcome, request.inputs)
    if gaps:
        outcome = CalculatorOutcome(status="invalid_input", outputs={"errors": [{"code": "input.provenance_missing", "paths": sorted(gaps)}]})
        return result(outcome, request.inputs)
    if unresolved:
        outcome = CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=sorted(unresolved))
        return result(outcome, model.model_dump())

    try:
        outcome = definition.compute(model)
    except WorkbenchInputError as exc:
        outcome = CalculatorOutcome(status="invalid_input", outputs={"errors": [exc.to_record()]})
        return result(outcome, request.inputs)

    if outcome.status == "completed":
        try:
            validated = definition.output_model.model_validate(outcome.outputs)
        except ValidationError as exc:
            raise WorkbenchError(
                "calculator.output_schema_violation",
                f"calculator {definition.calculator_id} produced output violating its declared model",
                {"errors": [{"loc": list(e["loc"]), "type": e["type"]} for e in exc.errors()]},
            )
        outputs = validated.model_dump(exclude_none=True)
        outcome = CalculatorOutcome(
            status=outcome.status,
            outputs=outputs,
            warnings=outcome.warnings,
            validations=outcome.validations,
            assumptions_used=outcome.assumptions_used,
            missing_fields=outcome.missing_fields,
            contradictions=outcome.contradictions,
            eligibility=outcome.eligibility,
        )
    return result(outcome, model.model_dump())
