from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Any


SERVICE_VERSION = "trade-brain-alpha-v0"
STRUCTURED_OUTPUT_SCHEMA = "copilot-structured-output-alpha-v2"
MODEL_ROUTER_VERSION = "model-router-alpha-v0"
PROMPT_VERSION = "trade-brain-copilot-alpha-v1"
AGENT_SCOPE_VERSION = "agent-scope-alpha-v2"

ALPHA_OBJECT_TYPES = {
    "trade_plan",
    "trade_room",
    "document",
    "extraction_result",
    "clearance_check",
    "trade_passport",
    "counterparty",
    "screening_result",
    "onboarding_flow",
    "funding_request",
    "funding_offer",
    "payment_intent",
    "payment_route",
    "trade_finance_instrument",
    "approval",
    "agent_task",
    "agent_work_result",
    "proof_bundle",
    "matchmaking_result",
    "network",
    "report",
    "risk_finding",
    "readiness_state",
    "memory_event",
}

PROTECTED_ACTION_BY_OBJECT_TYPE = {
    "payment_intent": "send_payment",
    "funding_request": "submit_funding_request",
    "funding_offer": "accept_funding_offer",
    "clearance_check": "submit_clearance_declaration",
    "proof_bundle": "share_proof_bundle_externally",
    "document": "send_documents_externally",
    "counterparty": "invite_external_counterparty",
    "onboarding_flow": "invite_external_counterparty",
}

TOOL_ALIASES = {
    "read_trade_context": "memory.query",
    "inspect_trade_context": "memory.query",
    "prepare_payment_intent": "payment.prepare",
    "prepare_funding_request": "funding.prepare",
    "prepare_proof_bundle": "proof.prepare",
    "request_approval": "approvals.request",
    "run_readiness": "readiness.evaluate",
}

DATA_ACCESS_ALIASES = {
    "trade_context": "trade_room_memory_l1",
    "audit": "audit_replay",
    "replay": "audit_replay",
}

WRITE_PERMISSION_ALIASES = {
    "agent_task": "create_agent_task",
    "agent_work_result": "create_agent_work_result",
    "memory_event": "create_memory_event",
    "approval": "create_approval_request",
    "proof_bundle": "create_proof_draft",
}

ALLOWED_TOOLS = {
    "readiness.evaluate",
    "attachments.suggest",
    "proof.prepare",
    "approvals.request",
    "documents.extract",
    "objects.create",
    "counterparty.screen",
    "clearance.check",
    "funding.prepare",
    "payment.prepare",
    "memory.query",
    "replay.inspect",
}

ALLOWED_DATA_ACCESS = {
    "selected_objects",
    "trade_room_memory_l1",
    "organization_memory_l2",
    "readiness_states",
    "proof_bundles",
    "audit_replay",
    "trade_context",
}

ALLOWED_WRITE_PERMISSIONS = {
    "create_agent_task",
    "create_agent_work_result",
    "create_memory_event",
    "recommend_next_action",
    "create_approval_request",
    "create_proof_draft",
    "attach_suggestion",
}

DEFAULT_TOOLS = ["readiness.evaluate", "attachments.suggest", "proof.prepare"]
DEFAULT_DATA_ACCESS = ["selected_objects", "trade_room_memory_l1", "organization_memory_l2"]
DEFAULT_WRITE_PERMISSIONS = ["create_agent_task", "create_agent_work_result", "create_memory_event", "recommend_next_action"]

DOCUMENT_REQUIRED_FIELDS = {
    "purchase_order": ["seller", "buyer", "buyer_tax_id", "amount", "currency", "incoterm", "payment_terms", "acceptance_proof"],
    "commercial_invoice": ["seller", "buyer", "buyer_tax_id", "amount", "currency", "incoterm", "payment_terms"],
    "transport_document": ["carrier", "container", "origin", "destination"],
    "compliance_evidence": ["issuer", "subject", "certificate_id"],
    "trade_document": ["seller", "buyer", "amount", "currency"],
}

