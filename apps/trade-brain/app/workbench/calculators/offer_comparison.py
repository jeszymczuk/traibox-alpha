"""Offer normalization + eligibility-first comparison (v1.1, closure §9.9).

Eligibility is a strict enum; comparability is explicit per offer against a
product-specific required-field set; missing/incomparable terms stay visible.
This ranking is deterministic normalization — NOT a final recommendation
(Phase 4 combines it with the user objective and evidence).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ..decimal_policy import quantize_money, quantize_rate, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import StructuredWarning
from ..types import DecimalStr, StrictInput

# §9.9: required comparison fields per financing product.
REQUIRED_FIELDS_BY_PRODUCT: dict[str, tuple[str, ...]] = {
    "receivables_finance": ("principal_available", "net_proceeds", "total_cost", "tenor_days", "effective_annual_cost", "recourse", "expected_days_to_funds"),
    "term_loan": ("principal_available", "net_proceeds", "total_cost", "tenor_days", "effective_annual_cost", "expected_days_to_funds"),
    "credit_line": ("principal_available", "effective_annual_cost", "expected_days_to_funds"),
    "generic": ("principal_available", "net_proceeds", "total_cost", "tenor_days", "effective_annual_cost", "expected_days_to_funds"),
}


class FinancingOffer(StrictInput):
    offer_id: str = Field(min_length=1)
    provider_label: str = Field(min_length=1)
    product: Literal["receivables_finance", "term_loan", "credit_line", "generic"] = "generic"
    currency: str = Field(min_length=3, max_length=3)
    principal_available: DecimalStr | None = None
    net_proceeds: DecimalStr | None = None
    total_cost: DecimalStr | None = None
    tenor_days: int | None = None
    effective_annual_cost: DecimalStr | None = None
    recourse: bool | None = None
    collateral: str | None = None
    conditions: list[str] = Field(default_factory=list)
    expected_days_to_funds: int | None = None
    expiry: str | None = None
    eligibility: Literal["eligible", "ineligible", "insufficient_information"] = "insufficient_information"
    ineligibility_reasons: list[str] = Field(default_factory=list)


class OfferComparisonInput(StrictInput):
    reporting_currency: str = Field(min_length=3, max_length=3)
    offers: list[FinancingOffer] = Field(min_length=1)


class OfferComparisonOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    offers: list[dict]
    ranking_basis: str


def compute_offer_comparison(inputs: OfferComparisonInput) -> CalculatorOutcome:
    currency = inputs.reporting_currency.upper()
    normalized = []
    warnings: list[StructuredWarning] = []
    for index, offer in enumerate(inputs.offers):
        required = REQUIRED_FIELDS_BY_PRODUCT[offer.product]
        unresolved = [f for f in required if getattr(offer, f) is None]
        if offer.currency.upper() != currency:
            unresolved.append("currency_conversion")
            warnings.append(
                StructuredWarning(code="offer.currency_mismatch", message=f"offer {offer.offer_id} is in {offer.currency}; explicit conversion required for comparison", severity="warning", related_input_paths=[f"offers[{index}].currency"])
            )
        comparable = offer.eligibility == "eligible" and not unresolved
        normalized.append(
            {
                "offer_id": offer.offer_id,
                "provider_label": offer.provider_label,
                "product": offer.product,
                "eligibility": offer.eligibility,
                "ineligibility_reasons": offer.ineligibility_reasons,
                "comparability": "comparable" if comparable else "incomparable",
                "unresolved_fields": unresolved,
                "net_proceeds": serialize_decimal(quantize_money(offer.net_proceeds, currency)) if offer.net_proceeds is not None else None,
                "total_cost": serialize_decimal(quantize_money(offer.total_cost, currency)) if offer.total_cost is not None else None,
                "effective_annual_cost": serialize_decimal(quantize_rate(offer.effective_annual_cost)) if offer.effective_annual_cost is not None else None,
                "tenor_days": offer.tenor_days,
                "expected_days_to_funds": offer.expected_days_to_funds,
                "conditions": offer.conditions,
            }
        )
    tier = {"eligible": 0, "insufficient_information": 1, "ineligible": 2}

    def sort_key(entry: dict) -> tuple:
        cost = entry["effective_annual_cost"]
        return (
            tier[entry["eligibility"]],
            0 if entry["comparability"] == "comparable" else 1,
            Decimal(cost) if cost is not None else Decimal("Infinity"),
            entry["offer_id"],
        )

    ranked = sorted(normalized, key=sort_key)
    outputs = {"currency": currency, "offers": ranked, "ranking_basis": "eligibility first, then comparable effective annual cost; deterministic normalization, not a recommendation"}
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=warnings)


OFFER_COMPARISON = CalculatorDefinition(
    calculator_id="capital.compare_financing_options",
    calculator_version="1.1.0",
    formula_version="option-comparison-v2",
    input_model=OfferComparisonInput,
    output_model=OfferComparisonOutput,
    compute=compute_offer_comparison,  # type: ignore[arg-type]
    material_input_paths=("offers[*].eligibility",),
    scenario_overridable_paths=("offers",),
    comparable_output_keys=(),
    unordered_list_paths=("offers",),
    required_evidence_categories=("offer_documents",),
    data_classes=("finance_read",),
    sensitivity="restricted_financial",
)
