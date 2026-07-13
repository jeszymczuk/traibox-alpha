"""Governed outcome definitions (Phase 4 §D1).

An outcome definition is version-controlled configuration: exact type +
version, evidence requirements, required calculators (exact versions), an
input composer, a deterministic summariser, optional model synthesis, a
recommendation policy, and an artifact policy. A shared runner executes every
definition — outcomes are reusable definitions, not bespoke pipelines (§D6).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from ..agents.framework.errors import ContractViolation

# Persisted lifecycle vocabulary (V012 CHECK). The Python runner emits the
# EXECUTION subset; requested/gathering_context/calculating/draft_ready/
# under_review/finalised/superseded/blocked are persistence-side transitions
# owned by the TypeScript API.
OUTCOME_STATUSES = (
    "requested",
    "gathering_context",
    "needs_information",
    "specialist_reads_pending",
    "calculating",
    "draft_ready",
    "under_review",
    "finalised",
    "superseded",
    "blocked",
    "failed",
    "abstained",
)

EXECUTION_STATUSES = ("completed", "needs_information", "abstained", "failed")

# Execution status → persisted outcome status (completed means the draft
# outcome is ready for human review — never auto-finalised).
PERSISTED_STATUS_FOR_EXECUTION = {
    "completed": "draft_ready",
    "needs_information": "needs_information",
    "abstained": "abstained",
    "failed": "failed",
}


@dataclass(frozen=True)
class RequiredCalculation:
    """One calculator the outcome may run, with EXACT versions. The builder
    maps outcome inputs to calculator inputs + provenance; returning None
    means this calculation is not applicable to the current inputs."""

    key: str
    calculator_id: str
    calculator_version: str
    formula_version: str
    builder: Callable[[dict[str, Any]], dict[str, Any] | None]
    # material=True: an insufficient_information result forces the outcome to
    # needs_information. material=False: the gap is reported but not blocking.
    material: bool = True
    # §7 (provenance-binding closure): the required evidence category whose
    # status is determined by THIS calculation's material inputs. A category
    # is verified only when the consumed material inputs are verified-bound —
    # an unrelated canonical claim in the category can never satisfy it.
    evidence_category: str | None = None


@dataclass(frozen=True)
class RecommendationPolicy:
    allowed_types: tuple[str, ...]
    requires_authority: str = "recommend"
    # When False the outcome reports analysis only (no recommendation section).
    enabled: bool = True


@dataclass(frozen=True)
class ArtifactPolicy:
    artifact_type: str | None
    schema_version: str = "capital-artifact-v1"


@dataclass(frozen=True)
class OutcomeDefinition:
    outcome_type: str
    definition_version: str
    objective: str
    required_authority: str
    required_evidence_categories: tuple[str, ...]
    calculations: tuple[RequiredCalculation, ...]
    # Deterministic composer: (inputs, calc results by key) → outcome payload
    # sections (facts/analysis dictionaries whose numbers come ONLY from
    # calculator outputs or supplied inputs).
    composer: Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]
    recommendation: RecommendationPolicy
    artifact: ArtifactPolicy
    # Purpose label for optional model synthesis (interpretation + wording).
    synthesis_purpose: str | None = None
    data_classes: tuple[str, ...] = ("finance_read", "trade_context")
    sensitivity: str = "confidential"
    supported_principal_types: tuple[str, ...] = ("company",)
    status: str = "active"

    def __post_init__(self) -> None:
        if not self.outcome_type or not self.definition_version:
            raise ContractViolation("outcome.invalid_definition", "outcome_type and definition_version are required", {})
        keys = [calculation.key for calculation in self.calculations]
        if len(keys) != len(set(keys)):
            raise ContractViolation("outcome.duplicate_calculation_key", f"duplicate calculation keys in {self.outcome_type}", {"keys": keys})


class OutcomeDefinitionRegistry:
    """Exact (outcome_type, definition_version) resolution — no fallbacks."""

    def __init__(self) -> None:
        self._definitions: dict[tuple[str, str], OutcomeDefinition] = {}

    def register(self, definition: OutcomeDefinition) -> None:
        key = (definition.outcome_type, definition.definition_version)
        if key in self._definitions:
            raise ContractViolation("outcome.duplicate_definition", f"{key} already registered", {})
        self._definitions[key] = definition

    def get(self, outcome_type: str, definition_version: str) -> OutcomeDefinition:
        definition = self._definitions.get((outcome_type, definition_version))
        if definition is None:
            raise ContractViolation(
                "outcome.definition_not_found",
                f"no outcome definition {outcome_type}@{definition_version}",
                {"outcome_type": outcome_type, "definition_version": definition_version},
            )
        return definition

    def all_keys(self) -> list[tuple[str, str]]:
        return sorted(self._definitions)
