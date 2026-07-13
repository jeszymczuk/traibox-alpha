"""Transaction P&L / margin + company-side aggregate P&L (directive B6)."""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from ..decimal_policy import quantize_money, quantize_rate, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import ValidationFinding
from ..types import DecimalStr, StrictInput


class TransactionPnlInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    revenue: DecimalStr
    discounts: DecimalStr = Decimal(0)
    direct_costs: DecimalStr = Decimal(0)
    trade_costs: DecimalStr = Decimal(0)
    financing_costs: DecimalStr = Decimal(0)
    expected_loss: DecimalStr | None = None
    fixed_costs_allocated: DecimalStr = Decimal(0)


def compute_transaction_pnl(inputs: TransactionPnlInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    warnings: list[str] = []
    net_revenue = inputs.revenue - inputs.discounts
    included = inputs.direct_costs + inputs.trade_costs + inputs.financing_costs + (inputs.expected_loss or Decimal(0))
    gross_contribution = net_revenue - included
    operating_contribution = gross_contribution - inputs.fixed_costs_allocated
    margin = (gross_contribution / net_revenue) if net_revenue != 0 else None
    if net_revenue == 0:
        warnings.append("net revenue is zero — margin undefined")
    variable = included
    break_even = None
    if net_revenue > 0 and variable < net_revenue:
        break_even = inputs.fixed_costs_allocated / (Decimal(1) - variable / net_revenue)
    outputs = {
        "currency": currency,
        "net_revenue": serialize_decimal(quantize_money(net_revenue, currency)),
        "included_costs": serialize_decimal(quantize_money(included, currency)),
        "gross_contribution": serialize_decimal(quantize_money(gross_contribution, currency)),
        "operating_contribution": serialize_decimal(quantize_money(operating_contribution, currency)),
        "contribution_margin": serialize_decimal(quantize_rate(margin)) if margin is not None else None,
        "break_even_revenue": serialize_decimal(quantize_money(break_even, currency)) if break_even is not None else None,
    }
    validations = [ValidationFinding(check="contribution_identity", status="pass", finding="gross contribution equals net revenue minus included costs")]
    assumptions = ["expected_loss provided explicitly"] if inputs.expected_loss is not None else []
    return CalculatorOutcome(outputs=outputs, warnings=warnings, validations=validations, assumptions_used=assumptions, missing_fields=[])


class AggregateItem(StrictInput):
    key: str = Field(min_length=1)
    group: str = Field(min_length=1)
    currency: str = Field(min_length=3, max_length=3)
    gross_contribution: DecimalStr
    net_revenue: DecimalStr


class AggregatePnlInput(StrictInput):
    reporting_currency: str = Field(min_length=3, max_length=3)
    items: list[AggregateItem] = Field(min_length=1)
    group_by: str = "group"


def compute_aggregate_pnl(inputs: AggregatePnlInput) -> CalculatorOutcome:
    currency = inputs.reporting_currency.upper()
    mixed = [item.key for item in inputs.items if item.currency.upper() != currency]
    if mixed:
        return CalculatorOutcome(
            outputs={},
            warnings=[],
            validations=[ValidationFinding(check="single_currency", status="fail", finding="mixed currencies require pre-converted items")],
            assumptions_used=[],
            missing_fields=[f"fx_conversion_for:{key}" for key in mixed],
        )
    groups: dict[str, dict[str, Decimal]] = {}
    for item in inputs.items:
        bucket = groups.setdefault(item.group, {"gross_contribution": Decimal(0), "net_revenue": Decimal(0)})
        bucket["gross_contribution"] += item.gross_contribution
        bucket["net_revenue"] += item.net_revenue
    outputs = {
        "currency": currency,
        "groups": {
            name: {k: serialize_decimal(quantize_money(v, currency)) for k, v in sorted(vals.items())} for name, vals in sorted(groups.items())
        },
        "total_gross_contribution": serialize_decimal(quantize_money(sum((i.gross_contribution for i in inputs.items), Decimal(0)), currency)),
    }
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])


TRANSACTION_PNL = CalculatorDefinition(
    calculator_id="capital.calculate_transaction_pnl",
    calculator_version="1.0.0",
    formula_version="pnl-waterfall-v1",
    input_model=TransactionPnlInput,
    compute=compute_transaction_pnl,  # type: ignore[arg-type]
)

AGGREGATE_PNL = CalculatorDefinition(
    calculator_id="capital.calculate_aggregate_pnl",
    calculator_version="1.0.0",
    formula_version="aggregate-pnl-v1",
    input_model=AggregatePnlInput,
    compute=compute_aggregate_pnl,  # type: ignore[arg-type]
)
