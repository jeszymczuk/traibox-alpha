"""Recommendation contract (Phase 4 §D4).

Material numeric content is populated by CODE from calculation outputs; the
model contributes wording only. The explicit next step may say a protected-
action proposal COULD be prepared later — it never creates or submits one.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Strict(BaseModel):
    # frozen=True: a recommendation is immutable once issued; a revision is a
    # new recommendation with its own lineage.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)


class RecommendationCondition(_Strict):
    description: str = Field(min_length=1)
    blocking: bool = False


class RecommendationRisk(_Strict):
    description: str = Field(min_length=1)
    severity: Literal["low", "medium", "high"] = "medium"
    mitigant: str | None = None


class AlternativeConsidered(_Strict):
    label: str = Field(min_length=1)
    reason_not_recommended: str = Field(min_length=1)


class Recommendation(_Strict):
    recommendation_type: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    rationale: str = Field(min_length=1)
    supporting_claim_ids: list[str] = Field(default_factory=list)
    supporting_calculation_refs: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"]
    conditions: list[RecommendationCondition] = Field(default_factory=list)
    risks: list[RecommendationRisk] = Field(default_factory=list)
    alternatives_considered: list[AlternativeConsidered] = Field(default_factory=list)
    # Explicit next step. May STATE that a protected-action proposal could be
    # prepared later; creating/submitting one is out of Phase 4 scope.
    next_step: str = Field(min_length=1)
    creates_protected_action: Literal[False] = False
