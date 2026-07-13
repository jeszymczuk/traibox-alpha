"""Phase 3 Financial Workbench tests (directive B10): fixtures, golden cases
A/B/C, property/invariant checks, deterministic hashing, strict validation."""

from __future__ import annotations

import unittest
from decimal import Decimal

from app.agents.framework.budget import BudgetTracker, EffectiveBudget
from app.agents.framework.policy import DeploymentPolicy
from app.agents.framework.replay import ReplayLog
from app.tools.invocation import ToolCall, ToolInvocationContext, invoke_tool
from app.tools.registry import ToolRegistry
from app.workbench.catalogue import ALL_CALCULATORS, default_registry, register_workbench_tools
from app.workbench.errors import CalculatorNotFound, WorkbenchInputError
from app.workbench.hashing import canonical_json, deterministic_hash
from app.workbench.registry import execute
from app.workbench.request import CalculationRequest
from app.workbench.scenario import NamedScenario, run_scenarios

REGISTRY = default_registry()
ORG = "org-1"


def make_request(calculator_id: str, version: str, formula: str, inputs: dict, **overrides) -> CalculationRequest:
    base = dict(
        calculator_id=calculator_id,
        calculator_version=version,
        formula_version=formula,
        organization_id=ORG,
        principal_id=ORG,
        principal_type="company",
        mandate_id="m-1",
        mandate_version=1,
        inputs=inputs,
        currency_policy={"base_currency": "EUR"},
        trace_id="trc",
        idempotency_key="idem",
    )
    base.update(overrides)
    return CalculationRequest.model_validate(base)


def run(calculator_id: str, inputs: dict, *, version: str = "1.0.0", formula: str | None = None):
    definition = REGISTRY.get(calculator_id, version)
    return execute(REGISTRY, make_request(calculator_id, version, formula or definition.formula_version, inputs))


class RegistryTest(unittest.TestCase):
    def test_catalogue_is_complete(self) -> None:
        self.assertEqual(len(ALL_CALCULATORS), 17)

    def test_unknown_calculator_and_version_fail_closed(self) -> None:
        with self.assertRaises(CalculatorNotFound):
            REGISTRY.get("capital.unknown", "1.0.0")
        with self.assertRaises(CalculatorNotFound):
            REGISTRY.get("capital.calculate_trade_cost", "9.9.9")

    def test_formula_version_never_silently_swapped(self) -> None:
        with self.assertRaises(CalculatorNotFound):
            execute(REGISTRY, make_request("capital.calculate_trade_cost", "1.0.0", "trade-cost-waterfall-v99", {"reporting_currency": "EUR", "components": [{"category": "product", "amount": "10", "currency": "EUR"}]}))


class DecimalPolicyTest(unittest.TestCase):
    def test_floats_rejected_for_money(self) -> None:
        result = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": 100.5})
        self.assertEqual(result.status, "invalid_input")

    def test_no_binary_float_in_outputs(self) -> None:
        result = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "100.10", "direct_costs": "40.05"})
        def walk(value):
            self.assertNotIsInstance(value, float)
            if isinstance(value, dict):
                for v in value.values():
                    walk(v)
            if isinstance(value, list):
                for v in value:
                    walk(v)
        walk(result.outputs)

    def test_bankers_rounding_boundary(self) -> None:
        result = run("capital.calculate_trade_cost", {"reporting_currency": "EUR", "components": [{"category": "a", "amount": "0.005", "currency": "EUR"}, {"category": "b", "amount": "0.015", "currency": "EUR"}]})
        # 0.020 total; half-even applies at quantization of the sum.
        self.assertEqual(result.outputs["total_trade_cost"], "0.02")


class HashingTest(unittest.TestCase):
    def test_hash_stability_and_key_order(self) -> None:
        a = deterministic_hash({"b": Decimal("1.10"), "a": [1, 2]}, calculator_id="x", calculator_version="1", formula_version="f")
        b = deterministic_hash({"a": [1, 2], "b": Decimal("1.10")}, calculator_id="x", calculator_version="1", formula_version="f")
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("sha256:"))

    def test_null_and_missing_are_distinct(self) -> None:
        self.assertNotEqual(canonical_json({"a": None}), canonical_json({}))

    def test_same_inputs_same_hashes_across_runs(self) -> None:
        inputs = {"currency": "EUR", "revenue": "100", "direct_costs": "40"}
        first = run("capital.calculate_transaction_pnl", inputs)
        second = run("capital.calculate_transaction_pnl", inputs)
        self.assertEqual(first.input_hash, second.input_hash)
        self.assertEqual(first.result_hash, second.result_hash)