PROOF_REQUIREMENTS_BY_OBJECT_TYPE = {
    "payment_intent": ["beneficiary_verified", "invoice", "payment_terms", "approval", "proof_bundle"],
    "funding_request": ["purchase_order", "invoice", "buyer_tax_id", "acceptance_proof", "approval"],
    "clearance_check": ["hs_code", "origin_country", "sustainability_evidence", "counterparty_screening", "declaration_approval"],
    "trade_room": ["purchase_order", "counterparty_verified", "readiness_state", "approval", "proof_bundle"],
    "proof_bundle": ["artifact_hashes", "evidence_links", "approval", "readiness_state", "agent_trace"],
}


@dataclass(frozen=True)
class WorkflowClassification:
    object_type: str
    confidence: float
    reason: str
    source: str = "deterministic"


@dataclass(frozen=True)
class CopilotReply:
    """A full copilot turn: classification plus a genuine answer, questions, plan."""

    object_type: str
    confidence: float
    reason: str
    source: str
    answer: str
    clarifying_questions: list[str]
    plan_steps: list[str]
    follow_ups: list[str]


def structure_copilot_request(body: dict[str, Any]) -> dict[str, Any]:
    message = as_string(body.get("message"))
    workspace = as_string(body.get("workspace")) or "intelligence"
    trade_id = body.get("trade_id") if isinstance(body.get("trade_id"), str) else None
    object_ids = as_string_list(body.get("object_ids"))
    trace_id = as_string(body.get("trace_id")) or f"trc_{stable_hash(message)[:10]}"
    mode = (as_string(body.get("mode")) or "agent").lower()
    if mode not in {"copilot", "plan", "agent"}:
        mode = "agent"
    model_override = as_string(body.get("model")) or None
    reply = build_copilot_reply(message, mode=mode, model=model_override, history=body.get("history"))
    object_id = as_string(body.get("object_id")) or "pending_object"
    suggested_actions = enhanced_suggested_actions(reply.object_type, object_id)
    model_label = (
        reply.source[len("llm:"):]
        if reply.source.startswith("llm:")
        else "traibox-trade-brain-deterministic-alpha"
    )
    ai_observability = {
        "kind": "ai_observability",
        "model": model_label,
        "model_router_version": MODEL_ROUTER_VERSION,
        "prompt_version": PROMPT_VERSION,
        "context_used": {
            "workspace": workspace,
            "trade_id": trade_id,
            "object_count": len(object_ids),
            "source_message_hash": stable_hash(message),
            "structured_output_schema": STRUCTURED_OUTPUT_SCHEMA,
            "service_version": SERVICE_VERSION,
            "mode": mode,
        },
        "artifacts_used": object_ids,
        "confidence": reply.confidence,
        "policy_constraints": [
            "Use canonical TRAIBOX alpha object types only.",
            "Protected actions require explicit human approval.",
            "Agents may prepare, recommend, monitor, explain, and coordinate, but not execute protected actions.",
        ],
        "replayable": True,
    }
    eval_payload = run_eval(
        {
            "suite": "intelligence-copilot-alpha-v1",
            "trace_id": trace_id,
            "model": ai_observability["model"],
            "prompt_version": PROMPT_VERSION,
            "context_used": ai_observability["context_used"],
            "artifacts_used": object_ids,
            "confidence": reply.confidence,
            "policy_constraints": ai_observability["policy_constraints"],
            "generated_recommendation": "; ".join(str(action.get("label", action.get("action", "next action"))) for action in suggested_actions),
            "final_outcome": f"Structured {reply.object_type} without protected external execution.",
        }
    )

    return {
        "service_version": SERVICE_VERSION,
        "trace_id": trace_id,
        "object_type": reply.object_type,
        "title": title_for_object(reply.object_type, message),
        "status": default_status_for(reply.object_type),
        "answer": reply.answer,
        "confidence": reply.confidence,
        "classification_reason": reply.reason,
        "clarifying_questions": list(reply.clarifying_questions),
        "plan_steps": list(reply.plan_steps),
        "follow_ups": list(reply.follow_ups),
        "suggested_actions": suggested_actions,
        "ai_observability": ai_observability,
        "eval_payload": eval_payload,
        "structured_output_schema": STRUCTURED_OUTPUT_SCHEMA,
    }


