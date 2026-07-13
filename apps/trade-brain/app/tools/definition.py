"""Typed tool definitions (directive B5).

Effect classes cover ONLY non-executing capabilities. There is no 'execute'
effect class, no canonical Finance write tool, and no provider execution tool —
these are structurally unrepresentable, not merely policy-denied.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from ..agents.framework.authority import AUTHORITY_LEVELS
from ..agents.framework.errors import ToolViolation

EFFECT_CLASSES: tuple[str, ...] = ("read", "calculate", "analyse", "draft", "monitor", "propose")

# Domains whose canonical state must never be writable from agent tools
# (directive A6 denylist; read-only access remains permitted via read tools).
CANONICAL_WRITE_DOMAINS_FORBIDDEN: tuple[str, ...] = (
    "finance",
    "payments",
    "escrow",
    "provider_execution",
    "offer_acceptance",
    "fund_release",
)


@dataclass(frozen=True)
class ToolDefinition:
    tool_id: str
    version: str
    tool_class: str
    owning_domain: str
    effect_class: str
    required_authority: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    data_classes: tuple[str, ...] = ()
    sensitivity: str = "internal"
    timeout_seconds: int = 30
    idempotent: bool = True
    audit_event: str = ""
    evidence_required: bool = False

    def __post_init__(self) -> None:
        if self.effect_class not in EFFECT_CLASSES:
            raise ToolViolation(
                "tool.effect_unrepresentable",
                f"effect class '{self.effect_class}' is not representable (no execution tools exist)",
                {"tool_id": self.tool_id, "effect_class": self.effect_class},
            )
        if self.required_authority not in AUTHORITY_LEVELS:
            raise ToolViolation(
                "tool.authority_unrepresentable",
                f"tool requires unrepresentable authority '{self.required_authority}'",
                {"tool_id": self.tool_id},
            )
        if self.owning_domain in CANONICAL_WRITE_DOMAINS_FORBIDDEN and self.effect_class != "read":
            raise ToolViolation(
                "tool.canonical_domain_write_forbidden",
                f"domain '{self.owning_domain}' permits read-only tools; canonical mutations go through "
                "protected-action proposals and domain command handlers",
                {"tool_id": self.tool_id, "owning_domain": self.owning_domain, "effect_class": self.effect_class},
            )
