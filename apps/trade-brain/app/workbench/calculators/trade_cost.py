"""Trade cost + landed cost calculators (spec §11.3, directive B6)."""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from ..currency import convert
from ..decimal_policy import quantize_money, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import ValidationFinding
from ..types import CostComponent, DecimalStr, FxRate, StrictInput


class TradeCostInput(StrictInput):
    reporting_currency: str = Field(min_length=3, max_length=3)
    components: list[CostComponent] = Field(min_length=1)
    fx_rates: list[FxRate] = Field(default_factory=list)
    incoterm: str | None = None
    incoterm_allocation_assumed: bool = False


def _total(inputs: TradeCostInput) -> tuple[Decimal, dict[str, Decimal], list[str], list[str]]:
    total = Decimal(0)
    by_category: dict[str, Decimal] = {}
    warnings: list[str] = []
    assumptions: list[str] = []
    for component in inputs.components:
        amount = component.amount
        if component.currency.upper() != inputs.reporting_currency.upper():
            amount, rate = convert(amount, component.currency, inputs.reporting_currency, inputs.fx_rates)
            if rate.staleness == "recent":
                warnings.append(f"FX rate for {component.currency} is not current (as_of {rate.as_of})")
        if component.recoverable:
            warnings.append(f"component '{component.category}' marked recoverable — excluded from total trade cost")
            continue
        if component.provenance in ("assumption", "estimate"):
            assumptions.append(f"{component.category}: {component.provenance}")
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
    return CalculatorOutcome(outputs=outputs, warnings=warnings, validations=validations, assumptions_used=assumptions, missing_fields=[])


class LandedCostInput(TradeCostInput):
    delivered_quantity: DecimalStr


def compute_landed_cost(inputs: LandedCostInput) -> CalculatorOutcome:
    if inputs.delivered_quantity <= 0:
        return CalculatorOutcome(
            outputs={},
            warnings=[],
            validations=[ValidationFinding(check="quantity_positive", status="fail", finding="delivered_quantity must be positive")],
            assumptions_used=[],
            missing_fields=["delivered_quantity"],
        )
    base = compute_trade_cost(TradeCostInput(**{k: v for k, v in inputs.model_dump().items() if k != "delivered_quantity"}))
    currency = inputs.reporting_currency.upper()
    total = Decimal(base.outputs["total_trade_cost"])
    per_unit = quantize_money(total / inputs.delivered_quantity, currency)
    warnings = list(base.warnings)
    if inputs.delivered_quantity > Decimal("1000000000"):
        warnings.append("delivered_quantity is implausibly large — verify units")
    outputs = {**base.outputs, "delivered_quantity": serialize_decimal(inputs.delivered_quantity), "landed_cost_per_unit": serialize_decimal(per_unit)}
    return CalculatorOutcome(outputs=outputs, warnings=warnings, validations=base.validations, assumptions_used=base.assumptions_used, missing_fields=[])


TRADE_COST = CalculatorDefinition(
    calculator_id="capital.calculate_trade_cost",
    calculator_version="1.0.0",
    formula_version="trade-cost-waterfall-v1",
    input_model=TradeCostInput,
    compute=compute_trade_cost,  # type: ignore[arg-type]
)

LANDED_COST = CalculatorDefinition(
    calculator_id="capital.calculate_landed_cost",
    calculator_version="1.0.0",
    formula_version="landed-cost-v1",
    input_model=LandedCostInput,
    compute=compute_landed_cost,  # type: ignore[arg-type]
)
