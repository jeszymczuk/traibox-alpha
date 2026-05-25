from __future__ import annotations

from typing import Any

from fastapi import FastAPI

from .core import (
    SERVICE_VERSION,
    analyze_document_intelligence,
    build_replay_log,
    detect_missing_proof,
    run_eval,
    scope_agent_task,
    structure_copilot_request,
)
from .eval_harness import list_eval_suites, run_eval_suite


app = FastAPI(
    title="TRAIBOX Trade Brain",
    version=SERVICE_VERSION,
    description="AI-native service boundary for Copilot structure, governed agent scope, eval logging, and replay previews.",
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "trade-brain", "version": SERVICE_VERSION}


@app.post("/v1/copilot/structure")
def copilot_structure(body: dict[str, Any]) -> dict[str, Any]:
    return structure_copilot_request(body)


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
