"""FX exposure/scenarios (v1.1: staleness policy + validation, §9.10),
deterministic milestone/condition evaluation, and company-side exposure."""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..decimal_policy import quantize_money, serialize_decimal
from ..errors import WorkbenchInputError
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import StructuredWarning
from ..types import DecimalStr, FxRate, StrictInput
from ..validators import non_negative_money, positive_fx_rate


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
    # §9.10: an explicit staleness policy is REQUIRED.
    allow_stale_reference: bool = False


class FxExposureOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    functional_currency: str
    foreign_currency: str
    foreign_amount: str
    reference_rate: str
    reference_rate_as_of: str
    base_settlement_value: str
    hedged_amount: str
    residual_exposure: str
    hedge_exceeds_exposure: bool
    scenarios: list[dict[str, str]]


def compute_fx_exposure(inputs: FxExposureInput) -> CalculatorOutcome:
    functional = inputs.functional_currency.upper()
    foreign = inputs.foreign_currency.upper()
    ref = inputs.reference_rate
    positive_fx_rate(ref.rate, "reference_rate.rate")
    non_negative_money(inputs.hedged_amount, "hedged_amount")
    for index, scenario in enumerate(inputs.scenarios):
        positive_fx_rate(scenario.rate, f"scenarios[{index}].rate")
    if ref.base_currency.upper() != foreign or ref.quote_currency.upper() != functional:
        return CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=["reference_rate_for_pair"])
    if ref.staleness in ("stale", "unknown") and not inputs.allow_stale_reference:
        raise WorkbenchInputError("fx.stale_reference", f"reference rate staleness is '{ref.staleness}' and the policy prohibits stale references", {"field": "reference_rate"})
    warnings: list[StructuredWarning] = []
    if ref.staleness in ("recent", "stale", "unknown"):
        warnings.append(StructuredWarning(code="fx.reference_not_current", message=f"reference rate staleness is '{ref.staleness}' (as_of {ref.as_of})", severity="warning" if ref.staleness == "recent" else "critical", related_input_paths=["reference_rate.as_of"]))
    base_value = inputs.foreign_amount * ref.rate
    residual = inputs.foreign_amount - inputs.hedged_amount
    hedge_exceeds = residual < 0
    if hedge_exceeds:
        # §9.10: explicit handling — over-hedge is surfaced, residual floors at
        # the (negative) over-hedged position rather than being hidden.
        warnings.append(StructuredWarning(code="fx.hedge_exceeds_exposure", message="hedged amount exceeds the foreign exposure — the negative residual is an over-hedged position", severity="critical", related_input_paths=["hedged_amount"]))
    scenarios = []
    for scenario in inputs.scenarios:
        value = inputs.foreign_amount * scenario.rate
        residual_impact = residual * (scenario.rate - ref.rate)
        scenarios.append(
            {
                "name": scenario.name,
                "rate": serialize_decimal(scenario.rate),
                "settlement_value": serialize_decimal(quantize_money(value, functional)),
                "gain_loss_vs_reference": serialize_decimal(quantize_money(value - base_value, functional)),
                "residual_exposure_impact": serialize_decimal(quantize_money(residual_impact, functional)),
            }
        )
    outputs = {
        "functional_currency": functional,
        "foreign_currency": foreign,
        "foreign_amount": serialize_decimal(inputs.foreign_amount),
        "reference_rate": serialize_decimal(ref.rate),
        "reference_rate_as_of": ref.as_of,
        "base_settlement_value": serialize_decimal(quantize_money(base_value, functional)),
        "hedged_amount": serialize_decimal(inputs.hedged_amount),
        "residual_exposure": serialize_decimal(residual),
        "hedge_exceeds_exposure": hedge_exceeds,
        "scenarios": scenarios,
    }
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=warnings)


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


class MilestoneOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    conditions: list[dict[str, str]]
    note: str


def compute_milestones(inputs: MilestoneInput) -> CalculatorOutcome:
    results = []
    contradictions: list[str] = []
    for condition in inputs.conditions:
        if condition.contradicted:
            status = "contradictory_evidence"
            contradictions.append(condition.condition_id)
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
    return CalculatorOutcome(status="completed", outputs=outputs, contradictions=contradictions)


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


class CompanyExposureOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    group_by: str
    exposure_by_group: dict[str, str]
    total_exposure: str
    concentration: dict[str, str | None]
    note: str


def compute_company_exposure(inputs: CompanyExposureInput) -> CalculatorOutcome:
    currency = inputs.reporting_currency.upper()
    mixed = [item.key for item in inputs.items if item.currency.upper() != currency]
    if mixed:
        return CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=[f"fx_conversion_for:{k}" for k in mixed])
    groups: dict[str, Decimal] = {}
    total = Decimal(0)
    for item in inputs.items:
        group = getattr(item, inputs.group_by) or "(unspecified)"
        groups[group] = groups.get(group, Decimal(0)) + item.amount
        total += item.amount
    concentration = {name: serialize_decimal((value / total).quantize(Decimal("0.0001"))) if total > 0 else None for name, value in sorted(groups.items())}
    outputs = {
        "currency": currency,
        "group_by": inputs.group_by,
        "exposure_by_group": {name: serialize_decimal(quantize_money(value, currency)) for name, value in sorted(groups.items())},
        "total_exposure": serialize_decimal(quantize_money(total, currency)),
        "concentration": concentration,
        "note": "company-side exposure only; financier portfolio allocation is out of scope",
    }
    return CalculatorOutcome(status="completed", outputs=outputs)


FX_EXPOSURE = CalculatorDefinition(
    calculator_id="capital.calculate_fx_scenarios",
    calculator_version="1.1.0",
    formula_version="fx-scenarios-v2",
    input_model=FxExposureInput,
    output_model=FxExposureOutput,
    compute=compute_fx_exposure,  # type: ignore[arg-type]
    material_input_paths=("foreign_amount", "reference_rate.rate", "hedged_amount"),
    may_default_paths=("hedged_amount",),
    scenario_overridable_paths=("foreign_amount", "scenarios", "hedged_amount"),
    comparable_output_keys=("base_settlement_value", "residual_exposure"),
    unordered_list_paths=("scenarios",),
    required_evidence_categories=("fx_rate_source",),
    data_classes=("finance_read",),
    sensitivity="confidential",
)

MILESTONES = CalculatorDefinition(
    calculator_id="capital.evaluate_conditions",
    calculator_version="1.0.0",
    formula_version="condition-eval-v1",
    input_model=MilestoneInput,
    output_model=MilestoneOutput,
    compute=compute_milestones,  # type: ignore[arg-type]
    material_input_paths=("conditions[*].observed", "conditions[*].actual"),
    scenario_overridable_paths=(),
    comparable_output_keys=(),
    unordered_list_paths=("conditions",),
    required_evidence_categories=("condition_evidence",),
    data_classes=("trade_context", "finance_read"),
    sensitivity="confidential",
)

COMPANY_EXPOSURE = CalculatorDefinition(
    calculator_id="capital.calculate_company_exposure",
    calculator_version="1.0.0",
    formula_version="company-exposure-v1",
    input_model=CompanyExposureInput,
    output_model=CompanyExposureOutput,
    compute=compute_company_exposure,  # type: ignore[arg-type]
    material_input_paths=("items[*].amount",),
    scenario_overridable_paths=("items",),
    comparable_output_keys=("total_exposure",),
    unordered_list_paths=("items",),
    required_evidence_categories=("receivables_book",),
    data_classes=("trade_context", "finance_read", "org_finance_profile"),
    sensitivity="restricted_financial",
)
