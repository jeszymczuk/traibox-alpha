"""Phase 3 Workbench closure tests (§12): authorized execution, exact
versioning, audit-complete hashing, provenance, financial correctness, golden
cases, and cross-process determinism."""

from __future__ import annotations

import subprocess
import sys
import unittest
from decimal import Decimal
from pathlib import Path

from app.agents.framework.budget import BudgetTracker, EffectiveBudget
from app.agents.framework.errors import AuthorityViolation, MandateViolation, ToolViolation
from app.agents.framework.policy import DeploymentPolicy
from app.agents.framework.replay import ReplayLog
from app.tools.invocation import ToolCall, ToolInvocationContext, invoke_tool
from app.tools.registry import ToolRegistry
from app.workbench.catalogue import ALL_CALCULATORS, default_registry, register_workbench_tools
from app.workbench.context import WorkbenchExecutionContext, execute_authorized_calculation
from app.workbench.errors import CalculatorNotFound, WorkbenchInputError
from app.workbench.hashing import canonical_json
from app.workbench.registry import _execute_unchecked
from app.workbench.request import CalculationRequest, build_run_draft
from app.workbench.scenario import NamedScenario, run_scenarios

REGISTRY = default_registry()
ORG = "org-1"
CURRENCY_POLICY = {"base_currency": "EUR", "conversion_allowed": True, "accepted_fx_sources": ["ecb"], "fx_as_of_required": True, "allow_stale_rates": False, "rate_direction": "base_to_quote"}
ROUNDING_POLICY = {"mode": "half_even", "monetary_scale": "currency_minor_units", "rate_scale": 10}


def make_context(**overrides) -> WorkbenchExecutionContext:
    base = dict(
        organization_id=ORG,
        principal_id=ORG,
        principal_type="company",
        mandate_id="m-1",
        mandate_version=1,
        task_id="t-1",
        requested_authority="calculate",
        effective_authority="calculate",
        effective_tool_classes=["calculation"],
        effective_data_classes=["finance_read", "trade_context", "org_finance_profile"],
        trace_id="trc",
    )
    base.update(overrides)
    return WorkbenchExecutionContext(**base)


def make_request(calculator_id: str, inputs: dict, *, provenance: list | None = None, version: str | None = None, formula: str | None = None, **overrides) -> CalculationRequest:
    matches = [c for c in ALL_CALCULATORS if c.calculator_id == calculator_id]
    definition = matches[0]
    base = dict(
        calculator_id=calculator_id,
        calculator_version=version or definition.calculator_version,
        formula_version=formula or definition.formula_version,
        organization_id=ORG,
        principal_id=ORG,
        principal_type="company",
        mandate_id="m-1",
        mandate_version=1,
        task_id="t-1",
        inputs=inputs,
        input_provenance=provenance or [],
        currency_policy=CURRENCY_POLICY,
        rounding_policy=ROUNDING_POLICY,
        trace_id="trc",
        idempotency_key="idem",
    )
    base.update(overrides)
    return CalculationRequest.model_validate(base)


def prov(paths_kinds: dict[str, str]) -> list[dict]:
    return [{"input_path": path, "kind": kind} for path, kind in paths_kinds.items()]


def run(calculator_id: str, inputs: dict, *, provenance: list | None = None, context: WorkbenchExecutionContext | None = None, **overrides):
    request = make_request(calculator_id, inputs, provenance=provenance, **overrides)
    result, _draft = execute_authorized_calculation(REGISTRY, request, context or make_context())
    return result


# Provenance helpers per calculator used repeatedly.
PNL_PROV = prov({"revenue": "user_provided", "variable_costs": "user_provided", "fixed_costs": "user_provided", "transaction_specific_costs": "user_provided", "financing_costs": "user_provided"})
RECV_PROV = prov({"invoice_exists": "verified_fact", "receivable_exists": "verified_fact", "delivery_complete": "verified_fact", "invoice_amount": "verified_fact", "advance_rate": "user_provided", "discount_annual_rate": "user_provided"})


