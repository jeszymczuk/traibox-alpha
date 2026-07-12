"""Typed task result (directive B7). Honest completion statuses only —
budget exhaustion or policy failure is never presented as completion."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

COMPLETION_STATUSES: tuple[str, ...] = ("completed", "partial", "blocked", "failed", "timed_out", "abstained")


@dataclass
class TaskResult:
    task_id: str
    completion_status: str
    objective_summary: str = ""
    structured_output: dict[str, Any] | None = None
    policy_violations: list[dict[str, Any]] = field(default_factory=list)
    untrusted_input_flags: list[dict[str, Any]] = field(default_factory=list)
    model_usage: list[dict[str, Any]] = field(default_factory=list)
    events: list[dict[str, Any]] = field(default_factory=list)
    effective_authority: str | None = None
    effective_tool_classes: tuple[str, ...] = ()
    definition_version: str | None = None
    mandate_version: int | None = None
    trace_id: str = ""

    def __post_init__(self) -> None:
        if self.completion_status not in COMPLETION_STATUSES:
            raise ValueError(f"invalid completion status '{self.completion_status}'")
