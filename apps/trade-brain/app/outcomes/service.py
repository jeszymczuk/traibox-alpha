"""HTTP service adapter for governed outcome execution (Phase 4 §D8).

The TypeScript API owns authentication, organization/principal resolution,
exact mandate loading (server-side, from the database), task creation, the
database transaction, RLS context, and persistence. This adapter receives the
already-resolved execution request PLUS the server-loaded mandate content
from the authenticated service caller, executes the governed outcome, and
returns the typed result for persistence. The Trade Brain never touches the
database and never creates canonical state.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import ValidationError

from ..agents.capital.definition import CAPITAL_AGENT_DEFINITION
from ..agents.framework.errors import FrameworkViolation
from ..agents.framework.mandate import Mandate
from ..core import SERVICE_VERSION
from ..workbench.catalogue import default_registry as default_workbench_registry
from .catalogue import default_outcome_registry
from .runner import execute_outcome

_OUTCOMES = default_outcome_registry()
_WORKBENCH = default_workbench_registry()


def _parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _mandate_from_payload(payload: dict[str, Any]) -> Mandate:
    return Mandate(
        mandate_id=str(payload["mandate_id"]),
        version=int(payload["version"]),
        org_id=str(payload["org_id"]),
        principal_id=str(payload["principal_id"]),
        principal_type=str(payload["principal_type"]),
        agent_class=str(payload["agent_class"]),
        status=str(payload["status"]),
        allowed_outcome_types=tuple(payload.get("allowed_outcome_types", [])),
        permitted_tool_classes=tuple(payload.get("permitted_tool_classes", [])),
        permitted_data_classes=tuple(payload.get("permitted_data_classes", [])),
        permitted_specialist_reads=tuple(payload.get("permitted_specialist_reads", [])),
        prohibited_actions=tuple(payload.get("prohibited_actions", [])),
        authority_ceiling=str(payload["authority_ceiling"]),
        max_sensitivity=str(payload.get("max_sensitivity", "confidential")),
        effective_from=_parse_timestamp(payload.get("effective_from")),
        expires_at=_parse_timestamp(payload.get("expires_at")),
        disclosure_policy_id=str(payload.get("disclosure_policy_id", "default")),
    )


def execute_capital_outcome(body: dict[str, Any]) -> dict[str, Any]:
    """Body: {"request": OutcomeExecutionRequest, "mandate": <server-loaded
    mandate content>}. Fails closed on malformed payloads."""
    request_payload = body.get("request")
    mandate_payload = body.get("mandate")
    if not isinstance(request_payload, dict) or not isinstance(mandate_payload, dict):
        return {"service_version": SERVICE_VERSION, "error": {"code": "outcome.malformed_payload", "message": "body requires 'request' and 'mandate' objects"}}
    try:
        mandate = _mandate_from_payload(mandate_payload)
    except (KeyError, ValueError, TypeError) as exc:
        return {"service_version": SERVICE_VERSION, "error": {"code": "outcome.malformed_mandate", "message": f"mandate payload invalid: {exc}"}}

    def loader(mandate_id: str, version: int) -> Mandate | None:
        if mandate.mandate_id == mandate_id and mandate.version == version:
            return mandate
        return None

    try:
        result = execute_outcome(
            request_payload,
            definitions=_OUTCOMES,
            workbench=_WORKBENCH,
            mandate_loader=loader,
            agent_definition=CAPITAL_AGENT_DEFINITION,
            model_port=None,
        )
    except ValidationError as exc:
        return {"service_version": SERVICE_VERSION, "error": {"code": "outcome.invalid_request", "message": str(exc.errors()[:5])}}
    except FrameworkViolation as exc:
        return {"service_version": SERVICE_VERSION, "error": {"code": exc.code, "message": exc.message}}
    return {"service_version": SERVICE_VERSION, "result": result.model_dump()}
