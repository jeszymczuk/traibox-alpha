"""Versioned specialist-agent definitions and their registry (spec §17.1).

Definitions are version-controlled code/config (decision in Phase 0 §16 of the
direction lock); the registry resolves EXACT versions. The framework supports
the canonical seven-class taxonomy without implementing all seven agents.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .authority import AUTHORITY_LEVELS
from .errors import ContractViolation

SPECIALIST_AGENT_CLASSES: tuple[str, ...] = (
    "capital_agent",
    "compliance_agent",
    "risk_agent",
    "market_network_agent",
    "trade_operations_agent",
    "audit_monitoring_agent",
    "concierge_coordinator",
)

PRINCIPAL_TYPES: tuple[str, ...] = ("company", "financier", "platform_internal")


@dataclass(frozen=True)
class BudgetPolicy:
    timeout_seconds: int = 60
    max_model_steps: int = 4
    max_tool_calls: int = 16
    max_output_tokens: int = 4096
    max_cost_usd: float = 1.0


@dataclass(frozen=True)
class AgentDefinition:
    agent_id: str
    agent_class: str
    version: str
    supported_principal_types: tuple[str, ...]
    supported_outcome_types: tuple[str, ...]
    allowed_authority_levels: tuple[str, ...]
    eligible_tool_classes: tuple[str, ...]
    eligible_specialist_reads: tuple[str, ...] = ()
    data_classes: tuple[str, ...] = ()
    model_policy_id: str = "default"
    evidence_policy_id: str = "default"
    budgets: BudgetPolicy = field(default_factory=BudgetPolicy)
    status: str = "active"  # draft | active | deprecated
    provenance: str = "traibox"

    def __post_init__(self) -> None:
        if self.agent_class not in SPECIALIST_AGENT_CLASSES:
            raise ContractViolation(
                "definition.unknown_agent_class",
                f"agent class '{self.agent_class}' is not in the canonical taxonomy",
                {"agent_class": self.agent_class},
            )
        for level in self.allowed_authority_levels:
            if level not in AUTHORITY_LEVELS:
                raise ContractViolation(
                    "definition.unrepresentable_authority",
                    f"definition grants unrepresentable authority '{level}'",
                    {"agent_id": self.agent_id, "level": level},
                )
        for principal_type in self.supported_principal_types:
            if principal_type not in PRINCIPAL_TYPES:
                raise ContractViolation(
                    "definition.unknown_principal_type",
                    f"unknown principal type '{principal_type}'",
                    {"agent_id": self.agent_id},
                )


class AgentDefinitionRegistry:
    """Exact-version resolution; no fuzzy fallbacks."""

    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], AgentDefinition] = {}

    def register(self, definition: AgentDefinition) -> None:
        key = (definition.agent_id, definition.version)
        if key in self._definitions:
            raise ContractViolation(
                "definition.duplicate_version",
                f"definition {definition.agent_id}@{definition.version} already registered",
                {"agent_id": definition.agent_id, "version": definition.version},
            )
        self._definitions[key] = definition

    def get(self, agent_id: str, version: str) -> AgentDefinition:
        definition = self._definitions.get((agent_id, version))
        if definition is None:
            raise ContractViolation(
                "definition.not_found",
                f"no definition {agent_id}@{version}",
                {"agent_id": agent_id, "version": version},
            )
        return definition

    def get_active(self, agent_id: str) -> AgentDefinition:
        candidates = [d for (aid, _), d in self._definitions.items() if aid == agent_id and d.status == "active"]
        if not candidates:
            raise ContractViolation("definition.no_active_version", f"no active definition for {agent_id}", {"agent_id": agent_id})
        # Deterministic: highest version string wins (semver-ish lexicographic on parts).
        return sorted(candidates, key=lambda d: tuple(int(p) if p.isdigit() else 0 for p in d.version.split(".")))[-1]