class AuthorizationTest(unittest.TestCase):
    def test_principal_and_org_mismatch_rejected(self) -> None:
        request = make_request("capital.calculate_ccc", {"inventory_days": "10", "receivable_days": "40", "payable_days": "30"}, provenance=prov({"inventory_days": "user_provided", "receivable_days": "user_provided", "payable_days": "user_provided"}))
        with self.assertRaises(MandateViolation):
            execute_authorized_calculation(REGISTRY, request, make_context(organization_id="org-2", principal_id="org-2"))
        with self.assertRaises(MandateViolation):
            execute_authorized_calculation(REGISTRY, request, make_context(principal_id="org-9"))

    def test_financier_context_rejected(self) -> None:
        request = make_request("capital.calculate_ccc", {"inventory_days": "1", "receivable_days": "1", "payable_days": "1"})
        with self.assertRaises(MandateViolation) as ctx:
            execute_authorized_calculation(REGISTRY, request, make_context(principal_type="financier"))
        self.assertEqual(ctx.exception.code, "workbench.principal_not_activated")

    def test_insufficient_authority_and_scope_rejected(self) -> None:
        request = make_request("capital.calculate_ccc", {"inventory_days": "1", "receivable_days": "1", "payable_days": "1"})
        with self.assertRaises(AuthorityViolation):
            execute_authorized_calculation(REGISTRY, request, make_context(effective_authority="observe"))
        with self.assertRaises(MandateViolation):
            execute_authorized_calculation(REGISTRY, request, make_context(effective_tool_classes=["context_read"]))

    def test_task_binding_mismatch_rejected(self) -> None:
        request = make_request("capital.calculate_ccc", {"inventory_days": "1", "receivable_days": "1", "payable_days": "1"}, task_id="t-other")
        with self.assertRaises(MandateViolation) as ctx:
            execute_authorized_calculation(REGISTRY, request, make_context())
        self.assertEqual(ctx.exception.code, "workbench.context_mismatch")


class VersioningTest(unittest.TestCase):
    def test_exact_calculator_and_formula_version(self) -> None:
        with self.assertRaises(CalculatorNotFound):
            REGISTRY.get("capital.calculate_trade_cost", "9.9.9")
        request = make_request("capital.calculate_trade_cost", {"reporting_currency": "EUR", "components": [{"category": "p", "amount": "10", "currency": "EUR"}]}, formula="trade-cost-waterfall-v99")
        with self.assertRaises(CalculatorNotFound):
            _execute_unchecked(REGISTRY, request)


class RunDraftTest(unittest.TestCase):
    def test_draft_preserves_bindings_policies_and_provenance(self) -> None:
        request = make_request("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "100", "variable_costs": "40"}, provenance=PNL_PROV, outcome_id="o-1", scenario_id="s-1")
        result, draft = execute_authorized_calculation(REGISTRY, request, make_context(actor_user_id="u-1"))
        self.assertEqual(result.status, "completed")
        self.assertEqual(draft.status, "completed")
        self.assertEqual(draft.organization_id, ORG)
        self.assertEqual(draft.principal_id, ORG)
        self.assertEqual((draft.mandate_id, draft.mandate_version), ("m-1", 1))
        self.assertEqual((draft.task_id, draft.outcome_id, draft.scenario_id), ("t-1", "o-1", "s-1"))
        self.assertEqual(draft.currency_policy.base_currency, "EUR")
        self.assertEqual(draft.rounding_policy.mode, "half_even")
        self.assertEqual(len(draft.input_provenance), len(PNL_PROV))
        self.assertEqual(draft.executed_by, "workbench")
        self.assertEqual(draft.actor_user_id, "u-1")
        self.assertEqual(draft.idempotency_key, "idem")
        self.assertEqual(draft.input_hash, result.input_hash)

    def test_unsupported_rounding_policy_rejected(self) -> None:
        with self.assertRaises(Exception):
            make_request("capital.calculate_ccc", {}, rounding_policy={"mode": "half_up", "monetary_scale": "currency_minor_units", "rate_scale": 10})


class ProvenanceTest(unittest.TestCase):
    def test_missing_material_provenance_detected(self) -> None:
        result = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "100"}, provenance=[])
        self.assertEqual(result.status, "invalid_input")
        self.assertEqual(result.outputs["errors"][0]["code"], "input.provenance_missing")

    def test_unresolved_material_input_never_becomes_zero(self) -> None:
        provenance = prov({"revenue": "unresolved"})
        result = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "0"}, provenance=provenance)
        self.assertEqual(result.status, "insufficient_information")
        self.assertIn("revenue", result.missing_fields)
        self.assertEqual(result.outputs, {})

    def test_assumptions_stay_visible(self) -> None:
        components = [{"category": "freight", "amount": "100", "currency": "EUR", "provenance": "assumption"}]
        result = run("capital.calculate_trade_cost", {"reporting_currency": "EUR", "components": components}, provenance=prov({"components[0].amount": "assumption"}))
        self.assertTrue(any("assumption" in a for a in result.assumptions_used))


