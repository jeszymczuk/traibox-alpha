"""Deterministic scenario / sensitivity analysis (closure §9.11).

Scenarios may override ONLY the calculator's declared allowlist —
organization, principal, mandate, versions, policies, provenance, and
authority are structurally outside the override surface (they live on the
request, not in `inputs`, and the allowlist gates everything inside `inputs`).
Each scenario derives its own idempotency key; scenario identity is part of
the input-hash manifest. The compare key must be a declared comparable output.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from pydantic import Field

from .context import WorkbenchExecutionContext, execute_authorized_calculation
from .decimal_policy import serialize_decimal
from .errors import WorkbenchInputError
from .registry import WorkbenchRegistry
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
    context: WorkbenchExecutionContext,
) -> dict[str, Any]:
    definition = registry.get(base_request.calculator_id, base_request.calculator_version)
    if compare_key not in definition.comparable_output_keys:
        raise WorkbenchInputError(
            "scenario.compare_key_not_comparable",
            f"'{compare_key}' is not a declared comparable output of {definition.calculator_id}",
            {"compare_key": compare_key, "declared": list(definition.comparable_output_keys)},
        )
    allow = set(definition.scenario_overridable_paths)
    base_result, _ = execute_authorized_calculation(registry, base_request, context)
    if base_result.status != "completed":
        return {"base": base_result.model_dump(), "scenarios": [], "note": f"base case status is {base_result.status}"}
    base_value = _decimal_output(base_result.outputs, compare_key)
    results = []
    largest: tuple[str, Decimal] | None = None
    for scenario in scenarios:
        denied = [key for key in scenario.overrides if key not in allow]
        if denied:
            raise WorkbenchInputError(
                "scenario.override_not_allowlisted",
                "scenario overrides fields outside the calculator's declared allowlist",
                {"scenario": scenario.name, "denied": sorted(denied), "allowlist": sorted(allow)},
            )
        request = base_request.model_copy(
            update={
                "inputs": {**base_request.inputs, **scenario.overrides},
                "scenario_id": scenario.name,
                "idempotency_key": f"{base_request.idempotency_key}:scenario:{scenario.name}",
            }
        )
        result, _ = execute_authorized_calculation(registry, request, context)
        delta = None
        if result.status == "completed":
            value = _decimal_output(result.outputs, compare_key)
            if value is not None and base_value is not None:
                delta = value - base_value
                if len(scenario.overrides) == 1 and (largest is None or abs(delta) > abs(largest[1])):
                    largest = (scenario.name, delta)
        results.append(
            {
                "name": scenario.name,
                "status": result.status,
                "value": result.outputs.get(compare_key),
                "delta": serialize_decimal(delta) if delta is not None else None,
                "input_hash": result.input_hash,
                "result_hash": result.result_hash,
            }
        )
    return {
        "base": {"value": base_result.outputs.get(compare_key), "input_hash": base_result.input_hash, "result_hash": base_result.result_hash},
        "compare_key": compare_key,
        "scenarios": results,
        "most_material_driver": largest[0] if largest else None,
    }


def _decimal_output(outputs: dict[str, Any], key: str) -> Decimal | None:
    value = outputs.get(key)
    return Decimal(value) if isinstance(value, str) else None