class TradeAndLandedCostTest(unittest.TestCase):
    COMPONENTS = [
        {"category": "product", "amount": "1000.00", "currency": "EUR"},
        {"category": "freight", "amount": "150.00", "currency": "EUR"},
        {"category": "duty", "amount": "50.00", "currency": "EUR"},
        {"category": "vat", "amount": "210.00", "currency": "EUR", "recoverable": True},
    ]

    def test_landed_cost_equals_component_sum_property(self) -> None:
        result = run("capital.calculate_landed_cost", {"reporting_currency": "EUR", "components": self.COMPONENTS, "delivered_quantity": "100"})
        self.assertEqual(result.outputs["total_trade_cost"], "1200.00")  # recoverable VAT excluded
        self.assertEqual(result.outputs["landed_cost_per_unit"], "12.00")
        total = sum(Decimal(v) for v in result.outputs["cost_by_category"].values())
        self.assertEqual(str(total), "1200.00")

    def test_currency_mismatch_requires_explicit_rate(self) -> None:
        components = [{"category": "freight", "amount": "100", "currency": "USD"}]
        result = run("capital.calculate_trade_cost", {"reporting_currency": "EUR", "components": components})
        self.assertEqual(result.status, "invalid_input")
        result_ok = run(
            "capital.calculate_trade_cost",
            {"reporting_currency": "EUR", "components": components, "fx_rates": [{"base_currency": "USD", "quote_currency": "EUR", "rate": "0.90", "source": "ecb", "as_of": "2026-07-13"}]},
        )
        self.assertEqual(result_ok.outputs["total_trade_cost"], "90.00")

    def test_stale_and_inverted_rates_rejected(self) -> None:
        components = [{"category": "freight", "amount": "100", "currency": "USD"}]
        stale = run("capital.calculate_trade_cost", {"reporting_currency": "EUR", "components": components, "fx_rates": [{"base_currency": "USD", "quote_currency": "EUR", "rate": "0.90", "source": "ecb", "as_of": "2026-01-01", "staleness": "stale"}]})
        self.assertEqual(stale.status, "invalid_input")
        inverted = run("capital.calculate_trade_cost", {"reporting_currency": "EUR", "components": components, "fx_rates": [{"base_currency": "EUR", "quote_currency": "USD", "rate": "1.11", "source": "ecb", "as_of": "2026-07-13"}]})
        self.assertEqual(inverted.status, "invalid_input")

    def test_zero_quantity_is_insufficient(self) -> None:
        result = run("capital.calculate_landed_cost", {"reporting_currency": "EUR", "components": self.COMPONENTS, "delivered_quantity": "0"})
        self.assertEqual(result.status, "insufficient_information")
        self.assertIn("delivered_quantity", result.missing_fields)


class PnlTest(unittest.TestCase):
    def test_contribution_identity_property(self) -> None:
        result = run("capital.calculate_transaction_pnl", {"currency": "EUR", "revenue": "1000", "discounts": "50", "direct_costs": "400", "trade_costs": "100", "financing_costs": "25"})
        self.assertEqual(Decimal(result.outputs["gross_contribution"]), Decimal("950") - Decimal("525"))
        self.assertEqual(result.outputs["contribution_margin"], "0.4473684211")

    def test_aggregate_rejects_mixed_currencies(self) -> None:
        items = [
            {"key": "t1", "group": "PT-NO", "currency": "EUR", "gross_contribution": "10", "net_revenue": "100"},
            {"key": "t2", "group": "PT-NO", "currency": "USD", "gross_contribution": "5", "net_revenue": "50"},
        ]
        result = run("capital.calculate_aggregate_pnl", {"reporting_currency": "EUR", "items": items})
        self.assertEqual(result.status, "insufficient_information")