class HashingTest(unittest.TestCase):
    BASE_INPUTS = {"currency": "EUR", "revenue": "100", "variable_costs": "40"}

    def _result(self, **overrides):
        return run("capital.calculate_transaction_pnl", dict(self.BASE_INPUTS), provenance=PNL_PROV, **overrides)

    def test_policies_and_scenario_affect_input_hash(self) -> None:
        base = self._result()
        other_currency = self._result(currency_policy={**CURRENCY_POLICY, "base_currency": "USD"})
        self.assertNotEqual(base.input_hash, other_currency.input_hash)
        scenario = self._result(scenario_id="s-1")
        self.assertNotEqual(base.input_hash, scenario.input_hash)
        # Provenance classification is hash-relevant.
        reclassified = run("capital.calculate_transaction_pnl", dict(self.BASE_INPUTS), provenance=prov({**{p["input_path"]: p["kind"] for p in PNL_PROV}, "revenue": "assumption"}))
        self.assertNotEqual(base.input_hash, reclassified.input_hash)

    def test_result_hash_covers_envelope_not_only_outputs(self) -> None:
        complete = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": True, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True, "invoice_amount": "60000", "due_in_days": 60, "advance_rate": "0.85", "discount_annual_rate": "0.09"}, provenance=RECV_PROV)
        ineligible = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": False, "receivable_exists": False, "delivery_complete": False, "buyer_acceptance": False}, provenance=RECV_PROV)
        insufficient = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": True}, provenance=RECV_PROV)
        hashes = {complete.result_hash, ineligible.result_hash, insufficient.result_hash}
        self.assertEqual(len(hashes), 3)
        self.assertEqual((complete.eligibility, ineligible.eligibility, insufficient.eligibility), ("eligible", "ineligible", "insufficient_information"))

    def test_unordered_permutations_hash_identically_ordered_changes_do_not(self) -> None:
        events = [
            {"on": "2026-08-01", "amount": "-10", "currency": "EUR", "label": "b"},
            {"on": "2026-08-02", "amount": "-5", "currency": "EUR", "label": "a"},
        ]
        provenance = prov({"opening_cash": "user_provided", "events[0].amount": "user_provided", "events[1].amount": "user_provided"})
        first = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "events": events}, provenance=provenance)
        second = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "events": list(reversed(events))}, provenance=provenance)
        self.assertEqual(first.input_hash, second.input_hash)
        self.assertEqual(first.result_hash, second.result_hash)
        changed = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "events": [{**events[0], "amount": "-11"}, events[1]]}, provenance=provenance)
        self.assertNotEqual(first.input_hash, changed.input_hash)

    def test_hashes_identical_across_separate_processes(self) -> None:
        script = (
            "import json,sys;"
            "sys.path.insert(0, sys.argv[1]);"
            "from tests.test_workbench import run, PNL_PROV;"
            "r = run('capital.calculate_transaction_pnl', {'currency':'EUR','revenue':'100','variable_costs':'40'}, provenance=PNL_PROV);"
            "print(json.dumps({'i': r.input_hash, 'r': r.result_hash}))"
        )
        root = str(Path(__file__).resolve().parent.parent)
        outputs = []
        for _ in range(2):
            proc = subprocess.run([sys.executable, "-c", script, root], capture_output=True, text=True, check=True)
            outputs.append(proc.stdout.strip().splitlines()[-1])
        self.assertEqual(outputs[0], outputs[1])
        local = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "100", "variable_costs": "40"}, provenance=PNL_PROV)
        import json as _json

        remote = _json.loads(outputs[0])
        self.assertEqual(remote, {"i": local.input_hash, "r": local.result_hash})

    def test_null_and_missing_distinct(self) -> None:
        self.assertNotEqual(canonical_json({"a": None}), canonical_json({}))


class StatusModelTest(unittest.TestCase):
    def test_contradiction_is_not_completed(self) -> None:
        result = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": False, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True}, provenance=RECV_PROV)
        self.assertEqual(result.status, "insufficient_information")
        self.assertTrue(result.contradictions)

    def test_structural_ineligibility_is_completed(self) -> None:
        result = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": False, "receivable_exists": False, "delivery_complete": False, "buyer_acceptance": False}, provenance=RECV_PROV)
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.eligibility, "ineligible")
        self.assertEqual(result.outputs["structural_eligibility"], "ineligible")

    def test_invalid_ranges_rejected_not_softened(self) -> None:
        for inputs, provenance in [
            ({"currency": "EUR", "invoice_exists": True, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True, "invoice_amount": "100", "due_in_days": 30, "advance_rate": "1.5", "discount_annual_rate": "0.1"}, RECV_PROV),
            ({"currency": "EUR", "invoice_exists": True, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True, "invoice_amount": "100", "due_in_days": 30, "advance_rate": "0.9", "reserve_rate": "0.2", "discount_annual_rate": "0.1"}, RECV_PROV),
        ]:
            result = run("capital.calculate_receivables_finance", inputs, provenance=provenance)
            self.assertEqual(result.status, "invalid_input")


