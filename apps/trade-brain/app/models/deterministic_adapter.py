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
    ) -> None:
        self._fixed_output = fixed_output
        self._simulate = simulate
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
            output = {key: f"deterministic:{key}" for key in request.output_schema.get("required", [])}
        return ModelResponse(
            provider=request.provider,
            model_id=request.model_id or "deterministic-test-model",
            output=output,
            usage={"input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0},
            stop_reason="end_turn",
            prompt_version=request.prompt_version,
        )
