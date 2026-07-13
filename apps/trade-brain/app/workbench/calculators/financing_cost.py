"""Financing cost / net proceeds, receivables finance (eligibility-first),
debt service (directive B6)."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import Field

from ..decimal_policy import day_count_basis, quantize_money, quantize_rate, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import ValidationFinding
from ..types import DecimalStr, StrictInput


class FinancingCostInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    principal: DecimalStr
    annual_rate: DecimalStr
    tenor_days: int = Field(gt=0)
    day_count: Literal["ACT/360", "ACT/365"] = "ACT/360"
    structure: Literal["simple_interest", "bullet", "amortizing_equal_principal"] = "simple_interest"
    periods: int = Field(default=1, gt=0)
    upfront_fees: DecimalStr = Decimal(0)
    recurring_fees_total: DecimalStr = Decimal(0)
    fees_withheld_at_disbursement: DecimalStr = Decimal(0)


def compute_financing_cost(inputs: FinancingCostInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    if inputs.principal <= 0:
        return CalculatorOutcome(outputs={}, warnings=[], validations=[ValidationFinding(check="principal_positive", status="fail", finding="principal must be positive")], assumptions_used=[], missing_fields=["principal"])
    basis = Decimal(day_count_basis(inputs.day_count))
    if inputs.structure == "amortizing_equal_principal":
        # Interest accrues on the declining balance across equal principal periods.
        period_days = Decimal(inputs.tenor_days) / Decimal(inputs.periods)
        balance = inputs.principal
        interest = Decimal(0)
        per_period_principal = inputs.principal / Decimal(inputs.periods)
        for _ in range(inputs.periods):
            interest += balance * inputs.annual_rate * period_days / basis
            balance -= per_period_principal
    else:
        interest = inputs.principal * inputs.annual_rate * Decimal(inputs.tenor_days) / basis
    total_fees = inputs.upfront_fees + inputs.recurring_fees_total
    total_cost = interest + total_fees
    net_proceeds = inputs.principal - inputs.fees_withheld_at_disbursement
    effective_period_cost = total_cost / net_proceeds if net_proceeds > 0 else None
    annualized = (effective_period_cost * basis / Decimal(inputs.tenor_days)) if effective_period_cost is not None else None
    outputs = {
        "currency": currency,
        "interest": serialize_decimal(quantize_money(interest, currency)),
        "total_fees": serialize_decimal(quantize_money(total_fees, currency)),
        "total_financing_cost": serialize_decimal(quantize_money(total_cost, currency)),
        "net_proceeds": serialize_decimal(quantize_money(net_proceeds, currency)),
        "total_repayment": serialize_decimal(quantize_money(inputs.principal + interest + inputs.recurring_fees_total, currency)),
        "effective_period_cost": serialize_decimal(quantize_rate(effective_period_cost)) if effective_period_cost is not None else None,
        # Annualized simple-equivalent method; deliberately NOT labelled APR.
        "annualized_effective_cost_simple": serialize_decimal(quantize_rate(annualized)) if annualized is not None else None,
        "day_count": inputs.day_count,
    }
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[ValidationFinding(check="net_proceeds_le_principal", status="pass" if net_proceeds <= inputs.principal else "fail")], assumptions_used=[], missing_fields=[])


class ReceivablesFinanceInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    invoice_exists: bool | None = None
    receivable_exists: bool | None = None
    delivery_complete: bool | None = None
    buyer_acceptance: bool | None = None
    acceptance_required: bool = True
    invoice_amount: DecimalStr | None = None
    due_in_days: int | None = None
    advance_rate: DecimalStr | None = None
    discount_annual_rate: DecimalStr | None = None
    service_fees: DecimalStr = Decimal(0)
    reserve_rate: DecimalStr = Decimal(0)
    assignment_restricted: bool | None = None
    disputed: bool | None = None
    day_count: Literal["ACT/360", "ACT/365"] = "ACT/360"


def compute_receivables_finance(inputs: ReceivablesFinanceInput) -> CalculatorOutcome:
    # Eligibility first (Golden A/B): a PO without invoice+receivable is NEVER eligible.
    unknown = [f for f in ("invoice_exists", "receivable_exists", "delivery_complete") if getattr(inputs, f) is None]
    if inputs.acceptance_required and inputs.buyer_acceptance is None:
        unknown.append("buyer_acceptance")
    if unknown:
        return CalculatorOutcome(outputs={}, warnings=[], validations=[], assumptions_used=[], missing_fields=unknown, eligibility="insufficient_information")
    contradictions: list[str] = []
    if inputs.receivable_exists and not inputs.invoice_exists:
        contradictions.append("receivable_exists without invoice_exists is contradictory")
    if contradictions:
        return CalculatorOutcome(outputs={"contradictions": contradictions}, warnings=[], validations=[ValidationFinding(check="evidence_consistency", status="fail", finding="; ".join(contradictions))], assumptions_used=[], missing_fields=[], eligibility="insufficient_information")
    ineligible_reasons: list[str] = []
    if not inputs.invoice_exists:
        ineligible_reasons.append("no invoice exists")
    if not inputs.receivable_exists:
        ineligible_reasons.append("no receivable exists")
    if not inputs.delivery_complete:
        ineligible_reasons.append("delivery/performance not complete")
    if inputs.acceptance_required and not inputs.buyer_acceptance:
        ineligible_reasons.append("buyer acceptance missing")
    if inputs.assignment_restricted:
        ineligible_reasons.append("assignment restricted")
    if inputs.disputed:
        ineligible_reasons.append("receivable disputed")
    if ineligible_reasons:
        return CalculatorOutcome(outputs={"reasons": ineligible_reasons}, warnings=[], validations=[], assumptions_used=[], missing_fields=[], eligibility="ineligible")
    needed = [f for f in ("invoice_amount", "due_in_days", "advance_rate", "discount_annual_rate") if getattr(inputs, f) is None]
    if needed:
        return CalculatorOutcome(outputs={}, warnings=[], validations=[], assumptions_used=[], missing_fields=needed, eligibility="eligible")
    currency = inputs.currency.upper()
    basis = Decimal(day_count_basis(inputs.day_count))
    advance = inputs.invoice_amount * inputs.advance_rate  # type: ignore[operator]
    reserve = inputs.invoice_amount * inputs.reserve_rate  # type: ignore[operator]
    discount = advance * inputs.discount_annual_rate * Decimal(inputs.due_in_days) / basis  # type: ignore[operator, arg-type]
    net_proceeds = advance - discount - inputs.service_fees
    outputs = {
        "currency": currency,
        "advance_amount": serialize_decimal(quantize_money(advance, currency)),
        "reserve": serialize_decimal(quantize_money(reserve, currency)),
        "discount_charge": serialize_decimal(quantize_money(discount, currency)),
        "service_fees": serialize_decimal(quantize_money(inputs.service_fees, currency)),
        "net_proceeds": serialize_decimal(quantize_money(net_proceeds, currency)),
        "expected_settlement_days": inputs.due_in_days,
    }
    validations = [ValidationFinding(check="net_proceeds_le_face", status="pass" if net_proceeds <= inputs.invoice_amount else "fail")]  # type: ignore[operator]
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=validations, assumptions_used=[], missing_fields=[], eligibility="eligible")


class DebtServiceInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    principal: DecimalStr
    annual_rate: DecimalStr
    periods: int = Field(gt=0)
    period_days: int = Field(gt=0)
    day_count: Literal["ACT/360", "ACT/365"] = "ACT/360"
    mandatory_fees_per_period: DecimalStr = Decimal(0)
    cash_available_per_period: DecimalStr | None = None


def compute_debt_service(inputs: DebtServiceInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    basis = Decimal(day_count_basis(inputs.day_count))
    per_principal = inputs.principal / Decimal(inputs.periods)
    balance = inputs.principal
    schedule = []
    total = Decimal(0)
    min_dscr: Decimal | None = None
    for period in range(1, inputs.periods + 1):
        interest = balance * inputs.annual_rate * Decimal(inputs.period_days) / basis
        service = per_principal + interest + inputs.mandatory_fees_per_period
        total += service
        entry = {"period": period, "principal": serialize_decimal(quantize_money(per_principal, currency)), "interest": serialize_decimal(quantize_money(interest, currency)), "debt_service": serialize_decimal(quantize_money(service, currency))}
        if inputs.cash_available_per_period is not None and service > 0:
            dscr = inputs.cash_available_per_period / service
            entry["dscr"] = serialize_decimal(quantize_rate(dscr))
            min_dscr = dscr if min_dscr is None or dscr < min_dscr else min_dscr
        schedule.append(entry)
        balance -= per_principal
    outputs = {
        "currency": currency,
        "schedule": schedule,
        "total_debt_service": serialize_decimal(quantize_money(total, currency)),
        "min_dscr": serialize_decimal(quantize_rate(min_dscr)) if min_dscr is not None else None,
        "dscr_definition": "cash_available_per_period / (principal + interest + mandatory fees)" if min_dscr is not None else None,
    }
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])


FINANCING_COST = CalculatorDefinition("capital.calculate_financing_cost", "1.0.0", "financing-cost-v1", FinancingCostInput, compute_financing_cost)  # type: ignore[arg-type]
RECEIVABLES_FINANCE = CalculatorDefinition("capital.calculate_receivables_finance", "1.0.0", "receivables-proceeds-v1", ReceivablesFinanceInput, compute_receivables_finance)  # type: ignore[arg-type]
DEBT_SERVICE = CalculatorDefinition("capital.calculate_debt_service", "1.0.0", "debt-service-v1", DebtServiceInput, compute_debt_service)  # type: ignore[arg-type]
