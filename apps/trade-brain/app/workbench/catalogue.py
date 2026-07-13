"""The company-side calculator catalogue + hardened tool integration
(closure §11).

Every calculator registers through the Phase 2 typed tool framework with its
OWN data classes, sensitivity, and schemas. The tool handler requires an
explicit currency policy, rounding policy, provenance, and idempotency key —
there is no EUR default and no ungoverned execution path: the handler builds a
WorkbenchExecutionContext from the invocation context and goes through
execute_authorized_calculation.
"""

from __future__ import annotations

from typing import Any

from ..tools.definition import ToolDefinition
from ..tools.invocation import ToolInvocationContext
from ..tools.registry import ToolRegistry
from .calculators.cashflow import CASHFLOW, CCC, LIQUIDITY, WORKING_CAPITAL
from .calculators.financing_cost import DEBT_SERVICE, FINANCING_COST, RECEIVABLES_FINANCE
from .calculators.fx_milestones_exposure import COMPANY_EXPOSURE, FX_EXPOSURE, MILESTONES
from .calculators.investment_returns import DILUTION, INVESTMENT_RETURNS
from .calculators.offer_comparison import OFFER_COMPARISON
from .calculators.trade_cost import LANDED_COST, TRADE_COST
from .calculators.transaction_pnl import AGGREGATE_PNL, TRANSACTION_PNL
from .context import WorkbenchExecutionContext, execute_authorized_calculation
from .registry import CalculatorDefinition, WorkbenchRegistry
from .request import CalculationRequest

ALL_CALCULATORS = (
    TRADE_COST,
    LANDED_COST,
    TRANSACTION_PNL,
    AGGREGATE_PNL,
    CASHFLOW,
    WORKING_CAPITAL,
    CCC,
    LIQUIDITY,
    FINANCING_COST,
    RECEIVABLES_FINANCE,
    DEBT_SERVICE,
    OFFER_COMPARISON,
    INVESTMENT_RETURNS,
    DILUTION,
    FX_EXPOSURE,
    MILESTONES,
    COMPANY_EXPOSURE,
)


def default_registry() -> WorkbenchRegistry:
    registry = WorkbenchRegistry()
    for calculator in ALL_CALCULATORS:
        registry.register(calculator)
    return registry


# The governed tool-call payload (§11): everything explicit, nothing defaulted.
_TOOL_INPUT_SCHEMA: dict[str, Any] = {
    "required": ["inputs", "currency_policy", "rounding_policy", "input_provenance", "assumption_refs", "invocation_key"],
    "properties": {
        "inputs": {"type": "object"},
        "currency_policy": {"type": "object"},
        "rounding_policy": {"type": "object"},
        "input_provenance": {"type": "array"},
        "assumption_refs": {"type": "array"},
        "invocation_key": {"type": "string"},
        "scenario_id": {"type": "string"},
        "outcome_id": {"type": "string"},
    },
    "additionalProperties": False,
}
_TOOL_OUTPUT_SCHEMA: dict[str, Any] = {"required": ["result", "run_draft"], "properties": {"result": {"type": "object"}, "run_draft": {"type": "object"}}}


class _WorkbenchToolHandler:
    def __init__(self, registry: WorkbenchRegistry, calculator: CalculatorDefinition) -> None:
        self._registry = registry
        self._calculator = calculator

    def handle(self, tool_input: dict[str, Any], context: ToolInvocationContext) -> dict[str, Any]:
        request = CalculationRequest(
            calculator_id=self._calculator.calculator_id,
            calculator_version=self._calculator.calculator_version,
            formula_version=self._calculator.formula_version,
            organization_id=context.org_id,
            principal_id=context.principal_id,
            principal_type=context.principal_type,  # type: ignore[arg-type]
            mandate_id=context.mandate_id,
            mandate_version=context.mandate_version,
            task_id=context.task_id,
            outcome_id=tool_input.get("outcome_id"),
            scenario_id=tool_input.get("scenario_id"),
            inputs=tool_input["inputs"],
            input_provenance=tool_input["input_provenance"],
            assumption_refs=tool_input["assumption_refs"],
            currency_policy=tool_input["currency_policy"],
            rounding_policy=tool_input["rounding_policy"],
            trace_id=context.trace_id,
            idempotency_key=str(tool_input["invocation_key"]),
        )
        execution_context = WorkbenchExecutionContext(
            organization_id=context.org_id,
            principal_id=context.principal_id,
            principal_type=context.principal_type,  # type: ignore[arg-type]
            mandate_id=context.mandate_id,
            mandate_version=context.mandate_version,
            task_id=context.task_id,
            requested_authority=context.effective_authority,
            effective_authority=context.effective_authority,
            effective_tool_classes=["calculation"],
            effective_data_classes=context.data_scope,
            trace_id=context.trace_id,
        )
        result, draft = execute_authorized_calculation(self._registry, request, execution_context)
        return {"result": result.model_dump(), "run_draft": draft.model_dump()}


def register_workbench_tools(tool_registry: ToolRegistry, workbench: WorkbenchRegistry) -> None:
    for calculator in ALL_CALCULATORS:
        tool_registry.register(
            ToolDefinition(
                tool_id=calculator.calculator_id,
                version=calculator.calculator_version,
                tool_class="calculation",
                owning_domain="capital",
                effect_class="calculate",
                required_authority="calculate",
                input_schema=_TOOL_INPUT_SCHEMA,
                output_schema=_TOOL_OUTPUT_SCHEMA,
                data_classes=calculator.data_classes,
                sensitivity=calculator.sensitivity,
                audit_event=f"capital.calculation.{calculator.calculator_id}",
                evidence_required=bool(calculator.required_evidence_categories),
            ),
            handler=_WorkbenchToolHandler(workbench, calculator),
        )
