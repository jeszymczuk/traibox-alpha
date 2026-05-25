from __future__ import annotations

import unittest

from app.core import analyze_document_intelligence, build_replay_log, detect_missing_proof, run_eval, scope_agent_task, structure_copilot_request


class TradeBrainCoreTest(unittest.TestCase):
    def test_structures_payment_copilot_request_with_protected_gate(self) -> None:
        result = structure_copilot_request(
            {
                "message": "Prepare a payment intent for a supplier advance and request approval.",
                "workspace": "intelligence",
                "trace_id": "trc_test",
            }
        )

        self.assertEqual(result["object_type"], "payment_intent")
        self.assertEqual(result["status"], "draft")
        self.assertEqual(result["trace_id"], "trc_test")
        self.assertEqual(result["ai_observability"]["prompt_version"], "trade-brain-copilot-alpha-v1")
        self.assertTrue(any(action.get("protected_action") == "send_payment" for action in result["suggested_actions"]))
        self.assertEqual(result["eval_payload"]["status"], "pass")

    def test_scopes_agent_task_with_legacy_aliases_and_replay_preview(self) -> None:
        result = scope_agent_task(
            {
                "objective": "Review payment intent and prepare payment execution, do not send money.",
                "input_object_types": ["payment_intent"],
                "permitted_tools": ["read_trade_context", "prepare_payment_intent", "request_approval"],
                "data_access": ["selected_objects", "trade_context"],
                "write_permissions": ["agent_task", "agent_work_result", "memory_event"],
                "time_budget_seconds": 999,
                "trace_id": "trc_agent",
            }
        )
        policy = result["runtime_policy"]

        self.assertEqual(policy["effective_tools"], ["memory.query", "payment.prepare", "approvals.request"])
        self.assertEqual(policy["effective_write_permissions"], ["create_agent_task", "create_agent_work_result", "create_memory_event"])
        self.assertIn("send_payment", policy["approval_gates"])
        self.assertEqual(policy["time_budget_seconds"], 120)
        self.assertFalse(policy["can_execute_protected_actions"])
        self.assertEqual(result["violations"], [])
        self.assertTrue(any(step["step"] == "runtime.ready" for step in result["replay_preview"]))

    def test_eval_logs_replayable_ai_decision_metadata(self) -> None:
        result = run_eval(
            {
                "suite": "trade-brain-alpha-eval-v1",
                "model": "router-test",
                "prompt_version": "prompt-test",
                "confidence": 0.81,
                "policy_constraints": ["Protected actions require explicit human approval."],
                "generated_recommendation": "Request approval before execution.",
                "trace_id": "trc_eval",
            }
        )

        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["model"], "router-test")
        self.assertEqual(result["prompt_version"], "prompt-test")
        self.assertEqual(result["trace_id"], "trc_eval")
        self.assertTrue(result["replayable"])

    def test_replay_log_contains_deterministic_scope_steps(self) -> None:
        result = build_replay_log(
            {
                "trace_id": "trc_replay",
                "objective": "Review payment.",
                "runtime_policy": {"scope_version": "agent-scope-alpha-v2", "approval_gates": ["send_payment"]},
                "input_objects": [{"object_id": "obj-1", "type": "payment_intent"}],
            }
        )

        self.assertEqual([step["step"] for step in result], ["task.accepted", "scope.normalized", "context.bound", "protected_actions.blocked_without_human_approval", "runtime.ready"])
        self.assertEqual(result[3]["gates"], ["send_payment"])

    def test_document_intelligence_extracts_required_trade_fields(self) -> None:
        result = analyze_document_intelligence(
            {
                "filename": "po-8812.txt",
                "text": "Purchase Order PO-8812. Seller: Lusitania Automation Lda. Buyer: Iberica Components SL. Buyer VAT: ESB12345678. Amount EUR 48000. Incoterm DAP. Payment terms: 40% advance and 60% after acceptance. Acceptance proof signed by buyer operations lead.",
                "trace_id": "trc_doc",
            }
        )

        self.assertEqual(result["document_type"], "purchase_order")
        self.assertEqual(result["missing_fields"], [])
        self.assertEqual(result["extracted_fields"]["buyer_tax_id"], "ESB12345678")
        self.assertTrue(result["quality_signals"]["ready_for_readiness"])

    def test_missing_proof_detection_blocks_protected_payment_without_approval(self) -> None:
        result = detect_missing_proof(
            {
                "object_type": "payment_intent",
                "available_proof": ["beneficiary_verified", "invoice", "payment_terms"],
                "trace_id": "trc_missing",
            }
        )

        self.assertEqual(result["overall"], "blocked")
        self.assertIn("approval", result["missing_items"])
        self.assertIn("proof_bundle", result["missing_items"])
        self.assertFalse(result["quality_signals"]["proof_ready"])


if __name__ == "__main__":
    unittest.main()
