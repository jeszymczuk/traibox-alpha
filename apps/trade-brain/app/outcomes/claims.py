"""Typed evidence assembly (Phase 4 §D3).

Every material statement in an outcome is a typed claim. Calculation claims
reference persisted calculation runs (ids assigned at persistence) through
the run's idempotency key plus the full audit identity (calculator id +
version + formula version + both hashes). Claims are never created from LLM
arithmetic: calculation claim statements are rendered by CODE from Workbench
outputs. Unknown information remains unknown — an absent fact produces an
unresolved_question claim, never a fabricated value.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from ..workbench.request import CalculationResult, FinancialCalculationRunDraft

CLAIM_TYPES = (
    "verified_fact",
    "inference",
    "assumption",
    "estimate",
    "calculation",
    "recommendation",
    "unresolved_question",
    "contradiction",
)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ClaimSourceRef(_Strict):
    source_type: Literal["document", "canonical_object", "calculation_run", "user_statement", "specialist_read"]
    document_id: str | None = None
    object_ref: dict[str, Any] | None = None
    calculation_ref: str | None = None
    detail: str | None = None


class CalculationClaimRef(_Strict):
    """The audit identity of a calculation claim (§D3): the persisted run id
    is assigned by the API at persistence time and joined through the run's
    (org, idempotency_key); the hash pair makes the reference verifiable."""

    run_idempotency_key: str = Field(min_length=1)
    calculator_id: str = Field(min_length=1)
    calculator_version: str = Field(min_length=1)
    formula_version: str = Field(min_length=1)
    input_hash: str = Field(min_length=1)
    result_hash: str = Field(min_length=1)


class EvidenceClaim(_Strict):
    claim_id: str = Field(min_length=1)
    claim_type: Literal[
        "verified_fact",
        "inference",
        "assumption",
        "estimate",
        "calculation",
        "recommendation",
        "unresolved_question",
        "contradiction",
    ]
    statement: str = Field(min_length=1)
    source_refs: list[ClaimSourceRef] = Field(default_factory=list)
    calculation_ref: CalculationClaimRef | None = None
    principal_id: str = Field(min_length=1)
    principal_type: Literal["company", "financier", "platform_internal"]
    visibility_scope: Literal["principal", "organization", "platform_internal"] = "principal"
    confidence: Literal["high", "medium", "low"] = "medium"
    verification_status: Literal["verified", "unverified", "conflicting"] = "unverified"
    materiality: Literal["critical", "material", "supporting"] = "material"
    as_of: str | None = None
    contradicts_claim_ids: list[str] = Field(default_factory=list)
    superseded_by_claim_id: str | None = None


class EvidenceBundle(_Strict):
    """The typed evidence set backing one outcome. Contradictions stay linked,
    never erased; unresolved questions stay visible."""

    claims: list[EvidenceClaim] = Field(default_factory=list)

    def by_type(self, claim_type: str) -> list[EvidenceClaim]:
        return [claim for claim in self.claims if claim.claim_type == claim_type]

    def contradictions(self) -> list[EvidenceClaim]:
        return self.by_type("contradiction")

    def unresolved_questions(self) -> list[EvidenceClaim]:
        return self.by_type("unresolved_question")

    def claim_ids(self) -> list[str]:
        return [claim.claim_id for claim in self.claims]


class ClaimFactory:
    """Deterministic claim ids within one outcome execution (trace-scoped)."""

    def __init__(self, *, principal_id: str, principal_type: str, trace_id: str) -> None:
        self._principal_id = principal_id
        self._principal_type = principal_type
        self._trace_id = trace_id
        self._counter = 0

    def _next_id(self, claim_type: str) -> str:
        self._counter += 1
        return f"claim:{self._trace_id}:{self._counter:03d}:{claim_type}"

    def _base(self, claim_type: str, statement: str, **kwargs: Any) -> EvidenceClaim:
        return EvidenceClaim(
            claim_id=self._next_id(claim_type),
            claim_type=claim_type,  # type: ignore[arg-type]
            statement=statement,
            principal_id=self._principal_id,
            principal_type=self._principal_type,  # type: ignore[arg-type]
            **kwargs,
        )

    def verified_fact(self, statement: str, *, source: ClaimSourceRef, materiality: str = "material", as_of: str | None = None) -> EvidenceClaim:
        return self._base("verified_fact", statement, source_refs=[source], verification_status="verified", confidence="high", materiality=materiality, as_of=as_of)

    def user_provided(self, statement: str, *, materiality: str = "material") -> EvidenceClaim:
        return self._base(
            "verified_fact",
            statement,
            source_refs=[ClaimSourceRef(source_type="user_statement")],
            verification_status="unverified",
            confidence="medium",
            materiality=materiality,
        )

    def assumption(self, statement: str, *, materiality: str = "material") -> EvidenceClaim:
        return self._base("assumption", statement, verification_status="unverified", confidence="medium", materiality=materiality)

    def estimate(self, statement: str, *, source: ClaimSourceRef | None = None) -> EvidenceClaim:
        return self._base("estimate", statement, source_refs=[source] if source else [], verification_status="unverified")

    def inference(self, statement: str, *, from_claim_ids: list[str], confidence: str = "medium") -> EvidenceClaim:
        refs = [ClaimSourceRef(source_type="calculation_run", detail=f"derived from {claim_id}") for claim_id in from_claim_ids]
        return self._base("inference", statement, source_refs=refs, confidence=confidence)

    def unresolved_question(self, statement: str, *, materiality: str = "material") -> EvidenceClaim:
        return self._base("unresolved_question", statement, verification_status="unverified", materiality=materiality)

    def contradiction(self, statement: str, *, contradicts: list[str], materiality: str = "critical") -> EvidenceClaim:
        return self._base("contradiction", statement, verification_status="conflicting", materiality=materiality, contradicts_claim_ids=contradicts)

    def calculation(
        self,
        statement: str,
        *,
        result: CalculationResult,
        draft: FinancialCalculationRunDraft,
        materiality: str = "material",
    ) -> EvidenceClaim:
        """Calculation claims are built by CODE from Workbench results — the
        statement must be assembled from result outputs, never model text."""
        ref = CalculationClaimRef(
            run_idempotency_key=draft.idempotency_key,
            calculator_id=result.calculator_id,
            calculator_version=result.calculator_version,
            formula_version=result.formula_version,
            input_hash=result.input_hash,
            result_hash=result.result_hash,
        )
        return self._base(
            "calculation",
            statement,
            source_refs=[ClaimSourceRef(source_type="calculation_run", calculation_ref=draft.idempotency_key)],
            calculation_ref=ref,
            verification_status="verified",
            confidence="high",
            materiality=materiality,
        )

    def recommendation(self, statement: str, *, supporting_claim_ids: list[str], confidence: str) -> EvidenceClaim:
        refs = [ClaimSourceRef(source_type="calculation_run", detail=f"supported by {claim_id}") for claim_id in supporting_claim_ids]
        return self._base("recommendation", statement, source_refs=refs, confidence=confidence)
