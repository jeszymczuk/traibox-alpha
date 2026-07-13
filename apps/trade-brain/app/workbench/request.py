"""Strict calculation contracts (Phase 3 closure §1).

Contract chain:
  WorkbenchCalculationRequest → WorkbenchCalculationResult
  → FinancialCalculationRunDraft → TypeScript persistence adapter
  → financial_calculation_runs record.

The Workbench stays persistence-independent: the draft carries everything
EXCEPT database-assigned fields (run_id, persisted created_at). Statuses are
unified across Python/TypeScript/database: completed |
insufficient_information | invalid_input | failed. `ineligible` is an
eligibility result, never a calculation status.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

CALCULATION_STATUSES = ("completed", "insufficient_information", "invalid_input", "failed")
ELIGIBILITY_VALUES = ("eligible", "ineligible", "insufficient_information", "not_applicable")

# The only rounding policy supported in this release (§4.1) — explicit,
# validated, recorded, and part of the input hash. Unsupported policies are
# rejected, never silently ignored.
SUPPORTED_ROUNDING_MODE = "half_even"
SUPPORTED_RATE_SCALE = 10


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CurrencyPolicy(_Strict):
    """Explicit currency policy (§4): no defaults, no implicit conversion."""

    base_currency: str = Field(min_length=3, max_length=3)
    conversion_allowed: bool = False
    accepted_fx_sources: list[str] = Field(default_factory=list)
    fx_as_of_required: bool = True
    allow_stale_rates: bool = False
    rate_direction: Literal["base_to_quote"] = "base_to_quote"

    @field_validator("base_currency")
    @classmethod
    def _upper_alpha(cls, value: str) -> str:
        code = value.upper()
        if not code.isalpha():
            raise ValueError(f"malformed currency code '{value}'")
        return code


class RoundingPolicy(_Strict):
    mode: str = SUPPORTED_ROUNDING_MODE
    monetary_scale: Literal["currency_minor_units"] = "currency_minor_units"
    rate_scale: int = SUPPORTED_RATE_SCALE

    @field_validator("mode")
    @classmethod
    def _supported_mode(cls, value: str) -> str:
        if value != SUPPORTED_ROUNDING_MODE:
            raise ValueError(f"unsupported rounding mode '{value}'; this release supports only '{SUPPORTED_ROUNDING_MODE}'")
        return value

    @field_validator("rate_scale")
    @classmethod
    def _supported_scale(cls, value: int) -> int:
        if value != SUPPORTED_RATE_SCALE:
            raise ValueError(f"unsupported rate scale {value}; this release supports only {SUPPORTED_RATE_SCALE}")
        return value


class StructuredWarning(_Strict):
    code: str = Field(min_length=1)
    message: str = Field(min_length=1)
    severity: Literal["info", "warning", "critical"] = "warning"
    related_input_paths: list[str] = Field(default_factory=list)


class InputProvenance(_Strict):
    """Path-based provenance (§5). input_path addresses top-level fields
    ('revenue'), nested fields ('reference_rate.rate'), and array items
    ('components[0].amount')."""

    input_path: str = Field(min_length=1)
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
    status: Literal["completed", "insufficient_information", "invalid_input", "failed"]
    inputs: dict[str, Any]
    outputs: dict[str, Any]
    warnings: list[StructuredWarning] = Field(default_factory=list)
    validations: list[ValidationFinding] = Field(default_factory=list)
    assumptions_used: list[str] = Field(default_factory=list)
    missing_fields: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    eligibility: Literal["eligible", "ineligible", "insufficient_information", "not_applicable"] = "not_applicable"
    input_hash: str = ""
    result_hash: str = ""
    executed_by: Literal["workbench"] = "workbench"
    trace_id: str = ""


class ExecutionMetadata(_Strict):
    duration_ms: int | None = None
    engine: str = "workbench"


class FinancialCalculationRunDraft(_Strict):
    """Everything persistence needs EXCEPT database-assigned fields (§1.1).
    Mirrors packages/contracts/src/calculations/financial-workbench.ts
    FinancialCalculationRunDraft; the TS adapter owns run_id/created_at."""

    calculator_id: str
    calculator_version: str
    formula_version: str
    organization_id: str
    principal_id: str
    principal_type: Literal["company", "financier", "platform_internal"]
    mandate_id: str
    mandate_version: int
    task_id: str | None
    outcome_id: str | None
    scenario_id: str | None
    input_snapshot: dict[str, Any]
    input_provenance: list[InputProvenance]
    assumption_refs: list[str]
    result: dict[str, Any]
    currency_policy: CurrencyPolicy
    rounding_policy: RoundingPolicy
    input_hash: str
    result_hash: str
    warnings: list[StructuredWarning]
    validations: list[ValidationFinding]
    status: Literal["completed", "insufficient_information", "invalid_input", "failed"]
    eligibility: Literal["eligible", "ineligible", "insufficient_information", "not_applicable"]
    missing_fields: list[str]
    executed_by: Literal["workbench"]
    actor_user_id: str | None
    trace_id: str
    idempotency_key: str
    execution: ExecutionMetadata


def build_run_draft(request: CalculationRequest, result: CalculationResult, *, actor_user_id: str | None = None, duration_ms: int | None = None) -> FinancialCalculationRunDraft:
    return FinancialCalculationRunDraft(
        calculator_id=result.calculator_id,
        calculator_version=result.calculator_version,
        formula_version=result.formula_version,
        organization_id=request.organization_id,
        principal_id=request.principal_id,
        principal_type=request.principal_type,
        mandate_id=request.mandate_id,
        mandate_version=request.mandate_version,
        task_id=request.task_id,
        outcome_id=request.outcome_id,
        scenario_id=request.scenario_id,
        input_snapshot=result.inputs,
        input_provenance=request.input_provenance,
        assumption_refs=request.assumption_refs,
        result=result.outputs,
        currency_policy=request.currency_policy,
        rounding_policy=request.rounding_policy,
        input_hash=result.input_hash,
        result_hash=result.result_hash,
        warnings=result.warnings,
        validations=result.validations,
        status=result.status,
        eligibility=result.eligibility,
        missing_fields=result.missing_fields,
        executed_by="workbench",
        actor_user_id=actor_user_id,
        trace_id=result.trace_id,
        idempotency_key=request.idempotency_key,
        execution=ExecutionMetadata(duration_ms=duration_ms),
    )
