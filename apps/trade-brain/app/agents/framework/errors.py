"""Structured errors for the governed agent framework.

Every violation is typed and carries a machine-readable payload so the runner
can fail closed with an honest, auditable result instead of a stack trace.
"""

from __future__ import annotations

from typing import Any


class FrameworkViolation(Exception):
    """Base class. code identifies the rule; detail is structured context."""

    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def to_record(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "detail": self.detail}


class ContractViolation(FrameworkViolation):
    """Task request does not satisfy the task contract."""


class MandateViolation(FrameworkViolation):
    """Mandate missing, inactive, expired, mismatched, or insufficient."""


class AuthorityViolation(FrameworkViolation):
    """Requested or attempted authority exceeds what is representable/granted."""


class ToolViolation(FrameworkViolation):
    """Unregistered, out-of-scope, or under-authorized tool use."""


class SchemaViolation(FrameworkViolation):
    """Structured model output failed schema validation."""


class BudgetExceeded(FrameworkViolation):
    """Time, token, step, or cost budget exhausted."""


class ModelFailure(FrameworkViolation):
    """Model provider failure (transport, refusal, provider error)."""


class ModelTimeout(BudgetExceeded):
    """Model call exceeded its time budget."""