class CashflowTest(unittest.TestCase):
    EVENTS = [
        {"on": "2026-08-01", "amount": "-40000", "currency": "EUR", "label": "supplier deposit"},
        {"on": "2026-09-15", "amount": "-20000", "currency": "EUR", "label": "production balance"},
        {"on": "2026-11-30", "amount": "72000", "currency": "EUR", "label": "buyer payment"},
    ]

    def test_peak_deficit_and_recovery(self) -> None:
        result = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "opening_cash": "10000", "events": self.EVENTS})
        self.assertEqual(result.outputs["peak_cash_deficit"], "-50000.00")
        self.assertEqual(result.outputs["cash_need_date"], "2026-09-15")
        self.assertEqual(result.outputs["recovery_date"], "2026-11-30")

    def test_delaying_collection_cannot_reduce_peak_gap_property(self) -> None:
        delayed = [dict(e) for e in self.EVENTS]
        delayed[2]["on"] = "2027-01-31"
        base = run("capital.calculate_working_capital", {"currency": "EUR", "opening_cash": "10000", "events": self.EVENTS})
        late = run("capital.calculate_working_capital", {"currency": "EUR", "opening_cash": "10000", "events": delayed})
        self.assertGreaterEqual(Decimal(late.outputs["peak_working_capital_requirement"]), Decimal(base.outputs["peak_working_capital_requirement"]))

    def test_duplicate_dates_are_deterministic(self) -> None:
        events = [
            {"on": "2026-08-01", "amount": "-10", "currency": "EUR", "label": "b"},
            {"on": "2026-08-01", "amount": "-5", "currency": "EUR", "label": "a"},
        ]
        first = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "events": events})
        second = run("capital.calculate_cashflow_timeline", {"currency": "EUR", "events": list(reversed(events))})
        self.assertEqual(first.result_hash, second.result_hash)

    def test_ccc_omitted_without_accounting_inputs(self) -> None:
        result = run("capital.calculate_ccc", {"receivable_days": "45"})
        self.assertEqual(result.status, "insufficient_information")
        self.assertIn("inventory_days", result.missing_fields)


class FinancingTest(unittest.TestCase):
    def test_simple_interest_act360(self) -> None:
        result = run("capital.calculate_financing_cost", {"currency": "EUR", "principal": "50000", "annual_rate": "0.12", "tenor_days": 90, "upfront_fees": "500", "fees_withheld_at_disbursement": "500"})
        self.assertEqual(result.outputs["interest"], "1500.00")
        self.assertEqual(result.outputs["net_proceeds"], "49500.00")
        self.assertEqual(result.outputs["total_financing_cost"], "2000.00")

    def test_increasing_fee_cannot_improve_net_proceeds_property(self) -> None:
        base = run("capital.calculate_financing_cost", {"currency": "EUR", "principal": "50000", "annual_rate": "0.12", "tenor_days": 90, "fees_withheld_at_disbursement": "500"})
        higher = run("capital.calculate_financing_cost", {"currency": "EUR", "principal": "50000", "annual_rate": "0.12", "tenor_days": 90, "fees_withheld_at_disbursement": "900"})
        self.assertLess(Decimal(higher.outputs["net_proceeds"]), Decimal(base.outputs["net_proceeds"]))

    def test_negative_principal_insufficient(self) -> None:
        result = run("capital.calculate_financing_cost", {"currency": "EUR", "principal": "-1", "annual_rate": "0.1", "tenor_days": 30})
        self.assertEqual(result.status, "insufficient_information")

    def test_debt_service_schedule_and_dscr(self) -> None:
        result = run("capital.calculate_debt_service", {"currency": "EUR", "principal": "120000", "annual_rate": "0.10", "periods": 4, "period_days": 90, "cash_available_per_period": "40000"})
        self.assertEqual(len(result.outputs["schedule"]), 4)
        self.assertIsNotNone(result.outputs["min_dscr"])


class GoldenCasesTest(unittest.TestCase):
    def test_golden_a_pre_shipment_po_finance(self) -> None:
        # PO exists; no invoice, no receivable → factoring INELIGIBLE, no fabrication.
        eligibility = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": False, "receivable_exists": False, "delivery_complete": False, "buyer_acceptance": False})
        self.assertEqual(eligibility.eligibility, "ineligible")
        self.assertIn("no invoice exists", eligibility.outputs["reasons"])
        # The pre-shipment gap is calculable from the PO cash-flow timeline.
        gap = run("capital.calculate_working_capital", {"currency": "EUR", "opening_cash": "5000", "events": CashflowTest.EVENTS})
        self.assertEqual(gap.outputs["peak_working_capital_requirement"], "55000.00")
        self.assertEqual(gap.status, "completed")

    def test_golden_b_post_delivery_accepted_invoice(self) -> None:
        result = run(
            "capital.calculate_receivables_finance",
            {"currency": "EUR", "invoice_exists": True, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True, "invoice_amount": "60000", "due_in_days": 60, "advance_rate": "0.85", "discount_annual_rate": "0.09", "service_fees": "300", "reserve_rate": "0.15"},
        )
        self.assertEqual(result.eligibility, "eligible")
        self.assertEqual(result.outputs["advance_amount"], "51000.00")
        self.assertEqual(result.outputs["discount_charge"], "765.00")
        self.assertEqual(result.outputs["net_proceeds"], "49935.00")
        self.assertLessEqual(Decimal(result.outputs["net_proceeds"]), Decimal("60000"))

    def test_golden_c_insufficient_information(self) -> None:
        result = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": True})
        self.assertEqual(result.status, "insufficient_information")
        self.assertEqual(result.eligibility, "insufficient_information")
        self.assertIn("receivable_exists", result.missing_fields)
        self.assertEqual(result.outputs, {})  # nothing fabricated

    def test_golden_contradictory_evidence(self) -> None:
        result = run("capital.calculate_receivables_finance", {"currency": "EUR", "invoice_exists": False, "receivable_exists": True, "delivery_complete": True, "buyer_acceptance": True})
        self.assertEqual(result.eligibility, "insufficient_information")
        self.assertTrue(result.outputs["contradictions"])


