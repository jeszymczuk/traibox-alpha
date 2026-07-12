"""Exact-version mandate validation (spec §4.5, directive B3).

The mandate is loaded server-side by the caller-provided loader — data supplied
in the task request is never authoritative. Only ACTIVE COMPANY mandates may
run in this release. Authority is never inferred from objective wording.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .authority import validate_level, validate_within_ceiling
from .definition import AgentDefinition
from .errors import MandateViolation

SENSITIVITIES: tuple[str, ...] = ("public", "internal", "confidential", "restricted_financial", "regulated_personal")


@dataclass(frozen=True)
class Mandate:
    mandate_id: str
    version: int
    org_id: str
    principal_id: str
    principal_type: str
    agent_class: str
    status: str  # draft | active | suspended | expired | revoked
    allowed_outcome_types: tuple[str, ...]
    permitted_tool_classes: tuple[str, ...]
    permitted_data_classes: tuple[str, ...]
    permitted_specialist_reads: tuple[str, ...]
    prohibited_actions: tuple[str, ...]
    authority_ceiling: str
    max_sensitivity: str = "confidential"
    effective_from: datetime | None = None
    expires_at: datetime | None = None
    disclosure_policy_id: str = "default"


def validate_mandate(
    *,
    mandate: Mandate,
    definition: AgentDefinition,
    org_id: str,
    principal_id: str,
    principal_type: str,
    requested_outcome_type: str,
    requested_authority: str,
    now: datetime | None = None,
) -> None:
    """Raise MandateViolation on the first failed check. Fail closed."""
    moment = now or datetime.now(timezone.utc)

    if mandate.org_id != org_id:
        raise MandateViolation("mandate.org_mismatch", "mandate belongs to a different organization", {"mandate_org": mandate.org_id})
    if mandate.principal_id != principal_id or mandate.principal_type != principal_type:
        raise MandateViolation(
            "mandate.principal_mismatch",
            "task principal does not match the mandate principal",
            {"mandate_principal": [mandate.principal_id, mandate.principal_type], "task_principal": [principal_id, principal_type]},
        )
    if mandate.status != "active":
        raise MandateViolation("mandate.not_active", f"mandate status is '{mandate.status}'", {"status": mandate.status})
    # Only company principals are activated in this release (CA-113).
    if mandate.principal_type != "company":
        raise MandateViolation(
            "mandate.principal_not_activated",
            f"principal type '{mandate.principal_type}' is reserved and not activated",
            {"principal_type": mandate.principal_type},
        )
    if mandate.effective_from is not None and moment < mandate.effective_from:
        raise MandateViolation("mandate.not_yet_effective", "mandate is not yet effective", {})
    if mandate.expires_at is not None and moment >= mandate.expires_at:
        raise MandateViolation("mandate.expired", "mandate has expired", {"expires_at": mandate.expires_at.isoformat()})
    if mandate.agent_class != definition.agent_class:
        raise MandateViolation(
            "mandate.agent_class_mismatch",
            "mandate was issued for a different agent class",
            {"mandate_class": mandate.agent_class, "definition_class": definition.agent_class},
        )
    if principal_type not in definition.supported_principal_types:
        raise MandateViolation("mandate.principal_unsupported_by_definition", "definition does not support this principal type", {})
    if requested_outcome_type not in mandate.allowed_outcome_types:
        raise MandateViolation(
            "mandate.outcome_not_permitted",
            f"outcome '{requested_outcome_type}' is outside the mandate",
            {"requested": requested_outcome_type},
        )
    if requested_outcome_type not in definition.supported_outcome_types:
        raise MandateViolation(
            "mandate.outcome_unsupported_by_definition",
            f"outcome '{requested_outcome_type}' is not supported by the agent definition",
            {"requested": requested_outcome_type},
        )
    validate_level(requested_authority)
    validate_within_ceiling(requested_authority, mandate.authority_ceiling)
    if requested_authority not in definition.allowed_authority_levels:
        raise MandateViolation(
            "mandate.authority_unsupported_by_definition",
            f"authority '{requested_authority}' is not allowed by the agent definition",
            {"requested": requested_authority},
        )
    if requested_authority in mandate.prohibited_actions or requested_outcome_type in mandate.prohibited_actions:
        raise MandateViolation("mandate.prohibited_action", "the mandate explicitly prohibits this request", {})
