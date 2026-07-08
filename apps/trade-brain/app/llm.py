"""Optional Anthropic-backed enrichment for the Trade Brain.

This module is the *only* place the ``anthropic`` SDK is imported, and it is
imported lazily inside the functions below — never at module load. That keeps
``app.core`` (and therefore the unit tests and the deterministic eval gate)
stdlib-only at import time, and it means a missing dependency, missing key,
network failure, safety refusal, or malformed model output all degrade
silently to the deterministic classifier rather than hard-failing the brain.

Two independent switches must BOTH be on for the LLM path to engage:

  * ``TRADE_BRAIN_LLM_ENABLED`` — operator opt-in. Default off so CI and the
    determinism gate always exercise the deterministic branch.
  * ``ANTHROPIC_API_KEY`` — the user's key, supplied via ``.env`` (never chat).

Tunables (all optional, sensible defaults):

  * ``TRADE_BRAIN_LLM_MODEL``      (default ``claude-opus-4-8``)
  * ``TRADE_BRAIN_LLM_MAX_TOKENS`` (default ``1024``)
  * ``TRADE_BRAIN_LLM_EFFORT``     (unset → model default; else low|medium|high|xhigh|max)
"""

from __future__ import annotations

import json
import os
from typing import Any

DEFAULT_MODEL = "claude-opus-4-8"
_TRUTHY = {"1", "true", "yes", "on"}
_VALID_EFFORT = {"low", "medium", "high", "xhigh", "max"}

CLASSIFY_SYSTEM_PROMPT = (
    "You are the TRAIBOX Trade Brain intent classifier for cross-border trade. "
    "Classify a trader's natural-language message into exactly one canonical TRAIBOX "
    "alpha object type — the single type that best represents the primary workflow the "
    "message is asking for. Be decisive. Return a calibrated confidence in [0,1] and a "
    "one-sentence reason grounded in the message. Never invent object types outside the "
    "provided enum; if the message is broad or ambiguous, choose 'trade_plan'."
)


def _flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in _TRUTHY


def llm_enabled() -> bool:
    """True only when the operator opted in AND a key is present."""
    return _flag("TRADE_BRAIN_LLM_ENABLED") and bool(os.environ.get("ANTHROPIC_API_KEY", "").strip())


def _model() -> str:
    return os.environ.get("TRADE_BRAIN_LLM_MODEL", "").strip() or DEFAULT_MODEL


def _max_tokens() -> int:
    try:
        return max(256, int(os.environ.get("TRADE_BRAIN_LLM_MAX_TOKENS", "1024")))
    except ValueError:
        return 1024


def _effort() -> str | None:
    effort = os.environ.get("TRADE_BRAIN_LLM_EFFORT", "").strip().lower()
    return effort if effort in _VALID_EFFORT else None


def classify_workflow_llm(message: str, allowed_object_types: list[str]) -> dict[str, Any] | None:
    """Classify ``message`` via Claude, constrained to ``allowed_object_types``.

    Returns ``{"object_type", "confidence", "reason", "model"}`` on success, or
    ``None`` to signal the caller should fall back to deterministic logic. This
    function never raises: every failure mode returns ``None``.
    """
    if not llm_enabled():
        return None
    text = (message or "").strip()
    if not text:
        return None

    try:
        import anthropic  # lazy — see module docstring

        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment

        output_config: dict[str, Any] = {
            "format": {
                "type": "json_schema",
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "object_type": {"type": "string", "enum": allowed_object_types},
                        "confidence": {"type": "number"},
                        "reason": {"type": "string"},
                    },
                    "required": ["object_type", "confidence", "reason"],
                },
            }
        }
        effort = _effort()
        if effort is not None:
            output_config["effort"] = effort

        model = _model()
        response = client.messages.create(
            model=model,
            max_tokens=_max_tokens(),
            system=CLASSIFY_SYSTEM_PROMPT,
            output_config=output_config,
            messages=[{"role": "user", "content": text}],
        )

        # Safety classifiers may decline (HTTP 200, stop_reason == "refusal").
        if getattr(response, "stop_reason", None) == "refusal":
            return None

        payload = _first_text_block(response)
        if not payload:
            return None

        data = json.loads(payload)
        object_type = data.get("object_type")
        if object_type not in allowed_object_types:
            return None

        try:
            confidence = float(data.get("confidence"))
        except (TypeError, ValueError):
            confidence = 0.75
        confidence = round(min(1.0, max(0.0, confidence)), 2)

        reason = data.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            reason = f"Trade Brain LLM classified this message as {object_type}."

        return {
            "object_type": object_type,
            "confidence": confidence,
            "reason": reason.strip(),
            "model": model,
        }
    except Exception:
        # Any failure (missing dep, auth, network, malformed output, SDK drift)
        # must fall back to the deterministic classifier — never hard-fail.
        return None


def _first_text_block(response: Any) -> str | None:
    for block in getattr(response, "content", None) or []:
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", None)
            if isinstance(text, str) and text.strip():
                return text
    return None
