"""Cash-flow timeline (v1.1: same-day aggregation + explicit recovery
definition, §9.1), working capital (v1.1: no double counting, §9.2), CCC, and
liquidity/runway (v1.1: dated events + burn mode, §9.6)."""

from __future__ import annotations

from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from ..decimal_policy import quantize_money, serialize_decimal
from ..registry import CalculatorDefinition, CalculatorOutcome
from ..request import StructuredWarning, ValidationFinding
from ..types import DatedAmount, DecimalStr, StrictInput
from ..validators import non_negative_money, positive_multiplier

# §9.1 documented model: all events on the same DATE are aggregated into one
# net daily movement — no intraday sequencing is inferred (not from labels,
# not from input order). Recovery is defined as cumulative cash returning to
# or above ZERO after the peak deficit; the definition ships in the result.
RECOVERY_DEFINITION = "recovery_to_zero"
SAME_DAY_MODEL = "aggregate_by_date"


class CashflowInput(StrictInput):
    currency: str = Field(min_length=3, max_length=3)
    opening_cash: DecimalStr = Decimal(0)
    events: list[DatedAmount] = Field(min_length=1)


class CashflowOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    timeline: list[dict[str, str | None]]
    closing_cash: str
    peak_cash_deficit: str
    cash_need_date: str | None = None
    recovery_date: str | None = None
    same_day_model: str
    recovery_definition: str


def _daily_timeline(inputs: CashflowInput) -> tuple[list[dict[str, str | None]], Decimal, Decimal, str | None, str | None]:
    mixed = [e.label or str(e.on) for e in inputs.events if e.currency.upper() != inputs.currency.upper()]
    if mixed:
        raise _MixedCurrencies(mixed)
    by_date: dict[str, Decimal] = {}
    labels: dict[str, list[str]] = {}
    for event in inputs.events:
        key = event.on.isoformat()
        by_date[key] = by_date.get(key, Decimal(0)) + event.amount
        if event.label:
            labels.setdefault(key, []).append(event.label)
    running = inputs.opening_cash
    timeline: list[dict[str, str | None]] = []
    peak_deficit = Decimal(0)
    peak_date: str | None = None
    recovery_date: str | None = None
    for day in sorted(by_date):
        running += by_date[day]
        timeline.append(
            {
                "on": day,
                "net_amount": serialize_decimal(quantize_money(by_date[day], inputs.currency)),
                "labels": "; ".join(sorted(labels.get(day, []))) or None,
                "cumulative": serialize_decimal(quantize_money(running, inputs.currency)),
            }
        )
        if running < peak_deficit:
            peak_deficit, peak_date, recovery_date = running, day, None
        elif peak_deficit < 0 and running >= 0 and recovery_date is None:
            recovery_date = day
    return timeline, running, peak_deficit, peak_date, recovery_date


class _MixedCurrencies(Exception):
    def __init__(self, keys: list[str]) -> None:
        self.keys = keys


