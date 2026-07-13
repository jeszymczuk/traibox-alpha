"""Versioned semantic binding-policy registry (semantic evidence-binding
closure §1).

Equal numbers are not the same financial fact. A caller may PROPOSE a mapping
from a canonical object field to a calculator/context input, but only a
server-owned, code-owned, versioned policy rule may AUTHORIZE it. A rule
proves the canonical field is semantically permitted to support that specific
financial input — beyond ownership, freshness, contradiction status, and
exact value equality (which the engine already checks).

For this release every rule is an EXACT-IDENTITY mapping (no caller-defined
transformations, no unit conversions). An input with no authorizing rule
stays user_provided / assumption / estimate / unresolved — it is never
verified. Both the TypeScript API and the Trade Brain revalidate against this
registry independently; the registry content is mirrored field-for-field in
packages/contracts/... and apps/api/src/domains/capital/context/
binding-policy.ts with a parity fixture.
"""

from __future__ import annotations

from dataclasses import dataclass

BINDING_POLICY_VERSION = "capital-binding-policy-v1"

# Sentinel calculator id for material outcome inputs consumed by composers
# rather than by a calculator (§6).
CONTEXT_CALCULATOR_ID = "@context"


@dataclass(frozen=True)
class BindingRule:
    rule_id: str
    # Source (canonical field) constraints.
    source_concept: str
    permitted_object_types: tuple[str, ...]
    permitted_source_layers: tuple[str, ...]
    permitted_field_paths: tuple[str, ...]
    required_value_type: str  # decimal | integer | boolean | string | date
    currency_relationship: str  # same | any | not_applicable
    source_evidence_category: str
    # Target (calculator / context input) constraints.
    calculator_id: str  # exact id, or CONTEXT_CALCULATOR_ID
    calculator_key: str  # exact outcome-definition key, or "*" for any key
    input_path: str  # exact input path
    target_evidence_category: str
    target_semantic_concept: str
    # Transformation policy (this release: exact identity only).
    exact_identity: bool = True
    deterministic_conversion: str | None = None
    # Outcome scoping (optional). None → applies to any outcome that consumes
    # the matching (calculator_id, key, input_path).
    outcome_type: str | None = None
    outcome_definition_version: str | None = None

    def identity(self) -> dict[str, str]:
        """Stable audited identity carried into verified provenance + hashes."""
        return {
            "binding_policy_version": BINDING_POLICY_VERSION,
            "binding_rule_id": self.rule_id,
            "semantic_concept": self.target_semantic_concept,
            "source_evidence_category": self.source_evidence_category,
            "target_evidence_category": self.target_evidence_category,
        }