class CalculatorCorrectnessTest(unittest.TestCase):
    def test_same_day_events_aggregate_no_artificial_deficit(self) -> None:
        # Outflow and inflow on the SAME day: aggregation nets to zero — no
        # label-alphabetical intraday deficit.
        events = [
            {"on": "2026-08-01", "amount": "-50000", "currency": "EUR", "label": "a-pay-supplier"},
            {"on": "2026-08-01", "amount": "50000", "currency": "EUR", "label": "z-draw-facility"},
        ]
        result = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "events": events}, provenance=prov({"events[0].amount": "user_provided", "events[1].amount": "user_provided", "opening_cash": "user_provided"}))
        self.assertEqual(result.outputs["peak_cash_deficit"], "0.00")
        self.assertEqual(result.outputs["same_day_model"], "aggregate_by_date")
        self.assertEqual(result.outputs["recovery_definition"], "recovery_to_zero")

    def test_working_capital_sources_applied_without_double_count(self) -> None:
        events = [
            {"on": "2026-08-01", "amount": "-40000", "currency": "EUR"},
            {"on": "2026-09-15", "amount": "-20000", "currency": "EUR"},
            {"on": "2026-11-30", "amount": "72000", "currency": "EUR"},
        ]
        provenance = prov({"opening_cash": "user_provided", "events[0].amount": "user_provided", "events[1].amount": "user_provided", "events[2].amount": "user_provided", "additional_internal_liquidity": "user_provided", "committed_facilities": "user_provided"})
        result = run("capital.calculate_working_capital", {"currency": "EUR", "opening_cash": "10000", "events": events, "additional_internal_liquidity": "20000", "committed_facilities": "100000"}, provenance=provenance)
        self.assertEqual(result.outputs["gross_peak_requirement"], "50000.00")
        self.assertEqual(result.outputs["internal_liquidity_applied"], "20000.00")
        self.assertEqual(result.outputs["committed_facilities_applied"], "30000.00")
        self.assertEqual(result.outputs["residual_funding_gap"], "0.00")
        self.assertEqual(result.outputs["gap_duration_days"], 76)

    def test_pnl_break_even_uses_only_variable_costs(self) -> None:
        result = run(
            "capital.calculate_transaction_pnl",
            {"currency": "EUR", "revenue": "1000", "variable_costs": "400", "fixed_costs": "300", "transaction_specific_costs": "100"},
            provenance=PNL_PROV,
        )
        # variable ratio 0.4 → break-even = (300+100)/(1-0.4) = 666.67
        self.assertEqual(result.outputs["break_even_revenue"], "666.67")
        self.assertEqual(result.outputs["contribution_margin"], "0.6000000000")

    def test_pnl_rejects_discounts_exceeding_revenue(self) -> None:
        result = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "100", "discounts": "150"}, provenance=PNL_PROV)
        self.assertEqual(result.status, "invalid_input")

    def test_financing_fee_timing_single_declaration(self) -> None:
        inputs = {
            "currency": "EUR",
            "principal": "50000",
            "annual_rate": "0.12",
            "tenor_days": 90,
            "fees": [
                {"label": "arrangement", "amount": "500", "timing": "withheld_at_disbursement"},
                {"label": "platform", "amount": "200", "timing": "paid_at_maturity"},
            ],
        }
        provenance = prov({"principal": "verified_fact", "annual_rate": "user_provided", "tenor_days": "user_provided", "fees[0].amount": "user_provided", "fees[1].amount": "user_provided"})
        result = run("capital.calculate_financing_cost", inputs, provenance=provenance)
        self.assertEqual(result.outputs["interest"], "1500.00")
        self.assertEqual(result.outputs["cash_received_at_disbursement"], "49500.00")
        self.assertEqual(result.outputs["total_financing_cost"], "2200.00")
        self.assertEqual(result.outputs["total_cash_repayment"], "51700.00")

    def test_fees_exceeding_principal_rejected(self) -> None:
        inputs = {"currency": "EUR", "principal": "1000", "annual_rate": "0.1", "tenor_days": 30, "fees": [{"label": "x", "amount": "2000", "timing": "withheld_at_disbursement"}]}
        result = run("capital.calculate_financing_cost", inputs, provenance=prov({"principal": "verified_fact", "annual_rate": "user_provided", "tenor_days": "user_provided", "fees[0].amount": "user_provided"}))
        self.assertEqual(result.status, "invalid_input")

    def test_debt_service_bullet_profile(self) -> None:
        provenance = prov({"principal": "verified_fact", "annual_rate": "user_provided", "periods": "user_provided", "period_days": "user_provided", "cash_available_per_period": "user_provided"})
        result = run("capital.calculate_debt_service", {"currency": "EUR", "principal": "120000", "annual_rate": "0.10", "periods": 4, "period_days": 90, "profile": "bullet"}, provenance=provenance)
        schedule = result.outputs["schedule"]
        self.assertEqual(schedule[0]["principal"], "0.00")
        self.assertEqual(schedule[3]["principal"], "120000.00")

    def test_xirr_dated_mode(self) -> None:
        provenance = prov({"cash_flows": "user_provided", "dated_flows": "user_provided", "discount_rate": "assumption"})
        result = run(
            "capital.calculate_investment_returns",
            {"currency": "EUR", "mode": "dated", "dated_flows": [{"on": "2026-01-01", "amount": "-1000"}, {"on": "2026-07-01", "amount": "550"}, {"on": "2027-01-01", "amount": "550"}], "discount_rate": "0.10"},
            provenance=provenance,
        )
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.outputs["mode"], "dated")
        self.assertEqual(result.outputs["irr_method"], "xirr_dated_bisection")
        self.assertIsNotNone(result.outputs["irr"])
        self.assertEqual(result.outputs["payback_date"], "2027-01-01")

    def test_multiple_irr_roots_flagged_not_authoritative(self) -> None:
        provenance = prov({"cash_flows": "user_provided", "dated_flows": "user_provided", "discount_rate": "assumption"})
        result = run("capital.calculate_investment_returns", {"currency": "EUR", "cash_flows": ["-100", "230", "-132"], "discount_rate": "0.05"}, provenance=provenance)
        self.assertIn("irr_not_unique", result.outputs["irr_diagnostic"] or "")
        self.assertTrue(any(w.code == "irr.multiple_roots" and w.severity == "critical" for w in result.warnings))

    def test_dilution_convention_required_and_returned(self) -> None:
        provenance = prov({"pre_money_valuation": "assumption", "new_capital": "user_provided", "existing_holder_pct": "verified_fact"})
        missing = run("capital.calculate_dilution", {"pre_money_valuation": "4000000", "new_capital": "1000000", "currency": "EUR", "existing_holder_pct": "0.40", "option_pool_added_pct": "0.10"}, provenance=provenance)
        self.assertEqual(missing.status, "insufficient_information")
        self.assertIn("option_pool_convention", missing.missing_fields)
        explicit = run("capital.calculate_dilution", {"pre_money_valuation": "4000000", "new_capital": "1000000", "currency": "EUR", "existing_holder_pct": "0.40", "option_pool_added_pct": "0.10", "option_pool_convention": "post_money_after_financing"}, provenance=provenance)
        self.assertEqual(explicit.outputs["option_pool_convention"], "post_money_after_financing")
        bad = run("capital.calculate_dilution", {"pre_money_valuation": "4000000", "new_capital": "1000000", "currency": "EUR", "existing_holder_pct": "1.40"}, provenance=provenance)
        self.assertEqual(bad.status, "invalid_input")

    def test_fx_stale_reference_and_overhedge(self) -> None:
        provenance = prov({"foreign_amount": "verified_fact", "reference_rate.rate": "user_provided", "hedged_amount": "user_provided"})
        stale = run(
            "capital.calculate_fx_scenarios",
            {"foreign_amount": "1000", "foreign_currency": "USD", "functional_currency": "EUR", "reference_rate": {"base_currency": "USD", "quote_currency": "EUR", "rate": "0.9", "source": "ecb", "as_of": "2026-01-01", "staleness": "stale"}},
            provenance=provenance,
        )
        self.assertEqual(stale.status, "invalid_input")
        over = run(
            "capital.calculate_fx_scenarios",
            {"foreign_amount": "1000", "foreign_currency": "USD", "functional_currency": "EUR", "hedged_amount": "1500", "reference_rate": {"base_currency": "USD", "quote_currency": "EUR", "rate": "0.9", "source": "ecb", "as_of": "2026-07-13"}},
            provenance=provenance,
        )
        self.assertTrue(over.outputs["hedge_exceeds_exposure"])
        self.assertTrue(any(w.code == "fx.hedge_exceeds_exposure" for w in over.warnings))

    def test_offer_product_specific_comparability(self) -> None:
        offers = [
            {"offer_id": "line", "provider_label": "Bank", "product": "credit_line", "currency": "EUR", "eligibility": "eligible", "principal_available": "50000", "effective_annual_cost": "0.11", "expected_days_to_funds": 10},
            {"offer_id": "loan", "provider_label": "Fintech", "product": "term_loan", "currency": "EUR", "eligibility": "eligible", "principal_available": "50000", "effective_annual_cost": "0.09", "expected_days_to_funds": 5},
        ]
        result = run("capital.compare_financing_options", {"reporting_currency": "EUR", "offers": offers}, provenance=prov({"offers[0].eligibility": "verified_fact", "offers[1].eligibility": "verified_fact"}))
        by_id = {o["offer_id"]: o for o in result.outputs["offers"]}
        self.assertEqual(by_id["line"]["comparability"], "comparable")  # credit_line needs fewer fields
        self.assertEqual(by_id["loan"]["comparability"], "incomparable")
        self.assertIn("net_proceeds", by_id["loan"]["unresolved_fields"])

    def test_leap_year_and_month_end_dates(self) -> None:
        events = [
            {"on": "2028-02-29", "amount": "-100", "currency": "EUR"},
            {"on": "2028-03-31", "amount": "100", "currency": "EUR"},
        ]
        result = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "events": events}, provenance=prov({"opening_cash": "user_provided", "events[0].amount": "user_provided", "events[1].amount": "user_provided"}))
        self.assertEqual(result.outputs["timeline"][0]["on"], "2028-02-29")
        self.assertEqual(result.outputs["recovery_date"], "2028-03-31")


