from __future__ import annotations

from contextlib import asynccontextmanager
import json
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .core import (
    SERVICE_VERSION,
    analyze_document_intelligence,
    build_replay_log,
    detect_missing_proof,
    run_eval,
    scope_agent_task,
    stream_copilot_events,
    structure_copilot_request,
)
from .eval_harness import list_eval_suites, run_eval_suite
from .security import service_auth_required, service_request_authorized, validate_service_auth_configuration


@asynccontextmanager
async def lifespan(_: FastAPI) -> Any:
    validate_service_auth_configuration()
    print(
        json.dumps(
            {
                "level": "info",
                "msg": "Trade Brain startup complete",
                "service": "trade-brain",
                "version": SERVICE_VERSION,
                "service_auth_required": service_auth_required(),
            }
        ),
        flush=True,
    )
    yield


app = FastAPI(
    title="TRAIBOX Trade Brain",
    version=SERVICE_VERSION,
    description="AI-native service boundary for Copilot structure, governed agent scope, eval logging, and replay previews.",
    lifespan=lifespan,
)


@app.middleware("http")
async def require_service_auth(request: Request, call_next: Any) -> Any:
    if request.url.path.startswith("/v1/") and not service_request_authorized(request.headers.get("authorization")):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized service request"})
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str | bool]:
    return {
        "status": "ok",
        "service": "trade-brain",
        "version": SERVICE_VERSION,
        "service_auth_required": service_auth_required(),
    }


@app.post("/v1/copilot/structure")
def copilot_structure(body: dict[str, Any]) -> dict[str, Any]:
    return structure_copilot_request(body)


@app.post("/v1/copilot/stream")
def copilot_stream(body: dict[str, Any]) -> StreamingResponse:
    def event_source() -> Any:
        for event in stream_copilot_events(body):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/v1/agents/scope")
def agent_scope(body: dict[str, Any]) -> dict[str, Any]:
    return scope_agent_task(body)


@app.post("/v1/evals/run")
def eval_run(body: dict[str, Any]) -> dict[str, Any]:
    return run_eval(body)


@app.post("/v1/documents/intelligence")
def document_intelligence(body: dict[str, Any]) -> dict[str, Any]:
    return analyze_document_intelligence(body)


@app.post("/v1/proofs/missing")
def missing_proof(body: dict[str, Any]) -> dict[str, Any]:
    return detect_missing_proof(body)


@app.get("/v1/evals/suites")
def eval_suites() -> dict[str, Any]:
    return {"service_version": SERVICE_VERSION, "suites": list_eval_suites()}


@app.post("/v1/evals/suites/run")
def eval_suite_run(body: dict[str, Any]) -> dict[str, Any]:
    suite_id = body.get("suite_id") if isinstance(body.get("suite_id"), str) else "all"
    return run_eval_suite(suite_id)


@app.post("/v1/replay/build")
def replay_build(body: dict[str, Any]) -> dict[str, Any]:
    return {"service_version": SERVICE_VERSION, "replay_log": build_replay_log(body)}


@app.post("/v1/capital/outcomes/execute")
def capital_outcome_execute(body: dict[str, Any]) -> dict[str, Any]:
    """Governed Capital outcome execution (Phase 4 §D8). The authenticated
    API supplies the resolved request + server-loaded mandate; the Brain
    executes and returns the typed result. No database access, no canonical
    state, no protected-action execution."""
    from .outcomes.service import execute_capital_outcome

    return execute_capital_outcome(body)
