"""Deployment-level tool policy helpers (directive B5)."""

from __future__ import annotations

from ..agents.framework.policy import DeploymentPolicy


def deployment_tool_classes(policy: DeploymentPolicy) -> tuple[str, ...]:
    return policy.allowed_tool_classes
