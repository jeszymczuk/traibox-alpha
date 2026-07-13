"""Shared strict input types for calculators.

Money/rates enter as decimal STRINGS (floats rejected — B2) and are converted
once at the validation boundary into Decimal.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from .decimal_policy import D


def _to_decimal(value: object) -> Decimal:
    return D(value)


DecimalStr = Annotated[Decimal, BeforeValidator(_to_decimal)]


class StrictInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, arbitrary_types_allowed=True)


class FxRate(StrictInput):
    """Explicit FX rate (B5): direction, source, and freshness are mandatory."""

    base_currency: str = Field(min_length=3, max_length=3)
    quote_currency: str = Field(min_length=3, max_length=3)
    rate: DecimalStr
    direction: Literal["base_to_quote"] = "base_to_quote"
    source: str = Field(min_length=1)
    as_of: str = Field(min_length=1)
    staleness: Literal["current", "recent", "stale", "unknown"] = "current"


class DatedAmount(StrictInput):
    on: date
    amount: DecimalStr
    currency: str = Field(min_length=3, max_length=3)
    label: str = ""


class CostComponent(StrictInput):
    category: str = Field(min_length=1)
    amount: DecimalStr
    currency: str = Field(min_length=3, max_length=3)
    recoverable: bool = False
    provenance: Literal["verified_fact", "user_provided", "assumption", "estimate", "derived"] = "user_provided"
