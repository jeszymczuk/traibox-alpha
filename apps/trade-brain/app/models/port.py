"""Provider-neutral model port (directive B6).

Model identifiers come from deployment policy — never from business logic.
No hidden chain-of-thought is returned or persisted: adapters return only
structured output, usage metadata, and provenance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from ..agents.framework.errors import SchemaViolation


@dataclass(frozen=True)
class ModelRequest:
    purpose: str
    messages: tuple[dict[str, str], ...]
    output_schema: dict[str, Any]
    provider: str
    model_id: str
    max_output_tokens: int
    timeout_seconds: int
    max_cost_usd: float
    prompt_version: str
    trace_id: str
    sensitivity: str = "internal"


@dataclass
class ModelResponse:
    provider: str
    model_id: str
    output: dict[str, Any]
    usage: dict[str, Any] = field(default_factory=dict)
    stop_reason: str = "end_turn"
    prompt_version: str = ""


class ModelPort(Protocol):
    def complete(self, request: ModelRequest) -> ModelResponse:  # pragma: no cover - protocol
        ...


def validate_structured_output(schema: dict[str, Any], output: Any) -> dict[str, Any]:
    """Minimal structural validation: dict shape + required keys present.

    Full JSON-schema validation arrives with outcome schemas in Phase 4; this
    layer guarantees the runner never accepts free-form output.
    """
    if not isinstance(output, dict):
        raise SchemaViolation("model.output_not_object", "model output is not a structured object", {"type": type(output).__name__})
    required = schema.get("required", [])
    missing = [key for key in required if key not in output]
    if missing:
        raise SchemaViolation("model.output_missing_fields", "model output is missing required fields", {"missing": missing})
    return output
