from __future__ import annotations

import sys
import types
import unittest
from unittest import mock

from app import core, llm


def _fake_anthropic(response: object | None = None, raises: BaseException | None = None) -> types.ModuleType:
    """Build a stand-in ``anthropic`` module so the LLM path is exercised offline."""

    class _Messages:
        def create(self, **_kwargs: object) -> object:
            if raises is not None:
                raise raises
            return response

    class _Client:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            self.messages = _Messages()

    module = types.ModuleType("anthropic")
    module.Anthropic = _Client  # type: ignore[attr-defined]
    return module


def _response(text: str, stop_reason: str = "end_turn") -> object:
    block = types.SimpleNamespace(type="text", text=text)
    return types.SimpleNamespace(stop_reason=stop_reason, content=[block])


ALLOWED = sorted(core.ALPHA_OBJECT_TYPES)


class LlmGatingTest(unittest.TestCase):
    def test_disabled_without_flag_even_with_key(self) -> None:
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "false", "ANTHROPIC_API_KEY": "sk-test"}):
            self.assertFalse(llm.llm_enabled())
            self.assertIsNone(llm.classify_workflow_llm("Prepare a payment intent.", ALLOWED))

    def test_disabled_without_key_even_with_flag(self) -> None:
        env = {"TRADE_BRAIN_LLM_ENABLED": "true"}
        with mock.patch.dict("os.environ", env, clear=False):
            import os

            os.environ.pop("ANTHROPIC_API_KEY", None)
            self.assertFalse(llm.llm_enabled())
            self.assertIsNone(llm.classify_workflow_llm("Prepare a payment intent.", ALLOWED))

    def test_classify_workflow_falls_back_to_deterministic_when_disabled(self) -> None:
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "false"}):
            result = core.classify_workflow("Prepare a payment intent and request approval.")
        self.assertEqual(result.object_type, "payment_intent")
        self.assertEqual(result.source, "deterministic")


class LlmParsingTest(unittest.TestCase):
    def _run(self, module: types.ModuleType, message: str = "Prepare a payment intent.") -> object | None:
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "true", "ANTHROPIC_API_KEY": "sk-test"}):
            with mock.patch.dict(sys.modules, {"anthropic": module}):
                return llm.classify_workflow_llm(message, ALLOWED)

    def test_parses_and_clamps_confidence(self) -> None:
        module = _fake_anthropic(
            _response('{"object_type": "payment_intent", "confidence": 1.9, "reason": "pay the supplier"}')
        )
        result = self._run(module)
        assert result is not None
        self.assertEqual(result["object_type"], "payment_intent")
        self.assertEqual(result["confidence"], 1.0)  # clamped into [0,1]
        self.assertEqual(result["model"], "claude-opus-4-8")

    def test_rejects_object_type_outside_enum(self) -> None:
        module = _fake_anthropic(
            _response('{"object_type": "not_a_real_type", "confidence": 0.9, "reason": "x"}')
        )
        self.assertIsNone(self._run(module))

    def test_refusal_falls_back(self) -> None:
        module = _fake_anthropic(
            _response('{"object_type": "payment_intent", "confidence": 0.9, "reason": "x"}', stop_reason="refusal")
        )
        self.assertIsNone(self._run(module))

    def test_sdk_error_falls_back(self) -> None:
        module = _fake_anthropic(raises=RuntimeError("network down"))
        self.assertIsNone(self._run(module))

    def test_dispatcher_uses_llm_source_label_on_success(self) -> None:
        module = _fake_anthropic(
            _response('{"object_type": "funding_request", "confidence": 0.88, "reason": "finance the order"}')
        )
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "true", "ANTHROPIC_API_KEY": "sk-test"}):
            with mock.patch.dict(sys.modules, {"anthropic": module}):
                result = core.classify_workflow("Please help with this order.")
        self.assertEqual(result.object_type, "funding_request")
        self.assertTrue(result.source.startswith("llm:"))


class CopilotGenerationTest(unittest.TestCase):
    COPILOT_JSON = (
        '{"object_type": "funding_request", "confidence": 0.9, '
        '"reason": "asking to raise working capital", '
        '"answer": "Here is how I would approach financing this export order...", '
        '"clarifying_questions": ["What is the invoice value?", "Who is the buyer?"], '
        '"plan_steps": ["Assemble the finance pack", "Request approval"]}'
    )

    def _gen(self, module: types.ModuleType, mode: str = "agent") -> object | None:
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "true", "ANTHROPIC_API_KEY": "sk-test"}):
            with mock.patch.dict(sys.modules, {"anthropic": module}):
                return llm.generate_copilot_llm("Fund my export order.", ALLOWED, mode=mode)

    def test_parses_full_copilot_reply(self) -> None:
        result = self._gen(_fake_anthropic(_response(self.COPILOT_JSON)))
        assert result is not None
        self.assertEqual(result["object_type"], "funding_request")
        self.assertTrue(result["answer"].startswith("Here is how"))
        self.assertEqual(len(result["clarifying_questions"]), 2)
        self.assertEqual(result["plan_steps"][0], "Assemble the finance pack")
        self.assertEqual(result["model"], "claude-opus-4-8")

    def test_missing_answer_falls_back(self) -> None:
        module = _fake_anthropic(
            _response('{"object_type": "funding_request", "confidence": 0.9, "reason": "x"}')
        )
        self.assertIsNone(self._gen(module))

    def test_model_override_is_used(self) -> None:
        module = _fake_anthropic(_response(self.COPILOT_JSON))
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "true", "ANTHROPIC_API_KEY": "sk-test"}):
            with mock.patch.dict(sys.modules, {"anthropic": module}):
                result = llm.generate_copilot_llm("Fund it.", ALLOWED, mode="copilot", model="claude-haiku-4-5")
        assert result is not None
        self.assertEqual(result["model"], "claude-haiku-4-5")


class BuildCopilotReplyTest(unittest.TestCase):
    def test_deterministic_reply_preserves_canned_answer(self) -> None:
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "false"}):
            reply = core.build_copilot_reply("Prepare a payment intent and request approval.")
        self.assertEqual(reply.object_type, "payment_intent")
        self.assertEqual(reply.source, "deterministic")
        self.assertTrue(reply.answer.startswith("Trade Brain classified this as a payment intent."))
        self.assertTrue(len(reply.clarifying_questions) >= 1)
        self.assertTrue(len(reply.plan_steps) >= 1)

    def test_llm_reply_labels_source_and_uses_answer(self) -> None:
        module = _fake_anthropic(_response(CopilotGenerationTest.COPILOT_JSON))
        with mock.patch.dict("os.environ", {"TRADE_BRAIN_LLM_ENABLED": "true", "ANTHROPIC_API_KEY": "sk-test"}):
            with mock.patch.dict(sys.modules, {"anthropic": module}):
                reply = core.build_copilot_reply("Fund my export order.", mode="copilot")
        self.assertEqual(reply.object_type, "funding_request")
        self.assertTrue(reply.source.startswith("llm:"))
        self.assertTrue(reply.answer.startswith("Here is how"))


if __name__ == "__main__":
    unittest.main()
