"""Currency and FX rules (directive B5). No implicit conversion — ever."""

from __future__ import annotations

from decimal import Decimal

from .errors import WorkbenchInputError
from .types import FxRate


def convert(amount: Decimal, from_currency: str, to_currency: str, rates: list[FxRate], *, allow_stale: bool = False) -> tuple[Decimal, FxRate]:
    """Convert with an EXPLICIT rate; returns (converted, rate used).
    Missing, inverted, or stale rates fail closed."""
    from_c, to_c = from_currency.upper(), to_currency.upper()
    if from_c == to_c:
        raise WorkbenchInputError("fx.same_currency", "conversion requested between identical currencies", {"currency": from_c})
    for rate in rates:
        if rate.base_currency.upper() == from_c and rate.quote_currency.upper() == to_c:
            if rate.staleness == "stale" and not allow_stale:
                raise WorkbenchInputError("fx.stale_rate", "FX rate is stale and the policy prohibits stale rates", {"pair": f"{from_c}/{to_c}", "as_of": rate.as_of})
            if rate.rate <= 0:
                raise WorkbenchInputError("fx.invalid_rate", "FX rate must be positive", {"pair": f"{from_c}/{to_c}"})
            return amount * rate.rate, rate
        if rate.base_currency.upper() == to_c and rate.quote_currency.upper() == from_c:
            raise WorkbenchInputError(
                "fx.inverted_rate",
                f"only the inverse rate {to_c}/{from_c} was supplied; explicit inversion is required",
                {"pair": f"{from_c}/{to_c}"},
            )
    raise WorkbenchInputError("fx.missing_rate", f"no FX rate supplied for {from_c}/{to_c}", {"pair": f"{from_c}/{to_c}"})
