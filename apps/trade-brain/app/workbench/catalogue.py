"""The company-side calculator catalogue (directive B6) + Phase 2 tool
integration (directive B8): every calculator registers as an effect-class
'calculate' tool requiring 'calculate' authority through the budgeted seam."""

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
from .registry import WorkbenchRegistry, execute
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


class _WorkbenchToolHandler:
    def __init__(self, registry: WorkbenchRegistry, calculator_id: str, calculator_version: str, formula_version: str) -> None:
        self._registry = registry
        self._id = calculator_id
        self._version = calculator_version
        self._formula = formula_version

    def handle(self, tool_input: dict[str, Any], context: ToolInvocationContext) -> dict[str, Any]:
        request = CalculationRequest(
            calculator_id=self._id,
            calculator_version=self._version,
            formula_version=self._formula,
            organization_id=context.org_id,
            principal_id=context.principal_id,
            principal_type=context.principal_type,  # type: ignore[arg-type]
            mandate_id=context.mandate_id,
            mandate_version=context.mandate_version,
            task_id=context.task_id,
            inputs=tool_input.get("inputs", {}),
            currency_policy={"base_currency": tool_input.get("base_currency", "EUR")},  # type: ignore[arg-type]
            trace_id=context.trace_id,
            idempotency_key=f"{context.task_id}:{self._id}",
        )
        return {"result": execute(self._registry, request).model_dump()}


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
                input_schema={"required": ["inputs"], "properties": {"inputs": {"type": "object"}, "base_currency": {"type": "string"}}, "additionalProperties": False},
                output_schema={"required": ["result"], "properties": {"result": {"type": "object"}}},
                data_classes=("selected_objects",),
                sensitivity="confidential",
                audit_event=f"capital.calculation.{calculator.calculator_id}",
                evidence_required=True,
            ),
            handler=_WorkbenchToolHandler(workbench, calculator.calculator_id, calculator.calculator_version, calculator.formula_version),
        )
