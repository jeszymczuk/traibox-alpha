"""Offer normalization + eligibility-first option comparison (directive B6).

Comparison never conceals incomparable or missing terms, and an ineligible
option can never outrank an eligible one.
"""

from __future__ import annotations

from decimal import Decimal

from pydantic import Field

from ..decimal_policy import quantize_money, quantize_rate, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..types import DecimalStr, StrictInput


class FinancingOffer(StrictInput):
    offer_id: str = Field(min_length=1)
    provider_label: str = Field(min_length=1)
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
    eligibility: str = "insufficient_information"  # eligible | ineligible | insufficient_information
    ineligibility_reasons: list[str] = Field(default_factory=list)


class OfferComparisonInput(StrictInput):
    reporting_currency: str = Field(min_length=3, max_length=3)
    offers: list[FinancingOffer] = Field(min_length=1)


_NORMALIZED_FIELDS = ("principal_available", "net_proceeds", "total_cost", "tenor_days", "effective_annual_cost", "recourse", "expected_days_to_funds")


def compute_offer_comparison(inputs: OfferComparisonInput) -> CalculatorOutcome:
    currency = inputs.reporting_currency.upper()
    normalized = []
    warnings: list[str] = []
    for offer in inputs.offers:
        unresolved = [f for f in _NORMALIZED_FIELDS if getattr(offer, f) is None]
        comparable = offer.eligibility == "eligible" and not unresolved and offer.currency.upper() == currency
        if offer.currency.upper() != currency:
            unresolved.append("currency_conversion")
            warnings.append(f"offer {offer.offer_id} is in {offer.currency}; explicit conversion required for comparison")
        normalized.append(
            {
                "offer_id": offer.offer_id,
                "provider_label": offer.provider_label,
                "eligibility": offer.eligibility,
                "ineligibility_reasons": offer.ineligibility_reasons,
                "comparability": "comparable" if comparable else "incomparable",
                "unresolved_fields": unresolved,
                "net_proceeds": serialize_decimal(quantize_money(offer.net_proceeds, currency)) if offer.net_proceeds is not None else None,
                "total_cost": serialize_decimal(quantize_money(offer.total_cost, currency)) if offer.total_cost is not None else None,
                "effective_annual_cost": serialize_decimal(quantize_rate(offer.effective_annual_cost)) if offer.effective_annual_cost is not None else None,
                "tenor_days": offer.tenor_days,
                "expected_days_to_funds": offer.expected_days_to_funds,
            }
        )
    # Eligibility-first ranking: eligible+comparable first (by effective cost),
    # then eligible-incomparable, then insufficient_information, then ineligible.
    tier = {"eligible": 0, "insufficient_information": 1, "ineligible": 2}

    def sort_key(entry: dict) -> tuple:
        cost = entry["effective_annual_cost"]
        return (
            tier.get(entry["eligibility"], 3),
            0 if entry["comparability"] == "comparable" else 1,
            Decimal(cost) if cost is not None else Decimal("Infinity"),
            entry["offer_id"],
        )

    ranked = sorted(normalized, key=sort_key)
    outputs = {"currency": currency, "offers": ranked, "ranking_basis": "eligibility first, then comparable effective annual cost"}
    return CalculatorOutcome(outputs=outputs, warnings=warnings, validations=[], assumptions_used=[], missing_fields=[])


OFFER_COMPARISON = CalculatorDefinition("capital.compare_financing_options", "1.0.0", "option-comparison-v1", OfferComparisonInput, compute_offer_comparison)  # type: ignore[arg-type]
