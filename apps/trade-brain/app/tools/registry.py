"""Typed tool registry with complete fail-closed authorization (A5/A6).

Authorization enforces, in order: registration, exact version, effective tool
class, effective authority, data classes, sensitivity ceiling, structured
prohibitions (tool id / class / command / effect / domain), and the
deployment-level canonical-mutation denylist. A denied call never proceeds.
"""

from __future__ import annotations

from ..agents.framework.authority import authority_rank
from ..agents.framework.errors import ToolViolation
from ..agents.framework.policy import DeploymentPolicy
from ..agents.framework.restrictions import Prohibitions, within_sensitivity_ceiling
from .definition import ToolDefinition
from .invocation import ToolHandler


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}
        self._handlers: dict[str, ToolHandler] = {}

    def register(self, tool: ToolDefinition, handler: ToolHandler | None = None) -> None:
        if tool.tool_id in self._tools:
            raise ToolViolation("tool.duplicate", f"tool '{tool.tool_id}' already registered", {"tool_id": tool.tool_id})
        self._tools[tool.tool_id] = tool
        if handler is not None:
            self._handlers[tool.tool_id] = handler

    def handler_for(self, tool_id: str) -> ToolHandler:
        handler = self._handlers.get(tool_id)
        if handler is None:
            raise ToolViolation("tool.no_handler", f"tool '{tool_id}' has no registered handler", {"tool_id": tool_id})
        return handler

    def authorize(
        self,
        tool_id: str,
        *,
        effective_tool_classes: frozenset[str],
        effective_authority: str,
        effective_data_classes: frozenset[str] | None = None,
        sensitivity_ceiling: str | None = None,
        prohibitions: Prohibitions | None = None,
        deployment: DeploymentPolicy | None = None,
        tool_version: str | None = None,
    ) -> ToolDefinition:
        tool = self._tools.get(tool_id)
        if tool is None:
            raise ToolViolation("tool.unregistered", f"tool '{tool_id}' is not registered", {"tool_id": tool_id})
        if tool_version is not None and tool_version != tool.version:
            raise ToolViolation("tool.version_mismatch", f"tool '{tool_id}' version '{tool_version}' is not registered", {"tool_id": tool_id})
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
                raise ToolViolation("tool.data_class_denied", f"tool '{tool_id}' needs data classes outside the effective scope", {"tool_id": tool_id, "denied": denied})
        if sensitivity_ceiling is not None and not within_sensitivity_ceiling(tool.sensitivity, sensitivity_ceiling):
            raise ToolViolation(
                "tool.sensitivity_exceeds_ceiling",
                f"tool '{tool_id}' sensitivity '{tool.sensitivity}' exceeds the mandate ceiling '{sensitivity_ceiling}'",
                {"tool_id": tool_id, "sensitivity": tool.sensitivity, "ceiling": sensitivity_ceiling},
            )
        if prohibitions is not None:
            if tool_id in prohibitions.tool_ids:
                raise ToolViolation("tool.prohibited_id", f"tool '{tool_id}' is explicitly prohibited by the mandate", {"tool_id": tool_id})
            if tool.tool_class in prohibitions.tool_classes:
                raise ToolViolation("tool.prohibited_class", f"tool class '{tool.tool_class}' is prohibited by the mandate", {"tool_id": tool_id})
            if tool.effect_class in prohibitions.effects:
                raise ToolViolation("tool.prohibited_effect", f"effect '{tool.effect_class}' is prohibited by the mandate", {"tool_id": tool_id})
            if tool.owning_domain in prohibitions.domains:
                raise ToolViolation("tool.prohibited_domain", f"domain '{tool.owning_domain}' is prohibited by the mandate", {"tool_id": tool_id})
            if tool.audit_event and tool.audit_event in prohibitions.commands:
                raise ToolViolation("tool.prohibited_command", f"command '{tool.audit_event}' is prohibited by the mandate", {"tool_id": tool_id})
        if deployment is not None:
            if tool.effect_class != "read" and tool.owning_domain in deployment.denied_mutation_domains:
                raise ToolViolation(
                    "tool.denied_mutation_domain",
                    f"non-read tools in domain '{tool.owning_domain}' are denied by deployment policy",
                    {"tool_id": tool_id, "owning_domain": tool.owning_domain},
                )
            if tool.audit_event and tool.audit_event in deployment.denied_commands:
                raise ToolViolation("tool.denied_command", f"command '{tool.audit_event}' is denied by deployment policy", {"tool_id": tool_id})
        return tool
