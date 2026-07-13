"""Deterministic NPV / IRR / payback / multiple + equity dilution (B6).

IRR uses deterministic bisection; no valid IRR, multiple sign changes, and
non-convergence return diagnostics rather than fabricated results.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from ..decimal_policy import quantize_money, quantize_rate, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..types import DecimalStr, StrictInput


class InvestmentInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    # cash_flows[0] is t=0 (typically the negative investment).
    cash_flows: list[DecimalStr] = Field(min_length=2)
    discount_rate: DecimalStr
    discount_rate_provenance: str = "assumption"


def _npv(rate: Decimal, flows: list[Decimal]) -> Decimal:
    total = Decimal(0)
    factor = Decimal(1)
    one_plus = Decimal(1) + rate
    for index, flow in enumerate(flows):
        if index > 0:
            factor *= one_plus
        total += flow / factor
    return total


def compute_investment(inputs: InvestmentInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    flows = list(inputs.cash_flows)
    warnings: list[str] = []
    sign_changes = sum(1 for a, b in zip(flows, flows[1:]) if (a < 0 <= b) or (a >= 0 > b))
    npv = _npv(inputs.discount_rate, flows)

    irr_value: Decimal | None = None
    irr_diagnostic = None
    if sign_changes == 0:
        irr_diagnostic = "no_valid_irr: cash flows never change sign"
    else:
        if sign_changes > 1:
            warnings.append("multiple sign changes — IRR may not be unique; bisection returns one root")
        low, high = Decimal("-0.9999"), Decimal("10")
        f_low, f_high = _npv(low, flows), _npv(high, flows)
        if f_low * f_high > 0:
            irr_diagnostic = "non_convergence: no sign change in the search interval [-99.99%, 1000%]"
        else:
            for _ in range(200):
                mid = (low + high) / 2
                f_mid = _npv(mid, flows)
                if abs(f_mid) < Decimal("0.000001"):
                    break
                if f_low * f_mid <= 0:
                    high, f_high = mid, f_mid
                else:
                    low, f_low = mid, f_mid
            irr_value = (low + high) / 2

    cumulative = Decimal(0)
    payback = None
    for period, flow in enumerate(flows):
        cumulative += flow
        if cumulative >= 0 and payback is None and period > 0:
            payback = period
    invested = -sum((f for f in flows if f < 0), Decimal(0))
    returned = sum((f for f in flows if f > 0), Decimal(0))
    multiple = returned / invested if invested > 0 else None

    outputs = {
        "currency": currency,
        "npv": serialize_decimal(quantize_money(npv, currency)),
        "irr": serialize_decimal(quantize_rate(irr_value)) if irr_value is not None else None,
        "irr_diagnostic": irr_diagnostic,
        "payback_period_index": payback,
        "return_multiple": serialize_decimal(quantize_rate(multiple)) if multiple is not None else None,
        "discount_rate_provenance": inputs.discount_rate_provenance,
    }
    assumptions = [f"discount_rate is an explicit {inputs.discount_rate_provenance}"]
    return CalculatorOutcome(outputs=outputs, warnings=warnings, validations=[], assumptions_used=assumptions, missing_fields=[])


class DilutionInput(StrictInput):
    pre_money_valuation: DecimalStr
    new_capital: DecimalStr
    currency: str = Field(min_length=3, max_length=3)
    existing_holder_pct: DecimalStr  # fraction, e.g. "0.40"
    option_pool_added_pct: DecimalStr = Decimal(0)
    valuation_provenance: str = "assumption"


def compute_dilution(inputs: DilutionInput) -> CalculatorOutcome:
    if inputs.pre_money_valuation <= 0 or inputs.new_capital < 0:
        return CalculatorOutcome(outputs={}, warnings=[], validations=[], assumptions_used=[], missing_fields=["pre_money_valuation" if inputs.pre_money_valuation <= 0 else "new_capital"])
    post_money = inputs.pre_money_valuation + inputs.new_capital
    new_investor_pct = inputs.new_capital / post_money
    holder_post = inputs.existing_holder_pct * inputs.pre_money_valuation / post_money
    holder_post_after_pool = holder_post * (Decimal(1) - inputs.option_pool_added_pct)
    outputs = {
        "currency": inputs.currency.upper(),
        "post_money_valuation": serialize_decimal(quantize_money(post_money, inputs.currency)),
        "new_investor_pct": serialize_decimal(quantize_rate(new_investor_pct)),
        "existing_holder_post_pct": serialize_decimal(quantize_rate(holder_post)),
        "existing_holder_post_pct_after_pool": serialize_decimal(quantize_rate(holder_post_after_pool)),
    }
    assumptions = [f"valuation is an explicit {inputs.valuation_provenance}, not a verified fact"]
    if inputs.option_pool_added_pct > 0:
        assumptions.append("option pool modelled explicitly as post-round dilution of existing holders")
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=assumptions, missing_fields=[])


INVESTMENT_RETURNS = CalculatorDefinition("capital.calculate_investment_returns", "1.0.0", "npv-irr-v1", InvestmentInput, compute_investment)  # type: ignore[arg-type]
DILUTION = CalculatorDefinition("capital.calculate_dilution", "1.0.0", "dilution-v1", DilutionInput, compute_dilution)  # type: ignore[arg-type]
