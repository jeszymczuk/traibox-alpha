"""Strict calculation request/result models (directive B3), matching the
Phase 1 financial_calculation_runs persistence contract. The Workbench never
writes to Postgres — results serialize into the TS-owned persistence layer."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CurrencyPolicy(_Strict):
    base_currency: str = Field(min_length=3, max_length=3)
    fx_source: str | None = None
    fx_as_of: str | None = None


class RoundingPolicy(_Strict):
    mode: str = "half_even"
    scale: int = 2


class InputProvenance(_Strict):
    input_key: str
    kind: Literal["verified_fact", "user_provided", "assumption", "estimate", "derived", "unresolved"]
    claim_id: str | None = None
    source: str | None = None
    as_of: str | None = None


class CalculationRequest(_Strict):
    calculator_id: str = Field(min_length=1)
    calculator_version: str = Field(min_length=1)
    formula_version: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    principal_id: str = Field(min_length=1)
    principal_type: Literal["company", "financier", "platform_internal"]
    mandate_id: str = Field(min_length=1)
    mandate_version: int = Field(gt=0)
    task_id: str | None = None
    outcome_id: str | None = None
    scenario_id: str | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    input_provenance: list[InputProvenance] = Field(default_factory=list)
    assumption_refs: list[str] = Field(default_factory=list)
    currency_policy: CurrencyPolicy
    rounding_policy: RoundingPolicy = Field(default_factory=RoundingPolicy)
    trace_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)


class ValidationFinding(_Strict):
    check: str
    status: Literal["pass", "warn", "fail"]
    finding: str | None = None


class CalculationResult(_Strict):
    calculator_id: str
    calculator_version: str
    formula_version: str
    status: Literal["completed", "insufficient_information", "invalid_input"]
    inputs: dict[str, Any]
    outputs: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)
    validations: list[ValidationFinding] = Field(default_factory=list)
    assumptions_used: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    eligibility: Literal["eligible", "ineligible", "insufficient_information", "not_applicable"] = "not_applicable"
    input_hash: str = ""
    result_hash: str = ""
    executed_by: Literal["workbench"] = "workbench"
    trace_id: str = ""
