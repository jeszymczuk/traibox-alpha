"""Typed tool-call seam (directive A6).

Phase 3 calculators plug in as handlers; Phase 2 provides the governed
invocation path: exact version resolution → full authorization → input schema
validation → budget consumption → handler → output schema validation → replay
metadata → typed result. No canonical-mutation handler can be registered
(structural denylist at registration and authorization).
"""

from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel, ConfigDict, Field

from ..agents.framework.budget import BudgetTracker
from ..agents.framework.errors import SchemaViolation, ToolViolation
from ..agents.framework.replay import ReplayLog
from .definition import ToolDefinition


class ToolCall(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_id: str = Field(min_length=1)
    # Exact version is REQUIRED on every governed call (§3) — no fallbacks.
    tool_version: str = Field(min_length=1)
    input: dict[str, Any] = Field(default_factory=dict)
    trace_id: str = Field(min_length=1)


class ToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    tool_id: str
    tool_version: str
    status: str  # 'success' | 'blocked' | 'failed'
    output: dict[str, Any] | None = None
    violation: dict[str, Any] | None = None


class ToolInvocationContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    org_id: str
    principal_id: str
    principal_type: str
    mandate_id: str
    mandate_version: int
    task_id: str
    trace_id: str
    effective_authority: str
    data_scope: list[str]


class ToolHandler(Protocol):  # pragma: no cover - protocol
    def handle(self, tool_input: dict[str, Any], context: ToolInvocationContext) -> dict[str, Any]: ...


def validate_against_schema(schema: dict[str, Any], payload: dict[str, Any], *, direction: str, tool_id: str) -> None:
    """Strict-lite structural validation for declared tool schemas: required
    keys, primitive type conformance where declared, and no undeclared keys
    when additionalProperties is false."""
    if not isinstance(payload, dict):
        raise SchemaViolation(f"tool.{direction}_not_object", f"tool {direction} is not an object", {"tool_id": tool_id})
    missing = [key for key in schema.get("required", []) if key not in payload]
    if missing:
        raise SchemaViolation(f"tool.{direction}_missing_fields", f"tool {direction} missing required fields", {"tool_id": tool_id, "missing": missing})
    properties: dict[str, Any] = schema.get("properties", {})
    if schema.get("additionalProperties") is False:
        extras = [key for key in payload if key not in properties]
        if extras:
            raise SchemaViolation(f"tool.{direction}_unexpected_fields", f"tool {direction} has undeclared fields", {"tool_id": tool_id, "extra": extras})
    type_map = {"string": str, "number": (int, float), "integer": int, "boolean": bool, "array": list, "object": dict}
    for key, spec in properties.items():
        if key in payload and isinstance(spec, dict) and spec.get("type") in type_map:
            expected = type_map[spec["type"]]
            value = payload[key]
            if isinstance(value, bool) and spec["type"] in ("number", "integer"):
                raise SchemaViolation(f"tool.{direction}_wrong_type", f"field '{key}' has the wrong type", {"tool_id": tool_id, "field": key})
            if not isinstance(value, expected):  # type: ignore[arg-type]
                raise SchemaViolation(f"tool.{direction}_wrong_type", f"field '{key}' has the wrong type", {"tool_id": tool_id, "field": key})


def invoke_tool(
    call: ToolCall,
    *,
    definition: ToolDefinition,
    handler: ToolHandler,
    context: ToolInvocationContext,
    budget: BudgetTracker,
    replay: ReplayLog,
) -> ToolResult:
    """The authorized invocation path. Authorization (registry.authorize) MUST
    have already succeeded for `definition`; this function re-pins the exact
    version, consumes budget, and validates both directions."""
    if call.tool_version != definition.version:
        raise ToolViolation(
            "tool.version_mismatch",
            f"tool '{call.tool_id}' version '{call.tool_version}' is not the registered version",
            {"tool_id": call.tool_id, "requested": call.tool_version, "registered": definition.version},
        )
    validate_against_schema(definition.input_schema, call.input, direction="input", tool_id=call.tool_id)
    budget.check_tool_call()
    replay.append("tool.invoked", tool_id=call.tool_id, tool_version=definition.version, effect_class=definition.effect_class)
    output = handler.handle(call.input, context)
    validate_against_schema(definition.output_schema, output, direction="output", tool_id=call.tool_id)
    replay.append("tool.completed", tool_id=call.tool_id)
    return ToolResult(tool_id=call.tool_id, tool_version=definition.version, status="success", output=output)
