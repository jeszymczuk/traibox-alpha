"""Company-side outcome catalogue (Phase 4 §§D5–D6).

Every ACTIVE company-side outcome type from the Capital Agent definition is
implemented as a REUSABLE declarative definition over the deterministic
Workbench — required calculators with exact versions, a builder mapping
outcome inputs to calculator inputs, and a composer whose every number comes
from calculator outputs or supplied inputs. No bespoke per-outcome pipelines;
the shared runner executes all of them.

Section conventions for outcome `inputs`:
  pnl / trade_cost / landed_cost / cashflow / working_capital / receivables /
  financing_cost / offers / liquidity / fx / conditions / debt / dilution /
  investment / aggregate_pnl / exposure / ccc — each an optional dict holding
  that calculator's inputs plus an optional 'provenance' list (path-based,
  relative to the calculator inputs).
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from ..workbench.request import CalculationResult
from .definition import ArtifactPolicy, OutcomeDefinition, OutcomeDefinitionRegistry, RecommendationPolicy, RequiredCalculation

# ---------------------------------------------------------------------------
# Shared builder helpers
# ---------------------------------------------------------------------------


def _section(name: str):
    def build(inputs: dict[str, Any]) -> dict[str, Any] | None:
        section = inputs.get(name)
        if not isinstance(section, dict) or not section:
            return None
        payload = {key: value for key, value in section.items() if key != "provenance"}
        return {"inputs": payload, "provenance": section.get("provenance", [])}

    return build


def _out(results: dict[str, CalculationResult], key: str) -> dict[str, Any]:
    result = results.get(key)
    return result.outputs if result is not None and result.status == "completed" else {}


def _status(results: dict[str, CalculationResult], key: str) -> str:
    result = results.get(key)
    return result.status if result is not None else "not_run"


def _dec(value: Any) -> Decimal | None:
    try:
        return Decimal(str(value)) if value is not None else None
    except Exception:  # noqa: BLE001 - display helper only
        return None


# ---------------------------------------------------------------------------
# 1. Transaction Financial Diagnosis (flagship §D5.1)
# ---------------------------------------------------------------------------


def _compose_diagnosis(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    pnl = _out(results, "pnl")
    cash = _out(results, "cashflow")
    wc = _out(results, "working_capital")
    cost = _out(results, "trade_cost")
    facts: list[str] = []
    if cost:
        facts.append(f"Total trade cost: {cost['total_trade_cost']} {cost['currency']}.")
    if pnl:
        facts.append(f"Net revenue {pnl['net_revenue']} {pnl['currency']}; gross contribution {pnl['gross_contribution']}; operating contribution {pnl['operating_contribution']}; contribution margin {pnl['contribution_margin']}.")
        facts.append(f"Break-even revenue: {pnl['break_even_revenue']} {pnl['currency']}.")
    if cash:
        facts.append(f"Peak cash deficit {cash['peak_cash_deficit']} {cash['currency']}" + (f" on {cash['cash_need_date']}" if cash.get("cash_need_date") else "") + (f"; recovery {cash['recovery_date']}." if cash.get("recovery_date") else "."))
    if wc:
        facts.append(
            f"Working capital: gross peak requirement {wc['gross_peak_requirement']} {wc['currency']}; internal liquidity applied {wc['internal_liquidity_applied']}; committed facilities applied {wc['committed_facilities_applied']}; residual funding gap {wc['residual_funding_gap']}"
            + (f" from {wc['funding_need_date']}" if wc.get("funding_need_date") else "")
            + (f" for {wc['gap_duration_days']} days." if wc.get("gap_duration_days") is not None else ".")
        )
    gap = _dec(wc.get("residual_funding_gap")) if wc else None
    margin = _dec(pnl.get("contribution_margin")) if pnl else None
    need = gap is not None and gap > 0
    rationale = []
    if margin is not None:
        rationale.append(f"The transaction is {'contribution-positive' if margin > 0 else 'contribution-negative'} (margin {pnl['contribution_margin']}).")
    if gap is not None:
        rationale.append(f"The residual funding gap after internal liquidity and committed facilities is {wc['residual_funding_gap']} {wc['currency']}.")
    sensitivity_note = "Most material driver: the largest dated outflow in the cash-flow timeline; re-run with scenario overrides on event amounts for exact deltas."
    return {
        "title": "Transaction financial diagnosis",
        "headline": (
            f"Contribution-positive transaction with a residual funding gap of {wc['residual_funding_gap']} {wc['currency']}."
            if need and margin is not None and margin > 0
            else "Transaction economics and funding position prepared from deterministic calculations."
        ),
        "facts": facts,
        "analysis": {
            "transaction_economics": {key: pnl.get(key) for key in ("net_revenue", "variable_costs", "non_scaling_costs", "gross_contribution", "operating_contribution", "contribution_margin", "break_even_revenue") if key in pnl},
            "cashflow_timeline": {key: cash.get(key) for key in ("closing_cash", "peak_cash_deficit", "cash_need_date", "recovery_date") if key in cash},
            "working_capital": {key: wc.get(key) for key in ("gross_peak_requirement", "internal_liquidity_applied", "committed_facilities_applied", "residual_funding_gap", "funding_need_date", "gap_duration_days") if key in wc},
            "key_sensitivities": sensitivity_note,
        },
        "recommendation_type": "financing_need" if need else "no_action_required",
        "recommended_action": (
            f"Address the {wc['residual_funding_gap']} {wc['currency']} residual funding gap before {wc.get('funding_need_date') or 'the funding need date'}; a financing-need classification and options comparison are the structured next outcomes."
            if need
            else "No external funding gap remains after internal liquidity and committed facilities; monitor the timeline for changes."
        ),
        "rationale_points": rationale,
        "next_step": (
            "Run financing_need_classification on this transaction; a protected-action proposal (e.g. submit_funding_request) could be prepared later only after human review."
            if need
            else "Review the diagnosis; no financing action is indicated by the current evidence."
        ),
        "risks": ([{"description": "Funding gap timing depends on estimated event dates", "severity": "medium"}] if need else []),
    }


DIAGNOSIS = OutcomeDefinition(
    outcome_type="capital_diagnosis",
    definition_version="1.0.0",
    objective="Diagnose transaction economics, cash-flow, and working-capital position",
    required_authority="analyse",
    required_evidence_categories=("trade_context", "cost_evidence", "cashflow_basis"),
    calculations=(
        RequiredCalculation("trade_cost", "capital.calculate_trade_cost", "1.0.0", "trade-cost-waterfall-v1", _section("trade_cost"), material=False),
        RequiredCalculation("pnl", "capital.calculate_transaction_pnl", "1.1.0", "pnl-waterfall-v2", _section("pnl")),
        RequiredCalculation("cashflow", "capital.calculate_cashflow_timeline", "1.1.0", "cashflow-timeline-v2", _section("cashflow")),
        RequiredCalculation("working_capital", "capital.calculate_working_capital", "1.1.0", "wc-gap-v2", _section("working_capital")),
    ),
    composer=_compose_diagnosis,
    recommendation=RecommendationPolicy(allowed_types=("financing_need", "no_action_required")),
    artifact=ArtifactPolicy(artifact_type="capital_diagnosis"),
    synthesis_purpose="transaction_financial_diagnosis",
)


# ---------------------------------------------------------------------------
# 2. Financing Need Classification (flagship §D5.2)
# ---------------------------------------------------------------------------


def _compose_financing_need(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    wc = _out(results, "working_capital")
    cash = _out(results, "cashflow")
    recv = _out(results, "receivables")
    gap = _dec(wc.get("residual_funding_gap")) if wc else None
    need_exists = gap is not None and gap > 0
    trade = inputs.get("trade_context", {}) if isinstance(inputs.get("trade_context"), dict) else {}
    invoice_exists = bool(trade.get("invoice_exists"))
    receivable_exists = bool(trade.get("receivable_exists"))
    delivery_complete = bool(trade.get("delivery_complete"))
    pre_shipment = not delivery_complete
    structural_eligibility = recv.get("structural_eligibility") if recv else None
    receivables_eligible = structural_eligibility == "eligible"
    eligible_categories: list[str] = []
    ineligible_categories: list[dict[str, Any]] = []
    if receivables_eligible:
        eligible_categories.append("receivables_finance")
    elif recv:
        ineligible_categories.append({"category": "receivables_finance", "reasons": recv.get("eligibility_reasons", [])})
    elif not receivable_exists:
        ineligible_categories.append({"category": "receivables_finance", "reasons": ["no receivable exists yet" + ("" if invoice_exists else " (no invoice)")]})
    if pre_shipment:
        eligible_categories.extend(["purchase_order_finance", "pre_shipment_working_capital", "supplier_credit"])
    else:
        eligible_categories.extend(["term_loan", "credit_line"])
    missing = []
    if need_exists and not wc.get("funding_need_date"):
        missing.append("funding need date (dated events required)")
    facts = []
    if wc:
        facts.append(f"Residual funding gap: {wc['residual_funding_gap']} {wc['currency']}" + (f" from {wc['funding_need_date']}" if wc.get("funding_need_date") else "") + (f" for {wc['gap_duration_days']} days." if wc.get("gap_duration_days") is not None else "."))
    if cash:
        facts.append(f"Peak cash deficit {cash['peak_cash_deficit']} {cash['currency']}.")
    facts.append(f"Trade stage: {'pre-shipment' if pre_shipment else 'post-delivery'}; invoice {'exists' if invoice_exists else 'does not exist'}; receivable {'exists' if receivable_exists else 'does not exist'}.")
    if recv:
        facts.append(f"Receivables-finance structural eligibility: {structural_eligibility} ({'; '.join(recv.get('eligibility_reasons', [])) or 'no blocking reasons'}).")
    return {
        "title": "Financing need classification",
        "headline": (
            f"A funding need of {wc['residual_funding_gap']} {wc['currency']} exists ({'pre-shipment' if pre_shipment else 'post-delivery'} character)."
            if need_exists
            else "No external funding need is evidenced by the working-capital calculation."
        ),
        "facts": facts,
        "analysis": {
            "need": {
                "exists": need_exists,
                "amount": wc.get("residual_funding_gap"),
                "currency": wc.get("currency"),
                "timing": wc.get("funding_need_date"),
                "duration_days": wc.get("gap_duration_days"),
                "character": "pre_shipment" if pre_shipment else "post_delivery",
                "receivable_exists": receivable_exists,
            },
            "structurally_relevant_categories": eligible_categories if need_exists else [],
            "structurally_ineligible_categories": ineligible_categories,
        },
        "recommendation_type": "financing_need_classified",
        "recommended_action": (
            f"Classify the need as {wc['residual_funding_gap']} {wc['currency']} ({'pre-shipment' if pre_shipment else 'post-delivery'}); compare the structurally relevant instrument categories."
            if need_exists
            else "Record that no funding need exists on current evidence."
        ),
        "rationale_points": [fact for fact in facts[:3]],
        "next_step": "Run financing_option_comparison over concrete offers in the relevant categories." if need_exists else "No financing action indicated.",
        "missing_information": missing,
    }


FINANCING_NEED = OutcomeDefinition(
    outcome_type="financing_need_classification",
    definition_version="1.0.0",
    objective="Determine whether a funding need exists and classify amount, timing, duration, and character",
    required_authority="analyse",
    required_evidence_categories=("cashflow_basis", "trade_context"),
    calculations=(
        RequiredCalculation("working_capital", "capital.calculate_working_capital", "1.1.0", "wc-gap-v2", _section("working_capital")),
        RequiredCalculation("cashflow", "capital.calculate_cashflow_timeline", "1.1.0", "cashflow-timeline-v2", _section("cashflow"), material=False),
        RequiredCalculation("receivables", "capital.calculate_receivables_finance", "1.1.0", "receivables-proceeds-v2", _section("receivables"), material=False),
    ),
    composer=_compose_financing_need,
    recommendation=RecommendationPolicy(allowed_types=("financing_need_classified",)),
    artifact=ArtifactPolicy(artifact_type="financing_strategy"),
    synthesis_purpose="financing_need_classification",
)


# ---------------------------------------------------------------------------
# 3. Financing Options Comparison (flagship §D5.3)
# ---------------------------------------------------------------------------


def _compose_option_comparison(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    comparison = _out(results, "comparison")
    offers = comparison.get("offers", [])
    eligible = [offer for offer in offers if offer.get("eligibility") == "eligible"]
    ineligible = [offer for offer in offers if offer.get("eligibility") == "ineligible"]
    incomplete = [offer for offer in offers if offer.get("eligibility") == "insufficient_information"]
    options = [
        {
            "label": f"{offer.get('provider_label', offer.get('offer_id'))} ({offer.get('product', 'generic')})",
            "structural_eligibility": offer.get("eligibility", "insufficient_information"),
            "ineligibility_reasons": offer.get("ineligibility_reasons", []),
            "missing_information": offer.get("missing_fields", []),
            "metrics": {key: offer.get(key) for key in ("net_proceeds", "total_cost", "effective_annual_cost", "tenor_days", "expected_days_to_funds") if offer.get(key) is not None},
            "conditions": offer.get("conditions", []),
            "recourse": str(offer.get("recourse")) if offer.get("recourse") is not None else None,
            "collateral": offer.get("collateral"),
            "timing": f"{offer['expected_days_to_funds']} days to funds" if offer.get("expected_days_to_funds") is not None else None,
            "comparability_note": offer.get("comparability_note"),
        }
        for offer in offers
    ]
    best = eligible[0] if eligible else None
    company_objective = str(inputs.get("company_objective", "minimize total financing cost while meeting the funding date"))
    facts = [f"{len(offers)} offer(s) compared: {len(eligible)} eligible, {len(ineligible)} structurally ineligible, {len(incomplete)} incomplete."]
    if best:
        facts.append(f"Lowest-cost eligible option: {best.get('provider_label', best.get('offer_id'))} — net proceeds {best.get('net_proceeds')}, total cost {best.get('total_cost')}, effective annual cost {best.get('effective_annual_cost')} ({comparison.get('ranking_basis', 'effective annual cost')}).")
    return {
        "title": "Financing options comparison",
        "headline": facts[0],
        "facts": facts,
        "analysis": {"ranking_basis": comparison.get("ranking_basis"), "company_objective": company_objective},
        "options": options,
        "recommendation_type": "financing_option_recommendation" if best else "no_eligible_option",
        "recommended_action": (
            f"Deterministic cost ordering favours {best.get('provider_label', best.get('offer_id'))}; weigh it against the stated company objective ('{company_objective}'), the option conditions, and the evidence before deciding — cost order alone is not the decision."
            if best
            else "No structurally eligible option with complete pricing exists; obtain the missing information or widen the option set."
        ),
        "rationale_points": facts,
        "alternatives_considered": [
            {"label": option["label"], "reason_not_recommended": "; ".join(option["ineligibility_reasons"]) or "higher effective cost or incomplete information"}
            for option in options
            if best is None or option["label"] != f"{best.get('provider_label', best.get('offer_id'))} ({best.get('product', 'generic')})"
        ][:4],
        "next_step": (
            "Review the comparison; if an option is selected, a term-sheet review and (later, after human approval) a protected-action proposal could follow."
            if best
            else "Provide the missing offer fields listed per option."
        ),
        "missing_information": [f"{offer.get('offer_id')}: {field}" for offer in offers for field in offer.get("missing_fields", [])],
    }


OPTION_COMPARISON = OutcomeDefinition(
    outcome_type="financing_option_comparison",
    definition_version="1.0.0",
    objective="Compare structurally eligible financing options on normalized economics",
    required_authority="recommend",
    required_evidence_categories=("offer_terms",),
    calculations=(
        RequiredCalculation("comparison", "capital.compare_financing_options", "1.1.0", "option-comparison-v2", _section("offers")),
        RequiredCalculation("receivables", "capital.calculate_receivables_finance", "1.1.0", "receivables-proceeds-v2", _section("receivables"), material=False),
    ),
    composer=_compose_option_comparison,
    recommendation=RecommendationPolicy(allowed_types=("financing_option_recommendation", "no_eligible_option")),
    artifact=ArtifactPolicy(artifact_type="financing_strategy"),
    synthesis_purpose="financing_option_comparison",
)


# ---------------------------------------------------------------------------
# 4. Funding Packet Preparation (flagship §D5.4)
# ---------------------------------------------------------------------------


def _compose_funding_packet(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    wc = _out(results, "working_capital")
    pnl = _out(results, "pnl")
    cash = _out(results, "cashflow")
    recv = _out(results, "receivables")
    company = inputs.get("company_context", {}) if isinstance(inputs.get("company_context"), dict) else {}
    evidence_checklist = ["commercial contract or purchase order", "cost evidence for major components", "cash-flow event dates", "bank/liquidity statements", "invoice and acceptance evidence (post-delivery structures)"]
    available = [str(item) for item in inputs.get("available_evidence", [])]
    missing_evidence = [item for item in evidence_checklist if not any(item.split()[0] in have.lower() for have in available)]
    facts = []
    if wc:
        facts.append(f"Funding requirement: {wc['residual_funding_gap']} {wc['currency']}" + (f" needed from {wc['funding_need_date']}" if wc.get("funding_need_date") else "") + (f" for {wc['gap_duration_days']} days." if wc.get("gap_duration_days") is not None else "."))
    if pnl:
        facts.append(f"Transaction economics: net revenue {pnl['net_revenue']} {pnl['currency']}, operating contribution {pnl['operating_contribution']}, margin {pnl['contribution_margin']}.")
    if cash:
        facts.append(f"Repayment source: transaction cash inflows (closing cash {cash['closing_cash']} {cash['currency']}" + (f", recovery {cash['recovery_date']})." if cash.get("recovery_date") else ")."))
    if recv:
        facts.append(f"Receivables-finance structural eligibility: {recv['structural_eligibility']}.")
    return {
        "title": "Funding packet (company-owned, non-binding)",
        "headline": "Company-owned information package prepared; it is NOT a canonical Finance funding request and submits nothing to any financier.",
        "facts": facts,
        "analysis": {
            "company_and_trade_context": {key: company.get(key) for key in ("company_name", "country", "sector", "trade_summary") if company.get(key)},
            "funding_requirement": {"amount": wc.get("residual_funding_gap"), "currency": wc.get("currency"), "from": wc.get("funding_need_date"), "duration_days": wc.get("gap_duration_days")},
            "requested_structure": inputs.get("requested_structure", "to be selected from the options comparison"),
            "use_of_funds": inputs.get("use_of_funds", "working capital for the underlying trade"),
            "repayment_source": inputs.get("repayment_source", "buyer settlement of the trade receivable"),
            "evidence_checklist": evidence_checklist,
            "available_evidence": available,
            "missing_evidence": missing_evidence,
            "risk_mitigants": [str(item) for item in inputs.get("risk_mitigants", [])],
        },
        "recommendation_type": "funding_packet_ready" if not missing_evidence else "funding_packet_incomplete",
        "recommended_action": "The packet is ready for human review before any submission decision." if not missing_evidence else f"Complete the packet: {len(missing_evidence)} evidence item(s) are missing.",
        "rationale_points": facts[:2],
        "next_step": "Human review of the packet; ONLY afterwards could a submit_funding_request proposal be prepared (proposal → approval → typed Finance command). Nothing is submitted by this outcome.",
        "missing_information": missing_evidence,
    }


FUNDING_PACKET = OutcomeDefinition(
    outcome_type="funding_packet",
    definition_version="1.0.0",
    objective="Prepare a company-owned, non-binding funding information packet",
    required_authority="draft",
    required_evidence_categories=("trade_context", "cashflow_basis", "cost_evidence"),
    calculations=(
        RequiredCalculation("working_capital", "capital.calculate_working_capital", "1.1.0", "wc-gap-v2", _section("working_capital")),
        RequiredCalculation("pnl", "capital.calculate_transaction_pnl", "1.1.0", "pnl-waterfall-v2", _section("pnl"), material=False),
        RequiredCalculation("cashflow", "capital.calculate_cashflow_timeline", "1.1.0", "cashflow-timeline-v2", _section("cashflow"), material=False),
        RequiredCalculation("receivables", "capital.calculate_receivables_finance", "1.1.0", "receivables-proceeds-v2", _section("receivables"), material=False),
    ),
    composer=_compose_funding_packet,
    recommendation=RecommendationPolicy(allowed_types=("funding_packet_ready", "funding_packet_incomplete")),
    artifact=ArtifactPolicy(artifact_type="financing_packet"),
    synthesis_purpose="funding_packet",
)


# ---------------------------------------------------------------------------
# 5. Term-Sheet Review & Financial Counteroffer (flagship §D5.5)
# ---------------------------------------------------------------------------


def _compose_term_sheet(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    cost = _out(results, "term_economics")
    comparison = _out(results, "comparison")
    terms = inputs.get("term_sheet", {}) if isinstance(inputs.get("term_sheet"), dict) else {}
    gaps = [str(gap) for gap in terms.get("unspecified_terms", [])]
    inconsistencies = [str(item) for item in terms.get("inconsistencies", [])]
    facts = []
    if cost:
        facts.append(f"Normalized economics: gross principal {cost['gross_principal']} {cost['currency']}, cash received at disbursement {cost['cash_received_at_disbursement']}, net proceeds {cost['net_proceeds']}, interest {cost['interest']}, total fees {cost['total_fees']}, total financing cost {cost['total_financing_cost']}, total cash repayment {cost['total_cash_repayment']}, annualized simple cost {cost['annualized_simple_cost']}.")
    for label in ("recourse", "security", "covenants"):
        if terms.get(label):
            facts.append(f"{label.title()}: {terms[label]}.")
    offers = comparison.get("offers", []) if comparison else []
    return {
        "title": "Term-sheet review",
        "headline": facts[0] if facts else "Term-sheet economics normalized from deterministic calculations.",
        "facts": facts,
        "analysis": {
            "normalized_terms": {key: cost.get(key) for key in ("gross_principal", "cash_received_at_disbursement", "net_proceeds", "interest", "total_fees", "total_financing_cost", "total_cash_repayment", "annualized_simple_cost", "day_count") if key in cost},
            "repayment_profile": cost.get("repayment_schedule", []),
            "recourse": terms.get("recourse"),
            "security": terms.get("security"),
            "covenants": terms.get("covenants", []),
            "conditions_precedent": terms.get("conditions", []),
            "gaps": gaps,
            "inconsistencies": inconsistencies,
            "alternatives_compared": len(offers),
        },
        "recommendation_type": "term_sheet_assessment",
        "recommended_action": "Review the normalized economics, gaps, and inconsistencies against the alternatives before responding to the financier.",
        "rationale_points": facts[:3],
        "next_step": "If terms should be improved, run financial_counteroffer to prepare the company-side counter position.",
        "missing_information": gaps,
        "risks": [{"description": item, "severity": "medium"} for item in inconsistencies],
    }


TERM_SHEET_REVIEW = OutcomeDefinition(
    outcome_type="term_sheet_review",
    definition_version="1.0.0",
    objective="Normalize and review financier term-sheet economics on the company side",
    required_authority="recommend",
    required_evidence_categories=("offer_terms",),
    calculations=(
        RequiredCalculation("term_economics", "capital.calculate_financing_cost", "1.1.0", "financing-cost-v2", _section("financing_cost")),
        RequiredCalculation("comparison", "capital.compare_financing_options", "1.1.0", "option-comparison-v2", _section("offers"), material=False),
    ),
    composer=_compose_term_sheet,
    recommendation=RecommendationPolicy(allowed_types=("term_sheet_assessment",)),
    artifact=ArtifactPolicy(artifact_type="term_sheet_review"),
    synthesis_purpose="term_sheet_review",
)


def _compose_counteroffer(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    current = _out(results, "current_terms")
    counter = _out(results, "counter_terms")
    facts = []
    if current:
        facts.append(f"Offered terms: total financing cost {current['total_financing_cost']} {current['currency']}, net proceeds {current['net_proceeds']}, annualized simple cost {current['annualized_simple_cost']}.")
    if counter:
        facts.append(f"Counter position: total financing cost {counter['total_financing_cost']} {counter['currency']}, net proceeds {counter['net_proceeds']}, annualized simple cost {counter['annualized_simple_cost']}.")
    saving = None
    if current and counter:
        current_cost, counter_cost = _dec(current.get("total_financing_cost")), _dec(counter.get("total_financing_cost"))
        if current_cost is not None and counter_cost is not None:
            saving = current_cost - counter_cost
            facts.append(f"Difference in total financing cost (offered − counter): {saving} {current['currency']}.")
    return {
        "title": "Financial counteroffer preparation",
        "headline": facts[-1] if facts else "Counteroffer economics prepared.",
        "facts": facts,
        "analysis": {
            "offered": {key: current.get(key) for key in ("total_financing_cost", "net_proceeds", "annualized_simple_cost") if key in current},
            "counter": {key: counter.get(key) for key in ("total_financing_cost", "net_proceeds", "annualized_simple_cost") if key in counter},
            "negotiation_points": [str(point) for point in inputs.get("negotiation_points", [])],
        },
        "recommendation_type": "counteroffer_prepared",
        "recommended_action": "Present the counter terms as the company position; the difference is quantified deterministically above.",
        "rationale_points": facts,
        "next_step": "Human review and company decision; any binding response remains a human action outside this outcome.",
    }


COUNTEROFFER = OutcomeDefinition(
    outcome_type="financial_counteroffer",
    definition_version="1.0.0",
    objective="Prepare a company-side financial counteroffer position",
    required_authority="draft",
    required_evidence_categories=("offer_terms",),
    calculations=(
        RequiredCalculation("current_terms", "capital.calculate_financing_cost", "1.1.0", "financing-cost-v2", _section("current_terms")),
        RequiredCalculation("counter_terms", "capital.calculate_financing_cost", "1.1.0", "financing-cost-v2", _section("counter_terms")),
    ),
    composer=_compose_counteroffer,
    recommendation=RecommendationPolicy(allowed_types=("counteroffer_prepared",)),
    artifact=ArtifactPolicy(artifact_type="financial_counteroffer"),
    synthesis_purpose="financial_counteroffer",
)


# ---------------------------------------------------------------------------
# D6 roadmap outcomes — single-calculator analyses and composed plans
# ---------------------------------------------------------------------------


def _single_calc_composer(key: str, title: str, fact_keys: tuple[str, ...], recommendation_type: str):
    def compose(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
        outputs = _out(results, key)
        facts = [f"{name.replace('_', ' ')}: {outputs[name]}" for name in fact_keys if outputs.get(name) is not None]
        return {
            "title": title,
            "headline": facts[0] if facts else f"{title} prepared.",
            "facts": facts,
            "analysis": {key: {name: outputs.get(name) for name in fact_keys if name in outputs}},
            "recommendation_type": recommendation_type,
            "recommended_action": f"Review the {title.lower()} figures; every number traces to the calculation appendix.",
            "rationale_points": facts[:3],
            "next_step": f"Use the {title.lower()} as an input to diagnosis, planning, or financing outcomes.",
        }

    return compose


TRADE_COST_ANALYSIS = OutcomeDefinition(
    outcome_type="trade_cost_analysis",
    definition_version="1.0.0",
    objective="Deterministic trade-cost breakdown",
    required_authority="analyse",
    required_evidence_categories=("cost_evidence",),
    calculations=(RequiredCalculation("trade_cost", "capital.calculate_trade_cost", "1.0.0", "trade-cost-waterfall-v1", _section("trade_cost")),),
    composer=_single_calc_composer("trade_cost", "Trade cost analysis", ("total_trade_cost", "currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="trade_cost_model"),
)

LANDED_COST_ANALYSIS = OutcomeDefinition(
    outcome_type="landed_cost_analysis",
    definition_version="1.0.0",
    objective="Deterministic landed-cost analysis",
    required_authority="analyse",
    required_evidence_categories=("cost_evidence",),
    calculations=(RequiredCalculation("landed_cost", "capital.calculate_landed_cost", "1.0.0", "landed-cost-v1", _section("landed_cost")),),
    composer=_single_calc_composer("landed_cost", "Landed cost analysis", ("total_trade_cost", "landed_cost_per_unit", "delivered_quantity", "currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="landed_cost_model"),
)

TRANSACTION_PNL = OutcomeDefinition(
    outcome_type="transaction_pnl",
    definition_version="1.0.0",
    objective="Deterministic transaction P&L",
    required_authority="analyse",
    required_evidence_categories=("cost_evidence", "trade_context"),
    calculations=(RequiredCalculation("pnl", "capital.calculate_transaction_pnl", "1.1.0", "pnl-waterfall-v2", _section("pnl")),),
    composer=_single_calc_composer("pnl", "Transaction P&L", ("net_revenue", "gross_contribution", "operating_contribution", "contribution_margin", "break_even_revenue", "currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="transaction_pnl"),
)

PORTFOLIO_PNL = OutcomeDefinition(
    outcome_type="portfolio_pnl",
    definition_version="1.0.0",
    objective="Company-side aggregate P&L across transactions (not financier portfolio analysis)",
    required_authority="analyse",
    required_evidence_categories=("trade_context",),
    calculations=(RequiredCalculation("aggregate", "capital.calculate_aggregate_pnl", "1.1.0", "aggregate-pnl-v2", _section("aggregate_pnl")),),
    composer=_single_calc_composer("aggregate", "Company aggregate P&L", ("total_net_revenue", "total_gross_contribution", "total_operating_contribution", "aggregate_contribution_margin", "currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="portfolio_pnl"),
)

CASHFLOW_FORECAST = OutcomeDefinition(
    outcome_type="cashflow_forecast",
    definition_version="1.0.0",
    objective="Deterministic dated cash-flow forecast",
    required_authority="analyse",
    required_evidence_categories=("cashflow_basis",),
    calculations=(RequiredCalculation("cashflow", "capital.calculate_cashflow_timeline", "1.1.0", "cashflow-timeline-v2", _section("cashflow")),),
    composer=_single_calc_composer("cashflow", "Cash-flow forecast", ("closing_cash", "peak_cash_deficit", "cash_need_date", "recovery_date", "currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="cashflow_forecast"),
)

WORKING_CAPITAL_ANALYSIS = OutcomeDefinition(
    outcome_type="working_capital_analysis",
    definition_version="1.0.0",
    objective="Working-capital requirement and residual funding gap",
    required_authority="analyse",
    required_evidence_categories=("cashflow_basis",),
    calculations=(
        RequiredCalculation("working_capital", "capital.calculate_working_capital", "1.1.0", "wc-gap-v2", _section("working_capital")),
        RequiredCalculation("ccc", "capital.calculate_ccc", "1.0.0", "ccc-v1", _section("ccc"), material=False),
    ),
    composer=_single_calc_composer("working_capital", "Working-capital analysis", ("gross_peak_requirement", "internal_liquidity_applied", "committed_facilities_applied", "residual_funding_gap", "funding_need_date", "gap_duration_days", "currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="working_capital_plan"),
)

TREASURY_LIQUIDITY_PLAN = OutcomeDefinition(
    outcome_type="treasury_liquidity_plan",
    definition_version="1.0.0",
    objective="Treasury and liquidity runway plan",
    required_authority="analyse",
    required_evidence_categories=("liquidity_evidence",),
    calculations=(
        RequiredCalculation("liquidity", "capital.calculate_liquidity_runway", "1.1.0", "runway-v2", _section("liquidity")),
        RequiredCalculation("exposure", "capital.calculate_company_exposure", "1.0.0", "company-exposure-v1", _section("exposure"), material=False),
    ),
    composer=_single_calc_composer("liquidity", "Treasury and liquidity plan", ("usable_liquidity", "minimum_projected_liquidity", "runway_months", "stress_runway_months", "runway_breach_date", "currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="treasury_plan"),
)

FX_EXPOSURE_ANALYSIS = OutcomeDefinition(
    outcome_type="fx_exposure_analysis",
    definition_version="1.0.0",
    objective="FX exposure and scenario analysis",
    required_authority="analyse",
    required_evidence_categories=("fx_rate_source",),
    calculations=(RequiredCalculation("fx", "capital.calculate_fx_scenarios", "1.1.0", "fx-scenarios-v2", _section("fx")),),
    composer=_single_calc_composer("fx", "FX exposure analysis", ("base_settlement_value", "residual_exposure", "hedge_exceeds_exposure", "functional_currency"), "analysis_ready"),
    recommendation=RecommendationPolicy(allowed_types=("analysis_ready",)),
    artifact=ArtifactPolicy(artifact_type="fx_plan"),
)


def _compose_capital_plan(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    wc = _out(results, "working_capital")
    liquidity = _out(results, "liquidity")
    investment = _out(results, "investment")
    facts = []
    if wc:
        facts.append(f"Residual funding gap {wc['residual_funding_gap']} {wc['currency']}.")
    if liquidity:
        facts.append(f"Liquidity runway {liquidity.get('runway_months')} months (stress {liquidity.get('stress_runway_months')}).")
    if investment:
        facts.append(f"Plan NPV {investment['npv']} {investment['currency']}" + (f", IRR {investment['irr']}." if investment.get("irr") else "."))
    return {
        "title": "Capital plan",
        "headline": facts[0] if facts else "Capital plan prepared.",
        "facts": facts,
        "analysis": {
            "funding": {key: wc.get(key) for key in ("gross_peak_requirement", "residual_funding_gap", "funding_need_date") if key in wc},
            "liquidity": {key: liquidity.get(key) for key in ("usable_liquidity", "runway_months", "stress_runway_months") if key in liquidity},
            "returns": {key: investment.get(key) for key in ("npv", "irr", "irr_diagnostic", "return_multiple") if investment.get(key) is not None},
        },
        "recommendation_type": "capital_plan_ready",
        "recommended_action": "Adopt the plan figures as the working baseline; every number traces to the calculation appendix.",
        "rationale_points": facts,
        "next_step": "Review the plan; financing outcomes cover any residual gap.",
    }


CAPITAL_PLAN = OutcomeDefinition(
    outcome_type="capital_plan",
    definition_version="1.0.0",
    objective="Composed capital plan: funding, liquidity, and investment returns",
    required_authority="analyse",
    required_evidence_categories=("cashflow_basis", "liquidity_evidence"),
    calculations=(
        RequiredCalculation("working_capital", "capital.calculate_working_capital", "1.1.0", "wc-gap-v2", _section("working_capital")),
        RequiredCalculation("liquidity", "capital.calculate_liquidity_runway", "1.1.0", "runway-v2", _section("liquidity"), material=False),
        RequiredCalculation("investment", "capital.calculate_investment_returns", "1.1.0", "npv-irr-v2", _section("investment"), material=False),
    ),
    composer=_compose_capital_plan,
    recommendation=RecommendationPolicy(allowed_types=("capital_plan_ready",)),
    artifact=ArtifactPolicy(artifact_type="capital_plan"),
)


def _compose_scenario_model(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    debt = _out(results, "debt")
    dilution = _out(results, "dilution")
    investment = _out(results, "investment")
    facts = []
    if debt:
        facts.append(f"Debt scenario: total debt service {debt['total_debt_service']} {debt['currency']}, min DSCR {debt.get('min_dscr')} ({debt.get('dscr_definition')}).")
    if dilution:
        facts.append(f"Equity scenario: post-money {dilution['post_money_valuation']} {dilution['currency']}, new investor {dilution['new_investor_pct']}, existing holder post {dilution['existing_holder_post_pct']}" + (f" (after pool {dilution['existing_holder_post_pct_after_pool']})." if dilution.get("existing_holder_post_pct_after_pool") else "."))
    if investment:
        facts.append(f"Return check: NPV {investment['npv']} {investment['currency']}" + (f", IRR {investment['irr']} ({investment.get('irr_diagnostic') or 'unique root'})." if investment.get("irr") else "."))
    if not facts:
        return {"abstain": "no debt, dilution, or investment scenario inputs were provided"}
    return {
        "title": "Capital-structure scenario model",
        "headline": facts[0],
        "facts": facts,
        "analysis": {
            "debt_scenario": {key: debt.get(key) for key in ("total_debt_service", "min_dscr", "dscr_definition") if key in debt},
            "equity_scenario": {key: dilution.get(key) for key in ("post_money_valuation", "new_investor_pct", "existing_holder_post_pct", "existing_holder_post_pct_after_pool", "option_pool_convention") if dilution.get(key) is not None},
            "returns": {key: investment.get(key) for key in ("npv", "irr", "irr_diagnostic", "return_multiple") if investment.get(key) is not None},
        },
        "recommendation_type": "scenario_model_ready",
        "recommended_action": "Compare the modeled structures on the deterministic figures above.",
        "rationale_points": facts,
        "next_step": "Feed the preferred structure into the financing strategy or capital plan.",
    }


SCENARIO_MODEL = OutcomeDefinition(
    outcome_type="scenario_model",
    definition_version="1.0.0",
    objective="Debt / equity / return scenario modeling",
    required_authority="analyse",
    required_evidence_categories=("scenario_basis",),
    calculations=(
        RequiredCalculation("debt", "capital.calculate_debt_service", "1.1.0", "debt-service-v2", _section("debt"), material=False),
        RequiredCalculation("dilution", "capital.calculate_dilution", "1.1.0", "dilution-v2", _section("dilution"), material=False),
        RequiredCalculation("investment", "capital.calculate_investment_returns", "1.1.0", "npv-irr-v2", _section("investment"), material=False),
    ),
    composer=_compose_scenario_model,
    recommendation=RecommendationPolicy(allowed_types=("scenario_model_ready",)),
    artifact=ArtifactPolicy(artifact_type="scenario_model"),
)


def _compose_financing_strategy(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    need = _compose_financing_need(inputs, results)
    need["title"] = "Financing strategy"
    need["recommendation_type"] = "financing_strategy_ready"
    need["next_step"] = "Adopt the strategy sequencing; run option comparison per instrument category as offers arrive."
    return need


FINANCING_STRATEGY = OutcomeDefinition(
    outcome_type="financing_strategy",
    definition_version="1.0.0",
    objective="Company financing strategy across instrument categories",
    required_authority="recommend",
    required_evidence_categories=("cashflow_basis", "trade_context"),
    calculations=(
        RequiredCalculation("working_capital", "capital.calculate_working_capital", "1.1.0", "wc-gap-v2", _section("working_capital")),
        RequiredCalculation("cashflow", "capital.calculate_cashflow_timeline", "1.1.0", "cashflow-timeline-v2", _section("cashflow"), material=False),
        RequiredCalculation("receivables", "capital.calculate_receivables_finance", "1.1.0", "receivables-proceeds-v2", _section("receivables"), material=False),
    ),
    composer=_compose_financing_strategy,
    recommendation=RecommendationPolicy(allowed_types=("financing_strategy_ready",)),
    artifact=ArtifactPolicy(artifact_type="financing_strategy"),
)


def _compose_instrument_blueprint(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    economics = _out(results, "economics")
    conditions = _out(results, "conditions")
    blueprint = inputs.get("blueprint", {}) if isinstance(inputs.get("blueprint"), dict) else {}
    facts = []
    if economics:
        facts.append(f"Indicative economics: net proceeds {economics['net_proceeds']} {economics['currency']}, total financing cost {economics['total_financing_cost']}, annualized simple cost {economics['annualized_simple_cost']}.")
    condition_rows = conditions.get("conditions", []) if conditions else []
    if condition_rows:
        satisfied = sum(1 for row in condition_rows if row.get("status") == "satisfied")
        facts.append(f"Milestone structure: {satisfied}/{len(condition_rows)} conditions currently satisfied (deterministic evaluation only).")
    return {
        "title": "Instrument blueprint",
        "headline": facts[0] if facts else "Instrument blueprint prepared.",
        "facts": facts,
        "analysis": {
            "instrument": {key: blueprint.get(key) for key in ("instrument_type", "parties", "milestones", "settlement") if blueprint.get(key)},
            "indicative_economics": {key: economics.get(key) for key in ("net_proceeds", "total_financing_cost", "annualized_simple_cost") if key in economics},
            "condition_structure": condition_rows,
        },
        "recommendation_type": "blueprint_ready",
        "recommended_action": "Review the blueprint; canonical instrument creation stays in the Finance domain behind proposals and approvals.",
        "rationale_points": facts,
        "next_step": "Human review; any instrument creation would later flow proposal → approval → typed Finance command.",
    }


INSTRUMENT_BLUEPRINT = OutcomeDefinition(
    outcome_type="instrument_blueprint",
    definition_version="1.0.0",
    objective="Blueprint a financing instrument structure with indicative economics",
    required_authority="draft",
    required_evidence_categories=("offer_terms", "condition_evidence"),
    calculations=(
        RequiredCalculation("economics", "capital.calculate_financing_cost", "1.1.0", "financing-cost-v2", _section("financing_cost"), material=False),
        RequiredCalculation("conditions", "capital.evaluate_conditions", "1.0.0", "condition-eval-v1", _section("conditions"), material=False),
    ),
    composer=_compose_instrument_blueprint,
    recommendation=RecommendationPolicy(allowed_types=("blueprint_ready",)),
    artifact=ArtifactPolicy(artifact_type="instrument_blueprint"),
)


def _compose_milestone_report(inputs: dict[str, Any], results: dict[str, CalculationResult]) -> dict[str, Any]:
    conditions = _out(results, "conditions")
    rows = conditions.get("conditions", []) if conditions else []
    satisfied = [row for row in rows if row.get("status") == "satisfied"]
    unresolved_rows = [row for row in rows if row.get("status") == "insufficient_information"]
    contradicted = [row for row in rows if row.get("status") == "contradictory_evidence"]
    facts = [f"{len(satisfied)}/{len(rows)} conditions satisfied; {len(unresolved_rows)} lack evidence; {len(contradicted)} contradicted."]
    return {
        "title": "Settlement and financial milestone analysis",
        "headline": facts[0],
        "facts": facts,
        "analysis": {"conditions": rows, "note": conditions.get("note")},
        "recommendation_type": "milestone_report_ready",
        "recommended_action": "Deterministic condition evaluation only; canonical workflow transitions remain in the Finance domain.",
        "rationale_points": facts,
        "next_step": "Provide evidence for the unresolved conditions; contradictions require human resolution.",
        "missing_information": [f"evidence for condition {row.get('condition_id')}" for row in unresolved_rows],
    }


MILESTONE_REPORT = OutcomeDefinition(
    outcome_type="milestone_monitoring_report",
    definition_version="1.0.0",
    objective="Deterministic settlement/milestone condition analysis (report, not a monitoring job)",
    required_authority="analyse",
    required_evidence_categories=("condition_evidence",),
    calculations=(RequiredCalculation("conditions", "capital.evaluate_conditions", "1.0.0", "condition-eval-v1", _section("conditions")),),
    composer=_compose_milestone_report,
    recommendation=RecommendationPolicy(allowed_types=("milestone_report_ready",)),
    artifact=ArtifactPolicy(artifact_type="milestone_monitoring_report"),
)


ALL_OUTCOME_DEFINITIONS: tuple[OutcomeDefinition, ...] = (
    DIAGNOSIS,
    FINANCING_NEED,
    OPTION_COMPARISON,
    FUNDING_PACKET,
    TERM_SHEET_REVIEW,
    COUNTEROFFER,
    TRADE_COST_ANALYSIS,
    LANDED_COST_ANALYSIS,
    TRANSACTION_PNL,
    PORTFOLIO_PNL,
    CASHFLOW_FORECAST,
    WORKING_CAPITAL_ANALYSIS,
    TREASURY_LIQUIDITY_PLAN,
    FX_EXPOSURE_ANALYSIS,
    CAPITAL_PLAN,
    SCENARIO_MODEL,
    FINANCING_STRATEGY,
    INSTRUMENT_BLUEPRINT,
    MILESTONE_REPORT,
)


def default_outcome_registry() -> OutcomeDefinitionRegistry:
    registry = OutcomeDefinitionRegistry()
    for definition in ALL_OUTCOME_DEFINITIONS:
        registry.register(definition)
    return registry
