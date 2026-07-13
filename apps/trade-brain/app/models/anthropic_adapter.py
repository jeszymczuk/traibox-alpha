"""Anthropic adapter for the model port (directive B6).

Wraps the provider behind the port: lazy SDK import (keeps the deterministic
eval gate and unit tests hermetic), model id from the request (which the
runner fills from deployment policy — never hard-coded here), structured
output only, no thinking/chain-of-thought content returned or persisted.
"""

from __future__ import annotations

import json

from ..agents.framework.errors import ModelFailure, ModelTimeout
from .port import ModelRequest, ModelResponse


class AnthropicModelPort:
    def complete(self, request: ModelRequest) -> ModelResponse:
        try:
            import anthropic  # lazy — see module docstring
        except Exception as exc:  # pragma: no cover - environment-dependent
            raise ModelFailure("model.sdk_unavailable", "anthropic SDK is not installed", {"error": str(exc)})

        if not request.model_id:
            raise ModelFailure("model.not_configured", "no model id configured for the anthropic provider", {})

        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
        try:
            response = client.messages.create(
                model=request.model_id,
                max_tokens=request.max_output_tokens,
                system=next((m["content"] for m in request.messages if m.get("role") == "system"), ""),
                messages=[m for m in request.messages if m.get("role") != "system"],
                output_config={"format": {"type": "json_schema", "schema": request.output_schema}},
                timeout=request.timeout_seconds,
            )
        except Exception as exc:
            name = type(exc).__name__
            if "Timeout" in name:
                raise ModelTimeout("model.timeout", "anthropic request timed out", {"timeout_seconds": request.timeout_seconds})
            raise ModelFailure("model.provider_failure", f"anthropic request failed: {name}", {})

        if getattr(response, "stop_reason", None) == "refusal":
            raise ModelFailure("model.refusal", "the model declined the request", {"stop_reason": "refusal"})

        payload = ""
        for block in getattr(response, "content", None) or []:
            if getattr(block, "type", None) == "text":
                payload = getattr(block, "text", "") or ""
                break
        try:
            output = json.loads(payload)
        except Exception:
            raise ModelFailure("model.output_unparseable", "structured output was not valid JSON", {})

        usage = getattr(response, "usage", None)
        return ModelResponse(
            provider="anthropic",
            model_id=str(getattr(response, "model", request.model_id)),
            output=output if isinstance(output, dict) else {"value": output},
            usage={
                "input_tokens": getattr(usage, "input_tokens", None),
                "output_tokens": getattr(usage, "output_tokens", None),
            },
            stop_reason=str(getattr(response, "stop_reason", "end_turn")),
            prompt_version=request.prompt_version,
        )