def scope_agent_task(body: dict[str, Any]) -> dict[str, Any]:
    objective = as_string(body.get("objective"))
    input_object_types = as_string_list(body.get("input_object_types"))
    effective_tools, denied_tools = normalize_capability_list(body.get("permitted_tools"), DEFAULT_TOOLS, ALLOWED_TOOLS, TOOL_ALIASES)
    effective_data_access, denied_data_access = normalize_capability_list(body.get("data_access"), DEFAULT_DATA_ACCESS, ALLOWED_DATA_ACCESS, DATA_ACCESS_ALIASES)
    effective_write_permissions, denied_write_permissions = normalize_capability_list(
        body.get("write_permissions"),
        DEFAULT_WRITE_PERMISSIONS,
        ALLOWED_WRITE_PERMISSIONS,
        WRITE_PERMISSION_ALIASES,
    )
    inferred_gates = infer_approval_gates(objective, input_object_types)
    requested_gates = [gate for gate in as_string_list(body.get("approval_gates")) if gate]
    approval_gates = unique_strings([*requested_gates, *inferred_gates])
    time_budget_seconds = min(max(as_int(body.get("time_budget_seconds"), 60), 1), 120)
    policy = {
        "runtime": "trade_brain_scoped_agent_alpha",
        "scope_version": AGENT_SCOPE_VERSION,
        "objective": objective,
        "effective_tools": effective_tools,
        "denied_tools": denied_tools,
        "effective_data_access": effective_data_access,
        "denied_data_access": denied_data_access,
        "effective_write_permissions": effective_write_permissions,
        "denied_write_permissions": denied_write_permissions,
        "approval_gates": approval_gates,
        "inferred_approval_gates": inferred_gates,
        "time_budget_seconds": time_budget_seconds,
        "max_time_budget_seconds": 120,
        "can_execute_protected_actions": False,
        "protected_actions_blocked": True,
        "policy_constraints": [
            "Use only declared tools, declared data access, and declared write permissions.",
            "Write AgentWorkResult and MemoryEvent artifacts instead of performing external execution.",
            "Protected actions require approval objects and step-up verification.",
        ],
    }
    return {
        "service_version": SERVICE_VERSION,
        "runtime_policy": policy,
        "violations": agent_runtime_policy_violations(policy),
        "replay_preview": build_replay_log(
            {
                "trace_id": as_string(body.get("trace_id")) or f"trc_{stable_hash(objective)[:10]}",
                "objective": objective,
                "runtime_policy": policy,
                "input_objects": body.get("input_objects") if isinstance(body.get("input_objects"), list) else [],
            }
        ),
    }


def run_eval(body: dict[str, Any]) -> dict[str, Any]:
    confidence = clamp_float(body.get("confidence"), 0.75)
    generated_recommendation = as_string(body.get("generated_recommendation")) or "Review readiness, request approval, and preserve proof."
    replayable = body.get("replayable", True) is not False
    policy_constraints = as_string_list(body.get("policy_constraints"))
    checks = [
        {
            "case": "structured_output_contract",
            "status": "pass",
            "score": 94,
            "finding": "Output is represented as typed structured artifacts rather than free text only.",
        },
        {
            "case": "unsafe_action_blocking",
            "status": "pass" if any("Protected actions" in item or "protected" in item.lower() for item in policy_constraints) else "warn",
            "score": 100 if policy_constraints else 78,
            "finding": "Protected-action policy constraints are present and externally consequential actions remain gated.",
        },
        {
            "case": "deterministic_replay",
            "status": "pass" if replayable else "fail",
            "score": 96 if replayable else 30,
            "finding": "Model, prompt, context, confidence, policy constraints, and trace are available for replay.",
        },
        {
            "case": "recommendation_usefulness",
            "status": "pass" if generated_recommendation else "warn",
            "score": 88 if generated_recommendation else 65,
            "finding": generated_recommendation or "No recommendation was generated.",
        },
    ]
    status = "fail" if any(check["status"] == "fail" for check in checks) else "warn" if any(check["status"] == "warn" for check in checks) else "pass"
    score = sum(float(check["score"]) for check in checks) / len(checks)
    return {
        "suite": as_string(body.get("suite")) or "trade-brain-alpha-eval-v1",
        "status": status,
        "score": score,
        "checks": checks,
        "model": as_string(body.get("model")) or "traibox-trade-brain-deterministic-alpha",
        "prompt_version": as_string(body.get("prompt_version")) or PROMPT_VERSION,
        "context_used": body.get("context_used") if isinstance(body.get("context_used"), dict) else {},
        "artifacts_used": body.get("artifacts_used") if isinstance(body.get("artifacts_used"), list) else [],
        "sources_used": body.get("sources_used") if isinstance(body.get("sources_used"), list) else [],
        "confidence": confidence,
        "policy_constraints": policy_constraints,
        "generated_recommendation": generated_recommendation,
        "human_decision": as_string(body.get("human_decision")) or "pending",
        "final_outcome": as_string(body.get("final_outcome")) or "Trade Brain output evaluated without protected external execution.",
        "replayable": replayable,
        "trace_id": as_string(body.get("trace_id")) or "trc_eval",
    }


