"""Transaction P&L (v1.1: explicit cost classification, closure §9.3) and
company-side aggregate P&L (v1.1: complete totals)."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from ..decimal_policy import quantize_money, quantize_rate, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import StructuredWarning, ValidationFinding
from ..types import DecimalStr, StrictInput
from ..validators import non_negative_money
from ..errors import WorkbenchInputError


class TransactionPnlInput(StrictInput):
    """Costs are CLASSIFIED (§9.3): only variable costs scale with revenue in
    contribution margin and break-even; financing and expected loss are
    itemized; fixed and transaction-specific non-scaling costs never scale."""

    currency: str = Field(min_length=3, max_length=3)
    revenue: DecimalStr
    discounts: DecimalStr = Decimal(0)
    variable_costs: DecimalStr = Decimal(0)
    fixed_costs: DecimalStr = Decimal(0)
    transaction_specific_costs: DecimalStr = Decimal(0)
    financing_costs: DecimalStr = Decimal(0)
    expected_loss: DecimalStr | None = None


class TransactionPnlOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    net_revenue: str
    variable_costs: str
    non_scaling_costs: str
    gross_contribution: str
    operating_contribution: str
    contribution_margin: str | None = None
    break_even_revenue: str | None = None


def compute_transaction_pnl(inputs: TransactionPnlInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    if inputs.revenue < 0:
        raise WorkbenchInputError("input.negative_revenue", "revenue must not be negative", {"field": "revenue"})
    non_negative_money(inputs.discounts, "discounts")
    for field_name in ("variable_costs", "fixed_costs", "transaction_specific_costs", "financing_costs"):
        non_negative_money(getattr(inputs, field_name), field_name)
    if inputs.discounts > inputs.revenue:
        raise WorkbenchInputError("input.discounts_exceed_revenue", "discounts must not exceed revenue", {"field": "discounts"})

    warnings: list[StructuredWarning] = []
    net_revenue = inputs.revenue - inputs.discounts
    expected_loss = inputs.expected_loss or Decimal(0)
    # Contribution: net revenue minus costs that vary with the transaction —
    # variable + financing + expected loss; transaction-specific non-scaling
    # costs are itemized but excluded from the VARIABLE ratio.
    non_scaling = inputs.transaction_specific_costs + inputs.fixed_costs
    gross_contribution = net_revenue - inputs.variable_costs - inputs.financing_costs - expected_loss - inputs.transaction_specific_costs
    operating_contribution = gross_contribution - inputs.fixed_costs
    variable_for_ratio = inputs.variable_costs + inputs.financing_costs + expected_loss
    margin = ((net_revenue - variable_for_ratio) / net_revenue) if net_revenue != 0 else None
    if net_revenue == 0:
        warnings.append(StructuredWarning(code="pnl.zero_net_revenue", message="net revenue is zero — margin undefined", severity="warning", related_input_paths=["revenue", "discounts"]))
    break_even = None
    if net_revenue > 0 and variable_for_ratio < net_revenue:
        # Break-even scales ONLY variable-classified costs with revenue.
        break_even = (inputs.fixed_costs + inputs.transaction_specific_costs) / (Decimal(1) - variable_for_ratio / net_revenue)
    outputs = {
        "currency": currency,
        "net_revenue": serialize_decimal(quantize_money(net_revenue, currency)),
        "variable_costs": serialize_decimal(quantize_money(variable_for_ratio, currency)),
        "non_scaling_costs": serialize_decimal(quantize_money(non_scaling, currency)),
        "gross_contribution": serialize_decimal(quantize_money(gross_contribution, currency)),
        "operating_contribution": serialize_decimal(quantize_money(operating_contribution, currency)),
        "contribution_margin": serialize_decimal(quantize_rate(margin)) if margin is not None else None,
        "break_even_revenue": serialize_decimal(quantize_money(break_even, currency)) if break_even is not None else None,
    }
    validations = [ValidationFinding(check="contribution_identity", status="pass", finding="gross contribution = net revenue - variable - financing - expected loss - transaction-specific")]
    assumptions = ["expected_loss provided explicitly"] if inputs.expected_loss is not None else []
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=warnings, validations=validations, assumptions_used=assumptions)


class AggregateItem(StrictInput):
    key: str = Field(min_length=1)
    group: str = Field(min_length=1)
    currency: str = Field(min_length=3, max_length=3)
    gross_contribution: DecimalStr
    net_revenue: DecimalStr
    operating_contribution: DecimalStr | None = None


class AggregatePnlOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    groups: dict[str, dict[str, str]]
    total_net_revenue: str
    total_gross_contribution: str
    total_operating_contribution: str | None = None
    aggregate_contribution_margin: str | None = None


class AggregatePnlInput(StrictInput):
    reporting_currency: str = Field(min_length=3, max_length=3)
    items: list[AggregateItem] = Field(min_length=1)


def compute_aggregate_pnl(inputs: AggregatePnlInput) -> CalculatorOutcome:
    currency = inputs.reporting_currency.upper()
    mixed = [item.key for item in inputs.items if item.currency.upper() != currency]
    if mixed:
        return CalculatorOutcome(
            status="insufficient_information",
            outputs={},
            validations=[ValidationFinding(check="single_currency", status="fail", finding="mixed currencies require pre-converted items")],
            missing_fields=[f"fx_conversion_for:{key}" for key in mixed],
        )
    groups: dict[str, dict[str, Decimal]] = {}
    total_revenue = Decimal(0)
    total_gross = Decimal(0)
    total_operating: Decimal | None = Decimal(0)
    for item in inputs.items:
        bucket = groups.setdefault(item.group, {"gross_contribution": Decimal(0), "net_revenue": Decimal(0)})
        bucket["gross_contribution"] += item.gross_contribution
        bucket["net_revenue"] += item.net_revenue
        total_gross += item.gross_contribution
        total_revenue += item.net_revenue
        if total_operating is not None:
            total_operating = total_operating + item.operating_contribution if item.operating_contribution is not None else None
    margin = (total_gross / total_revenue) if total_revenue != 0 else None
    outputs = {
        "currency": currency,
        "groups": {name: {k: serialize_decimal(quantize_money(v, currency)) for k, v in sorted(vals.items())} for name, vals in sorted(groups.items())},
        "total_net_revenue": serialize_decimal(quantize_money(total_revenue, currency)),
        "total_gross_contribution": serialize_decimal(quantize_money(total_gross, currency)),
        "total_operating_contribution": serialize_decimal(quantize_money(total_operating, currency)) if total_operating is not None else None,
        "aggregate_contribution_margin": serialize_decimal(quantize_rate(margin)) if margin is not None else None,
    }
    return CalculatorOutcome(status="completed", outputs=outputs)


TRANSACTION_PNL = CalculatorDefinition(
    calculator_id="capital.calculate_transaction_pnl",
    calculator_version="1.1.0",
    formula_version="pnl-waterfall-v2",
    input_model=TransactionPnlInput,
    output_model=TransactionPnlOutput,
    compute=compute_transaction_pnl,  # type: ignore[arg-type]
    material_input_paths=("revenue", "variable_costs", "fixed_costs", "transaction_specific_costs", "financing_costs"),
    may_default_paths=("discounts", "variable_costs", "fixed_costs", "transaction_specific_costs", "financing_costs"),
    scenario_overridable_paths=("revenue", "discounts", "variable_costs", "fixed_costs", "transaction_specific_costs", "financing_costs", "expected_loss"),
    comparable_output_keys=("net_revenue", "gross_contribution", "operating_contribution", "break_even_revenue"),
    required_evidence_categories=("revenue_basis", "cost_documents"),
    data_classes=("trade_context", "finance_read"),
    sensitivity="confidential",
)

AGGREGATE_PNL = CalculatorDefinition(
    calculator_id="capital.calculate_aggregate_pnl",
    calculator_version="1.1.0",
    formula_version="aggregate-pnl-v2",
    input_model=AggregatePnlInput,
    output_model=AggregatePnlOutput,
    compute=compute_aggregate_pnl,  # type: ignore[arg-type]
    material_input_paths=("items[*].gross_contribution", "items[*].net_revenue"),
    scenario_overridable_paths=("items",),
    comparable_output_keys=("total_gross_contribution", "total_net_revenue"),
    unordered_list_paths=("items",),
    required_evidence_categories=("transaction_pnl_runs",),
    data_classes=("trade_context", "finance_read", "org_finance_profile"),
    sensitivity="confidential",
)
