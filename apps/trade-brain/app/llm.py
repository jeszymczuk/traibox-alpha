"""Optional Anthropic-backed enrichment for the Trade Brain.

This module is the *only* place the ``anthropic`` SDK is imported, and it is
imported lazily inside the functions below — never at module load. That keeps
``app.core`` (and therefore the unit tests and the deterministic eval gate)
stdlib-only at import time, and it means a missing dependency, missing key,
network failure, safety refusal, or malformed model output all degrade
silently to the deterministic path rather than hard-failing the brain.

Two independent switches must BOTH be on for the LLM path to engage:

  * ``TRADE_BRAIN_LLM_ENABLED`` — operator opt-in. Default off so CI and the
    determinism gate always exercise the deterministic branch.
  * ``ANTHROPIC_API_KEY`` — the user's key, supplied via ``.env`` (never chat).

Tunables (all optional, sensible defaults):

  * ``TRADE_BRAIN_LLM_MODEL``      (default ``claude-opus-4-8``)
  * ``TRADE_BRAIN_LLM_MAX_TOKENS`` (default ``1024``)
  * ``TRADE_BRAIN_LLM_EFFORT``     (unset → model default; else low|medium|high|xhigh|max)

Two capabilities are exposed:

  * :func:`classify_workflow_llm` — intent classification only (object_type).
  * :func:`generate_copilot_llm`  — a full copilot reply: classification PLUS a
    genuine conversational answer, clarifying questions, and plan steps, shaped
    by the requested ``mode`` (copilot | plan | agent) and optional chat history.
"""

from __future__ import annotations

import json
import os
from typing import Any

DEFAULT_MODEL = "claude-opus-4-8"
_TRUTHY = {"1", "true", "yes", "on"}
_VALID_EFFORT = {"low", "medium", "high", "xhigh", "max"}
_MAX_HISTORY = 12  # cap prior turns fed back to the model to bound tokens

CLASSIFY_SYSTEM_PROMPT = (
    "You are the TRAIBOX Trade Brain intent classifier for cross-border trade. "
    "Classify a trader's natural-language message into exactly one canonical TRAIBOX "
    "alpha object type — the single type that best represents the primary workflow the "
    "message is asking for. Be decisive. Return a calibrated confidence in [0,1] and a "
    "one-sentence reason grounded in the message. Never invent object types outside the "
    "provided enum; if the message is broad or ambiguous, choose 'trade_plan'."
)

_COPILOT_ROLE = (
    "You are TRAIBOX's trade-intelligence copilot — an expert cross-border trade "
    "advisor for SMEs (customs, incoterms, trade finance, payments, compliance, "
    "logistics). You are embedded in a governed workspace: you can recommend, draft, "
    "explain, and structure work, but you NEVER execute protected actions (moving money, "
    "submitting filings, sending documents externally) — those always require explicit "
    "human approval. Ground every answer in the specifics of the trader's message; if a "
    "figure or corridor is given, use it. Do not pad with disclaimers."
)

COPILOT_SYSTEM_PROMPT = (
    _COPILOT_ROLE
    + " Respond conversationally and usefully, the way a sharp trade advisor would. "
    "Also classify the primary workflow into one canonical TRAIBOX object type from the "
    "enum. Return: `answer` — a genuine, concrete, helpful reply in plain text (a few "
    "short paragraphs or tight bullet lines; lead with the substance, not a preamble); "
    "`clarifying_questions` — 0 to 4 sharp questions you would actually need answered to "
    "proceed (only real blockers, omit if none); `plan_steps` — 0 to 6 concrete next "
    "steps; a calibrated `confidence` in [0,1]; and a one-sentence `reason` for the "
    "classification. Never invent object types outside the enum; if broad or ambiguous, "
    "use 'trade_plan'."
)

PLAN_SYSTEM_PROMPT = (
    _COPILOT_ROLE
    + " The trader wants a structured, governed plan. Classify the primary workflow into "
    "one canonical TRAIBOX object type from the enum. Return: `answer` — a crisp summary "
    "of how you'll structure this and what happens next, in plain text; `plan_steps` — an "
    "ordered, concrete plan of 3 to 7 steps mapped to real trade workflows (readiness "
    "checks, evidence/proof, approvals, execution), each step a single actionable line; "
    "`clarifying_questions` — only the essential blockers, 0 to 3; a calibrated "
    "`confidence` in [0,1]; and a one-sentence `reason` for the classification. Protected "
    "actions require human approval — plan them, never perform them. Never invent object "
    "types outside the enum; if broad or ambiguous, use 'trade_plan'."
)


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def llm_enabled() -> bool:
    """True only when the operator opted in AND a key is present."""
    return _flag("TRADE_BRAIN_LLM_ENABLED") and bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def _model(override: str | None = None) -> str:
    """Resolve the model: explicit request override → env → default."""
    if isinstance(override, str) and override.strip():
        return override.strip()
    return os.environ.get("TRADE_BRAIN_LLM_MODEL", "").strip() or DEFAULT_MODEL


def _max_tokens(floor: int = 256) -> int:
    try:
        configured = int(os.environ.get("TRADE_BRAIN_LLM_MAX_TOKENS", "1024"))
    except ValueError:
        configured = 1024
    return max(floor, configured)


def _effort() -> str | None:
    effort = os.environ.get("TRADE_BRAIN_LLM_EFFORT", "").strip().lower()
    return effort if effort in _VALID_EFFORT else None


# Models that reject the `effort` parameter (400). Sending effort to these silently
# breaks the LLM path and falls back to deterministic — so we omit it for them.
_NO_EFFORT_MODEL_TAGS = ("haiku", "sonnet-4-5")