def compute_cashflow(inputs: CashflowInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    try:
        timeline, closing, peak_deficit, peak_date, recovery_date = _daily_timeline(inputs)
    except _MixedCurrencies as exc:
        return CalculatorOutcome(
            status="insufficient_information",
            outputs={},
            validations=[ValidationFinding(check="single_currency", status="fail", finding="events must be pre-converted to the timeline currency")],
            missing_fields=[f"fx_conversion_for:{m}" for m in exc.keys],
        )
    outputs = {
        "currency": currency,
        "timeline": timeline,
        "closing_cash": serialize_decimal(quantize_money(closing, currency)),
        "peak_cash_deficit": serialize_decimal(quantize_money(peak_deficit, currency)),
        "cash_need_date": peak_date,
        "recovery_date": recovery_date,
        "same_day_model": SAME_DAY_MODEL,
        "recovery_definition": RECOVERY_DEFINITION,
    }
    return CalculatorOutcome(status="completed", outputs=outputs)


class WorkingCapitalInput(StrictInput):
    """§9.2: opening_cash covers cash already on hand; additional internal
    liquidity and committed facilities are declared SEPARATELY and must not
    duplicate amounts already inside opening_cash (documented definition)."""

    currency: str = Field(min_length=3, max_length=3)
    opening_cash: DecimalStr = Decimal(0)
    events: list[DatedAmount] = Field(min_length=1)
    additional_internal_liquidity: DecimalStr = Decimal(0)
    committed_facilities: DecimalStr = Decimal(0)


class WorkingCapitalOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    gross_peak_requirement: str
    internal_liquidity_applied: str
    committed_facilities_applied: str
    residual_funding_gap: str
    funding_need_date: str | None = None
    gap_duration_days: int | None = None
    recovery_definition: str


def compute_working_capital(inputs: WorkingCapitalInput) -> CalculatorOutcome:
    non_negative_money(inputs.additional_internal_liquidity, "additional_internal_liquidity")
    non_negative_money(inputs.committed_facilities, "committed_facilities")
    base = compute_cashflow(CashflowInput(currency=inputs.currency, opening_cash=inputs.opening_cash, events=inputs.events))
    if base.status != "completed":
        return base
    currency = inputs.currency.upper()
    peak_deficit = Decimal(base.outputs["peak_cash_deficit"])
    gross_requirement = -peak_deficit if peak_deficit < 0 else Decimal(0)
    internal_applied = min(gross_requirement, inputs.additional_internal_liquidity)
    facilities_applied = min(gross_requirement - internal_applied, inputs.committed_facilities)
    residual = gross_requirement - internal_applied - facilities_applied
    need_date = base.outputs["cash_need_date"]
    recovery = base.outputs["recovery_date"]
    duration = None
    if need_date and recovery:
        from datetime import date

        duration = (date.fromisoformat(recovery) - date.fromisoformat(need_date)).days
    outputs = {
        "currency": currency,
        "gross_peak_requirement": serialize_decimal(quantize_money(gross_requirement, currency)),
        "internal_liquidity_applied": serialize_decimal(quantize_money(internal_applied, currency)),
        "committed_facilities_applied": serialize_decimal(quantize_money(facilities_applied, currency)),
        "residual_funding_gap": serialize_decimal(quantize_money(residual, currency)),
        "funding_need_date": need_date,
        "gap_duration_days": duration,
        "recovery_definition": RECOVERY_DEFINITION,
    }
    return CalculatorOutcome(status="completed", outputs=outputs, warnings=list(base.warnings))


class CccInput(StrictInput):
    inventory_days: DecimalStr | None = None
    receivable_days: DecimalStr | None = None
    payable_days: DecimalStr | None = None


class CccOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ccc_days: str


def compute_ccc(inputs: CccInput) -> CalculatorOutcome:
    missing = [f for f in ("inventory_days", "receivable_days", "payable_days") if getattr(inputs, f) is None]
    if missing:
        return CalculatorOutcome(
            status="insufficient_information",
            outputs={},
            warnings=[StructuredWarning(code="ccc.inputs_not_meaningful", message="cash-conversion metrics are omitted when accounting inputs are not meaningful", severity="info", related_input_paths=missing)],
            missing_fields=missing,
        )
    ccc = inputs.inventory_days + inputs.receivable_days - inputs.payable_days  # type: ignore[operator]
    return CalculatorOutcome(status="completed", outputs={"ccc_days": serialize_decimal(ccc)})


class LiquidityInput(StrictInput):
    """§9.6: dated mode (committed inflows/outflows as events) preferred when
    dated information exists; constant monthly burn remains a supported
    simplified mode."""

    currency: str = Field(min_length=3, max_length=3)
    opening_liquidity: DecimalStr
    minimum_cash: DecimalStr = Decimal(0)
    liquidity_buffer: DecimalStr = Decimal(0)
    committed_events: list[DatedAmount] = Field(default_factory=list)
    monthly_net_burn: DecimalStr | None = None
    stress_burn_multiplier: DecimalStr = Decimal(1)


class LiquidityOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str
    mode: str
    usable_liquidity: str
    minimum_projected_liquidity: str | None = None
    runway_months: str | None = None
    stress_runway_months: str | None = None
    runway_breach_date: str | None = None
    note: str | None = None


def compute_liquidity(inputs: LiquidityInput) -> CalculatorOutcome:
    currency = inputs.currency.upper()
    non_negative_money(inputs.minimum_cash, "minimum_cash")
    non_negative_money(inputs.liquidity_buffer, "liquidity_buffer")
    positive_multiplier(inputs.stress_burn_multiplier, "stress_burn_multiplier")
    floor = inputs.minimum_cash + inputs.liquidity_buffer
    usable = inputs.opening_liquidity - floor
    if inputs.committed_events:
        timeline = compute_cashflow(CashflowInput(currency=inputs.currency, opening_cash=inputs.opening_liquidity, events=inputs.committed_events))
        if timeline.status != "completed":
            return timeline
        minimum_projected = min(Decimal(entry["cumulative"]) for entry in timeline.outputs["timeline"])
        breach = next((entry["on"] for entry in timeline.outputs["timeline"] if Decimal(entry["cumulative"]) < floor), None)
        outputs = {
            "currency": currency,
            "mode": "dated_events",
            "usable_liquidity": serialize_decimal(quantize_money(usable, currency)),
            "minimum_projected_liquidity": serialize_decimal(quantize_money(minimum_projected, currency)),
            "runway_breach_date": breach,
            "runway_months": None,
            "stress_runway_months": None,
            "note": None,
        }
        return CalculatorOutcome(status="completed", outputs=outputs)
    if inputs.monthly_net_burn is None:
        return CalculatorOutcome(status="insufficient_information", outputs={}, missing_fields=["monthly_net_burn", "committed_events"])
    if inputs.monthly_net_burn <= 0:
        return CalculatorOutcome(status="completed", outputs={"currency": currency, "mode": "burn_rate", "usable_liquidity": serialize_decimal(quantize_money(usable, currency)), "runway_months": None, "stress_runway_months": None, "minimum_projected_liquidity": None, "runway_breach_date": None, "note": "no net burn — runway not applicable"})
    runway = usable / inputs.monthly_net_burn
    stress = usable / (inputs.monthly_net_burn * inputs.stress_burn_multiplier)
    outputs = {
        "currency": currency,
        "mode": "burn_rate",
        "usable_liquidity": serialize_decimal(quantize_money(usable, currency)),
        "runway_months": serialize_decimal(runway.quantize(Decimal("0.1"))),
        "stress_runway_months": serialize_decimal(stress.quantize(Decimal("0.1"))),
        "minimum_projected_liquidity": None,
        "runway_breach_date": None,
        "note": None,
    }
    return CalculatorOutcome(status="completed", outputs=outputs)


_CF_COMMON = dict(data_classes=("trade_context", "finance_read"), sensitivity="confidential")

CASHFLOW = CalculatorDefinition(
    calculator_id="capital.calculate_cashflow_timeline",
    calculator_version="1.1.0",
    formula_version="cashflow-timeline-v2",
    input_model=CashflowInput,
    output_model=CashflowOutput,
    compute=compute_cashflow,  # type: ignore[arg-type]
    material_input_paths=("opening_cash", "events[*].amount"),
    may_default_paths=("opening_cash",),
    scenario_overridable_paths=("opening_cash", "events"),
    comparable_output_keys=("peak_cash_deficit", "closing_cash"),
    unordered_list_paths=("events",),
    required_evidence_categories=("payment_terms", "order_documents"),
    **_CF_COMMON,
)

WORKING_CAPITAL = CalculatorDefinition(
    calculator_id="capital.calculate_working_capital",
    calculator_version="1.1.0",
    formula_version="wc-gap-v2",
    input_model=WorkingCapitalInput,
    output_model=WorkingCapitalOutput,
    compute=compute_working_capital,  # type: ignore[arg-type]
    material_input_paths=("opening_cash", "events[*].amount", "additional_internal_liquidity", "committed_facilities"),
    may_default_paths=("opening_cash", "additional_internal_liquidity", "committed_facilities"),
    scenario_overridable_paths=("opening_cash", "events", "additional_internal_liquidity", "committed_facilities"),
    comparable_output_keys=("gross_peak_requirement", "residual_funding_gap"),
    unordered_list_paths=("events",),
    required_evidence_categories=("payment_terms", "liquidity_statements"),
    **_CF_COMMON,
)

CCC = CalculatorDefinition(
    calculator_id="capital.calculate_ccc",
    calculator_version="1.0.0",
    formula_version="ccc-v1",
    input_model=CccInput,
    output_model=CccOutput,
    compute=compute_ccc,  # type: ignore[arg-type]
    material_input_paths=("inventory_days", "receivable_days", "payable_days"),
    scenario_overridable_paths=("inventory_days", "receivable_days", "payable_days"),
    comparable_output_keys=("ccc_days",),
    unordered_list_paths=(),
    required_evidence_categories=("accounting_metrics",),
    **_CF_COMMON,
)

LIQUIDITY = CalculatorDefinition(
    calculator_id="capital.calculate_liquidity_runway",
    calculator_version="1.1.0",
    formula_version="runway-v2",
    input_model=LiquidityInput,
    output_model=LiquidityOutput,
    compute=compute_liquidity,  # type: ignore[arg-type]
    material_input_paths=("opening_liquidity", "monthly_net_burn", "committed_events[*].amount"),
    may_default_paths=("minimum_cash", "liquidity_buffer"),
    scenario_overridable_paths=("opening_liquidity", "monthly_net_burn", "committed_events", "stress_burn_multiplier"),
    comparable_output_keys=("usable_liquidity", "runway_months", "minimum_projected_liquidity"),
    required_evidence_categories=("liquidity_statements",),
    data_classes=("finance_read", "org_finance_profile"),
    sensitivity="restricted_financial",
    unordered_list_paths=("committed_events",),
)
