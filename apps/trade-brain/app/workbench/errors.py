"""Workbench errors. Invalid input fails closed; MISSING data is not an error
but a structured `insufficient_information` result (directive B9)."""

from __future__ import annotations

from typing import Any


class WorkbenchError(Exception):
    def __init__(self, code: str, message: str, detail: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.detail = detail or {}

    def to_record(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "detail": self.detail}


class WorkbenchInputError(WorkbenchError, ValueError):
    """Invalid (not merely missing) input: wrong type, float money, bad schema.

    Also a ValueError so pydantic BeforeValidators convert it into a normal
    ValidationError at the model boundary (engine returns invalid_input).
    """


class CalculatorNotFound(WorkbenchError):
    """Unknown calculator id or version — fail closed, never fall back."""
