"""Deployment policy: environment-owned runtime configuration (directives B6/A4/A6).

Model identifiers, pricing, and canonical-mutation denylists live in
configuration, never in business logic.
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
    max_cost_usd: float | None = 1.0
    prompt_version: str = "capital-framework-v1"


# Deployment-owned pricing per (provider, model_id): USD per 1K tokens.
PricingTable = dict[tuple[str, str], dict[str, float]]

# Canonical-mutation denylist (directive A6): domains and commands whose
# mutation can never be reachable from agent tools. Read tools remain allowed.
DEFAULT_DENIED_MUTATION_DOMAINS: tuple[str, ...] = (
    "finance",
    "payments",
    "escrow",
    "provider_execution",
    "offer_acceptance",
    "fund_release",
)
DEFAULT_DENIED_COMMANDS: tuple[str, ...] = (
    "finance.create_funding_request",
    "finance.accept_funding_offer",
    "payments.execute",
    "payments.release_funds",
    "escrow.release",
    "provider.execute",
)


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
    pricing: PricingTable = field(default_factory=dict)
    # Documented conservative per-step estimate used ONLY when a hard cost
    # limit exists and neither the provider nor pricing config can price the
    # step. None => fail closed in that situation.
    conservative_step_cost_usd: float | None = None
    denied_mutation_domains: tuple[str, ...] = DEFAULT_DENIED_MUTATION_DOMAINS
    denied_commands: tuple[str, ...] = DEFAULT_DENIED_COMMANDS

    def estimate_cost_usd(self, provider: str, model_id: str, input_tokens: int | None, output_tokens: int | None) -> float | None:
        rates = self.pricing.get((provider, model_id))
        if rates is None or input_tokens is None or output_tokens is None:
            return None
        return (input_tokens / 1000.0) * rates.get("input_per_1k", 0.0) + (output_tokens / 1000.0) * rates.get("output_per_1k", 0.0)


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