class GoldenCasesTest(unittest.TestCase):
    def test_golden_a_pre_shipment(self) -> None:
        eligibility = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": False, "receivable_exists": False, "delivery_complete": False, "buyer_acceptance": False}, provenance=RECV_PROV)
        self.assertEqual(eligibility.eligibility, "ineligible")
        self.assertIn("no invoice exists", eligibility.outputs["eligibility_reasons"])
        events = [
            {"on": "2026-08-01", "amount": "-40000", "currency": "EUR", "label": "supplier deposit"},
            {"on": "2026-09-15", "amount": "-20000", "currency": "EUR", "label": "production balance"},
            {"on": "2026-11-30", "amount": "72000", "currency": "EUR", "label": "buyer payment"},
        ]
        provenance = prov({"opening_cash": "user_provided", "events[0].amount": "user_provided", "events[1].amount": "user_provided", "events[2].amount": "user_provided", "additional_internal_liquidity": "user_provided", "committed_facilities": "user_provided"})
        gap = run("capital.calculate_working_capital", {"currency": "EUR", "opening_cash": "5000", "events": events}, provenance=provenance)
        self.assertEqual(gap.outputs["gross_peak_requirement"], "55000.00")
        self.assertEqual(gap.status, "completed")

    def test_golden_b_accepted_invoice(self) -> None:
        result = run(
            "capital.calculate_receivables_finance",
            {"currency": "EUR", "invoice_exists": True, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True, "invoice_amount": "60000", "due_in_days": 60, "advance_rate": "0.85", "discount_annual_rate": "0.09", "service_fees": "300", "reserve_rate": "0.15"},
            provenance=RECV_PROV,
        )
        self.assertEqual((result.status, result.eligibility), ("completed", "eligible"))
        self.assertEqual(result.outputs["pricing_status"], "complete")
        self.assertEqual(result.outputs["advance_amount"], "51000.00")
        self.assertEqual(result.outputs["discount_charge"], "765.00")
        self.assertEqual(result.outputs["net_proceeds"], "49935.00")
        self.assertEqual(result.outputs["reserve_release_at_settlement"], "9000.00")

    def test_golden_b_eligible_structure_incomplete_pricing(self) -> None:
        result = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": True, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True}, provenance=RECV_PROV)
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.outputs["structural_eligibility"], "eligible")
        self.assertEqual(result.outputs["pricing_status"], "incomplete")
        self.assertIn("invoice_amount", result.outputs["missing_pricing_fields"])

    def test_golden_c_insufficient_information(self) -> None:
        result = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": True}, provenance=RECV_PROV)
        self.assertEqual(result.status, "insufficient_information")
        self.assertIn("receivable_exists", result.missing_fields)
        self.assertEqual(result.outputs, {})


