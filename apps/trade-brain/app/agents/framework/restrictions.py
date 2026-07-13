"""Sensitivity ordering and structured prohibitions (directive A5)."""

from __future__ import annotations

from dataclasses import dataclass, field

from .errors import MandateViolation

SENSITIVITY_ORDER: tuple[str, ...] = ("public", "internal", "confidential", "restricted_financial", "regulated_personal")


def sensitivity_rank(level: str) -> int:
    if level not in SENSITIVITY_ORDER:
        raise MandateViolation("sensitivity.unknown", f"unknown sensitivity '{level}'", {"level": level})
    return SENSITIVITY_ORDER.index(level)


def within_sensitivity_ceiling(level: str, ceiling: str) -> bool:
    return sensitivity_rank(level) <= sensitivity_rank(ceiling)


@dataclass(frozen=True)
class Prohibitions:
    """Parsed mandate prohibitions. Syntax: 'tool:<id>', 'tool_class:<class>',
    'command:<name>', 'effect:<class>', 'domain:<domain>', 'outcome:<type>'.
    A bare value is treated as an outcome type (backward compatibility)."""

    tool_ids: frozenset[str] = field(default_factory=frozenset)
    tool_classes: frozenset[str] = field(default_factory=frozenset)
    commands: frozenset[str] = field(default_factory=frozenset)
    effects: frozenset[str] = field(default_factory=frozenset)
    domains: frozenset[str] = field(default_factory=frozenset)
    outcomes: frozenset[str] = field(default_factory=frozenset)

    @classmethod
    def parse(cls, entries: tuple[str, ...] | list[str]) -> "Prohibitions":
        buckets: dict[str, set[str]] = {k: set() for k in ("tool", "tool_class", "command", "effect", "domain", "outcome")}
        for raw in entries:
            prefix, _, value = raw.partition(":")
            if value and prefix in buckets:
                buckets[prefix].add(value)
            else:
                buckets["outcome"].add(raw)
        return cls(
            tool_ids=frozenset(buckets["tool"]),
            tool_classes=frozenset(buckets["tool_class"]),
            commands=frozenset(buckets["command"]),
            effects=frozenset(buckets["effect"]),
            domains=frozenset(buckets["domain"]),
            outcomes=frozenset(buckets["outcome"]),
        )
