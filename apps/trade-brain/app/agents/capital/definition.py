"""Capital Agent definition v1.1 (spec §17.1; company-side scope, CA-100/101).

Directive A7: the ACTIVE company-side definition advertises only company-side
outcomes as executable. Financier-direct outcomes stay reserved in the shared
contracts (financier-compatible foundation) but are NOT executable through the
company definition — a company mandate cannot run them even if the outcome
string is supplied, because the definition does not support them.
"""

from __future__ import annotations

from ..framework.authority import AUTHORITY_LEVELS
from ..framework.definition import AgentDefinition, BudgetPolicy

# Executable, company-side outcomes (approved roadmap).
ACTIVE_COMPANY_OUTCOME_TYPES: tuple[str, ...] = (
    "capital_diagnosis",
    "trade_cost_analysis",
    "landed_cost_analysis",
    "transaction_pnl",
    "portfolio_pnl",  # company-side aggregate P&L, not financier portfolio analysis
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
)

# Reserved financier-direct outcomes: present in shared contracts for future
# additive activation; NOT executable via the company definition.
RESERVED_FINANCIER_OUTCOME_TYPES: tuple[str, ...] = (
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
    supported_outcome_types=ACTIVE_COMPANY_OUTCOME_TYPES,
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
