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
    "You are TRAIBOX's trade-intelligence copilot: a world-class cross-border trade "
    "expert (customs, incoterms, trade finance, payments, compliance, logistics, "
    "sourcing) advising an SME trader. You deliver value immediately and decisively. "
    "You can recommend, draft, and explain; you never execute protected actions (moving "
    "money, filing declarations, sending documents externally) — those need the trader's "
    "explicit approval, which you mention only when it is actually relevant."
)

_DELIVERY_RULES = (
    "\n\nDeliver something useful on the FIRST turn. Make reasonable assumptions instead "
    "of asking the trader to fill in blanks. Be specific: name real options, regions, "
    "product grades, certifications, documents, and realistic price / duty / lead-time "
    "ranges, and say how you would proceed. If they ask to source something, propose an "
    "actual approach with specifics and offer to shortlist suppliers or draft outreach. "
    "If they ask how to do something, tell them concretely."
    "\n\nHard rules:"
    "\n- Lead with substance the trader can act on today. NEVER open with 'I'll assess "
    "your readiness' or a meta list of things you will evaluate."
    "\n- Do not interrogate. State your assumptions rather than asking. Ask at most ONE "
    "genuinely blocking question, and only after you have already delivered something."
    "\n- Talk like an expert broker, not a compliance workflow. Avoid internal jargon "
    "('readiness score', 'governed run', 'assess across dimensions')."
    "\n- Concrete and specific beats comprehensive. No filler."
    "\n\nAccuracy discipline (this is a tool traders act on — being wrong is worse than "
    "being vague):"
    "\n- Stay specific, but flag figures that move over time — freight/spot rates, market "
    "prices, lead times, current interest rates — as INDICATIVE: give a realistic ballpark "
    "and say to confirm the live number. Never present a volatile figure as the precise "
    "'right now' rate."
    "\n- Duties, VAT, and tariffs are destination- and HS-code-specific. Give the correct "
    "ballpark or outer bound and note it depends on the destination; don't state one range "
    "as universally true."
    "\n- Do NOT vouch for the current status of specific named companies, banks, lenders, "
    "or fintechs — your knowledge may be stale and providers close or change. Name a "
    "specific provider only as an example to verify, or name the type of provider instead; "
    "never present one named vendor as a vetted, currently-operating recommendation."
    "\n- Be precise on regulations (banned vs concentration-limited, which body issues a "
    "document). If you are unsure of an exact threshold, code, or figure, say so rather "
    "than inventing one. Keep any numbers you cite internally consistent."
    "\n- Surface load-bearing conditions and safety-critical constraints up front (e.g. "
    "'VAT is only reclaimable if you're VAT-registered', lithium batteries are dangerous "
    "goods) rather than burying them."
)

_CLASSIFY_TAIL = (
    "\n\nAlways classify the primary workflow into exactly one canonical TRAIBOX object "
    "type from the provided enum; if broad or ambiguous, use 'trade_plan'."
)

# Plain-text streaming variant: same delivery + accuracy discipline, but the model
# writes a clean markdown answer directly (no JSON envelope, so nothing truncates).
_STREAM_MARKDOWN = (
    "\n\nWrite your answer directly in clean, well-structured markdown — short paragraphs, "
    "**bold** labels, and bullet or numbered lists where useful. Do not output JSON, and do "
    "not mention object types, classifications, or internal governance. Just give the trader "
    "the answer."
)

STREAM_COPILOT_SYSTEM = _COPILOT_ROLE + _DELIVERY_RULES + _STREAM_MARKDOWN
STREAM_PLAN_SYSTEM = (
    _COPILOT_ROLE
    + _DELIVERY_RULES
    + _STREAM_MARKDOWN
    + " When the task calls for it, weave a concrete, ordered plan of next actions into the "
    "answer as a markdown list."
)

COPILOT_SYSTEM_PROMPT = (
    _COPILOT_ROLE
    + _DELIVERY_RULES
    + _CLASSIFY_TAIL
    + "\n\nReturn:"
    "\n- answer: the real, specific, helpful response (tight paragraphs or bullets; "
    "substance first, no preamble)."
    "\n- follow_ups: 2-4 short imperative next actions YOU can take if tapped (e.g. "
    "'Shortlist 3 FSC-certified mills', 'Draft the supplier RFQ', 'Estimate landed cost "
    "to Oslo') — things that deliver more, never questions."
    "\n- clarifying_questions: 0-2, only genuinely blocking, phrased as a quick offer."
    "\n- plan_steps: 0-5 concrete actions (only if a plan actually helps); each an action "
    "that produces something, never 'assess X'."
    "\n- confidence in [0,1] and a one-sentence reason for the classification."
)

