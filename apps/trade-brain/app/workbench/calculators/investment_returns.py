"""Investment returns (v1.1: dated XNPV/XIRR mode added, §9.7) and equity
dilution (v1.1: explicit option-pool convention, §9.8)."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..decimal_policy import quantize_money, quantize_rate, serialize_decimal
from ..errors import WorkbenchInputError
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import StructuredWarning
from ..types import DecimalStr, StrictInput
from ..validators import discount_rate, strictly_positive, unit_fraction


class DatedFlow(StrictInput):
    on: date
    amount: DecimalStr


class InvestmentInput(StrictInput):
    """mode='periodic' uses index-based cash_flows (cash_flows[0] at t=0);
    mode='dated' uses dated_flows with real dates (XNPV / dated-cash-flow
    IRR). Both modes are explicit — never inferred."""

    currency: str = Field(min_length=3, max_length=3)
    mode: Literal["periodic", "dated"] = "periodic"
    cash_flows: list[DecimalStr] | None = None
    dated_flows: list[DatedFlow] | None = None
    discount_rate: DecimalStr
    discount_rate_provenance: str = "assumption"


class InvestmentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    mode: str
    npv: str
    irr: str | None = None
    irr_method: str | None = None
    irr_diagnostic: str | None = None
    payback_period_index: int | None = None
    payback_date: str | None = None
    return_multiple: str | None = None
    discount_rate_provenance: str


def _npv_periodic(rate: Decimal, flows: list[Decimal]) -> Decimal:
    total = Decimal(0)
    factor = Decimal(1)
    one_plus = Decimal(1) + rate
    for index, flow in enumerate(flows):
        if index > 0:
            factor *= one_plus
        total += flow / factor
    return total


def _npv_dated(rate: Decimal, flows: list[DatedFlow]) -> Decimal:
    base = flows[0].on
    one_plus = Decimal(1) + rate
    total = Decimal(0)
    for flow in flows:
        years = Decimal((flow.on - base).days) / Decimal(365)
        # (1+r)^years via exp/ln is float territory; use integer-day compounding:
        # (1+r)^(days/365) computed with Decimal power through exponent as float
        # is not exact — approximate deterministically with per-day factor.
        total += flow.amount / _pow_decimal(one_plus, years)
    return total


def _pow_decimal(base: Decimal, exponent: Decimal) -> Decimal:
    """Deterministic decimal power via exp(exponent * ln(base))."""
    return (exponent * base.ln()).exp()


def _bisect_irr(npv_fn, low: Decimal, high: Decimal) -> tuple[Decimal | None, str | None]:
    f_low, f_high = npv_fn(low), npv_fn(high)
    if f_low * f_high > 0:
        return None, "non_convergence: no sign change in the search interval [-99.99%, 1000%]"
    for _ in range(200):
        mid = (low + high) / 2
        f_mid = npv_fn(mid)
        if abs(f_mid) < Decimal("0.000001"):
            return mid, None
        if f_low * f_mid <= 0:
            high, f_high = mid, f_mid
        else:
            low, f_low = mid, f_mid
    return (low + high) / 2, None


def compute_investment(inputs: InvestmentInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    discount_rate(inputs.discount_rate, "discount_rate")
    warnings: list[StructuredWarning] = []

    if inputs.mode == "periodic":
        if not inputs.cash_flows or len(inputs.cash_flows) < 2:
            return CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=["cash_flows"])
        flows = list(inputs.cash_flows)
        amounts = flows
        npv = _npv_periodic(inputs.discount_rate, flows)
        npv_fn = lambda rate: _npv_periodic(rate, flows)  # noqa: E731
        irr_method = "periodic_irr_bisection"
    else:
        if not inputs.dated_flows or len(inputs.dated_flows) < 2:
            return CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=["dated_flows"])
        dated = sorted(inputs.dated_flows, key=lambda f: f.on)
        amounts = [f.amount for f in dated]
        npv = _npv_dated(inputs.discount_rate, dated)
        npv_fn = lambda rate: _npv_dated(rate, dated)  # noqa: E731
        irr_method = "xirr_dated_bisection"

    sign_changes = sum(1 for a, b in zip(amounts, amounts[1:]) if (a < 0 <= b) or (a >= 0 > b))
    irr_value: Decimal | None = None
    diagnostic: str | None = None
    if sign_changes == 0:
        diagnostic = "no_valid_irr: cash flows never change sign"
    else:
        if sign_changes > 1:
            diagnostic = "irr_not_unique: multiple sign changes — the reported root is one of several possible; do not treat as an unqualified authoritative result"
            warnings.append(StructuredWarning(code="irr.multiple_roots", message="multiple sign changes — IRR may not be unique", severity="critical", related_input_paths=["cash_flows" if inputs.mode == "periodic" else "dated_flows"]))
        irr_value, convergence = _bisect_irr(npv_fn, Decimal("-0.9999"), Decimal("10"))
        if convergence:
            # Both facts matter: non-uniqueness (if flagged) AND convergence.
            diagnostic = f"{diagnostic}; {convergence}" if diagnostic else convergence

    cumulative = Decimal(0)
    payback_index = None
    payback_date = None
    if inputs.mode == "periodic":
        for period, flow in enumerate(amounts):
            cumulative += flow
            if cumulative >= 0 and payback_index is None and period > 0:
                payback_index = period
    else:
        for flow in sorted(inputs.dated_flows, key=lambda f: f.on):  # type: ignore[arg-type]
            cumulative += flow.amount
            if cumulative >= 0 and payback_date is None and flow.on != inputs.dated_flows[0].on:  # type: ignore[index]
                payback_date = flow.on.isoformat()
    invested = -sum((f for f in amounts if f < 0), Decimal(0))
    returned = sum((f for f in amounts if f > 0), Decimal(0))
    multiple = returned / invested if invested > 0 else None

    outputs = {
        "currency": currency,
        "mode": inputs.mode,
        "npv": serialize_decimal(quantize_money(npv, currency)),
        "irr": serialize_decimal(quantize_rate(irr_value)) if irr_value is not None else None,
        "irr_method": irr_method if irr_value is not None else None,
        "irr_diagnostic": diagnostic,
        "payback_period_index": payback_index,
        "payback_date": payback_date,
        "return_multiple": serialize_decimal(quantize_rate(multiple)) if multiple is not None else None,
        "discount_rate_provenance": inputs.discount_rate_provenance,
    }
    assumptions = [f"discount_rate is an explicit {inputs.discount_rate_provenance}"]
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=warnings, assumptions_used=assumptions)


PoolConvention = Literal["pre_money_before_financing", "post_money_after_financing"]


class DilutionInput(StrictInput):
    pre_money_valuation: DecimalStr
    new_capital: DecimalStr
    currency: str = Field(min_length=3, max_length=3)
    existing_holder_pct: DecimalStr
    option_pool_added_pct: DecimalStr = Decimal(0)
    # §9.8: the pool convention is EXPLICIT — never silently assumed.
    option_pool_convention: PoolConvention | None = None
    valuation_provenance: str = "assumption"


class DilutionOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    post_money_valuation: str
    new_investor_pct: str
    existing_holder_post_pct: str
    existing_holder_post_pct_after_pool: str | None = None
    option_pool_convention: str | None = None


def compute_dilution(inputs: DilutionInput) -> CalculatorOutcome:
    strictly_positive(inputs.pre_money_valuation, "pre_money_valuation")
    if inputs.new_capital < 0:
        raise WorkbenchInputError("input.negative_amount", "'new_capital' must not be negative", {"field": "new_capital"})
    unit_fraction(inputs.existing_holder_pct, "existing_holder_pct")
    unit_fraction(inputs.option_pool_added_pct, "option_pool_added_pct")
    if inputs.option_pool_added_pct > 0 and inputs.option_pool_convention is None:
        return CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=["option_pool_convention"])
    post_money = inputs.pre_money_valuation + inputs.new_capital
    new_investor_pct = inputs.new_capital / post_money
    holder_post = inputs.existing_holder_pct * inputs.pre_money_valuation / post_money
    after_pool: Decimal | None = None
    if inputs.option_pool_added_pct > 0:
        if inputs.option_pool_convention == "pre_money_before_financing":
            # Pool carved out of existing holders BEFORE the round dilutes everyone.
            after_pool = inputs.existing_holder_pct * (Decimal(1) - inputs.option_pool_added_pct) * inputs.pre_money_valuation / post_money
        else:  # post_money_after_financing: pool dilutes everyone post-round.
            after_pool = holder_post * (Decimal(1) - inputs.option_pool_added_pct)
    outputs = {
        "currency": inputs.currency.upper(),
        "post_money_valuation": serialize_decimal(quantize_money(post_money, inputs.currency)),
        "new_investor_pct": serialize_decimal(quantize_rate(new_investor_pct)),
        "existing_holder_post_pct": serialize_decimal(quantize_rate(holder_post)),
        "existing_holder_post_pct_after_pool": serialize_decimal(quantize_rate(after_pool)) if after_pool is not None else None,
        "option_pool_convention": inputs.option_pool_convention,
    }
    assumptions = [f"valuation is an explicit {inputs.valuation_provenance}, not a verified fact"]
    if inputs.option_pool_convention:
        assumptions.append(f"option pool convention: {inputs.option_pool_convention}")
    return CalculatorOutcome(status="completed", outputs=outputs, assumptions_used=assumptions)


INVESTMENT_RETURNS = CalculatorDefinition(
    calculator_id="capital.calculate_investment_returns",
    calculator_version="1.1.0",
    formula_version="npv-irr-v2",
    input_model=InvestmentInput,
    output_model=InvestmentOutput,
    compute=compute_investment,  # type: ignore[arg-type]
    material_input_paths=("cash_flows", "dated_flows", "discount_rate"),
    scenario_overridable_paths=("cash_flows", "dated_flows", "discount_rate"),
    comparable_output_keys=("npv", "irr", "return_multiple"),
    required_evidence_categories=("cashflow_basis",),
    data_classes=("finance_read",),
    sensitivity="confidential",
)

DILUTION = CalculatorDefinition(
    calculator_id="capital.calculate_dilution",
    calculator_version="1.1.0",
    formula_version="dilution-v2",
    input_model=DilutionInput,
    output_model=DilutionOutput,
    compute=compute_dilution,  # type: ignore[arg-type]
    material_input_paths=("pre_money_valuation", "new_capital", "existing_holder_pct"),
    may_default_paths=("option_pool_added_pct",),
    scenario_overridable_paths=("pre_money_valuation", "new_capital", "option_pool_added_pct"),
    comparable_output_keys=("post_money_valuation", "new_investor_pct", "existing_holder_post_pct"),
    required_evidence_categories=("cap_table",),
    data_classes=("org_finance_profile",),
    sensitivity="restricted_financial",
)