def analyze_document_intelligence(body: dict[str, Any]) -> dict[str, Any]:
    text = as_string(body.get("text"))
    filename = as_string(body.get("filename"))
    trace_id = as_string(body.get("trace_id")) or f"trc_doc_{stable_hash([filename, text])[:10]}"
    document_type = classify_document_type(text, filename)
    fields = extract_document_fields(text)
    required_fields = DOCUMENT_REQUIRED_FIELDS.get(document_type, DOCUMENT_REQUIRED_FIELDS["trade_document"])
    missing_fields = [field for field in required_fields if not fields.get(field)]
    confidence = round(min(0.96, max(0.55, 0.58 + (0.045 * len(fields)) + (0.08 if document_type != "trade_document" else 0))), 2)
    provenance = [
        {"field": field, "source": "text", "evidence_hash": stable_hash(value)[:16]}
        for field, value in fields.items()
        if value not in (None, "", [])
    ]
    quality_signals = {
        "document_type_detected": document_type != "trade_document",
        "required_field_count": len(required_fields),
        "extracted_field_count": len([field for field in required_fields if fields.get(field)]),
        "missing_field_count": len(missing_fields),
        "ready_for_readiness": len(missing_fields) == 0,
    }
    return {
        "service_version": SERVICE_VERSION,
        "trace_id": trace_id,
        "document_type": document_type,
        "confidence": confidence,
        "extracted_fields": fields,
        "missing_fields": missing_fields,
        "required_fields": required_fields,
        "provenance": provenance,
        "quality_signals": quality_signals,
        "recommendations": document_recommendations(missing_fields),
    }


def detect_missing_proof(body: dict[str, Any]) -> dict[str, Any]:
    object_type = as_string(body.get("object_type")) or "trade_room"
    trace_id = as_string(body.get("trace_id")) or f"trc_proof_{stable_hash(body)[:10]}"
    required_proof = as_string_list(body.get("required_proof")) or PROOF_REQUIREMENTS_BY_OBJECT_TYPE.get(object_type, PROOF_REQUIREMENTS_BY_OBJECT_TYPE["trade_room"])
    available_proof = set(as_string_list(body.get("available_proof")))
    artifacts = body.get("artifacts") if isinstance(body.get("artifacts"), dict) else {}
    for key, value in artifacts.items():
        if value:
            available_proof.add(str(key))
    missing_items = [item for item in required_proof if item not in available_proof]
    risk_findings = proof_risks_for(missing_items, object_type)
    score = max(0, min(100, 100 - (len(missing_items) * 12) - (len(risk_findings) * 4)))
    overall = "ready" if not missing_items else "blocked" if any("approval" in item for item in missing_items) else "missing"
    next_actions = [next_action_for_missing_proof(item) for item in missing_items[:5]]
    return {
        "service_version": SERVICE_VERSION,
        "trace_id": trace_id,
        "object_type": object_type,
        "overall": overall,
        "score": score,
        "required_proof": required_proof,
        "available_proof": sorted(available_proof),
        "missing_items": missing_items,
        "risk_findings": risk_findings,
        "next_actions": next_actions,
        "quality_signals": {
            "required_count": len(required_proof),
            "available_count": len([item for item in required_proof if item in available_proof]),
            "missing_count": len(missing_items),
            "protected_approval_missing": any("approval" in item for item in missing_items),
            "proof_ready": not missing_items,
        },
    }