class PropertyTest(unittest.TestCase):
    def test_landed_cost_component_sum_and_fee_monotonicity(self) -> None:
        components = [{"category": "product", "amount": "1000.00", "currency": "EUR"}, {"category": "freight", "amount": "150.00", "currency": "EUR"}]
        provenance = prov({"components[0].amount": "verified_fact", "components[1].amount": "verified_fact", "delivered_quantity": "verified_fact"})
        result = run("capital.calculate_landed_cost", {"reporting_currency": "EUR", "components": components, "delivered_quantity": "100"}, provenance=provenance)
        self.assertEqual(result.outputs["total_trade_cost"], "1150.00")
        total = sum(Decimal(v) for v in result.outputs["cost_by_category"].values())
        self.assertEqual(str(total), "1150.00")
        fee_prov = prov({"principal": "verified_fact", "annual_rate": "user_provided", "tenor_days": "user_provided", "fees[0].amount": "user_provided"})
        low = run("capital.calculate_financing_cost", {"currency": "EUR", "principal": "50000", "annual_rate": "0.12", "tenor_days": 90, "fees": [{"label": "f", "amount": "500", "timing": "withheld_at_disbursement"}]}, provenance=fee_prov)
        high = run("capital.calculate_financing_cost", {"currency": "EUR", "principal": "50000", "annual_rate": "0.12", "tenor_days": 90, "fees": [{"label": "f", "amount": "900", "timing": "withheld_at_disbursement"}]}, provenance=fee_prov)
        self.assertLess(Decimal(high.outputs["net_proceeds"]), Decimal(low.outputs["net_proceeds"]))

    def test_delayed_collection_never_shrinks_peak_gap(self) -> None:
        base_events = [
            {"on": "2026-08-01", "amount": "-40000", "currency": "EUR"},
            {"on": "2026-11-30", "amount": "72000", "currency": "EUR"},
        ]
        delayed = [base_events[0], {**base_events[1], "on": "2027-01-31"}]
        provenance = prov({"opening_cash": "user_provided", "events[0].amount": "user_provided", "events[1].amount": "user_provided", "additional_internal_liquidity": "user_provided", "committed_facilities": "user_provided"})
        base = run("capital.calculate_working_capital", {"currency": "EUR", "opening_cash": "10000", "events": base_events}, provenance=provenance)
        late = run("capital.calculate_working_capital", {"currency": "EUR", "opening_cash": "10000", "events": delayed}, provenance=provenance)
        self.assertGreaterEqual(Decimal(late.outputs["gross_peak_requirement"]), Decimal(base.outputs["gross_peak_requirement"]))

    def test_no_binary_floats_in_outputs(self) -> None:
        result = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "100.10", "variable_costs": "40.05"}, provenance=PNL_PROV)

        def walk(value):
            self.assertNotIsInstance(value, float)
            if isinstance(value, dict):
                for v in value.values():
                    walk(v)
            if isinstance(value, list):
                for v in value:
                    walk(v)

        walk(result.outputs)


