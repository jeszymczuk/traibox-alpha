"""Strict resolved runtime task models (directive A1/A2).

The governed runner consumes ONLY a fully resolved task: nothing security-
relevant is defaulted, inferred from objective text, or resolved implicitly
during execution. Mirrors packages/contracts/src/agents/runtime.ts
(agent-runtime-task-v1). Unknown fields are rejected.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .authority import AUTHORITY_LEVELS
from .definition import PRINCIPAL_TYPES

AGENT_RUNTIME_TASK_CONTRACT_VERSION = "agent-runtime-task-v1"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TaskConstraints(_Strict):
    timeout_seconds: int | None = Field(default=None, gt=0)
    max_model_steps: int | None = Field(default=None, gt=0)
    max_tool_calls: int | None = Field(default=None, ge=0)
    max_output_tokens: int | None = Field(default=None, gt=0)
    max_cost_usd: float | None = Field(default=None, gt=0)
    deadline: str | None = None


class AuthorizedObjectRef(_Strict):
    source_layer: Literal["relational", "alpha_object", "external"]
    domain: str = Field(min_length=1)
    object_type: str = Field(min_length=1)
    object_id: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    trade_id: str | None = None
    object_version: str | int | None = None
    observed_at: str | None = None
    access_scope: str | None = None


class DocumentInput(_Strict):
    source_id: str = Field(min_length=1)
    content: str
    content_hash: str | None = None
    media_type: str | None = None


class ResolvedAgentTask(_Strict):
    contract_version: Literal["agent-runtime-task-v1"]
    task_id: str = Field(min_length=1)
    agent_id: str = Field(min_length=1)
    definition_version: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    principal_id: str = Field(min_length=1)
    principal_type: str
    organization_id: str = Field(min_length=1)
    mandate_id: str = Field(min_length=1)
    mandate_version: int = Field(gt=0)
    requested_outcome_type: str = Field(min_length=1)
    requested_authority: str
    trace_id: str = Field(min_length=1)
    idempotency_key: str = Field(min_length=1)
    tool_scope: list[str]
    data_scope: list[str]
    constraints: TaskConstraints
    authorized_object_refs: list[AuthorizedObjectRef]
    documents: list[DocumentInput] = Field(default_factory=list)

    @field_validator("principal_type")
    @classmethod
    def _principal_type_known(cls, value: str) -> str:
        if value not in PRINCIPAL_TYPES:
            raise ValueError(f"unknown principal type '{value}'")
        return value

    @field_validator("requested_authority")
    @classmethod
    def _authority_representable(cls, value: str) -> str:
        if value not in AUTHORITY_LEVELS:
            raise ValueError(f"authority '{value}' is not representable")
        return value

    @model_validator(mode="after")
    def _org_backed_principal(self) -> "ResolvedAgentTask":
        # CA-113: principal identity is organization-backed for every currently
        # supported principal type.
        if self.principal_id != self.organization_id:
            raise ValueError("principal_id must equal organization_id under the org-backed principal model")
        return self
