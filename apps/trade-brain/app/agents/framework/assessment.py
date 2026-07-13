"""Strict objective-assessment output schema (directive A3).

Full validation of the Phase 2 model output: typed fields, no extra fields
(a model cannot smuggle authority/mandate/tool-scope overrides), no scalar
where a list is required, no casting-to-pass. A validation failure surfaces as
a structured SchemaViolation and an honest blocked result.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .errors import SchemaViolation

# JSON-schema mirror sent to the model port for structured output.
ASSESSMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "objective_summary": {"type": "string", "minLength": 1},
        "blocking_questions": {"type": "array", "items": {"type": "string", "minLength": 1}},
        "rationale": {"type": "string", "minLength": 1},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "uncertainty": {"type": "array", "items": {"type": "string"}},
        "evidence_requirements": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["objective_summary", "blocking_questions", "rationale"],
}


class AssessmentOutput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    objective_summary: str = Field(min_length=1)
    blocking_questions: list[str]
    rationale: str = Field(min_length=1)
    assumptions: list[str] = Field(default_factory=list)
    uncertainty: list[str] = Field(default_factory=list)
    evidence_requirements: list[str] = Field(default_factory=list)


def validate_assessment_output(output: Any) -> AssessmentOutput:
    try:
        return AssessmentOutput.model_validate(output)
    except ValidationError as exc:
        raise SchemaViolation(
            "model.output_schema_violation",
            "model output failed strict schema validation",
            {"errors": [{"loc": list(e["loc"]), "type": e["type"]} for e in exc.errors()]},
        )
