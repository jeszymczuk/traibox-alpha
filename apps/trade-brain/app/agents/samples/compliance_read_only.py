"""Minimal non-Capital sample definition (directive B2).

A framework TEST FIXTURE proving the same governed runtime serves another
specialist class — not a claim that a production Compliance Agent exists.
Read-only: analyse ceiling, context reads only.
"""

from __future__ import annotations

from ..framework.definition import AgentDefinition, BudgetPolicy

COMPLIANCE_READ_ONLY_SAMPLE = AgentDefinition(
    agent_id="compliance_read_sample",
    agent_class="compliance_agent",
    version="0.1.0",
    supported_principal_types=("company",),
    supported_outcome_types=("compliance_context_read",),
    allowed_authority_levels=("observe", "analyse"),
    eligible_tool_classes=("context_read",),
    data_classes=("selected_objects",),
    budgets=BudgetPolicy(timeout_seconds=30, max_model_steps=1, max_tool_calls=4, max_output_tokens=1024, max_cost_usd=0.1),
    status="active",
    provenance="traibox-framework-sample",
)
