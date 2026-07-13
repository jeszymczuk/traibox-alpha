"""Authorized calculation execution (Phase 3 closure §2).

The Workbench is not an ungoverned calculation bypass: every governed
execution flows through execute_authorized_calculation with a strict
WorkbenchExecutionContext, or through the governed tool seam (which builds
the same context). The raw engine is internal.
"""

from __future__ import annotations

import time
from typing import Callable, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..agents.framework.authority import authority_rank
from ..agents.framework.errors import AuthorityViolation, MandateViolation
from .registry import WorkbenchRegistry, _execute_unchecked
from .request import CalculationRequest, CalculationResult, FinancialCalculationRunDraft, build_run_draft

CALCULATION_TOOL_CLASS = "calculation"


class WorkbenchExecutionContext(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    organization_id: str = Field(min_length=1)
    principal_id: str = Field(min_length=1)
    principal_type: Literal["company", "financier", "platform_internal"]
    mandate_id: str = Field(min_length=1)
    mandate_version: int = Field(gt=0)
    task_id: str = Field(min_length=1)
    actor_user_id: str | None = None
    requested_authority: str = Field(min_length=1)
    effective_authority: str = Field(min_length=1)
    effective_tool_classes: list[str]
    effective_data_classes: list[str]
    sensitivity_ceiling: str = "confidential"
    trace_id: str = Field(min_length=1)


def authorize_calculation(context: WorkbenchExecutionContext, request: CalculationRequest) -> None:
    """Fail closed on any mismatch (§2)."""
    if context.principal_id != context.organization_id:
        raise MandateViolation("workbench.principal_not_org_backed", "principal_id must equal organization_id (CA-113)", {})
    if context.principal_type != "company":
        raise MandateViolation(
            "workbench.principal_not_activated",
            f"principal type '{context.principal_type}' is reserved; only company principals execute calculations in this release",
            {"principal_type": context.principal_type},
        )
    if authority_rank(context.effective_authority) < authority_rank("calculate"):
        raise AuthorityViolation(
            "workbench.insufficient_authority",
            f"effective authority '{context.effective_authority}' is below 'calculate'",
            {"effective": context.effective_authority},
        )
    if CALCULATION_TOOL_CLASS not in context.effective_tool_classes:
        raise MandateViolation("workbench.tool_class_not_permitted", "the 'calculation' tool class is outside the effective scope", {})
    mismatches = {
        "organization_id": (request.organization_id, context.organization_id),
        "principal_id": (request.principal_id, context.principal_id),
        "principal_type": (request.principal_type, context.principal_type),
        "mandate_id": (request.mandate_id, context.mandate_id),
        "mandate_version": (request.mandate_version, context.mandate_version),
        # Governed calculations are always task-bound; a None request task_id
        # is a mismatch, not a wildcard.
        "task_id": (request.task_id, context.task_id),
    }
    wrong = [key for key, (requested, authorized) in mismatches.items() if requested != authorized]
    if wrong:
        raise MandateViolation(
            "workbench.context_mismatch",
            "calculation request does not match the authorized execution context",
            {"mismatched": sorted(wrong)},
        )


def execute_authorized_calculation(
    registry: WorkbenchRegistry,
    request: CalculationRequest,
    context: WorkbenchExecutionContext,
    *,
    time_source: Callable[[], float] = time.monotonic,
) -> tuple[CalculationResult, FinancialCalculationRunDraft]:
    """The governed entry point: authorize → execute → build the run draft."""
    authorize_calculation(context, request)
    started = time_source()
    result = _execute_unchecked(registry, request)
    duration_ms = int((time_source() - started) * 1000)
    draft = build_run_draft(request, result, actor_user_id=context.actor_user_id, duration_ms=duration_ms)
    return result, draft
