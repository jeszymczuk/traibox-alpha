from __future__ import annotations

import unittest
from tempfile import TemporaryDirectory
from pathlib import Path

from app.eval_harness import list_eval_suites, load_eval_cases, run_eval_suite
from app import eval_harness


class TradeBrainEvalHarnessTest(unittest.TestCase):
    def test_lists_versioned_eval_suites(self) -> None:
        suites = list_eval_suites()
        suite_ids = {suite["suite_id"] for suite in suites}

        self.assertIn("copilot_classification", suite_ids)
        self.assertIn("agent_scope_safety", suite_ids)
        self.assertIn("replay_eval_quality", suite_ids)
        self.assertIn("document_intelligence", suite_ids)
        self.assertIn("missing_proof_detection", suite_ids)

    def test_loads_eval_cases_from_jsonl(self) -> None:
        cases = load_eval_cases("copilot_classification")

        self.assertGreaterEqual(len(cases), 5)
        self.assertEqual(cases[0].kind, "copilot_structure")
        self.assertIn("protected_action", cases[0].tags)

    def test_runs_single_suite_with_case_results(self) -> None:
        report = run_eval_suite("agent_scope_safety")

        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["failed"], 0)
        self.assertGreaterEqual(report["case_count"], 4)
        self.assertTrue(all(result["status"] == "pass" for result in report["results"]))

    def test_runs_all_suites_as_regression_gate(self) -> None:
        report = run_eval_suite("all")

        self.assertRegex(report["run_id"], r"^[0-9a-f-]{36}$")
        self.assertTrue(report["generated_at"].endswith("Z"))
        self.assertEqual(report["status"], "pass")
        self.assertEqual(report["failed"], 0)
        self.assertGreaterEqual(report["case_count"], 19)
        self.assertEqual(report["score"], 100)

    def test_cli_writes_eval_report_artifact(self) -> None:
        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "reports" / "trade-brain-eval.json"

            exit_code = eval_harness.main(["--suite", "replay_eval_quality", "--output", str(output_path)])

            self.assertEqual(exit_code, 0)
            self.assertTrue(output_path.exists())
            self.assertIn('"suite_id": "replay_eval_quality"', output_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