class OfferComparisonTest(unittest.TestCase):
    def test_ineligible_never_outranks_eligible(self) -> None:
        offers = [
            {"offer_id": "cheap-but-ineligible", "provider_label": "A", "currency": "EUR", "eligibility": "ineligible", "ineligibility_reasons": ["no receivable"], "effective_annual_cost": "0.01"},
            {"offer_id": "eligible", "provider_label": "B", "currency": "EUR", "eligibility": "eligible", "principal_available": "50000", "net_proceeds": "49000", "total_cost": "2000", "tenor_days": 90, "effective_annual_cost": "0.16", "recourse": True, "expected_days_to_funds": 7},
        ]
        result = run("capital.compare_financing_options", {"reporting_currency": "EUR", "offers": offers})
        self.assertEqual(result.outputs["offers"][0]["offer_id"], "eligible")
        self.assertEqual(result.outputs["offers"][1]["comparability"], "incomparable")

    def test_missing_terms_are_visible_not_hidden(self) -> None:
        offers = [{"offer_id": "o1", "provider_label": "A", "currency": "EUR", "eligibility": "eligible", "net_proceeds": "49000"}]
        result = run("capital.compare_financing_options", {"reporting_currency": "EUR", "offers": offers})
        self.assertIn("total_cost", result.outputs["offers"][0]["unresolved_fields"])


class InvestmentTest(unittest.TestCase):
    def test_npv_irr_payback(self) -> None:
        result = run("capital.calculate_investment_returns", {"currency": "EUR", "cash_flows": ["-1000", "500", "500", "500"], "discount_rate": "0.10"})
        self.assertEqual(result.outputs["npv"], "243.43")
        self.assertAlmostEqual(float(result.outputs["irr"]), 0.2337, places=3)
        self.assertEqual(result.outputs["payback_period_index"], 2)

    def test_no_valid_irr_diagnostic(self) -> None:
        result = run("capital.calculate_investment_returns", {"currency": "EUR", "cash_flows": ["-100", "-50", "-25"], "discount_rate": "0.10"})
        self.assertIsNone(result.outputs["irr"])
        self.assertIn("no_valid_irr", result.outputs["irr_diagnostic"])

    def test_dilution(self) -> None:
        result = run("capital.calculate_dilution", {"pre_money_valuation": "4000000", "new_capital": "1000000", "currency": "EUR", "existing_holder_pct": "0.40"})
        self.assertEqual(result.outputs["post_money_valuation"], "5000000.00")
        self.assertEqual(result.outputs["new_investor_pct"], "0.2000000000")
        self.assertEqual(result.outputs["existing_holder_post_pct"], "0.3200000000")
        self.assertIn("valuation is an explicit assumption, not a verified fact", result.assumptions_used)


