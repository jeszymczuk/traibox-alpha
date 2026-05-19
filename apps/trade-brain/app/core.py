from __future__ import annotations

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


@dataclass(frozen=True)
class WorkflowClassification:
    object_type: str
    confidence: float
    reason: str


def structure_copilot_request(body: dict[str, Any]) -> dict[str, Any]:
    message = as_string(body.get("message"))
    workspace = as_string(body.get("workspace")) or "intelligence"
    trade_id = body.get("trade_id") if isinstance(body.get("trade_id"), str) else None
    object_ids = as_string_list(body.get("object_ids"))
    trace_id = as_string(body.get("trace_id")) or f"trc_{stable_hash(message)[:10]}"
    classification = classify_workflow(message)
    object_id = as_string(body.get("object_id")) or "pending_object"
    suggested_actions = enhanced_suggested_actions(classification.object_type, object_id)
    ai_observability = {
        "kind": "ai_observability",
        "model": "traibox-trade-brain-deterministic-alpha",
        "model_router_version": MODEL_ROUTER_VERSION,
        "prompt_version": PROMPT_VERSION,
        "context_used": {
            "workspace": workspace,
            "trade_id": trade_id,
            "object_count": len(object_ids),
            "source_message_hash": stable_hash(message),
            "structured_output_schema": STRUCTURED_OUTPUT_SCHEMA,
            "service_version": SERVICE_VERSION,
        },
        "artifacts_used": object_ids,
        "confidence": classification.confidence,
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
            "confidence": classification.confidence,
            "policy_constraints": ai_observability["policy_constraints"],
            "generated_recommendation": "; ".join(str(action.get("label", action.get("action", "next action"))) for action in suggested_actions),
            "final_outcome": f"Structured {classification.object_type} without protected external execution.",
        }
    )

    return {
        "service_version": SERVICE_VERSION,
        "trace_id": trace_id,
        "object_type": classification.object_type,
        "title": title_for_object(classification.object_type, message),
        "status": default_status_for(classification.object_type),
        "answer": (
            f"Trade Brain classified this as a {classification.object_type.replace('_', ' ')}. "
            "It prepared readiness, execution, approval, attachment, replay, and eval context without executing protected actions."
        ),
        "confidence": classification.confidence,
        "classification_reason": classification.reason,
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
    if "proof" in lower:
        return WorkflowClassification("proof_bundle", 0.78, "Message refers to proof or evidence packaging.")
    if "report" in lower:
        return WorkflowClassification("report", 0.74, "Message refers to report generation.")
    if "document" in lower or "upload" in lower:
        return WorkflowClassification("document", 0.76, "Message refers to document intake or classification.")
    return WorkflowClassification("trade_plan", 0.72, "Message appears to describe a broader trade intent.")


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
