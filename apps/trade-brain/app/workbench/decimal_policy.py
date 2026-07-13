"""Numeric and monetary policy (directive B2).

ALL financial values use decimal arithmetic. Binary floats are rejected at the
boundary — a float input is an error, never silently accepted. Serialized
decimals are normalized strings. Percentages are decimal fractions (0.05 =
5%); rates are annual decimal fractions unless a calculator states otherwise;
day counts default to ACT/360 unless the input specifies ACT/365.
"""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from typing import Any

from .errors import WorkbenchInputError

# Intermediate precision; money is quantized to the currency's minor units at
# the result boundary, rates/ratios to 10 places.
INTERMEDIATE_PRECISION = 28
MONEY_EXPONENT = Decimal("0.01")  # default 2 minor units
RATE_EXPONENT = Decimal("0.0000000001")
ROUNDING = ROUND_HALF_EVEN  # banker's rounding

CURRENCY_MINOR_UNITS: dict[str, int] = {"JPY": 0, "KWD": 3, "BHD": 3, "TND": 3}

DAY_COUNT_BASES: dict[str, int] = {"ACT/360": 360, "ACT/365": 365}


def D(value: Any, *, field: str = "value") -> Decimal:
    """Strict decimal constructor: str | int | Decimal. Floats are rejected."""
    if isinstance(value, bool) or isinstance(value, float):
        raise WorkbenchInputError("input.float_rejected", f"field '{field}' must be a decimal string, not a binary float", {"field": field})
    if isinstance(value, Decimal):
        return value
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, str):
        try:
            return Decimal(value.strip())
        except InvalidOperation:
            raise WorkbenchInputError("input.not_decimal", f"field '{field}' is not a valid decimal string", {"field": field, "value": value})
    raise WorkbenchInputError("input.not_decimal", f"field '{field}' has unsupported numeric type {type(value).__name__}", {"field": field})


def money_exponent(currency: str) -> Decimal:
    units = CURRENCY_MINOR_UNITS.get(currency.upper(), 2)
    return Decimal(1).scaleb(-units)


def quantize_money(value: Decimal, currency: str) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = INTERMEDIATE_PRECISION
        return value.quantize(money_exponent(currency), rounding=ROUNDING)


def quantize_rate(value: Decimal) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = INTERMEDIATE_PRECISION
        return value.quantize(RATE_EXPONENT, rounding=ROUNDING)


def serialize_decimal(value: Decimal) -> str:
    """Normalized string: no exponent notation, no trailing-zero ambiguity beyond quantization."""
    return format(value, "f")


def day_count_basis(convention: str) -> int:
    basis = DAY_COUNT_BASES.get(convention)
    if basis is None:
        raise WorkbenchInputError("input.day_count_unknown", f"unknown day-count convention '{convention}'", {"convention": convention})
    return basis