class FxMilestoneExposureTest(unittest.TestCase):
    def test_fx_scenarios(self) -> None:
        result = run(
            "capital.calculate_fx_scenarios",
            {"foreign_amount": "100000", "foreign_currency": "USD", "functional_currency": "EUR", "reference_rate": {"base_currency": "USD", "quote_currency": "EUR", "rate": "0.90", "source": "ecb", "as_of": "2026-07-13"}, "scenarios": [{"name": "weak_usd", "rate": "0.85"}], "hedged_amount": "40000"},
        )
        self.assertEqual(result.outputs["base_settlement_value"], "90000.00")
        self.assertEqual(result.outputs["scenarios"][0]["gain_loss_vs_reference"], "-5000.00")
        self.assertEqual(result.outputs["scenarios"][0]["residual_exposure_impact"], "-3000.00")

    def test_condition_statuses(self) -> None:
        result = run(
            "capital.evaluate_conditions",
            {"conditions": [
                {"condition_id": "c1", "kind": "invoice_issued", "observed": True},
                {"condition_id": "c2", "kind": "acceptance_present", "observed": None},
                {"condition_id": "c3", "kind": "covenant_threshold", "threshold": "1.2", "actual": "1.1"},
                {"condition_id": "c4", "kind": "delivery_evidence", "observed": True, "contradicted": True},
            ]},
        )
        statuses = {c["condition_id"]: c["status"] for c in result.outputs["conditions"]}
        self.assertEqual(statuses, {"c1": "satisfied", "c2": "insufficient_information", "c3": "not_satisfied", "c4": "contradictory_evidence"})

    def test_company_exposure_concentration(self) -> None:
        items = [
            {"key": "i1", "counterparty": "Buyer A", "currency": "EUR", "amount": "75000"},
            {"key": "i2", "counterparty": "Buyer B", "currency": "EUR", "amount": "25000"},
        ]
        result = run("capital.calculate_company_exposure", {"reporting_currency": "EUR", "items": items})
        self.assertEqual(result.outputs["concentration"]["Buyer A"], "0.7500")


class ScenarioEngineTest(unittest.TestCase):
    def test_scenarios_and_most_material_driver(self) -> None:
        base = make_request("capital.calculate_transaction_pnl", "1.0.0", "pnl-waterfall-v1", {"currency": "EUR", "revenue": "1000", "direct_costs": "400"})
        report = run_scenarios(
            REGISTRY,
            base,
            [NamedScenario(name="price_down", overrides={"revenue": "900"}), NamedScenario(name="cost_up", overrides={"direct_costs": "440"})],
            compare_key="gross_contribution",
        )
        self.assertEqual(report["base"]["value"], "600.00")
        deltas = {s["name"]: s["delta"] for s in report["scenarios"]}
        self.assertEqual(deltas, {"price_down": "-100.00", "cost_up": "-40.00"})
        self.assertEqual(report["most_material_driver"], "price_down")

    def test_undeclared_variable_rejected(self) -> None:
        base = make_request("capital.calculate_transaction_pnl", "1.0.0", "pnl-waterfall-v1", {"currency": "EUR", "revenue": "1000"})
        with self.assertRaises(WorkbenchInputError):
            run_scenarios(REGISTRY, base, [NamedScenario(name="bad", overrides={"not_an_input": "1"})], compare_key="gross_contribution")


class ToolIntegrationTest(unittest.TestCase):
    def test_calculators_register_as_budgeted_calculate_tools(self) -> None:
        tools = ToolRegistry()
        register_workbench_tools(tools, REGISTRY)
        definition = tools.authorize(
            "capital.calculate_transaction_pnl",
            effective_tool_classes=frozenset({"calculation"}),
            effective_authority="calculate",
            sensitivity_ceiling="confidential",
        )
        self.assertEqual(definition.effect_class, "calculate")
        clock = {"t": 0.0}

        def source() -> float:
            clock["t"] += 0.001
            return clock["t"]

        result = invoke_tool(
            ToolCall(tool_id="capital.calculate_transaction_pnl", input={"inputs": {"currency": "EUR", "revenue": "100", "direct_costs": "40"}, "base_currency": "EUR"}, trace_id="trc"),
            definition=definition,
            handler=tools.handler_for("capital.calculate_transaction_pnl"),
            context=ToolInvocationContext(org_id=ORG, principal_id=ORG, principal_type="company", mandate_id="m-1", mandate_version=1, task_id="t-1", trace_id="trc", effective_authority="calculate", data_scope=["selected_objects"]),
            budget=BudgetTracker(budget=EffectiveBudget(10.0, 1, 5, 100, None), deployment=DeploymentPolicy(), time_source=source),
            replay=ReplayLog("trc"),
        )
        self.assertEqual(result.status, "success")
        self.assertEqual(result.output["result"]["outputs"]["gross_contribution"], "60.00")
        self.assertEqual(result.output["result"]["executed_by"], "workbench")

    def test_calculate_authority_required(self) -> None:
        from app.agents.framework.errors import ToolViolation

        tools = ToolRegistry()
        register_workbench_tools(tools, REGISTRY)
        with self.assertRaises(ToolViolation):
            tools.authorize("capital.calculate_transaction_pnl", effective_tool_classes=frozenset({"calculation"}), effective_authority="observe")


if __name__ == "__main__":
    unittest.main()
