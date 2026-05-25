from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from .core import (
    SERVICE_VERSION,
    analyze_document_intelligence,
    build_replay_log,
    detect_missing_proof,
    run_eval,
    scope_agent_task,
    structure_copilot_request,
)


DEFAULT_DATASET_DIR = Path(__file__).resolve().parents[1] / "evals"
HARNESS_VERSION = "trade-brain-eval-harness-alpha-v1"


@dataclass(frozen=True)
class EvalCase:
    id: str
    kind: str
    input: dict[str, Any]
    expect: dict[str, Any]
    tags: list[str]
    dataset: str


def list_eval_suites(dataset_dir: Path | None = None) -> list[dict[str, Any]]:
    root = dataset_dir or DEFAULT_DATASET_DIR
    suites: list[dict[str, Any]] = []
    for path in sorted(root.glob("*.jsonl")):
        cases = load_eval_cases(path.stem, root)
        suites.append({"suite_id": path.stem, "case_count": len(cases), "path": str(path)})
    return suites


def run_eval_suite(suite_id: str = "all", dataset_dir: Path | None = None) -> dict[str, Any]:
    root = dataset_dir or DEFAULT_DATASET_DIR
    cases = load_eval_cases(suite_id, root)
    results = [run_eval_case(case) for case in cases]
    passed = sum(1 for result in results if result["status"] == "pass")
    failed = sum(1 for result in results if result["status"] == "fail")
    score = round((passed / len(results)) * 100, 2) if results else 0
    return {
        "run_id": str(uuid4()),
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "harness_version": HARNESS_VERSION,
        "service_version": SERVICE_VERSION,
        "suite_id": suite_id,
        "case_count": len(results),
        "passed": passed,
        "failed": failed,
        "score": score,
        "status": "pass" if failed == 0 else "fail",
        "results": results,
    }


def run_eval_case(case: EvalCase) -> dict[str, Any]:
    if case.kind == "copilot_structure":
        output = structure_copilot_request(case.input)
        checks = check_copilot_structure(output, case.expect)
    elif case.kind == "agent_scope":
        output = scope_agent_task(case.input)
        checks = check_agent_scope(output, case.expect)
    elif case.kind == "replay":
        output = {"replay_log": build_replay_log(case.input)}
        checks = check_replay(output["replay_log"], case.expect)
    elif case.kind == "eval_payload":
        output = run_eval(case.input)
        checks = check_eval_payload(output, case.expect)
    elif case.kind == "document_intelligence":
        output = analyze_document_intelligence(case.input)
        checks = check_document_intelligence(output, case.expect)
    elif case.kind == "missing_proof_detection":
        output = detect_missing_proof(case.input)
        checks = check_missing_proof_detection(output, case.expect)
    else:
        output = {}
        checks = [fail_check("kind.supported", f"Unsupported eval case kind: {case.kind}")]

    status = "pass" if all(check["status"] == "pass" for check in checks) else "fail"
    return {
        "id": case.id,
        "dataset": case.dataset,
        "kind": case.kind,
        "tags": case.tags,
        "status": status,
        "checks": checks,
        "summary": summarize_case_output(case.kind, output),
    }


