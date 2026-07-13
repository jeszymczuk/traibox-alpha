"""Financing cost / net proceeds (v1.1: explicit fee timing, §9.4),
receivables finance (v1.1: structural vs pricing separation, §9.5), and
debt service (v1.1: explicit repayment profiles)."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..decimal_policy import day_count_basis, quantize_money, quantize_rate, serialize_decimal
from ..errors import WorkbenchInputError
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import StructuredWarning, ValidationFinding
from ..types import DecimalStr, StrictInput
from ..validators import discount_rate, non_negative_days, non_negative_money, positive_int, strictly_positive, unit_fraction

FeeTiming = Literal["withheld_at_disbursement", "paid_at_disbursement", "capitalized", "paid_periodically", "paid_at_maturity"]


class Fee(StrictInput):
    label: str = Field(min_length=1)
    amount: DecimalStr
    timing: FeeTiming


class FinancingCostInput(StrictInput):
    """Fees are declared ONCE with explicit timing (§9.4); timing determines
    both cost and proceeds effects — no double entry."""

    currency: str = Field(min_length=3, max_length=3)
    principal: DecimalStr
    annual_rate: DecimalStr
    tenor_days: int
    day_count: Literal["ACT/360", "ACT/365"] = "ACT/360"
    structure: Literal["simple_interest", "bullet", "amortizing_equal_principal"] = "simple_interest"
    periods: int = 1
    fees: list[Fee] = Field(default_factory=list)


class FinancingCostOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    gross_principal: str
    cash_received_at_disbursement: str
    net_proceeds: str
    interest: str
    fees_by_timing: dict[str, str]
    total_fees: str
    total_financing_cost: str
    total_cash_repayment: str
    repayment_schedule: list[dict[str, str | int]]
    annualized_simple_cost: str | None = None
    day_count: str


def compute_financing_cost(inputs: FinancingCostInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    strictly_positive(inputs.principal, "principal")
    discount_rate(inputs.annual_rate, "annual_rate")
    positive_int(inputs.tenor_days, "tenor_days")
    positive_int(inputs.periods, "periods")
    for index, fee in enumerate(inputs.fees):
        non_negative_money(fee.amount, f"fees[{index}].amount")
    basis = Decimal(day_count_basis(inputs.day_count))

    by_timing: dict[str, Decimal] = {}
    for fee in inputs.fees:
        by_timing[fee.timing] = by_timing.get(fee.timing, Decimal(0)) + fee.amount
    withheld = by_timing.get("withheld_at_disbursement", Decimal(0))
    paid_at_disb = by_timing.get("paid_at_disbursement", Decimal(0))
    capitalized = by_timing.get("capitalized", Decimal(0))
    if withheld + paid_at_disb > inputs.principal:
        raise WorkbenchInputError("input.fees_exceed_principal", "disbursement-time fees exceed the principal", {"field": "fees"})

    # Interest accrues on principal + capitalized fees.
    interest_base = inputs.principal + capitalized
    schedule: list[dict[str, str | int]] = []
    if inputs.structure == "amortizing_equal_principal":
        period_days = Decimal(inputs.tenor_days) / Decimal(inputs.periods)
        balance = interest_base
        interest = Decimal(0)
        per_principal = interest_base / Decimal(inputs.periods)
        for period in range(1, inputs.periods + 1):
            period_interest = balance * inputs.annual_rate * period_days / basis
            interest += period_interest
            schedule.append({"period": period, "principal": serialize_decimal(quantize_money(per_principal, currency)), "interest": serialize_decimal(quantize_money(period_interest, currency))})
            balance -= per_principal
    else:
        interest = interest_base * inputs.annual_rate * Decimal(inputs.tenor_days) / basis
        schedule.append({"period": 1, "principal": serialize_decimal(quantize_money(interest_base, currency)), "interest": serialize_decimal(quantize_money(interest, currency))})

    total_fees = sum(by_timing.values(), Decimal(0))
    total_cost = interest + total_fees
    cash_received = inputs.principal - withheld - paid_at_disb
    net_proceeds = cash_received
    total_repayment = interest_base + interest + by_timing.get("paid_periodically", Decimal(0)) + by_timing.get("paid_at_maturity", Decimal(0))
    effective_period_cost = total_cost / net_proceeds if net_proceeds > 0 else None
    annualized = (effective_period_cost * basis / Decimal(inputs.tenor_days)) if effective_period_cost is not None else None
    outputs = {
        "currency": currency,
        "gross_principal": serialize_decimal(quantize_money(inputs.principal, currency)),
        "cash_received_at_disbursement": serialize_decimal(quantize_money(cash_received, currency)),
        "net_proceeds": serialize_decimal(quantize_money(net_proceeds, currency)),
        "interest": serialize_decimal(quantize_money(interest, currency)),
        "fees_by_timing": {timing: serialize_decimal(quantize_money(amount, currency)) for timing, amount in sorted(by_timing.items())},
        "total_fees": serialize_decimal(quantize_money(total_fees, currency)),
        "total_financing_cost": serialize_decimal(quantize_money(total_cost, currency)),
        "total_cash_repayment": serialize_decimal(quantize_money(total_repayment, currency)),
        "repayment_schedule": schedule,
        # Simple annualization; deliberately NOT labelled APR.
        "annualized_simple_cost": serialize_decimal(quantize_rate(annualized)) if annualized is not None else None,
        "day_count": inputs.day_count,
    }
    validations = [ValidationFinding(check="net_proceeds_le_principal", status="pass" if net_proceeds <= inputs.principal else "fail")]
    return CalculatorOutcome(status="completed", outputs=outputs, validations=validations)


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


class ReceivablesFinanceOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    structural_eligibility: str
    pricing_status: str
    eligibility_reasons: list[str]
    missing_pricing_fields: list[str]
    currency: str | None = None
    advance_amount: str | None = None
    reserve: str | None = None
    reserve_release_at_settlement: str | None = None
    discount_charge: str | None = None
    service_fees: str | None = None
    net_proceeds: str | None = None
    expected_settlement_days: int | None = None


def compute_receivables_finance(inputs: ReceivablesFinanceInput) -> CalculatorOutcome:
    # §9.5: structural eligibility, information completeness, and pricing
    # completeness are separate dimensions.
    non_negative_money(inputs.service_fees, "service_fees")
    unknown = [f for f in ("invoice_exists", "receivable_exists", "delivery_complete") if getattr(inputs, f) is None]
    if inputs.acceptance_required and inputs.buyer_acceptance is None:
        unknown.append("buyer_acceptance")
    if unknown:
        return CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=unknown, eligibility="insufficient_information")
    contradictions: list[str] = []
    if inputs.receivable_exists and not inputs.invoice_exists:
        contradictions.append("receivable_exists without invoice_exists is contradictory")
    if contradictions:
        return CalculatorOutcome(
            status="insufficient_information",
            outputs={},
            validations=[ValidationFinding(check="evidence_consistency", status="fail", finding="; ".join(contradictions))],
            contradictions=contradictions,
            eligibility="insufficient_information",
        )
    reasons: list[str] = []
    if not inputs.invoice_exists:
        reasons.append("no invoice exists")
    if not inputs.receivable_exists:
        reasons.append("no receivable exists")
    if not inputs.delivery_complete:
        reasons.append("delivery/performance not complete")
    if inputs.acceptance_required and not inputs.buyer_acceptance:
        reasons.append("buyer acceptance missing")
    if inputs.assignment_restricted:
        reasons.append("assignment restricted")
    if inputs.disputed:
        reasons.append("receivable disputed")
    if reasons:
        outputs = {"structural_eligibility": "ineligible", "pricing_status": "not_applicable", "eligibility_reasons": reasons, "missing_pricing_fields": []}
        return CalculatorOutcome(status="completed", outputs=outputs, eligibility="ineligible")

    missing_pricing = [f for f in ("invoice_amount", "due_in_days", "advance_rate", "discount_annual_rate") if getattr(inputs, f) is None]
    if missing_pricing:
        outputs = {"structural_eligibility": "eligible", "pricing_status": "incomplete", "eligibility_reasons": [], "missing_pricing_fields": missing_pricing}
        return CalculatorOutcome(status="completed", outputs=outputs, missing_fields=missing_pricing, eligibility="eligible")

    unit_fraction(inputs.advance_rate, "advance_rate")  # type: ignore[arg-type]
    unit_fraction(inputs.reserve_rate, "reserve_rate")
    if inputs.advance_rate + inputs.reserve_rate > Decimal(1):  # type: ignore[operator]
        raise WorkbenchInputError("input.advance_reserve_inconsistent", "advance_rate + reserve_rate must not exceed 1", {"field": "advance_rate"})
    discount_rate(inputs.discount_annual_rate, "discount_annual_rate")  # type: ignore[arg-type]
    non_negative_days(inputs.due_in_days, "due_in_days")  # type: ignore[arg-type]
    strictly_positive(inputs.invoice_amount, "invoice_amount")  # type: ignore[arg-type]

    currency = inputs.currency.upper()
    basis = Decimal(day_count_basis(inputs.day_count))
    advance = inputs.invoice_amount * inputs.advance_rate  # type: ignore[operator]
    reserve = inputs.invoice_amount * inputs.reserve_rate  # type: ignore[operator]
    discount = advance * inputs.discount_annual_rate * Decimal(inputs.due_in_days) / basis  # type: ignore[operator, arg-type]
    net_proceeds = advance - discount - inputs.service_fees
    warnings: list[StructuredWarning] = []
    if net_proceeds < 0:
        raise WorkbenchInputError("input.negative_net_proceeds", "fees and discount exceed the advance — negative net proceeds are not representable", {"field": "service_fees"})
    outputs = {
        "structural_eligibility": "eligible",
        "pricing_status": "complete",
        "eligibility_reasons": [],
        "missing_pricing_fields": [],
        "currency": currency,
        "advance_amount": serialize_decimal(quantize_money(advance, currency)),
        "reserve": serialize_decimal(quantize_money(reserve, currency)),
        "reserve_release_at_settlement": serialize_decimal(quantize_money(reserve, currency)),
        "discount_charge": serialize_decimal(quantize_money(discount, currency)),
        "service_fees": serialize_decimal(quantize_money(inputs.service_fees, currency)),
        "net_proceeds": serialize_decimal(quantize_money(net_proceeds, currency)),
        "expected_settlement_days": inputs.due_in_days,
    }
    validations = [ValidationFinding(check="net_proceeds_le_face", status="pass" if net_proceeds <= inputs.invoice_amount else "fail")]  # type: ignore[operator]
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=warnings, validations=validations, eligibility="eligible")


class DebtServiceInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    principal: DecimalStr
    annual_rate: DecimalStr
    periods: int
    period_days: int
    day_count: Literal["ACT/360", "ACT/365"] = "ACT/360"
    profile: Literal["equal_principal", "bullet"] = "equal_principal"
    mandatory_fees_per_period: DecimalStr = Decimal(0)
    cash_available_per_period: DecimalStr | None = None


class DebtServiceOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    profile: str
    schedule: list[dict[str, str | int]]
    total_debt_service: str
    min_dscr: str | None = None
    dscr_definition: str | None = None


def compute_debt_service(inputs: DebtServiceInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    strictly_positive(inputs.principal, "principal")
    discount_rate(inputs.annual_rate, "annual_rate")
    positive_int(inputs.periods, "periods")
    positive_int(inputs.period_days, "period_days")
    non_negative_money(inputs.mandatory_fees_per_period, "mandatory_fees_per_period")
    basis = Decimal(day_count_basis(inputs.day_count))
    balance = inputs.principal
    schedule = []
    total = Decimal(0)
    min_dscr: Decimal | None = None
    for period in range(1, inputs.periods + 1):
        interest = balance * inputs.annual_rate * Decimal(inputs.period_days) / basis
        if inputs.profile == "equal_principal":
            principal_paid = inputs.principal / Decimal(inputs.periods)
        else:  # bullet: principal repaid only in the final period
            principal_paid = inputs.principal if period == inputs.periods else Decimal(0)
        service = principal_paid + interest + inputs.mandatory_fees_per_period
        total += service
        entry: dict[str, str | int] = {
            "period": period,
            "principal": serialize_decimal(quantize_money(principal_paid, currency)),
            "interest": serialize_decimal(quantize_money(interest, currency)),
            "debt_service": serialize_decimal(quantize_money(service, currency)),
        }
        if inputs.cash_available_per_period is not None and service > 0:
            dscr = inputs.cash_available_per_period / service
            entry["dscr"] = serialize_decimal(quantize_rate(dscr))
            min_dscr = dscr if min_dscr is None or dscr < min_dscr else min_dscr
        schedule.append(entry)
        balance -= principal_paid
    outputs = {
        "currency": currency,
        "profile": inputs.profile,
        "schedule": schedule,
        "total_debt_service": serialize_decimal(quantize_money(total, currency)),
        "min_dscr": serialize_decimal(quantize_rate(min_dscr)) if min_dscr is not None else None,
        "dscr_definition": "cash_available_per_period / (principal + interest + mandatory fees)" if min_dscr is not None else None,
    }
    return CalculatorOutcome(status="completed", outputs=outputs)


FINANCING_COST = CalculatorDefinition(
    calculator_id="capital.calculate_financing_cost",
    calculator_version="1.1.0",
    formula_version="financing-cost-v2",
    input_model=FinancingCostInput,
    output_model=FinancingCostOutput,
    compute=compute_financing_cost,  # type: ignore[arg-type]
    material_input_paths=("principal", "annual_rate", "tenor_days", "fees[*].amount"),
    scenario_overridable_paths=("principal", "annual_rate", "tenor_days", "fees"),
    comparable_output_keys=("net_proceeds", "total_financing_cost", "total_cash_repayment"),
    unordered_list_paths=("fees",),
    required_evidence_categories=("financing_terms",),
    data_classes=("finance_read",),
    sensitivity="restricted_financial",
)

RECEIVABLES_FINANCE = CalculatorDefinition(
    calculator_id="capital.calculate_receivables_finance",
    calculator_version="1.1.0",
    formula_version="receivables-proceeds-v2",
    input_model=ReceivablesFinanceInput,
    output_model=ReceivablesFinanceOutput,
    compute=compute_receivables_finance,  # type: ignore[arg-type]
    material_input_paths=("invoice_exists", "receivable_exists", "delivery_complete", "invoice_amount", "advance_rate", "discount_annual_rate"),
    may_default_paths=("service_fees", "reserve_rate"),
    scenario_overridable_paths=("invoice_amount", "due_in_days", "advance_rate", "discount_annual_rate", "service_fees", "reserve_rate"),
    comparable_output_keys=("net_proceeds", "advance_amount", "discount_charge"),
    required_evidence_categories=("invoice_documents", "delivery_evidence", "acceptance_evidence"),
    data_classes=("trade_context", "finance_read"),
    sensitivity="restricted_financial",
)

DEBT_SERVICE = CalculatorDefinition(
    calculator_id="capital.calculate_debt_service",
    calculator_version="1.1.0",
    formula_version="debt-service-v2",
    input_model=DebtServiceInput,
    output_model=DebtServiceOutput,
    compute=compute_debt_service,  # type: ignore[arg-type]
    material_input_paths=("principal", "annual_rate", "periods", "period_days", "cash_available_per_period"),
    may_default_paths=("mandatory_fees_per_period",),
    scenario_overridable_paths=("principal", "annual_rate", "periods", "period_days", "mandatory_fees_per_period", "cash_available_per_period"),
    comparable_output_keys=("total_debt_service", "min_dscr"),
    required_evidence_categories=("financing_terms", "cashflow_basis"),
    data_classes=("finance_read",),
    sensitivity="restricted_financial",
)
