"""Calculator registry + engine (directives B7).

Exact-version resolution only: unknown calculators/versions fail closed and a
newer formula version is never silently selected. The engine pipeline:
resolve → strict input validation → execute deterministic code → validate
output → hash → typed result.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from pydantic import BaseModel, ValidationError

from .errors import CalculatorNotFound, WorkbenchError, WorkbenchInputError
from .hashing import deterministic_hash
from .request import CalculationRequest, CalculationResult, ValidationFinding


@dataclass(frozen=True)
class CalculatorOutcome:
    """What a calculator's compute() returns before the engine wraps it."""

    outputs: dict[str, Any]
    warnings: list[str]
    validations: list[ValidationFinding]
    assumptions_used: list[str]
    missing_fields: list[str]
    eligibility: str = "not_applicable"

    @property
    def status(self) -> str:
        return "insufficient_information" if self.missing_fields else "completed"


@dataclass(frozen=True)
class CalculatorDefinition:
    calculator_id: str
    calculator_version: str
    formula_version: str
    input_model: type[BaseModel]
    compute: Callable[[BaseModel], CalculatorOutcome]
    input_schema_version: str = "1"
    output_schema_version: str = "1"
    required_evidence_categories: tuple[str, ...] = ()
    supported_assumptions: tuple[str, ...] = ()


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


def execute(registry: WorkbenchRegistry, request: CalculationRequest) -> CalculationResult:
    definition = registry.get(request.calculator_id, request.calculator_version)
    if definition.formula_version != request.formula_version:
        raise CalculatorNotFound(
            "calculator.formula_version_mismatch",
            f"calculator {request.calculator_id}@{request.calculator_version} implements formula "
            f"'{definition.formula_version}', not '{request.formula_version}' — versions are never silently swapped",
            {"registered": definition.formula_version, "requested": request.formula_version},
        )

    def result(status: str, *, inputs: dict[str, Any], outputs: dict[str, Any] | None = None, outcome: CalculatorOutcome | None = None, invalid: list[dict[str, Any]] | None = None) -> CalculationResult:
        input_hash = deterministic_hash(inputs, calculator_id=definition.calculator_id, calculator_version=definition.calculator_version, formula_version=definition.formula_version)
        payload_outputs = outputs if outputs is not None else (outcome.outputs if outcome else {})
        if invalid is not None:
            payload_outputs = {"errors": invalid}
        result_hash = deterministic_hash(payload_outputs, calculator_id=definition.calculator_id, calculator_version=definition.calculator_version, formula_version=definition.formula_version)
        return CalculationResult(
            calculator_id=definition.calculator_id,
            calculator_version=definition.calculator_version,
            formula_version=definition.formula_version,
            status=status,  # type: ignore[arg-type]
            inputs=inputs,
            outputs=payload_outputs,
            warnings=outcome.warnings if outcome else [],
            validations=outcome.validations if outcome else [],
            assumptions_used=outcome.assumptions_used if outcome else [],
            missing_fields=outcome.missing_fields if outcome else [],
            eligibility=(outcome.eligibility if outcome else "not_applicable"),  # type: ignore[arg-type]
            input_hash=input_hash,
            result_hash=result_hash,
            trace_id=request.trace_id,
        )

    try:
        model = definition.input_model.model_validate(request.inputs)
    except ValidationError as exc:
        errors = [{"loc": list(e["loc"]), "type": e["type"]} for e in exc.errors()]
        return result("invalid_input", inputs=request.inputs, invalid=errors)

    try:
        outcome = definition.compute(model)
    except WorkbenchInputError as exc:
        return result("invalid_input", inputs=request.inputs, invalid=[exc.to_record()])

    return result(outcome.status, inputs=model.model_dump(), outcome=outcome)