# ---------------------------------------------------------------------------
# Conservative, defensible mappings only (§5). Absence of a rule = fail closed.
# ---------------------------------------------------------------------------
_RULES: tuple[BindingRule, ...] = (
    # A single-shipment trade's contract amount is the transaction face value;
    # the outcome definitions that consume it as revenue declare that concept.
    BindingRule(
        rule_id="BR-TRADE-AMOUNT-REVENUE",
        source_concept="trade_contract_amount",
        permitted_object_types=("trade",),
        permitted_source_layers=("relational",),
        permitted_field_paths=("amount",),
        required_value_type="decimal",
        currency_relationship="same",
        source_evidence_category="trade_context",
        calculator_id="capital.calculate_transaction_pnl",
        calculator_key="pnl",
        input_path="revenue",
        target_evidence_category="cost_evidence",
        target_semantic_concept="transaction_revenue",
    ),
    # Finance-offer tenor → financing-cost tenor (both integer days, exact).
    BindingRule(
        rule_id="BR-OFFER-TENOR",
        source_concept="offer_tenor",
        permitted_object_types=("finance_offer",),
        permitted_source_layers=("relational",),
        permitted_field_paths=("tenor_days",),
        required_value_type="integer",
        currency_relationship="not_applicable",
        source_evidence_category="offer_terms",
        calculator_id="capital.calculate_financing_cost",
        calculator_key="*",
        input_path="tenor_days",
        target_evidence_category="offer_terms",
        target_semantic_concept="financing_tenor",
    ),
    # Finance-offer fees → financing-cost fee amount (both decimal, same ccy).
    BindingRule(
        rule_id="BR-OFFER-FEES",
        source_concept="offer_fees",
        permitted_object_types=("finance_offer",),
        permitted_source_layers=("relational",),
        permitted_field_paths=("fees",),
        required_value_type="decimal",
        currency_relationship="same",
        source_evidence_category="offer_terms",
        calculator_id="capital.calculate_financing_cost",
        calculator_key="*",
        input_path="fees[0].amount",
        target_evidence_category="offer_terms",
        target_semantic_concept="financing_fee",
    ),
    # Authoritative account balance → working-capital opening cash.
    BindingRule(
        rule_id="BR-ACCOUNT-OPENING-CASH",
        source_concept="account_balance",
        permitted_object_types=("account",),
        permitted_source_layers=("relational", "external"),
        permitted_field_paths=("balance",),
        required_value_type="decimal",
        currency_relationship="same",
        source_evidence_category="cashflow_basis",
        calculator_id="capital.calculate_working_capital",
        calculator_key="working_capital",
        input_path="opening_cash",
        target_evidence_category="cashflow_basis",
        target_semantic_concept="opening_liquidity",
    ),
    # Authoritative account balance → liquidity opening liquidity.
    BindingRule(
        rule_id="BR-ACCOUNT-OPENING-LIQUIDITY",
        source_concept="account_balance",
        permitted_object_types=("account",),
        permitted_source_layers=("relational", "external"),
        permitted_field_paths=("balance",),
        required_value_type="decimal",
        currency_relationship="same",
        source_evidence_category="liquidity_evidence",
        calculator_id="capital.calculate_liquidity_runway",
        calculator_key="liquidity",
        input_path="opening_liquidity",
        target_evidence_category="liquidity_evidence",
        target_semantic_concept="opening_liquidity",
    ),
    # Authoritative invoice amount → receivables face value.
    BindingRule(
        rule_id="BR-INVOICE-AMOUNT",
        source_concept="invoice_amount",
        permitted_object_types=("invoice",),
        permitted_source_layers=("relational", "alpha_object"),
        permitted_field_paths=("total", "amount"),
        required_value_type="decimal",
        currency_relationship="same",
        source_evidence_category="trade_context",
        calculator_id="capital.calculate_receivables_finance",
        calculator_key="receivables",
        input_path="invoice_amount",
        target_evidence_category="trade_context",
        target_semantic_concept="receivables_face_value",
    ),
    # -----------------------------------------------------------------------
    # §6 context-input rules (calculator_id = CONTEXT_CALCULATOR_ID). A GENERIC
    # trade record can never verify these specific existence/status facts —
    # each requires its OWN authoritative canonical source.
    # -----------------------------------------------------------------------
    BindingRule(
        rule_id="BR-CTX-INVOICE-EXISTS",
        source_concept="invoice_presence",
        permitted_object_types=("invoice",),
        permitted_source_layers=("relational", "alpha_object"),
        permitted_field_paths=("exists", "status_present"),
        required_value_type="boolean",
        currency_relationship="not_applicable",
        source_evidence_category="trade_context",
        calculator_id=CONTEXT_CALCULATOR_ID,
        calculator_key="@context",
        input_path="trade_context.invoice_exists",
        target_evidence_category="trade_context",
        target_semantic_concept="invoice_existence",
    ),
    BindingRule(
        rule_id="BR-CTX-RECEIVABLE-EXISTS",
        source_concept="receivable_presence",
        permitted_object_types=("receivable", "invoice"),
        permitted_source_layers=("relational", "alpha_object"),
        permitted_field_paths=("exists", "status_present"),
        required_value_type="boolean",
        currency_relationship="not_applicable",
        source_evidence_category="trade_context",
        calculator_id=CONTEXT_CALCULATOR_ID,
        calculator_key="@context",
        input_path="trade_context.receivable_exists",
        target_evidence_category="trade_context",
        target_semantic_concept="receivable_existence",
    ),
    BindingRule(
        rule_id="BR-CTX-DELIVERY-COMPLETE",
        source_concept="delivery_status",
        permitted_object_types=("delivery", "shipment", "trade"),
        permitted_source_layers=("relational", "alpha_object"),
        permitted_field_paths=("delivery_complete", "delivered"),
        required_value_type="boolean",
        currency_relationship="not_applicable",
        source_evidence_category="trade_context",
        calculator_id=CONTEXT_CALCULATOR_ID,
        calculator_key="@context",
        input_path="trade_context.delivery_complete",
        target_evidence_category="trade_context",
        target_semantic_concept="delivery_completion",
    ),
    BindingRule(
        rule_id="BR-CTX-BUYER-ACCEPTANCE",
        source_concept="acceptance_status",
        permitted_object_types=("acceptance", "invoice", "trade"),
        permitted_source_layers=("relational", "alpha_object"),
        permitted_field_paths=("buyer_acceptance", "accepted"),
        required_value_type="boolean",
        currency_relationship="not_applicable",
        source_evidence_category="trade_context",
        calculator_id=CONTEXT_CALCULATOR_ID,
        calculator_key="@context",
        input_path="trade_context.buyer_acceptance",
        target_evidence_category="trade_context",
        target_semantic_concept="buyer_acceptance",
    ),
)


