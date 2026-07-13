"""Trade cost + landed cost calculators (spec §11.3; closure §§7–10).

Formulas unchanged from v1 (component-sum waterfall; per-unit division);
this closure adds explicit statuses, structured warnings, strict output
models, validators, and provenance/scenario metadata.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from ..currency import convert
from ..decimal_policy import quantize_money, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import StructuredWarning, ValidationFinding
from ..types import CostComponent, DecimalStr, FxRate, StrictInput
from ..validators import strictly_positive


class TradeCostInput(StrictInput):
    reporting_currency: str = Field(min_length=3, max_length=3)
    components: list[CostComponent] = Field(min_length=1)
    fx_rates: list[FxRate] = Field(default_factory=list)
    incoterm: str | None = None
    incoterm_allocation_assumed: bool = False


class TradeCostOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    total_trade_cost: str
    currency: str
    cost_by_category: dict[str, str]


def _total(inputs: TradeCostInput) -> tuple[Decimal, dict[str, Decimal], list[StructuredWarning], list[str]]:
    total = Decimal(0)
    by_category: dict[str, Decimal] = {}
    warnings: list[StructuredWarning] = []
    assumptions: list[str] = []
    for index, component in enumerate(inputs.components):
        amount = component.amount
        if component.currency.upper() != inputs.reporting_currency.upper():
            amount, rate = convert(amount, component.currency, inputs.reporting_currency, inputs.fx_rates)
            if rate.staleness == "recent":
                warnings.append(
                    StructuredWarning(code="fx.rate_not_current", message=f"FX rate for {component.currency} is not current (as_of {rate.as_of})", severity="warning", related_input_paths=[f"components[{index}].currency"])
                )
        if component.recoverable:
            warnings.append(
                StructuredWarning(code="cost.recoverable_excluded", message=f"component '{component.category}' marked recoverable — excluded from total trade cost", severity="info", related_input_paths=[f"components[{index}].recoverable"])
            )
            continue
        if component.provenance in ("assumption", "estimate"):
            assumptions.append(f"components[{index}].amount ({component.category}): {component.provenance}")
        by_category[component.category] = by_category.get(component.category, Decimal(0)) + amount
        total += amount
    return total, by_category, warnings, assumptions


def compute_trade_cost(inputs: TradeCostInput) -> CalculatorOutcome:
    total, by_category, warnings, assumptions = _total(inputs)
    if inputs.incoterm_allocation_assumed:
        assumptions.append("incoterm cost allocation assumed, not verified")
    currency = inputs.reporting_currency.upper()
    outputs = {
        "total_trade_cost": serialize_decimal(quantize_money(total, currency)),
        "currency": currency,
        "cost_by_category": {k: serialize_decimal(quantize_money(v, currency)) for k, v in sorted(by_category.items())},
    }
    validations = [ValidationFinding(check="component_sum", status="pass", finding="total equals the sum of included components")]
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=warnings, validations=validations, assumptions_used=assumptions)


class LandedCostInput(TradeCostInput):
    delivered_quantity: DecimalStr


class LandedCostOutput(TradeCostOutput):
    delivered_quantity: str
    landed_cost_per_unit: str


def compute_landed_cost(inputs: LandedCostInput) -> CalculatorOutcome:
    strictly_positive(inputs.delivered_quantity, "delivered_quantity")
    base = compute_trade_cost(TradeCostInput(**{k: v for k, v in inputs.model_dump().items() if k != "delivered_quantity"}))
    currency = inputs.reporting_currency.upper()
    total = Decimal(base.outputs["total_trade_cost"])
    per_unit = quantize_money(total / inputs.delivered_quantity, currency)
    warnings = list(base.warnings)
    if inputs.delivered_quantity > Decimal("1000000000"):
        warnings.append(StructuredWarning(code="quantity.implausible", message="delivered_quantity is implausibly large — verify units", severity="critical", related_input_paths=["delivered_quantity"]))
    outputs = {**base.outputs, "delivered_quantity": serialize_decimal(inputs.delivered_quantity), "landed_cost_per_unit": serialize_decimal(per_unit)}
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=warnings, validations=base.validations, assumptions_used=base.assumptions_used)


TRADE_COST = CalculatorDefinition(
    calculator_id="capital.calculate_trade_cost",
    calculator_version="1.0.0",
    formula_version="trade-cost-waterfall-v1",
    input_model=TradeCostInput,
    output_model=TradeCostOutput,
    compute=compute_trade_cost,  # type: ignore[arg-type]
    material_input_paths=("components[*].amount",),
    scenario_overridable_paths=("components", "fx_rates"),
    comparable_output_keys=("total_trade_cost",),
    unordered_list_paths=("fx_rates",),
    required_evidence_categories=("cost_documents",),
    data_classes=("trade_context", "finance_read"),
    sensitivity="confidential",
)

LANDED_COST = CalculatorDefinition(
    calculator_id="capital.calculate_landed_cost",
    calculator_version="1.0.0",
    formula_version="landed-cost-v1",
    input_model=LandedCostInput,
    output_model=LandedCostOutput,
    compute=compute_landed_cost,  # type: ignore[arg-type]
    material_input_paths=("components[*].amount", "delivered_quantity"),
    scenario_overridable_paths=("components", "fx_rates", "delivered_quantity"),
    comparable_output_keys=("total_trade_cost", "landed_cost_per_unit"),
    unordered_list_paths=("fx_rates",),
    required_evidence_categories=("cost_documents", "shipment_documents"),
    data_classes=("trade_context", "finance_read"),
    sensitivity="confidential",
)