class ScenarioEngineTest(unittest.TestCase):
    def test_allowlist_and_compare_key_enforced(self) -> None:
        base = make_request("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "1000", "variable_costs": "400"}, provenance=PNL_PROV)
        with self.assertRaises(WorkbenchInputError):
            run_scenarios(REGISTRY, base, [NamedScenario(name="bad", overrides={"currency": "USD"})], compare_key="gross_contribution", context=make_context())
        with self.assertRaises(WorkbenchInputError):
            run_scenarios(REGISTRY, base, [], compare_key="not_an_output", context=make_context())

    def test_scenarios_deltas_and_distinct_hashes(self) -> None:
        base = make_request("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "1000", "variable_costs": "400"}, provenance=PNL_PROV)
        report = run_scenarios(
            REGISTRY,
            base,
            [NamedScenario(name="price_down", overrides={"revenue": "900"}), NamedScenario(name="cost_up", overrides={"variable_costs": "440"})],
            compare_key="gross_contribution",
            context=make_context(),
        )
        self.assertEqual(report["base"]["value"], "600.00")
        deltas = {s["name"]: s["delta"] for s in report["scenarios"]}
        self.assertEqual(deltas, {"price_down": "-100.00", "cost_up": "-40.00"})
        self.assertEqual(report["most_material_driver"], "price_down")
        self.assertNotEqual(report["scenarios"][0]["input_hash"], report["base"]["input_hash"])


class ToolIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tools = ToolRegistry()
        register_workbench_tools(self.tools, REGISTRY)

    def _invoke(self, tool_input: dict):
        definition = self.tools.authorize(
            "capital.calculate_transaction_pnl",
            "1.1.0",
            effective_tool_classes=frozenset({"calculation"}),
            effective_authority="calculate",
            sensitivity_ceiling="confidential",
        )
        clock = {"t": 0.0}

        def source() -> float:
            clock["t"] += 0.001
            return clock["t"]

        return invoke_tool(
            ToolCall(tool_id="capital.calculate_transaction_pnl", tool_version="1.1.0", input=tool_input, trace_id="trc"),
            definition=definition,
            handler=self.tools.handler_for("capital.calculate_transaction_pnl", "1.1.0"),
            context=ToolInvocationContext(org_id=ORG, principal_id=ORG, principal_type="company", mandate_id="m-1", mandate_version=1, task_id="t-1", trace_id="trc", effective_authority="calculate", data_scope=["finance_read", "trade_context"]),
            budget=BudgetTracker(budget=EffectiveBudget(10.0, 1, 5, 100, None), deployment=DeploymentPolicy(), time_source=source),
            replay=ReplayLog("trc"),
        )

    def test_tool_requires_explicit_policies_and_key(self) -> None:
        from app.agents.framework.errors import SchemaViolation

        with self.assertRaises(SchemaViolation):
            self._invoke({"inputs": {"currency": "EUR", "revenue": "100"}})

    def test_governed_tool_execution_returns_result_and_draft(self) -> None:
        result = self._invoke(
            {
                "inputs": {"currency": "EUR", "revenue": "100", "variable_costs": "40"},
                "currency_policy": CURRENCY_POLICY,
                "rounding_policy": ROUNDING_POLICY,
                "input_provenance": PNL_PROV,
                "assumption_refs": [],
                "invocation_key": "call-1",
            }
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output["result"]["outputs"]["gross_contribution"], "60.00")
        self.assertEqual(result.output["run_draft"]["executed_by"], "workbench")
        self.assertEqual(result.output["run_draft"]["idempotency_key"], "call-1")

    def test_per_calculator_data_classes_and_sensitivity(self) -> None:
        with self.assertRaises(ToolViolation) as ctx:
            self.tools.authorize(
                "capital.calculate_liquidity_runway",
                "1.1.0",
                effective_tool_classes=frozenset({"calculation"}),
                effective_authority="calculate",
                sensitivity_ceiling="confidential",  # liquidity is restricted_financial
            )
        self.assertEqual(ctx.exception.code, "tool.sensitivity_exceeds_ceiling")

    def test_two_tool_versions_coexist_and_resolve_exactly(self) -> None:
        from app.tools.definition import ToolDefinition

        v1 = ToolDefinition(tool_id="capital.demo_tool", version="1.0.0", tool_class="calculation", owning_domain="capital", effect_class="calculate", required_authority="calculate", input_schema={}, output_schema={})
        v2 = ToolDefinition(tool_id="capital.demo_tool", version="2.0.0", tool_class="calculation", owning_domain="capital", effect_class="calculate", required_authority="calculate", input_schema={}, output_schema={})

        class H:
            def __init__(self, tag: str) -> None:
                self.tag = tag

            def handle(self, tool_input, context):
                return {"tag": self.tag}

        self.tools.register(v1, handler=H("one"))
        self.tools.register(v2, handler=H("two"))
        self.assertEqual(self.tools.handler_for("capital.demo_tool", "1.0.0").tag, "one")
        self.assertEqual(self.tools.handler_for("capital.demo_tool", "2.0.0").tag, "two")
        self.assertEqual(self.tools.authorize("capital.demo_tool", "2.0.0", effective_tool_classes=frozenset({"calculation"}), effective_authority="calculate").version, "2.0.0")
        with self.assertRaises(ToolViolation) as missing:
            self.tools.authorize("capital.demo_tool", "3.0.0", effective_tool_classes=frozenset({"calculation"}), effective_authority="calculate")
        self.assertEqual(missing.exception.code, "tool.unknown_version")
        with self.assertRaises(ToolViolation):
            self.tools.authorize("capital.demo_tool", "", effective_tool_classes=frozenset({"calculation"}), effective_authority="calculate")


if __name__ == "__main__":
    unittest.main()