class BindingPolicyRegistry:
    """Exact-match authorization: a proposed binding is authorized only when a
    rule matches ALL of source object type, source layer, canonical field
    path, required value type, currency relationship, and the exact target
    (calculator id, key, input path). No fuzzy fallbacks."""

    policy_version = BINDING_POLICY_VERSION

    def __init__(self, rules: tuple[BindingRule, ...] = _RULES) -> None:
        by_id: dict[str, BindingRule] = {}
        for rule in rules:
            if rule.rule_id in by_id:
                raise ValueError(f"duplicate binding rule id {rule.rule_id}")
            by_id[rule.rule_id] = rule
        self._rules = rules
        self._by_id = by_id

    def get(self, rule_id: str) -> BindingRule | None:
        return self._by_id.get(rule_id)

    def authorize(
        self,
        *,
        calculator_id: str,
        calculator_key: str,
        input_path: str,
        object_type: str,
        source_layer: str,
        field_path: str,
        value_type: str | None,
        source_currency: str | None,
        target_currency: str | None,
        source_concept: str | None,
        outcome_type: str | None = None,
        outcome_definition_version: str | None = None,
    ) -> BindingRule | None:
        for rule in self._rules:
            if rule.calculator_id != calculator_id:
                continue
            if rule.calculator_key != "*" and rule.calculator_key != calculator_key:
                continue
            if rule.input_path != input_path:
                continue
            if object_type not in rule.permitted_object_types:
                continue
            if source_layer not in rule.permitted_source_layers:
                continue
            if field_path not in rule.permitted_field_paths:
                continue
            if value_type is not None and rule.required_value_type != value_type:
                continue
            # Semantic concept must match when the canonical field declares one.
            if source_concept is not None and source_concept != rule.source_concept:
                continue
            if rule.currency_relationship == "same" and source_currency and target_currency and source_currency.upper() != target_currency.upper():
                continue
            if rule.outcome_type is not None and rule.outcome_type != outcome_type:
                continue
            if rule.outcome_definition_version is not None and rule.outcome_definition_version != outcome_definition_version:
                continue
            return rule
        return None


DEFAULT_BINDING_POLICY = BindingPolicyRegistry()