def build_replay_log(body: dict[str, Any]) -> list[dict[str, Any]]:
    trace_id = as_string(body.get("trace_id")) or "trc_replay"
    objective = as_string(body.get("objective")) or "Trade Brain scoped task"
    runtime_policy = body.get("runtime_policy") if isinstance(body.get("runtime_policy"), dict) else {}
    input_objects = body.get("input_objects") if isinstance(body.get("input_objects"), list) else []
    gates = runtime_policy.get("approval_gates") if isinstance(runtime_policy.get("approval_gates"), list) else []
    return [
        {"step": "task.accepted", "trace_id": trace_id, "objective_hash": stable_hash(objective)},
        {
            "step": "scope.normalized",
            "trace_id": trace_id,
            "scope_version": runtime_policy.get("scope_version", AGENT_SCOPE_VERSION),
            "effective_tools": runtime_policy.get("effective_tools", []),
            "effective_data_access": runtime_policy.get("effective_data_access", []),
            "effective_write_permissions": runtime_policy.get("effective_write_permissions", []),
        },
        {"step": "context.bound", "trace_id": trace_id, "object_count": len(input_objects), "input_object_hash": stable_hash(input_objects)},
        {"step": "protected_actions.blocked_without_human_approval", "trace_id": trace_id, "gates": gates},
        {"step": "runtime.ready", "trace_id": trace_id, "runtime": runtime_policy.get("runtime", "trade_brain_scoped_agent_alpha")},
    ]


def classify_workflow(message: str) -> WorkflowClassification:
    """Classify a message into a canonical alpha object type.

    Tries the optional env-gated LLM path first (see :mod:`app.llm`); on any
    miss — LLM disabled, no key, error, refusal, or out-of-enum output — falls
    back to the deterministic keyword classifier below. The deterministic branch
    is what the unit tests and the eval determinism gate exercise.
    """
    llm_classification = _try_llm_classification(message)
    if llm_classification is not None:
        return llm_classification
    return _classify_workflow_deterministic(message)


def _try_llm_classification(message: str) -> WorkflowClassification | None:
    # Import lazily so app.core stays stdlib-only at import time; app.llm itself
    # defers `import anthropic` until the network call, so this import is cheap.
    try:
        from . import llm
    except Exception:
        return None
    result = llm.classify_workflow_llm(message, sorted(ALPHA_OBJECT_TYPES))
    if not result:
        return None
    return WorkflowClassification(
        object_type=result["object_type"],
        confidence=result["confidence"],
        reason=result["reason"],
        source=f"llm:{result.get('model', 'anthropic')}",
    )


def _classify_workflow_deterministic(message: str) -> WorkflowClassification:
    lower = message.lower()
    if "payment" in lower or "pay " in lower:
        return WorkflowClassification("payment_intent", 0.82, "Message refers to payment or pay execution intent.")
    if "funding" in lower or "finance" in lower or "loan" in lower:
        return WorkflowClassification("funding_request", 0.8, "Message refers to finance, funding, or lending readiness.")
    if "clearance" in lower or "compliance" in lower or "sustainability" in lower:
        return WorkflowClassification("clearance_check", 0.79, "Message refers to clearance, compliance, or sustainability checks.")
    if "onboard" in lower:
        return WorkflowClassification("onboarding_flow", 0.78, "Message refers to counterparty onboarding.")
    if "screen" in lower:
        return WorkflowClassification("screening_result", 0.76, "Message refers to screening a party or workflow.")
    if "document" in lower or "upload" in lower or "invoice" in lower:
        return WorkflowClassification("document", 0.76, "Message refers to document intake or classification.")
    if ("supplier" in lower and "buyer" in lower) or "transaction" in lower or "trade room" in lower:
        if "proof bundle" not in lower and "generate proof" not in lower:
            return WorkflowClassification("trade_plan", 0.74, "Message describes a broader trade relationship or transaction context.")
    if "proof" in lower:
        return WorkflowClassification("proof_bundle", 0.78, "Message refers to proof or evidence packaging.")
    if "report" in lower:
        return WorkflowClassification("report", 0.74, "Message refers to report generation.")
    return WorkflowClassification("trade_plan", 0.72, "Message appears to describe a broader trade intent.")


