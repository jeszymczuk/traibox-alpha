"""Capital Agent definition v1.1 (spec §17.1; company-side scope, CA-100/101).

Supported principal types include 'financier' because the DEFINITION is
principal-neutral by design — activation is governed by mandates, and only
company mandates may be active in this release (CA-113, enforced in
mandate validation and the database).
"""

from __future__ import annotations

from ..framework.authority import AUTHORITY_LEVELS
from ..framework.definition import AgentDefinition, BudgetPolicy

CAPITAL_OUTCOME_TYPES: tuple[str, ...] = (
    "capital_diagnosis",
    "trade_cost_analysis",
    "landed_cost_analysis",
    "transaction_pnl",
    "portfolio_pnl",
    "cashflow_forecast",
    "working_capital_analysis",
    "scenario_model",
    "financing_need_classification",
    "financing_strategy",
    "financing_option_comparison",
    "funding_packet",
    "term_sheet_review",
    "financial_counteroffer",
    "capital_plan",
    "treasury_liquidity_plan",
    "fx_exposure_analysis",
    "instrument_blueprint",
    "milestone_monitoring_report",
    "underwriting_pre_read",
    "credit_memo_draft",
    "allocation_memo_draft",
    "portfolio_exposure_brief",
)

CAPITAL_AGENT_DEFINITION = AgentDefinition(
    agent_id="capital_agent",
    agent_class="capital_agent",
    version="1.1.0",
    supported_principal_types=("company", "financier"),
    supported_outcome_types=CAPITAL_OUTCOME_TYPES,
    allowed_authority_levels=AUTHORITY_LEVELS,
    eligible_tool_classes=("context_read", "memory_read", "calculation", "artifact", "proposal", "specialist_read"),
    eligible_specialist_reads=("compliance_agent", "risk_agent", "market_network_agent", "trade_operations_agent", "audit_monitoring_agent"),
    data_classes=("selected_objects", "trade_context", "finance_read", "org_finance_profile", "memory_governed"),
    model_policy_id="capital-default",
    evidence_policy_id="evidence.finance.material-v1",
    budgets=BudgetPolicy(timeout_seconds=90, max_model_steps=6, max_tool_calls=24, max_output_tokens=8192, max_cost_usd=2.0),
    status="active",
    provenance="traibox-capital-agent-v1.1",
)
