"""Deployment policy: environment-owned runtime configuration (directive B6).

Model identifiers and provider selection live in configuration, never in
business logic.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class ModelPolicy:
    provider: str = "anthropic"
    model_id: str = ""
    max_output_tokens: int = 4096
    timeout_seconds: int = 60
    max_cost_usd: float = 1.0
    prompt_version: str = "capital-framework-v1"


@dataclass(frozen=True)
class DeploymentPolicy:
    allowed_tool_classes: tuple[str, ...] = (
        "context_read",
        "memory_read",
        "calculation",
        "artifact",
        "proposal",
        "specialist_read",
    )
    model: ModelPolicy = field(default_factory=ModelPolicy)


def deployment_policy_from_env() -> DeploymentPolicy:
    return DeploymentPolicy(
        model=ModelPolicy(
            provider=os.environ.get("TRADE_BRAIN_MODEL_PROVIDER", "anthropic").strip() or "anthropic",
            model_id=os.environ.get("TRADE_BRAIN_LLM_MODEL", "").strip(),
            max_output_tokens=_int_env("TRADE_BRAIN_LLM_MAX_TOKENS", 4096),
            timeout_seconds=_int_env("TRADE_BRAIN_MODEL_TIMEOUT_S", 60),
        )
    )


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default