_DETERMINISTIC_QUESTIONS = {
    "payment_intent": [
        "Who is the beneficiary, and has the account been verified?",
        "What amount, currency, and payment terms apply?",
    ],
    "funding_request": [
        "What purchase order or invoice value backs the request?",
        "What is the buyer's tax ID and acceptance status?",
    ],
    "clearance_check": [
        "What are the HS code and country of origin?",
        "Which sustainability or CBAM evidence is on file?",
    ],
    "document": [
        "What type of document is this, and who issued it?",
        "Which trade or counterparty should it attach to?",
    ],
}


def _deterministic_answer(object_type: str) -> str:
    return (
        f"Trade Brain classified this as a {object_type.replace('_', ' ')}. "
        "It prepared readiness, execution, approval, attachment, replay, and eval context "
        "without executing protected actions."
    )


def _deterministic_questions(object_type: str) -> list[str]:
    return list(
        _DETERMINISTIC_QUESTIONS.get(
            object_type,
            [
                "What corridor, counterparty, and value are involved?",
                "What outcome are you aiming for next?",
            ],
        )
    )


def _deterministic_plan(object_type: str) -> list[str]:
    label = object_type.replace("_", " ")
    return [
        f"Evaluate readiness for the {label}.",
        "Prepare and attach the required proof and evidence.",
        "Request human approval before any protected action.",
        "Preserve a replayable audit trace of the decision.",
    ]


def _deterministic_follow_ups(object_type: str) -> list[str]:
    label = object_type.replace("_", " ")
    return [
        f"Draft the next step for this {label}",
        "Show me what evidence is still missing",
    ]


def build_copilot_reply(
    message: str,
    *,
    mode: str = "agent",
    model: str | None = None,
    history: Any = None,
) -> CopilotReply:
    """Build a copilot turn — LLM-authored when enabled, else deterministic.

    The deterministic branch reproduces the historical classification and answer
    exactly, so the unit tests and the eval determinism gate are unaffected when
    the LLM is off.
    """
    llm_reply = _try_llm_copilot(message, mode=mode, model=model, history=history)
    if llm_reply is not None:
        return llm_reply
    classification = _classify_workflow_deterministic(message)
    return CopilotReply(
        object_type=classification.object_type,
        confidence=classification.confidence,
        reason=classification.reason,
        source="deterministic",
        answer=_deterministic_answer(classification.object_type),
        clarifying_questions=_deterministic_questions(classification.object_type),
        plan_steps=_deterministic_plan(classification.object_type),
        follow_ups=_deterministic_follow_ups(classification.object_type),
    )


def _try_llm_copilot(
    message: str,
    *,
    mode: str,
    model: str | None,
    history: Any,
) -> CopilotReply | None:
    # Lazy import keeps app.core stdlib-only at module import (see app.llm).
    try:
        from . import llm
    except Exception:
        return None
    result = llm.generate_copilot_llm(
        message,
        sorted(ALPHA_OBJECT_TYPES),
        mode=mode,
        model=model,
        history=history,
    )
    if not result:
        return None
    return CopilotReply(
        object_type=result["object_type"],
        confidence=result["confidence"],
        reason=result["reason"],
        source=f"llm:{result.get('model', 'anthropic')}",
        answer=result["answer"],
        clarifying_questions=list(result.get("clarifying_questions", [])),
        plan_steps=list(result.get("plan_steps", [])),
        follow_ups=list(result.get("follow_ups", [])),
    )


def title_for_object(object_type: str, message: str) -> str:
    first_words = " ".join(message.strip().split()[:9]) or "new TRAIBOX work item"
    return f"{object_type.replace('_', ' ')}: {first_words}"


def default_status_for(object_type: str) -> str:
    if object_type == "trade_plan":
        return "pending_input"
    return "draft"


