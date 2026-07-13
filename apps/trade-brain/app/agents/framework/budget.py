"""Execution-budget enforcement (directive A4).

Budgets are enforced, not advisory. The effective budget is the most
restrictive intersection of agent definition, task constraints, and deployment
policy. Cost accounting uses deployment-owned pricing; when a hard cost limit
is configured and cost cannot be determined, the run fails closed unless the
deployment declares a documented conservative per-step estimate.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from .definition import BudgetPolicy
from .errors import BudgetExceeded
from .policy import DeploymentPolicy
from .task import TaskConstraints


def _min_opt(*values: float | int | None) -> float | int | None:
    present = [v for v in values if v is not None]
    return min(present) if present else None


@dataclass
class EffectiveBudget:
    timeout_seconds: float
    max_model_steps: int
    max_tool_calls: int
    max_output_tokens: int
    max_cost_usd: float | None


def effective_budget(definition_budgets: BudgetPolicy, constraints: TaskConstraints, deployment: DeploymentPolicy) -> EffectiveBudget:
    return EffectiveBudget(
        timeout_seconds=float(_min_opt(definition_budgets.timeout_seconds, constraints.timeout_seconds, deployment.model.timeout_seconds) or 60),
        max_model_steps=int(_min_opt(definition_budgets.max_model_steps, constraints.max_model_steps) or 1),
        max_tool_calls=int(_min_opt(definition_budgets.max_tool_calls, constraints.max_tool_calls) or 0),
        max_output_tokens=int(_min_opt(definition_budgets.max_output_tokens, constraints.max_output_tokens, deployment.model.max_output_tokens) or 1024),
        max_cost_usd=_min_opt(definition_budgets.max_cost_usd, constraints.max_cost_usd, deployment.model.max_cost_usd),
    )


@dataclass
class BudgetTracker:
    budget: EffectiveBudget
    deployment: DeploymentPolicy
    time_source: Callable[[], float]
    started_at: float = field(init=False)
    model_steps: int = 0
    tool_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

    def __post_init__(self) -> None:
        self.started_at = self.time_source()

    # --- checks (called BEFORE the spend) ---
    def check_deadline(self, phase: str) -> None:
        elapsed = self.time_source() - self.started_at
        if elapsed > self.budget.timeout_seconds:
            raise BudgetExceeded("budget.deadline_exceeded", f"execution deadline exceeded ({phase})", {"elapsed_s": elapsed, "limit_s": self.budget.timeout_seconds})

    def check_model_step(self) -> None:
        self.check_deadline("before_model_call")
        if self.model_steps + 1 > self.budget.max_model_steps:
            raise BudgetExceeded("budget.model_steps_exceeded", "model-step budget exhausted", {"limit": self.budget.max_model_steps})
        self.model_steps += 1

    def check_tool_call(self) -> None:
        self.check_deadline("before_tool_call")
        if self.tool_calls + 1 > self.budget.max_tool_calls:
            raise BudgetExceeded("budget.tool_calls_exceeded", "tool-call budget exhausted", {"limit": self.budget.max_tool_calls})
        self.tool_calls += 1

    # --- accounting (called AFTER a model result) ---
    def record_model_usage(self, *, provider: str, model_id: str, input_tokens: int | None, output_tokens: int | None, reported_cost_usd: float | None) -> float:
        self.check_deadline("after_model_call")
        self.input_tokens += int(input_tokens or 0)
        self.output_tokens += int(output_tokens or 0)
        if self.output_tokens > self.budget.max_output_tokens:
            raise BudgetExceeded("budget.output_tokens_exceeded", "output-token budget exhausted", {"used": self.output_tokens, "limit": self.budget.max_output_tokens})
        step_cost = reported_cost_usd
        if step_cost is None:
            step_cost = self.deployment.estimate_cost_usd(provider, model_id, input_tokens, output_tokens)
        if step_cost is None:
            if self.budget.max_cost_usd is not None:
                if self.deployment.conservative_step_cost_usd is None:
                    raise BudgetExceeded(
                        "budget.cost_undeterminable",
                        "a hard cost limit is configured but cost cannot be determined (no pricing, no conservative estimate)",
                        {"provider": provider, "model_id": model_id},
                    )
                step_cost = self.deployment.conservative_step_cost_usd
            else:
                step_cost = 0.0
        self.cost_usd += float(step_cost)
        if self.budget.max_cost_usd is not None and self.cost_usd > self.budget.max_cost_usd:
            raise BudgetExceeded("budget.cost_exceeded", "cost budget exhausted", {"cost_usd": self.cost_usd, "limit": self.budget.max_cost_usd})
        return float(step_cost)

    def snapshot(self) -> dict[str, object]:
        return {
            "model_steps": self.model_steps,
            "tool_calls": self.tool_calls,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 6),
            "elapsed_s": round(self.time_source() - self.started_at, 3),
            "limits": {
                "timeout_seconds": self.budget.timeout_seconds,
                "max_model_steps": self.budget.max_model_steps,
                "max_tool_calls": self.budget.max_tool_calls,
                "max_output_tokens": self.budget.max_output_tokens,
                "max_cost_usd": self.budget.max_cost_usd,
            },
        }
