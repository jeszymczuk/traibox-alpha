"""Versioned Capital artifacts (Phase 4 §D7).

Artifacts are STRUCTURED FIRST: the structured model is the artifact; any
Markdown/HTML rendering is derived from it and never carries content of its
own. Versions are immutable — a changed artifact is a NEW version with a
prior-version reference. Artifacts are intelligence deliverables, never
canonical Finance objects.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .claims import EvidenceClaim
from .recommendation import Recommendation

ARTIFACT_SCHEMA_VERSION = "capital-artifact-v1"


class _Strict(BaseModel):
    # frozen=True: artifact content is immutable once constructed — a changed
    # artifact is a NEW version, never an in-place edit (§D7).
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, frozen=True)


class CalculationAppendixEntry(_Strict):
    """Verifiable lineage for every material number in the artifact."""

    run_idempotency_key: str
    calculator_id: str
    calculator_version: str
    formula_version: str
    input_hash: str
    result_hash: str
    status: str
    key_outputs: dict[str, Any] = Field(default_factory=dict)


class ArtifactScenario(_Strict):
    name: str
    compare_key: str | None = None
    value: str | None = None
    delta: str | None = None
    note: str | None = None


class ArtifactOption(_Strict):
    label: str
    structural_eligibility: Literal["eligible", "ineligible", "insufficient_information", "not_applicable"]
    ineligibility_reasons: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    conditions: list[str] = Field(default_factory=list)
    recourse: str | None = None
    collateral: str | None = None
    timing: str | None = None
    comparability_note: str | None = None
    risks: list[str] = Field(default_factory=list)


class GeneratedBy(_Strict):
    agent_class: Literal["capital_agent"] = "capital_agent"
    agent_definition_version: str
    outcome_type: str
    outcome_definition_version: str
    synthesis_source: Literal["deterministic", "model"] = "deterministic"
    model_id: str | None = None
    trace_id: str


class CapitalArtifactDraft(_Strict):
    """Everything the API needs to persist an immutable artifact version.
    artifact_id/version numbering is owned by API persistence; version 1 is
    implied for a new artifact, and supersession creates version n+1 with
    prior_version_ref."""

    artifact_type: str
    schema_version: Literal["capital-artifact-v1"] = ARTIFACT_SCHEMA_VERSION
    organization_id: str
    principal_id: str
    principal_type: Literal["company", "financier", "platform_internal"]
    mandate_id: str
    mandate_version: int
    task_id: str
    outcome_type: str
    outcome_definition_version: str
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    facts: list[str] = Field(default_factory=list)
    analysis: dict[str, Any] = Field(default_factory=dict)
    assumptions: list[str] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    contradictions: list[str] = Field(default_factory=list)
    scenarios: list[ArtifactScenario] = Field(default_factory=list)
    options: list[ArtifactOption] = Field(default_factory=list)
    recommendation: Recommendation | None = None
    risks: list[str] = Field(default_factory=list)
    evidence_index: list[str] = Field(default_factory=list)
    calculation_appendix: list[CalculationAppendixEntry] = Field(default_factory=list)
    generated_by: GeneratedBy
    trace_id: str
    prior_version_ref: str | None = None
    provisional: bool = False


def build_evidence_index(claims: list[EvidenceClaim]) -> list[str]:
    return [f"{claim.claim_id} [{claim.claim_type}:{claim.verification_status}] {claim.statement}" for claim in claims]


def render_markdown(artifact: CapitalArtifactDraft) -> str:
    """Derived rendering ONLY — reads the structured model, adds nothing."""
    lines: list[str] = [f"# {artifact.title}", ""]
    if artifact.provisional:
        lines += ["> **PROVISIONAL** — material information is unresolved; see open questions.", ""]
    lines += [artifact.summary, ""]
    if artifact.facts:
        lines += ["## Facts", *[f"- {fact}" for fact in artifact.facts], ""]
    if artifact.analysis:
        lines.append("## Analysis")
        for section, content in artifact.analysis.items():
            lines.append(f"### {section.replace('_', ' ').title()}")
            if isinstance(content, dict):
                lines += [f"- **{key}**: {value}" for key, value in content.items()]
            elif isinstance(content, list):
                lines += [f"- {item}" for item in content]
            else:
                lines.append(str(content))
            lines.append("")
    if artifact.options:
        lines.append("## Options")
        for option in artifact.options:
            lines.append(f"### {option.label} — {option.structural_eligibility}")
            if option.ineligibility_reasons:
                lines += [f"- not eligible: {reason}" for reason in option.ineligibility_reasons]
            if option.missing_information:
                lines += [f"- missing: {item}" for item in option.missing_information]
            lines += [f"- {key}: {value}" for key, value in option.metrics.items()]
            lines.append("")
    if artifact.scenarios:
        lines += ["## Scenarios", *[f"- {s.name}: {s.compare_key}={s.value} (Δ {s.delta})" for s in artifact.scenarios], ""]
    if artifact.recommendation:
        rec = artifact.recommendation
        lines += [
            "## Recommendation",
            f"**{rec.recommendation_type}** ({rec.confidence} confidence): {rec.summary}",
            "",
            rec.rationale,
            "",
            f"**Next step:** {rec.next_step}",
            "",
        ]
        if rec.conditions:
            lines += ["Conditions:", *[f"- {'[blocking] ' if c.blocking else ''}{c.description}" for c in rec.conditions], ""]
        if rec.risks:
            lines += ["Risks:", *[f"- ({r.severity}) {r.description}" + (f" — mitigant: {r.mitigant}" if r.mitigant else "") for r in rec.risks], ""]
        if rec.alternatives_considered:
            lines += ["Alternatives considered:", *[f"- {a.label}: {a.reason_not_recommended}" for a in rec.alternatives_considered], ""]
    if artifact.assumptions:
        lines += ["## Assumptions", *[f"- {item}" for item in artifact.assumptions], ""]
    if artifact.unresolved_questions:
        lines += ["## Open questions", *[f"- {item}" for item in artifact.unresolved_questions], ""]
    if artifact.contradictions:
        lines += ["## Contradictions", *[f"- {item}" for item in artifact.contradictions], ""]
    if artifact.risks:
        lines += ["## Risks", *[f"- {item}" for item in artifact.risks], ""]
    if artifact.calculation_appendix:
        lines.append("## Calculation appendix")
        for entry in artifact.calculation_appendix:
            lines.append(f"- `{entry.calculator_id}@{entry.calculator_version}` ({entry.formula_version}) — {entry.status}")
            lines.append(f"  - input `{entry.input_hash}` / result `{entry.result_hash}`")
            lines += [f"  - {key}: {value}" for key, value in entry.key_outputs.items()]
        lines.append("")
    if artifact.evidence_index:
        lines += ["## Evidence index", *[f"- {item}" for item in artifact.evidence_index], ""]
    lines.append(f"---\n*Generated by {artifact.generated_by.agent_class} {artifact.generated_by.agent_definition_version} · outcome {artifact.outcome_type}@{artifact.outcome_definition_version} · trace {artifact.trace_id} · synthesis: {artifact.generated_by.synthesis_source}. Intelligence deliverable — not a canonical Finance object; no action has been executed.*")
    return "\n".join(lines)
