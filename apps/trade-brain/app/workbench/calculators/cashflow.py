"""Cash-flow timeline, working capital / funding gap, CCC, liquidity (B6)."""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from ..decimal_policy import quantize_money, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import ValidationFinding
from ..types import DatedAmount, DecimalStr, StrictInput


class CashflowInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    opening_cash: DecimalStr = Decimal(0)
    events: list[DatedAmount] = Field(min_length=1)


def compute_cashflow(inputs: CashflowInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    mixed = [e.label or str(e.on) for e in inputs.events if e.currency.upper() != currency]
    if mixed:
        return CalculatorOutcome(outputs={}, warnings=[], validations=[ValidationFinding(check="single_currency", status="fail", finding="events must be pre-converted to the timeline currency")], assumptions_used=[], missing_fields=[f"fx_conversion_for:{m}" for m in mixed])
    # Deterministic ordering: date, then label (duplicate dates are legal).
    ordered = sorted(inputs.events, key=lambda e: (e.on.isoformat(), e.label))
    running = inputs.opening_cash
    timeline = []
    peak_deficit = Decimal(0)
    peak_date = None
    recovery_date = None
    for event in ordered:
        running += event.amount
        timeline.append({"on": event.on.isoformat(), "label": event.label, "amount": serialize_decimal(event.amount), "cumulative": serialize_decimal(quantize_money(running, currency))})
        if running < peak_deficit:
            peak_deficit, peak_date, recovery_date = running, event.on, None
        elif peak_deficit < 0 and running >= 0 and recovery_date is None:
            recovery_date = event.on
    outputs = {
        "currency": currency,
        "timeline": timeline,
        "closing_cash": serialize_decimal(quantize_money(running, currency)),
        "peak_cash_deficit": serialize_decimal(quantize_money(peak_deficit, currency)),
        "cash_need_date": peak_date.isoformat() if peak_date else None,
        "recovery_date": recovery_date.isoformat() if recovery_date else None,
    }
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])


class WorkingCapitalInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    opening_cash: DecimalStr = Decimal(0)
    events: list[DatedAmount] = Field(min_length=1)
    available_internal_liquidity: DecimalStr = Decimal(0)
    committed_facilities: DecimalStr = Decimal(0)


def compute_working_capital(inputs: WorkingCapitalInput) -> CalculatorOutcome:
    base = compute_cashflow(CashflowInput(currency=inputs.currency, opening_cash=inputs.opening_cash, events=inputs.events))
    if base.missing_fields:
        return base
    currency = inputs.currency.upper()
    peak_deficit = Decimal(base.outputs["peak_cash_deficit"])
    requirement = -peak_deficit if peak_deficit < 0 else Decimal(0)
    residual_gap = requirement - inputs.available_internal_liquidity - inputs.committed_facilities
    if residual_gap < 0:
        residual_gap = Decimal(0)
    outputs = {
        **base.outputs,
        "peak_working_capital_requirement": serialize_decimal(quantize_money(requirement, currency)),
        "residual_funding_gap": serialize_decimal(quantize_money(residual_gap, currency)),
    }
    return CalculatorOutcome(outputs=outputs, warnings=base.warnings, validations=base.validations, assumptions_used=base.assumptions_used, missing_fields=[])


class CccInput(StrictInput):
    inventory_days: DecimalStr | None = None
    receivable_days: DecimalStr | None = None
    payable_days: DecimalStr | None = None


def compute_ccc(inputs: CccInput) -> CalculatorOutcome:
    missing = [f for f in ("inventory_days", "receivable_days", "payable_days") if getattr(inputs, f) is None]
    if missing:
        return CalculatorOutcome(outputs={}, warnings=["cash-conversion metrics are omitted when accounting inputs are not meaningful"], validations=[], assumptions_used=[], missing_fields=missing)
    ccc = inputs.inventory_days + inputs.receivable_days - inputs.payable_days  # type: ignore[operator]
    outputs = {"ccc_days": serialize_decimal(ccc)}
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])


class LiquidityInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    opening_liquidity: DecimalStr
    monthly_net_burn: DecimalStr
    minimum_cash: DecimalStr = Decimal(0)
    stress_burn_multiplier: DecimalStr = Decimal(1)


def compute_liquidity(inputs: LiquidityInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    usable = inputs.opening_liquidity - inputs.minimum_cash
    if inputs.monthly_net_burn <= 0:
        outputs = {"currency": currency, "runway_months": None, "note": "no net burn — runway not applicable"}
        return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])
    runway = usable / inputs.monthly_net_burn
    stress = usable / (inputs.monthly_net_burn * inputs.stress_burn_multiplier) if inputs.stress_burn_multiplier > 0 else None
    outputs = {
        "currency": currency,
        "usable_liquidity": serialize_decimal(quantize_money(usable, currency)),
        "runway_months": serialize_decimal(runway.quantize(Decimal("0.1"))),
        "stress_runway_months": serialize_decimal(stress.quantize(Decimal("0.1"))) if stress is not None else None,
    }
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])


CASHFLOW = CalculatorDefinition("capital.calculate_cashflow_timeline", "1.0.0", "cashflow-timeline-v1", CashflowInput, compute_cashflow)  # type: ignore[arg-type]
WORKING_CAPITAL = CalculatorDefinition("capital.calculate_working_capital", "1.0.0", "wc-gap-v1", WorkingCapitalInput, compute_working_capital)  # type: ignore[arg-type]
CCC = CalculatorDefinition("capital.calculate_ccc", "1.0.0", "ccc-v1", CccInput, compute_ccc)  # type: ignore[arg-type]
LIQUIDITY = CalculatorDefinition("capital.calculate_liquidity_runway", "1.0.0", "runway-v1", LiquidityInput, compute_liquidity)  # type: ignore[arg-type]
