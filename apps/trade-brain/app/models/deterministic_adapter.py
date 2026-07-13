"""Deterministic test adapter for the model port (directive B6).

Produces schema-valid structured output derived only from the request, or
simulates configured failure modes — no network, no nondeterminism.
"""

from __future__ import annotations

from typing import Any

from ..agents.framework.errors import ModelFailure, ModelTimeout
from .port import ModelRequest, ModelResponse


class DeterministicModelPort:
    def __init__(
        self,
        *,
        fixed_output: dict[str, Any] | None = None,
        simulate: str | None = None,  # None | 'timeout' | 'failure' | 'schema_violation'
        usage: dict[str, Any] | None = None,
    ) -> None:
        self._fixed_output = fixed_output
        self._simulate = simulate
        self._usage = usage
        self.requests: list[ModelRequest] = []

    def complete(self, request: ModelRequest) -> ModelResponse:
        self.requests.append(request)
        if self._simulate == "timeout":
            raise ModelTimeout("model.timeout", "simulated model timeout", {"timeout_seconds": request.timeout_seconds})
        if self._simulate == "failure":
            raise ModelFailure("model.provider_failure", "simulated provider failure", {})
        if self._simulate == "schema_violation":
            output: dict[str, Any] = {"unexpected": True}
        elif self._fixed_output is not None:
            output = dict(self._fixed_output)
        else:
            output = {"objective_summary": "deterministic summary", "blocking_questions": [], "rationale": "deterministic rationale"}
        return ModelResponse(
            provider=request.provider,
            model_id=request.model_id or "deterministic-test-model",
            output=output,
            usage=dict(self._usage) if self._usage is not None else {"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
            stop_reason="end_turn",
            prompt_version=request.prompt_version,
        )
