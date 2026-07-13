"""FX exposure/scenarios, milestone/condition evaluation, company-side
exposure, and scenario/sensitivity analysis (directive B6)."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import Field

from ..decimal_policy import quantize_money, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..types import DecimalStr, FxRate, StrictInput


class FxScenario(StrictInput):
    name: str = Field(min_length=1)
    rate: DecimalStr


class FxExposureInput(StrictInput):
    foreign_amount: DecimalStr
    foreign_currency: str = Field(min_length=3, max_length=3)
    functional_currency: str = Field(min_length=3, max_length=3)
    reference_rate: FxRate
    scenarios: list[FxScenario] = Field(default_factory=list)
    hedged_amount: DecimalStr = Decimal(0)


def compute_fx_exposure(inputs: FxExposureInput) -> CalculatorOutcome:
    functional = inputs.functional_currency.upper()
    ref = inputs.reference_rate
    if ref.base_currency.upper() != inputs.foreign_currency.upper() or ref.quote_currency.upper() != functional:
        return CalculatorOutcome(outputs={}, warnings=[], validations=[], assumptions_used=[], missing_fields=["reference_rate_for_pair"])
    warnings = []
    if ref.staleness in ("stale", "unknown"):
        warnings.append(f"reference rate staleness is '{ref.staleness}' (as_of {ref.as_of})")
    base_value = inputs.foreign_amount * ref.rate
    residual = inputs.foreign_amount - inputs.hedged_amount
    scenarios = []
    for scenario in inputs.scenarios:
        value = inputs.foreign_amount * scenario.rate
        residual_impact = residual * (scenario.rate - ref.rate)
        scenarios.append(
            {
                "name": scenario.name,
                "settlement_value": serialize_decimal(quantize_money(value, functional)),
                "gain_loss_vs_reference": serialize_decimal(quantize_money(value - base_value, functional)),
                "residual_exposure_impact": serialize_decimal(quantize_money(residual_impact, functional)),
            }
        )
    outputs = {
        "functional_currency": functional,
        "base_settlement_value": serialize_decimal(quantize_money(base_value, functional)),
        "hedged_amount": serialize_decimal(inputs.hedged_amount),
        "residual_exposure": serialize_decimal(residual),
        "scenarios": scenarios,
    }
    return CalculatorOutcome(outputs=outputs, warnings=warnings, validations=[], assumptions_used=[], missing_fields=[])


class ConditionFact(StrictInput):
    condition_id: str = Field(min_length=1)
    kind: Literal["invoice_issued", "delivery_evidence", "acceptance_present", "payment_due", "covenant_threshold", "liquidity_threshold", "financing_condition"]
    observed: bool | None = None
    threshold: DecimalStr | None = None
    actual: DecimalStr | None = None
    direction: Literal["gte", "lte"] = "gte"
    contradicted: bool = False


class MilestoneInput(StrictInput):
    conditions: list[ConditionFact] = Field(min_length=1)


def compute_milestones(inputs: MilestoneInput) -> CalculatorOutcome:
    results = []
    for condition in inputs.conditions:
        if condition.contradicted:
            status = "contradictory_evidence"
        elif condition.threshold is not None:
            if condition.actual is None:
                status = "insufficient_information"
            else:
                ok = condition.actual >= condition.threshold if condition.direction == "gte" else condition.actual <= condition.threshold
                status = "satisfied" if ok else "not_satisfied"
        elif condition.observed is None:
            status = "insufficient_information"
        else:
            status = "satisfied" if condition.observed else "not_satisfied"
        results.append({"condition_id": condition.condition_id, "kind": condition.kind, "status": status})
    outputs = {"conditions": results, "note": "deterministic evaluation only; canonical workflow transitions remain in the Finance domain"}
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])


class ExposureItem(StrictInput):
    key: str = Field(min_length=1)
    counterparty: str = Field(min_length=1)
    corridor: str = ""
    currency: str = Field(min_length=3, max_length=3)
    amount: DecimalStr
    due_date: str = ""
    payment_status: str = "open"


class CompanyExposureInput(StrictInput):
    reporting_currency: str = Field(min_length=3, max_length=3)
    items: list[ExposureItem] = Field(min_length=1)
    group_by: Literal["counterparty", "corridor", "currency", "due_date", "payment_status"] = "counterparty"


def compute_company_exposure(inputs: CompanyExposureInput) -> CalculatorOutcome:
    currency = inputs.reporting_currency.upper()
    mixed = [item.key for item in inputs.items if item.currency.upper() != currency]
    if mixed:
        return CalculatorOutcome(outputs={}, warnings=[], validations=[], assumptions_used=[], missing_fields=[f"fx_conversion_for:{k}" for k in mixed])
    groups: dict[str, Decimal] = {}
    total = Decimal(0)
    for item in inputs.items:
        group = getattr(item, inputs.group_by) or "(unspecified)"
        groups[group] = groups.get(group, Decimal(0)) + item.amount
        total += item.amount
    concentration = {
        name: serialize_decimal((value / total).quantize(Decimal("0.0001"))) if total > 0 else None for name, value in sorted(groups.items())
    }
    outputs = {
        "currency": currency,
        "group_by": inputs.group_by,
        "exposure_by_group": {name: serialize_decimal(quantize_money(value, currency)) for name, value in sorted(groups.items())},
        "total_exposure": serialize_decimal(quantize_money(total, currency)),
        "concentration": concentration,
        "note": "company-side exposure only; financier portfolio allocation is out of scope",
    }
    return CalculatorOutcome(outputs=outputs, warnings=[], validations=[], assumptions_used=[], missing_fields=[])


FX_EXPOSURE = CalculatorDefinition("capital.calculate_fx_scenarios", "1.0.0", "fx-scenarios-v1", FxExposureInput, compute_fx_exposure)  # type: ignore[arg-type]
MILESTONES = CalculatorDefinition("capital.evaluate_conditions", "1.0.0", "condition-eval-v1", MilestoneInput, compute_milestones)  # type: ignore[arg-type]
COMPANY_EXPOSURE = CalculatorDefinition("capital.calculate_company_exposure", "1.0.0", "company-exposure-v1", CompanyExposureInput, compute_company_exposure)  # type: ignore[arg-type]