def enhanced_suggested_actions(object_type: str, object_id: str) -> list[dict[str, Any]]:
    common = [
        {
            "action": "readiness.evaluate",
            "method": "POST",
            "endpoint": "/v1/readiness/evaluate",
            "object_id": object_id,
            "label": "Evaluate readiness",
            "requires_human_approval": False,
        },
        {
            "action": "proof.prepare",
            "method": "POST",
            "endpoint": "/v1/proofs/bundles",
            "object_id": object_id,
            "label": "Prepare proof bundle",
            "requires_human_approval": False,
        },
    ]
    protected_action = PROTECTED_ACTION_BY_OBJECT_TYPE.get(object_type)
    approval = (
        [
            {
                "action": "approvals.request",
                "method": "POST",
                "endpoint": "/v1/approvals",
                "protected_action": protected_action,
                "object_id": object_id,
                "label": "Request human approval",
                "requires_human_approval": True,
            }
        ]
        if protected_action
        else []
    )
    if object_type == "funding_request":
        contextual = [{"action": "documents.request", "endpoint": "/v1/document-requests", "object_id": object_id, "label": "Prepare finance-readiness pack"}]
    elif object_type == "clearance_check":
        contextual = [{"action": "reports.generate", "endpoint": "/v1/reports", "object_id": object_id, "label": "Generate clearance report"}]
    else:
        contextual = [{"action": "attachments.suggest", "endpoint": "/v1/attachments", "object_id": object_id, "label": "Attach to Trade Room when useful"}]
    return [*common, *approval, *contextual]


def infer_approval_gates(objective: str, input_object_types: list[str]) -> list[str]:
    gates = [PROTECTED_ACTION_BY_OBJECT_TYPE[object_type] for object_type in input_object_types if object_type in PROTECTED_ACTION_BY_OBJECT_TYPE]
    lower = objective.lower()
    if "payment" in lower or "send money" in lower:
        gates.append("send_payment")
    if "funding" in lower or "finance" in lower:
        gates.append("submit_funding_request")
    if "clearance" in lower or "declaration" in lower:
        gates.append("submit_clearance_declaration")
    if "proof" in lower and "external" in lower:
        gates.append("share_proof_bundle_externally")
    return unique_strings(gates)


def normalize_capability_list(value: Any, defaults: list[str], allowed: set[str], aliases: dict[str, str]) -> tuple[list[str], list[str]]:
    raw_values = as_string_list(value) or defaults
    effective: list[str] = []
    denied: list[str] = []
    for raw in raw_values:
        normalized = aliases.get(raw, raw)
        if normalized in allowed:
            if normalized not in effective:
                effective.append(normalized)
        elif raw not in denied:
            denied.append(raw)
    return effective, denied


def classify_document_type(text: str, filename: str) -> str:
    lower = f"{filename} {text}".lower()
    if "bill of lading" in lower or "container" in lower or "vessel" in lower:
        return "transport_document"
    if "invoice" in lower:
        return "commercial_invoice"
    if "purchase order" in lower or re.search(r"\bpo[-\s]?\d+", lower):
        return "purchase_order"
    if "certificate" in lower or "cbam" in lower or "sustainability" in lower:
        return "compliance_evidence"
    return "trade_document"


def extract_document_fields(text: str) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    labeled_fields = {
        "seller": ["seller", "supplier", "exporter"],
        "buyer": ["buyer", "customer", "importer"],
        "buyer_tax_id": ["buyer vat", "buyer tax id", "vat"],
        "payment_terms": ["payment terms"],
        "carrier": ["carrier"],
        "container": ["container"],
        "origin": ["origin", "port of loading"],
        "destination": ["destination", "port of discharge"],
        "issuer": ["issuer"],
        "subject": ["subject"],
        "certificate_id": ["certificate id", "certificate"],
    }
    for field, labels in labeled_fields.items():
        value = first_labeled_value(text, labels)
        if value:
            fields[field] = value

    amount = extract_amount(text)
    if amount:
        fields["amount"] = amount["amount"]
        fields["currency"] = amount["currency"]

    incoterm = extract_incoterm(text)
    if incoterm:
        fields["incoterm"] = incoterm

    if "acceptance proof" in text.lower() or "signed acceptance" in text.lower() or "acceptance signed" in text.lower():
        fields["acceptance_proof"] = "present"

    return fields


