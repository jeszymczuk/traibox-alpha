"""Runtime authority model (spec §5.1, decision CA-102).

The ONLY representable runtime authority levels are the seven below. Execution
powers are structurally absent: they cannot be granted, requested, registered
on a tool, or expanded by a model response, prompt, document, or specialist
read — there is simply no value to express them with.
"""

from __future__ import annotations

from .errors import AuthorityViolation

AUTHORITY_LEVELS: tuple[str, ...] = (
    "observe",
    "calculate",
    "analyse",
    "recommend",
    "draft",
    "monitor",
    "propose_protected_action",
)

# Never representable at runtime; kept only to reject them explicitly.
FORBIDDEN_AUTHORITIES: tuple[str, ...] = (
    "approve",
    "bind",
    "commit",
    "execute",
    "pay",
    "execute_payment",
    "release_funds",
    "sign",
    "accept_offer",
    "lend",
    "custody",
    "clear",
    "underwrite_of_record",
)


def validate_level(level: str) -> str:
    """A level outside the closed set fails closed — including every forbidden power."""
    if level not in AUTHORITY_LEVELS:
        raise AuthorityViolation(
            "authority.unrepresentable",
            f"authority level '{level}' is not representable at runtime",
            {"requested": level, "representable": list(AUTHORITY_LEVELS)},
        )
    return level


def authority_rank(level: str) -> int:
    return AUTHORITY_LEVELS.index(validate_level(level))


def validate_within_ceiling(requested: str, ceiling: str) -> str:
    """Requested authority must not exceed the mandate ceiling."""
    if authority_rank(requested) > authority_rank(ceiling):
        raise AuthorityViolation(
            "authority.exceeds_ceiling",
            f"requested authority '{requested}' exceeds mandate ceiling '{ceiling}'",
            {"requested": requested, "ceiling": ceiling},
        )
    return requested
