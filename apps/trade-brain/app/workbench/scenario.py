"""Deterministic scenario / sensitivity analysis (directive B6).

Scenarios override explicitly declared input variables only; formulas are
fixed by the calculator version — the LLM cannot alter them. Deltas are
computed on declared numeric output keys; the most material driver is the
single-variable scenario with the largest absolute delta.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from pydantic import Field

from .decimal_policy import serialize_decimal
from .errors import WorkbenchInputError
from .registry import WorkbenchRegistry, execute
from .request import CalculationRequest
from .types import StrictInput


class NamedScenario(StrictInput):
    name: str = Field(min_length=1)
    overrides: dict[str, Any]


def run_scenarios(
    registry: WorkbenchRegistry,
    base_request: CalculationRequest,
    scenarios: list[NamedScenario],
    *,
    compare_key: str,
) -> dict[str, Any]:
    base = execute(registry, base_request)
    if base.status != "completed":
        return {"base": base.model_dump(), "scenarios": [], "note": f"base case status is {base.status}"}
    base_value = _decimal_output(base.outputs, compare_key)
    results = []
    largest: tuple[str, Decimal] | None = None
    for scenario in scenarios:
        unknown = [key for key in scenario.overrides if key not in base_request.inputs]
        if unknown:
            raise WorkbenchInputError("scenario.undeclared_variable", "scenario overrides undeclared input variables", {"scenario": scenario.name, "unknown": unknown})
        request = base_request.model_copy(update={"inputs": {**base_request.inputs, **scenario.overrides}, "scenario_id": scenario.name})
        result = execute(registry, request)
        delta = None
        if result.status == "completed":
            value = _decimal_output(result.outputs, compare_key)
            if value is not None and base_value is not None:
                delta = value - base_value
                if len(scenario.overrides) == 1 and (largest is None or abs(delta) > abs(largest[1])):
                    largest = (scenario.name, delta)
        results.append({"name": scenario.name, "status": result.status, "value": result.outputs.get(compare_key), "delta": serialize_decimal(delta) if delta is not None else None, "result_hash": result.result_hash})
    return {
        "base": {"value": base.outputs.get(compare_key), "result_hash": base.result_hash},
        "compare_key": compare_key,
        "scenarios": results,
        "most_material_driver": largest[0] if largest else None,
    }


def _decimal_output(outputs: dict[str, Any], key: str) -> Decimal | None:
    value = outputs.get(key)
    return Decimal(value) if isinstance(value, str) else None