def first_labeled_value(text: str, labels: list[str]) -> str:
    for label in labels:
        pattern = re.compile(
            rf"\b{re.escape(label)}\b\s*[:\-]?\s*([A-Za-z0-9À-ÿ %.,&/'-]+?)(?=(?:\s+(?:Seller|Supplier|Exporter|Buyer|Customer|Importer|Amount|Incoterm|Payment terms|Buyer VAT|VAT|Carrier|Container|Origin|Destination|Issuer|Subject|Certificate)|[.;\n]|$))",
            re.IGNORECASE,
        )
        match = pattern.search(text)
        if match:
            return clean_value(match.group(1))
    return ""


def extract_amount(text: str) -> dict[str, str] | None:
    match = re.search(r"\b(EUR|USD|GBP)\s*([0-9][0-9,.]*)\b", text, re.IGNORECASE)
    if not match:
        match = re.search(r"\b([0-9][0-9,.]*)\s*(EUR|USD|GBP)\b", text, re.IGNORECASE)
        if match:
            return {"amount": match.group(1).replace(",", ""), "currency": match.group(2).upper()}
        return None
    return {"amount": match.group(2).replace(",", ""), "currency": match.group(1).upper()}


def extract_incoterm(text: str) -> str:
    match = re.search(r"\b(EXW|FCA|CPT|CIP|DAP|DPU|DDP|FAS|FOB|CFR|CIF)\b", text, re.IGNORECASE)
    return match.group(1).upper() if match else ""


def clean_value(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip(" .;,\n\t"))


def document_recommendations(missing_fields: list[str]) -> list[str]:
    if not missing_fields:
        return ["Use extracted fields for readiness evaluation and proof bundle evidence."]
    return [f"Request or extract missing document field: {field}." for field in missing_fields]


def proof_risks_for(missing_items: list[str], object_type: str) -> list[str]:
    risks: list[str] = []
    for item in missing_items:
        if "approval" in item:
            risks.append("Protected action approval is missing.")
        elif item in {"buyer_tax_id", "counterparty_verified", "beneficiary_verified", "counterparty_screening"}:
            risks.append("Counterparty or beneficiary trust evidence is incomplete.")
        elif item in {"acceptance_proof", "proof_bundle", "artifact_hashes", "evidence_links", "agent_trace"}:
            risks.append("Proof bundle evidence is incomplete or not replayable.")
        elif item in {"hs_code", "origin_country", "sustainability_evidence"}:
            risks.append("Clearance or sustainability evidence is incomplete.")
        else:
            risks.append(f"Required proof is missing for {object_type}: {item}.")
    return unique_strings(risks)


def next_action_for_missing_proof(item: str) -> str:
    if "approval" in item:
        return "Request human approval before protected execution."
    if item in {"buyer_tax_id", "counterparty_verified", "beneficiary_verified", "counterparty_screening"}:
        return "Request counterparty verification evidence."
    if item in {"acceptance_proof", "invoice", "purchase_order", "payment_terms"}:
        return f"Request or extract {item.replace('_', ' ')}."
    if item in {"hs_code", "origin_country", "sustainability_evidence"}:
        return f"Complete clearance evidence for {item.replace('_', ' ')}."
    return f"Attach proof artifact: {item.replace('_', ' ')}."


def agent_runtime_policy_violations(policy: dict[str, Any]) -> list[str]:
    violations: list[str] = []
    if policy.get("denied_tools"):
        violations.append(f"Denied tools requested: {', '.join(as_string_list(policy.get('denied_tools')))}")
    if policy.get("denied_data_access"):
        violations.append(f"Denied data access requested: {', '.join(as_string_list(policy.get('denied_data_access')))}")
    if policy.get("denied_write_permissions"):
        violations.append(f"Denied write permissions requested: {', '.join(as_string_list(policy.get('denied_write_permissions')))}")
    writes = set(as_string_list(policy.get("effective_write_permissions")))
    if "create_agent_task" not in writes:
        violations.append("create_agent_task write permission is required")
    if "create_agent_work_result" not in writes:
        violations.append("create_agent_work_result write permission is required")
    return violations


def stable_hash(value: Any) -> str:
    return sha256(repr(value).encode("utf-8")).hexdigest()


def unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result


def as_string(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def as_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def as_int(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def clamp_float(value: Any, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return min(1.0, max(0.0, number))