def _effort_for(model: str) -> str | None:
    effort = _effort()
    if effort is None:
        return None
    lowered = model.lower()
    if any(tag in lowered for tag in _NO_EFFORT_MODEL_TAGS):
        return None
    return effort


def _sanitize_history(history: Any) -> list[dict[str, str]]:
    """Coerce prior turns into a valid, bounded ``messages`` prefix.

    Keeps only user/assistant turns with non-empty text, drops any leading
    assistant turns (the sequence must start with a user turn), and caps the
    length. Malformed input yields an empty prefix.
    """
    if not isinstance(history, list):
        return []
    turns: list[dict[str, str]] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        role = item.get("role")
        content = item.get("content")
        if role not in ("user", "assistant") or not isinstance(content, str) or not content.strip():
            continue
        turns.append({"role": role, "content": content.strip()})
    turns = turns[-_MAX_HISTORY:]
    while turns and turns[0]["role"] != "user":
        turns.pop(0)
    return turns


def _structured_call(
    system_prompt: str,
    message: str,
    schema: dict[str, Any],
    model: str,
    *,
    max_tokens: int,
    history: Any = None,
) -> dict[str, Any] | None:
    """Run one constrained structured-output call. Returns parsed JSON or None.

    Never raises: gating, missing key/dep, network error, refusal, or malformed
    output all return None so the caller falls back deterministically.
    """
    if not llm_enabled():
        return None
    text = (message or "").strip()
    if not text:
        return None

    try:
        import anthropic  # lazy — see module docstring

        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment

        output_config: dict[str, Any] = {"format": {"type": "json_schema", "schema": schema}}
        effort = _effort_for(model)
        if effort is not None:
            output_config["effort"] = effort

        messages = [*_sanitize_history(history), {"role": "user", "content": text}]
        response = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
            output_config=output_config,
            messages=messages,
        )

        # Safety classifiers may decline (HTTP 200, stop_reason == "refusal").
        if getattr(response, "stop_reason", None) == "refusal":
            return None

        payload = _first_text_block(response)
        if not payload:
            return None
        data = json.loads(payload)
        return data if isinstance(data, dict) else None
    except Exception:
        # Any failure (missing dep, auth, network, malformed output, SDK drift)
        # must fall back to the deterministic path — never hard-fail.
        return None


def _clamp_confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        confidence = 0.75
    return round(min(1.0, max(0.0, confidence)), 2)


def _string_list(value: Any, *, cap: int) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            out.append(item.strip())
        if len(out) >= cap:
            break
    return out


def _classification_schema(allowed_object_types: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "object_type": {"type": "string", "enum": allowed_object_types},
            "confidence": {"type": "number"},
            "reason": {"type": "string"},
        },
        "required": ["object_type", "confidence", "reason"],
    }


def _copilot_schema(allowed_object_types: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "object_type": {"type": "string", "enum": allowed_object_types},
            "confidence": {"type": "number"},
            "reason": {"type": "string"},
            "answer": {"type": "string"},
            "clarifying_questions": {"type": "array", "items": {"type": "string"}},
            "plan_steps": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["object_type", "confidence", "reason", "answer"],
    }


def classify_workflow_llm(message: str, allowed_object_types: list[str]) -> dict[str, Any] | None:
    """Classify ``message`` via Claude, constrained to ``allowed_object_types``.

    Returns ``{"object_type", "confidence", "reason", "model"}`` on success, or
    ``None`` to fall back to deterministic logic. Never raises.
    """
    model = _model()
    data = _structured_call(
        CLASSIFY_SYSTEM_PROMPT,
        message,
        _classification_schema(allowed_object_types),
        model,
        max_tokens=_max_tokens(),
    )
    if not data:
        return None
    object_type = data.get("object_type")
    if object_type not in allowed_object_types:
        return None
    reason = data.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        reason = f"Trade Brain LLM classified this message as {object_type}."
    return {
        "object_type": object_type,
        "confidence": _clamp_confidence(data.get("confidence")),
        "reason": reason.strip(),
        "model": model,
    }


def generate_copilot_llm(
    message: str,
    allowed_object_types: list[str],
    *,
    mode: str = "agent",
    model: str | None = None,
    history: Any = None,
) -> dict[str, Any] | None:
    """Produce a full copilot reply via one structured-output call.

    Returns ``{"object_type", "confidence", "reason", "answer",
    "clarifying_questions", "plan_steps", "model"}`` on success, else ``None``.
    ``mode`` shapes the system prompt (``copilot`` = conversational; ``plan`` /
    ``agent`` = structured plan). Never raises.
    """
    resolved_model = _model(model)
    system_prompt = COPILOT_SYSTEM_PROMPT if mode == "copilot" else PLAN_SYSTEM_PROMPT
    data = _structured_call(
        system_prompt,
        message,
        _copilot_schema(allowed_object_types),
        resolved_model,
        max_tokens=_max_tokens(floor=1536),
        history=history,
    )
    if not data:
        return None
    object_type = data.get("object_type")
    if object_type not in allowed_object_types:
        return None
    answer = data.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        return None  # a copilot reply without an answer is not useful — fall back
    reason = data.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        reason = f"Trade Brain classified this message as {object_type}."
    return {
        "object_type": object_type,
        "confidence": _clamp_confidence(data.get("confidence")),
        "reason": reason.strip(),
        "answer": answer.strip(),
        "clarifying_questions": _string_list(data.get("clarifying_questions"), cap=4),
        "plan_steps": _string_list(data.get("plan_steps"), cap=7),
        "model": resolved_model,
    }


def _first_text_block(response: Any) -> str | None:
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", None)
            if isinstance(text, str) and text.strip():
                return text
    return None
