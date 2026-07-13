#!/usr/bin/env python3
"""TRAIBOX Capital Agent v1.1 — founder validation runner (NON-PRODUCTION).

Executes the Golden A / B / C scenarios through the REAL governed outcome
engine (the same code path the API service calls) and prints a readable
report: evidence status, assumptions, deterministic calculations with audit
hashes, the recommendation, and the rendered artifact.

This is a narrow internal validation surface for founder review only — it is
not a production UX, it touches no database, it creates no canonical state,
and it executes no protected action.

Usage (from the repository root; no database or manual editing required):
    python3 scripts/capital-validation/run_golden.py A
    python3 scripts/capital-validation/run_golden.py B
    python3 scripts/capital-validation/run_golden.py C
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "apps/trade-brain"))

from app.outcomes.artifacts import render_markdown  # noqa: E402
from app.outcomes.service import execute_capital_outcome  # noqa: E402

ORG = "11111111-1111-4111-8111-111111111111"
MANDATE = "22222222-2222-4222-8222-222222222222"
TASK = "33333333-3333-4333-8333-333333333333"
TRADE = "44444444-4444-4444-8444-444444444444"

MANDATE_PAYLOAD = {
    "mandate_id": MANDATE, "version": 1, "org_id": ORG, "principal_id": ORG,
    "principal_type": "company", "agent_class": "capital_agent", "status": "active",
    "allowed_outcome_types": ["capital_diagnosis", "financing_need_classification", "financing_option_comparison", "funding_packet"],
    "permitted_tool_classes": ["context_read", "calculation", "artifact", "proposal"],
    "permitted_data_classes": ["selected_objects", "trade_context", "finance_read", "org_finance_profile"],
    "authority_ceiling": "propose_protected_action",
    "max_sensitivity": "restricted_financial",
    "disclosure_policy_id": "disclosure-company-v1",
}

WC = {
    "currency": "EUR", "opening_cash": "5000.00",
    "events": [
        {"label": "supplier-prepayment", "amount": "-42000.00", "currency": "EUR", "on": "2026-08-01"},
        {"label": "freight", "amount": "-3000.00", "currency": "EUR", "on": "2026-08-10"},
        {"label": "buyer-settlement", "amount": "60000.00", "currency": "EUR", "on": "2026-10-15"},
    ],
    "committed_facilities": "10000.00",
    "provenance": [
        {"input_path": "opening_cash", "kind": "verified_fact"},
        {"input_path": "events[0].amount", "kind": "verified_fact"},
        {"input_path": "events[1].amount", "kind": "estimate"},
        {"input_path": "events[2].amount", "kind": "verified_fact"},
        {"input_path": "committed_facilities", "kind": "verified_fact"},
    ],
}
CASHFLOW = {key: WC[key] for key in ("currency", "opening_cash", "events", "provenance")}

def snapshots(categories: tuple[str, ...], freshness: str = "current") -> list[dict]:
    return [{
        "object_type": "trade", "source_layer": "relational", "object_id": TRADE,
        "organization_id": ORG, "principal_id": ORG,
        "retrieved_at": "2026-07-13T00:00:00Z", "as_of": "2026-07-13", "freshness": freshness,
        "facts": [
            {"input_path": f"canonical.{category}", "statement": f"Canonical {category} evidence verified from trade {TRADE} (PT-DE olive oil export, 60,000.00 EUR)", "category": category}
            for category in categories
        ],
    }]


def request(outcome_type: str, inputs: dict, *, facts=None, snaps=None, authority="recommend", key: str = "golden") -> dict:
    return {
        "contract_version": "capital-outcome-execution-v1",
        "outcome_type": outcome_type, "definition_version": "1.0.0",
        "organization_id": ORG, "principal_id": ORG, "principal_type": "company",
        "mandate_id": MANDATE, "mandate_version": 1, "task_id": TASK,
        "objective": f"Founder validation — {outcome_type}",
        "requested_authority": authority,
        "inputs": inputs, "input_facts": facts or [],
        "canonical_snapshots": snaps if snaps is not None else [],
        "currency_policy": {"base_currency": "EUR"},
        "trace_id": f"founder-validation-{key}",
        "idempotency_key": f"founder-validation-{key}",
    }


def show(result: dict) -> None:
    print(f"\n=== OUTCOME: {result['outcome_type']} @ {result['definition_version']} ===")
    print(f"status: {result['execution_status']}  (persisted as: {result['persisted_status']})")
    print(f"confidence: {result['confidence']}   synthesis: {result['synthesis_source']}   provisional: {result.get('provisional')}")
    print("\n-- evidence coverage --")
    for category, status in result.get("evidence_coverage", {}).items():
        print(f"  {category}: {status}")
    for note in result.get("trust_notes", []):
        print(f"  note: {note}")
    print("\n-- deterministic calculations --")
    for summary in result["calculations"]:
        print(f"  {summary['key']}: {summary['status']} [{summary['calculator_id']}@{summary['calculator_version']}]")
        print(f"    input  {summary['input_hash']}")
        print(f"    result {summary['result_hash']}")
    assumptions = [claim["statement"] for claim in result["evidence"]["claims"] if claim["claim_type"] == "assumption"]
    if assumptions:
        print("\n-- assumptions --")
        for assumption in assumptions:
            print(f"  - {assumption}")
    if result.get("targeted_questions"):
        print("\n-- targeted questions --")
        for question in result["targeted_questions"]:
            print(f"  ? {question}")
    if result.get("contradictions"):
        print("\n-- contradictions (preserved, not erased) --")
        for contradiction in result["contradictions"]:
            print(f"  ! {contradiction}")
    if result.get("recommendation"):
        rec = result["recommendation"]
        print(f"\n-- recommendation ({rec['recommendation_type']}, {rec['confidence']}) --")
        print(f"  {rec['summary']}")
        print(f"  next step: {rec['next_step']}")
        print(f"  creates_protected_action: {rec['creates_protected_action']}")
    if result.get("artifact"):
        print("\n" + "=" * 70)
        print("ARTIFACT (markdown rendering derived from the structured model)")
        print("=" * 70)
        from app.outcomes.artifacts import CapitalArtifactDraft

        print(render_markdown(CapitalArtifactDraft.model_validate(result["artifact"])))


def golden_a() -> dict:
    """Pre-shipment purchase-order funding: no invoice, no receivable —
    receivables finance must be structurally ineligible; nothing fabricated."""
    inputs = {
        "trade_context": {"invoice_exists": False, "receivable_exists": False, "delivery_complete": False},
        "working_capital": WC, "cashflow": CASHFLOW,
        "receivables": {
            "currency": "EUR", "invoice_exists": False, "receivable_exists": False,
            "delivery_complete": False, "buyer_acceptance": False,
            "provenance": [
                {"input_path": "invoice_exists", "kind": "verified_fact"},
                {"input_path": "receivable_exists", "kind": "verified_fact"},
                {"input_path": "delivery_complete", "kind": "verified_fact"},
            ],
        },
    }
    return request("financing_need_classification", inputs, snaps=snapshots(("cashflow_basis", "trade_context")), authority="analyse", key="golden-a")


def golden_b() -> dict:
    """Post-delivery accepted invoice: receivable exists — receivables
    finance structurally eligible and priced; lineage to calculation runs."""
    inputs = {
        "trade_context": {"invoice_exists": True, "receivable_exists": True, "delivery_complete": True},
        "working_capital": WC,
        "receivables": {
            "currency": "EUR", "invoice_exists": True, "receivable_exists": True,
            "delivery_complete": True, "buyer_acceptance": True,
            "invoice_amount": "60000.00", "due_in_days": 60,
            "advance_rate": "0.85", "discount_annual_rate": "0.09",
            "service_fees": "150.00", "reserve_rate": "0.05",
            "provenance": [
                {"input_path": "invoice_exists", "kind": "verified_fact"},
                {"input_path": "receivable_exists", "kind": "verified_fact"},
                {"input_path": "delivery_complete", "kind": "verified_fact"},
                {"input_path": "invoice_amount", "kind": "verified_fact"},
                {"input_path": "advance_rate", "kind": "user_provided"},
                {"input_path": "discount_annual_rate", "kind": "user_provided"},
            ],
        },
    }
    return request("financing_need_classification", inputs, snaps=snapshots(("cashflow_basis", "trade_context")), authority="analyse", key="golden-b")


def golden_c() -> dict:
    """Missing material cost + contradictory delivery evidence: targeted
    questions, needs_information, no fabricated assumptions, no artifact."""
    wc = {
        "currency": "EUR",
        "events": [
            {"label": "supplier-prepayment", "amount": "-42000.00", "currency": "EUR", "on": "2026-08-01"},
            {"label": "buyer-settlement", "amount": "60000.00", "currency": "EUR", "on": "2026-10-15"},
        ],
        "provenance": [
            {"input_path": "events[0].amount", "kind": "unresolved"},
            {"input_path": "events[1].amount", "kind": "verified_fact"},
        ],
    }
    facts = [
        {"input_path": "trade_context.delivery_complete", "kind": "user_provided", "statement": "Forwarder POD says delivery completed 2026-07-02", "category": "trade_context"},
        {"input_path": "trade_context.buyer_dispute", "kind": "user_provided", "statement": "Buyer email says goods were never delivered", "category": "trade_context", "contradicts_paths": ["trade_context.delivery_complete"]},
    ]
    inputs = {"trade_context": {"invoice_exists": True, "receivable_exists": True, "delivery_complete": True}, "working_capital": wc}
    return request("financing_need_classification", inputs, facts=facts, snaps=[], authority="analyse", key="golden-c")


def main() -> int:
    scenario = (sys.argv[1] if len(sys.argv) > 1 else "").upper()
    builders = {"A": golden_a, "B": golden_b, "C": golden_c}
    if scenario not in builders:
        print(__doc__)
        return 2
    print(f"Running Golden {scenario} through the governed outcome engine (deterministic synthesis unless TRADE_BRAIN_LLM_ENABLED is set)...")
    response = execute_capital_outcome({"request": builders[scenario](), "mandate": MANDATE_PAYLOAD})
    if "error" in response:
        print("ERROR:", response["error"])
        return 1
    show(response["result"])
    print("\nWhat to judge (founder):")
    print("  1. Are the classifications honest (eligible vs ineligible, verified vs user-provided)?")
    print("  2. Does every number trace to a calculation hash in the appendix?")
    print("  3. Are the open questions the RIGHT questions to ask the company?")
    print("  4. Would you show this artifact to an SME founder as a draft?")
    print("  (No canonical Finance state was read or written; no action was executed.)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