PLAN_SYSTEM_PROMPT = (
    _COPILOT_ROLE
    + _DELIVERY_RULES
    + _CLASSIFY_TAIL
    + "\n\nThe trader wants you to move the work forward: deliver a concrete first cut AND "
    "an ordered plan of real actions — not a readiness assessment."
    "\n\nReturn:"
    "\n- answer: substance-first — the actual recommendation, first draft, or "
    "sourcing/execution approach specific to their request."
    "\n- plan_steps: 3-6 concrete ACTIONS that each produce something (e.g. 'Shortlist 3 "
    "FSC/PEFC mills in Galicia and draft outreach', 'Assemble the EUR.1 + phytosanitary "
    "pack', 'Model landed cost at DAP Oslo'). Never 'assess/check X readiness'."
    "\n- follow_ups: 2-4 short imperative next actions you can take if tapped."
    "\n- clarifying_questions: 0-2, only genuine blockers."
    "\n- confidence in [0,1] and a one-sentence reason for the classification."
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
            "follow_ups": {"type": "array", "items": {"type": "string"}},
            "clarifying_questions": {"type": "array", "items": {"type": "string"}},
            "plan_steps": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["object_type", "confidence", "reason", "answer", "follow_ups"],
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
        "follow_ups": _string_list(data.get("follow_ups"), cap=4),
        "clarifying_questions": _string_list(data.get("clarifying_questions"), cap=2),
        "plan_steps": _string_list(data.get("plan_steps"), cap=6),
        "model": resolved_model,
    }


def resolve_model(override: str | None = None) -> str:
    """Public: resolve the model that a request would use."""
    return _model(override)


def _meta_model() -> str:
    """A small, fast model for the post-answer classification pass."""
    return os.environ.get("TRADE_BRAIN_LLM_META_MODEL", "").strip() or "claude-haiku-4-5"


def stream_copilot_answer(
    message: str,
    *,
    mode: str = "agent",
    model: str | None = None,
    history: Any = None,
):
    """Yield the answer as plain-text markdown chunks via a streaming LLM call.

    Assumes :func:`llm_enabled`. Raises on any failure so the caller emits an
    honest error rather than silently degrading to a canned answer. Because the
    answer is plain text (not a JSON envelope), it never truncates the structure.
    """
    import anthropic  # lazy — see module docstring

    client = anthropic.Anthropic()
    system = STREAM_COPILOT_SYSTEM if mode == "copilot" else STREAM_PLAN_SYSTEM
    resolved_model = _model(model)
    kwargs: dict[str, Any] = {
        "model": resolved_model,
        "max_tokens": _max_tokens(floor=4096),
        "system": system,
        "messages": [*_sanitize_history(history), {"role": "user", "content": (message or "").strip()}],
    }
    effort = _effort_for(resolved_model)
    if effort is not None:
        kwargs["output_config"] = {"effort": effort}

    with client.messages.stream(**kwargs) as stream:
        for text in stream.text_stream:
            if text:
                yield text
        final = stream.get_final_message()
    if getattr(final, "stop_reason", None) == "refusal":
        raise RuntimeError("refusal")


def classify_meta(
    message: str,
    answer: str,
    allowed_object_types: list[str],
    *,
    model: str | None = None,
) -> dict[str, Any] | None:
    """Fast structured pass: object_type + follow_ups + title from the answer.

    Runs on a small model by default. Returns None on any failure (caller falls
    back to deterministic classification).
    """
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "object_type": {"type": "string", "enum": allowed_object_types},
            "confidence": {"type": "number"},
            "title": {"type": "string"},
            "follow_ups": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["object_type", "confidence", "title", "follow_ups"],
    }
    system = (
        "You label a trade-copilot exchange for a governed workspace. Given the trader's "
        "message and the assistant's answer, return: the single canonical TRAIBOX object "
        "type that best fits (from the enum; if broad/ambiguous use 'trade_plan'); a "
        "calibrated confidence in [0,1]; a short title (<= 8 words, no quotes); and 2-4 "
        "short imperative follow-up actions the assistant could do next if tapped (things "
        "that deliver more — never questions). Do not restate the answer."
    )
    user = f"Trader message:\n{(message or '').strip()}\n\nAssistant answer:\n{(answer or '')[:4000]}"
    data = _structured_call(system, user, schema, _meta_model(), max_tokens=512)
    if not data:
        return None
    object_type = data.get("object_type")
    if object_type not in allowed_object_types:
        return None
    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        title = None
    return {
        "object_type": object_type,
        "confidence": _clamp_confidence(data.get("confidence")),
        "title": title,
        "follow_ups": _string_list(data.get("follow_ups"), cap=4),
    }


def _first_text_block(response: Any) -> str | None:
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", None)
            if isinstance(text, str) and text.strip():
                return text
    return None
