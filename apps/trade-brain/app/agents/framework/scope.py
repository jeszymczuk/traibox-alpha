"""Effective scope computation (directive B5).

The effective tool set is the INTERSECTION of agent definition, mandate, task
scope, and deployment policy — never a union, never widened by any runtime
input.
"""

from __future__ import annotations

from .definition import AgentDefinition
from .mandate import Mandate


def effective_tool_classes(
    *,
    definition: AgentDefinition,
    mandate: Mandate,
    task_tool_scope: tuple[str, ...] | None,
    deployment_allowed: tuple[str, ...],
) -> frozenset[str]:
    scope = frozenset(definition.eligible_tool_classes) & frozenset(mandate.permitted_tool_classes) & frozenset(deployment_allowed)
    if task_tool_scope is not None:
        scope &= frozenset(task_tool_scope)
    return scope


def effective_data_classes(
    *,
    definition: AgentDefinition,
    mandate: Mandate,
    task_data_scope: tuple[str, ...] | None,
) -> frozenset[str]:
    scope = frozenset(definition.data_classes) & frozenset(mandate.permitted_data_classes)
    if task_data_scope is not None:
        scope &= frozenset(task_data_scope)
    return scope
