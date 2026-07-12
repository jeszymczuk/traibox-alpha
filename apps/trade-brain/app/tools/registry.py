"""Typed tool registry with fail-closed authorization (directive B5)."""

from __future__ import annotations

from ..agents.framework.authority import authority_rank
from ..agents.framework.errors import ToolViolation
from .definition import ToolDefinition


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, tool: ToolDefinition) -> None:
        if tool.tool_id in self._tools:
            raise ToolViolation("tool.duplicate", f"tool '{tool.tool_id}' already registered", {"tool_id": tool.tool_id})
        self._tools[tool.tool_id] = tool

    def authorize(
        self,
        tool_id: str,
        *,
        effective_tool_classes: frozenset[str],
        effective_authority: str,
        effective_data_classes: frozenset[str] | None = None,
    ) -> ToolDefinition:
        """Return the definition or raise — an unauthorized call never proceeds."""
        tool = self._tools.get(tool_id)
        if tool is None:
            raise ToolViolation("tool.unregistered", f"tool '{tool_id}' is not registered", {"tool_id": tool_id})
        if tool.tool_class not in effective_tool_classes:
            raise ToolViolation(
                "tool.outside_scope",
                f"tool class '{tool.tool_class}' is outside the effective scope",
                {"tool_id": tool_id, "tool_class": tool.tool_class, "effective": sorted(effective_tool_classes)},
            )
        if authority_rank(tool.required_authority) > authority_rank(effective_authority):
            raise ToolViolation(
                "tool.insufficient_authority",
                f"tool '{tool_id}' requires authority '{tool.required_authority}'",
                {"tool_id": tool_id, "required": tool.required_authority, "effective": effective_authority},
            )
        if effective_data_classes is not None and tool.data_classes:
            denied = [dc for dc in tool.data_classes if dc not in effective_data_classes]
            if denied:
                raise ToolViolation(
                    "tool.data_class_denied",
                    f"tool '{tool_id}' needs data classes outside the effective scope",
                    {"tool_id": tool_id, "denied": denied},
                )
        return tool