def load_eval_cases(suite_id: str = "all", dataset_dir: Path | None = None) -> list[EvalCase]:
    root = dataset_dir or DEFAULT_DATASET_DIR
    paths = sorted(root.glob("*.jsonl")) if suite_id == "all" else [root / f"{suite_id}.jsonl"]
    cases: list[EvalCase] = []
    for path in paths:
        if not path.exists():
            raise FileNotFoundError(f"Eval suite not found: {path}")
        with path.open("r", encoding="utf-8") as handle:
            for line_number, raw_line in enumerate(handle, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                payload = json.loads(line)
                cases.append(
                    EvalCase(
                        id=required_string(payload, "id", path, line_number),
                        kind=required_string(payload, "kind", path, line_number),
                        input=required_dict(payload, "input", path, line_number),
                        expect=required_dict(payload, "expect", path, line_number),
                        tags=string_list(payload.get("tags")),
                        dataset=path.stem,
                    )
                )
    return cases


def check_copilot_structure(output: dict[str, Any], expect: dict[str, Any]) -> list[dict[str, Any]]:
    actions = string_list([action.get("action") for action in output.get("suggested_actions", []) if isinstance(action, dict)])
    protected_actions = string_list([action.get("protected_action") for action in output.get("suggested_actions", []) if isinstance(action, dict)])
    eval_payload = output.get("eval_payload") if isinstance(output.get("eval_payload"), dict) else {}
    return [
        exact_check("object_type", output.get("object_type"), expect.get("object_type")),
        min_number_check("confidence", output.get("confidence"), expect.get("min_confidence")),
        contains_all_check("required_actions", actions, string_list(expect.get("required_actions"))),
        contains_all_check("required_protected_actions", protected_actions, string_list(expect.get("required_protected_actions"))),
        exact_check("eval_status", eval_payload.get("status"), expect.get("eval_status")),
        exact_check("structured_output_schema", output.get("structured_output_schema"), "copilot-structured-output-alpha-v2"),
    ]


def check_agent_scope(output: dict[str, Any], expect: dict[str, Any]) -> list[dict[str, Any]]:
    policy = output.get("runtime_policy") if isinstance(output.get("runtime_policy"), dict) else {}
    return [
        contains_all_check("effective_tools", string_list(policy.get("effective_tools")), string_list(expect.get("effective_tools"))),
        contains_all_check("effective_write_permissions", string_list(policy.get("effective_write_permissions")), string_list(expect.get("effective_write_permissions"))),
        contains_all_check("approval_gates", string_list(policy.get("approval_gates")), string_list(expect.get("approval_gates"))),
        optional_exact_list_check("denied_tools", string_list(policy.get("denied_tools")), expect, "denied_tools"),
        optional_exact_list_check("denied_data_access", string_list(policy.get("denied_data_access")), expect, "denied_data_access"),
        optional_exact_list_check("denied_write_permissions", string_list(policy.get("denied_write_permissions")), expect, "denied_write_permissions"),
        optional_contains_text_check("violations_contain", string_list(output.get("violations")), expect, "violations_contain"),
        optional_exact_list_check("violations", string_list(output.get("violations")), expect, "violations"),
        exact_check("time_budget_seconds", policy.get("time_budget_seconds"), expect.get("time_budget_seconds")),
        exact_check("protected_actions_blocked", policy.get("protected_actions_blocked"), expect.get("protected_actions_blocked")),
        exact_check("can_execute_protected_actions", policy.get("can_execute_protected_actions"), False),
    ]


def check_replay(replay_log: list[dict[str, Any]], expect: dict[str, Any]) -> list[dict[str, Any]]:
    steps = string_list([entry.get("step") for entry in replay_log])
    gates = string_list(next((entry.get("gates") for entry in replay_log if entry.get("step") == "protected_actions.blocked_without_human_approval"), []))
    return [
        contains_all_check("required_steps", steps, string_list(expect.get("required_steps"))),
        min_number_check("min_steps", len(replay_log), expect.get("min_steps")),
        contains_all_check("approval_gates", gates, string_list(expect.get("approval_gates"))),
    ]


def check_eval_payload(output: dict[str, Any], expect: dict[str, Any]) -> list[dict[str, Any]]:
    check_cases = string_list([check.get("case") for check in output.get("checks", []) if isinstance(check, dict)])
    return [
        exact_check("status", output.get("status"), expect.get("status")),
        min_number_check("score", output.get("score"), expect.get("min_score")),
        contains_all_check("required_check_cases", check_cases, string_list(expect.get("required_check_cases"))),
        exact_check("replayable", output.get("replayable"), expect.get("replayable")),
    ]


def check_document_intelligence(output: dict[str, Any], expect: dict[str, Any]) -> list[dict[str, Any]]:
    extracted_fields = output.get("extracted_fields") if isinstance(output.get("extracted_fields"), dict) else {}
    provenance_fields = string_list([entry.get("field") for entry in output.get("provenance", []) if isinstance(entry, dict)])
    return [
        exact_check("document_type", output.get("document_type"), expect.get("document_type")),
        min_number_check("confidence", output.get("confidence"), expect.get("min_confidence")),
        contains_all_check("required_extracted_fields", list(extracted_fields.keys()), string_list(expect.get("required_extracted_fields"))),
        contains_all_check("missing_fields", string_list(output.get("missing_fields")), string_list(expect.get("missing_fields"))),
        contains_all_check("provenance_fields", provenance_fields, string_list(expect.get("provenance_fields"))),
        exact_check(
            "ready_for_readiness",
            (output.get("quality_signals") if isinstance(output.get("quality_signals"), dict) else {}).get("ready_for_readiness"),
            expect.get("ready_for_readiness"),
        ),
    ]


def check_missing_proof_detection(output: dict[str, Any], expect: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        exact_check("overall", output.get("overall"), expect.get("overall")),
        min_number_check("score", output.get("score"), expect.get("min_score")),
        contains_all_check("missing_items", string_list(output.get("missing_items")), string_list(expect.get("missing_items"))),
        contains_text_check("risk_findings", string_list(output.get("risk_findings")), string_list(expect.get("risk_findings_contain"))),
        contains_text_check("next_actions", string_list(output.get("next_actions")), string_list(expect.get("next_actions_contain"))),
        exact_check(
            "proof_ready",
            (output.get("quality_signals") if isinstance(output.get("quality_signals"), dict) else {}).get("proof_ready"),
            expect.get("proof_ready"),
        ),
    ]


def summarize_case_output(kind: str, output: dict[str, Any]) -> dict[str, Any]:
    if kind == "copilot_structure":
        return {
            "object_type": output.get("object_type"),
            "confidence": output.get("confidence"),
            "eval_status": (output.get("eval_payload") if isinstance(output.get("eval_payload"), dict) else {}).get("status"),
        }
    if kind == "agent_scope":
        policy = output.get("runtime_policy") if isinstance(output.get("runtime_policy"), dict) else {}
        return {
            "runtime": policy.get("runtime"),
            "approval_gates": policy.get("approval_gates"),
            "violations": output.get("violations"),
        }
    if kind == "replay":
        return {"steps": [entry.get("step") for entry in output.get("replay_log", []) if isinstance(entry, dict)]}
    if kind == "eval_payload":
        return {"status": output.get("status"), "score": output.get("score"), "model": output.get("model")}
    if kind == "document_intelligence":
        return {
            "document_type": output.get("document_type"),
            "confidence": output.get("confidence"),
            "missing_fields": output.get("missing_fields"),
            "quality_signals": output.get("quality_signals"),
        }
    if kind == "missing_proof_detection":
        return {
            "overall": output.get("overall"),
            "score": output.get("score"),
            "missing_items": output.get("missing_items"),
            "quality_signals": output.get("quality_signals"),
        }
    return {}


def exact_check(name: str, actual: Any, expected: Any) -> dict[str, Any]:
    if expected is None:
        return pass_check(name, "No expectation declared.")
    if actual == expected:
        return pass_check(name, f"Expected {expected!r}.")
    return fail_check(name, f"Expected {expected!r}, got {actual!r}.")


def exact_list_check(name: str, actual: list[str], expected: list[str]) -> dict[str, Any]:
    if not expected:
        if actual:
            return fail_check(name, f"Expected empty list, got {actual!r}.")
        return pass_check(name, "Expected empty list.")
    if actual == expected:
        return pass_check(name, f"Matched {expected!r}.")
    return fail_check(name, f"Expected {expected!r}, got {actual!r}.")


def optional_exact_list_check(name: str, actual: list[str], expect: dict[str, Any], key: str) -> dict[str, Any]:
    if key not in expect:
        return pass_check(name, "No exact-list expectation declared.")
    return exact_list_check(name, actual, string_list(expect.get(key)))


def contains_all_check(name: str, actual: list[str], expected: list[str]) -> dict[str, Any]:
    missing = [item for item in expected if item not in actual]
    if missing:
        return fail_check(name, f"Missing {missing!r}; actual {actual!r}.")
    return pass_check(name, f"Contains {expected!r}.")


def contains_text_check(name: str, actual: list[str], expected_fragments: list[str]) -> dict[str, Any]:
    missing = [fragment for fragment in expected_fragments if not any(fragment in candidate for candidate in actual)]
    if missing:
        return fail_check(name, f"Missing text fragments {missing!r}; actual {actual!r}.")
    return pass_check(name, f"Contains text fragments {expected_fragments!r}.")


def optional_contains_text_check(name: str, actual: list[str], expect: dict[str, Any], key: str) -> dict[str, Any]:
    if key not in expect:
        return pass_check(name, "No text expectation declared.")
    return contains_text_check(name, actual, string_list(expect.get(key)))


def min_number_check(name: str, actual: Any, minimum: Any) -> dict[str, Any]:
    if minimum is None:
        return pass_check(name, "No minimum declared.")
    try:
        actual_number = float(actual)
        minimum_number = float(minimum)
    except (TypeError, ValueError):
        return fail_check(name, f"Expected numeric value >= {minimum!r}, got {actual!r}.")
    if actual_number >= minimum_number:
        return pass_check(name, f"{actual_number} >= {minimum_number}.")
    return fail_check(name, f"{actual_number} < {minimum_number}.")


def pass_check(name: str, finding: str) -> dict[str, Any]:
    return {"case": name, "status": "pass", "finding": finding}


def fail_check(name: str, finding: str) -> dict[str, Any]:
    return {"case": name, "status": "fail", "finding": finding}


def required_string(payload: dict[str, Any], key: str, path: Path, line_number: int) -> str:
    value = payload.get(key)
    if isinstance(value, str) and value:
        return value
    raise ValueError(f"{path}:{line_number} missing string field {key}")


def required_dict(payload: dict[str, Any], key: str, path: Path, line_number: int) -> dict[str, Any]:
    value = payload.get(key)
    if isinstance(value, dict):
        return value
    raise ValueError(f"{path}:{line_number} missing object field {key}")


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str):
            candidate = item.strip()
            if candidate:
                result.append(candidate)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run TRAIBOX Trade Brain eval suites.")
    parser.add_argument("--suite", default="all", help="Suite id to run, or all.")
    parser.add_argument("--dataset-dir", default=str(DEFAULT_DATASET_DIR), help="Directory containing JSONL eval suites.")
    parser.add_argument("--output", help="Write the JSON eval report to this file.")
    parser.add_argument("--list", action="store_true", help="List available suites instead of running them.")
    args = parser.parse_args(argv)
    dataset_dir = Path(args.dataset_dir)
    if args.list:
        print(json.dumps({"suites": list_eval_suites(dataset_dir)}, indent=2))
        return 0
    report = run_eval_suite(args.suite, dataset_dir)
    output = json.dumps(report, indent=2)
    print(output)
    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(f"{output}\n", encoding="utf-8")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
