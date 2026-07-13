"""Reusable financial-domain validators (Phase 3 closure §8).

Invalid values are REJECTED (invalid_input via WorkbenchInputError, which
pydantic converts to a ValidationError at the model boundary) — they are never
softened into insufficient_information. Fields where negative values are
legitimate (cash-flow events, gains/losses, deltas, net positions) simply do
not use these validators; that is the documented convention.
"""

from __future__ import annotations

from decimal import Decimal

from .errors import WorkbenchInputError


def non_negative_money(value: Decimal, field: str) -> Decimal:
    if value < 0:
        raise WorkbenchInputError("input.negative_amount", f"'{field}' must not be negative", {"field": field})
    return value


def strictly_positive(value: Decimal, field: str) -> Decimal:
    if value <= 0:
        raise WorkbenchInputError("input.not_positive", f"'{field}' must be strictly positive", {"field": field})
    return value


def unit_fraction(value: Decimal, field: str) -> Decimal:
    """Rates expressed as fractions of one: advance/reserve/ownership/pool."""
    if not (Decimal(0) <= value <= Decimal(1)):
        raise WorkbenchInputError("input.fraction_out_of_range", f"'{field}' must be within [0, 1]", {"field": field})
    return value


def discount_rate(value: Decimal, field: str) -> Decimal:
    """Discount rates must exceed -1 (–100%); no other universal cap applies."""
    if value <= Decimal(-1):
        raise WorkbenchInputError("input.rate_out_of_range", f"'{field}' must be greater than -1", {"field": field})
    return value


def positive_fx_rate(value: Decimal, field: str) -> Decimal:
    if value <= 0:
        raise WorkbenchInputError("input.fx_rate_not_positive", f"'{field}' must be a positive FX rate", {"field": field})
    return value


def non_negative_days(value: int, field: str) -> int:
    if value < 0:
        raise WorkbenchInputError("input.negative_days", f"'{field}' must not be negative", {"field": field})
    return value


def positive_int(value: int, field: str) -> int:
    if value <= 0:
        raise WorkbenchInputError("input.not_positive", f"'{field}' must be strictly positive", {"field": field})
    return value


def positive_multiplier(value: Decimal, field: str) -> Decimal:
    if value <= 0:
        raise WorkbenchInputError("input.multiplier_not_positive", f"'{field}' must be greater than zero", {"field": field})
    return value
