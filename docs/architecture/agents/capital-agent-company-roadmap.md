# Capital Agent v1.1 — Company-Side Capability Roadmap

Scope per CA-100: the **complete** company-side Capital Agent. Nothing here is removed to shrink the first delivery; the vertical slice (see [capital-agent-first-vertical-slice.md](capital-agent-first-vertical-slice.md)) is the first milestone on this roadmap, not its ceiling.

## 1. Company-side capabilities → outcomes → calculators → phase

| Capability (direction §6) | Outcome type(s) (spec §7.2) | Key Workbench calculators (spec §11) | Delivery |
|---|---|---|---|
| Transaction financial diagnosis | `capital_diagnosis` | gap/timeline classifiers | **Slice** (P4a) |
| Trade-cost analysis | `trade_cost_analysis` | trade cost waterfall, FX conversion | **Slice** |
| Landed-cost analysis | `landed_cost_analysis` | landed cost per unit + anomaly checks | **Slice** |
| Transaction P&L / margin | `transaction_pnl` | P&L waterfall, gross/contribution margin | **Slice** |
| Cash-flow timing/forecast | `cashflow_forecast` | cash-flow timeline engine | **Slice** (timing view; 13-week forecast P4b) |
| Working-capital analysis + funding gap | `working_capital_analysis` | WC gap, CCC (omitted when not meaningful) | **Slice** |
| Financing need classification | `financing_need_classification` | eligibility classifier (stage-aware: Golden A/B) | **Slice** |
| Financing-options comparison | `financing_option_comparison` | financing cost, receivables proceeds, offer normalization, eligibility-first comparison | **Slice** |
| Financing packet (one artifact among many) | `funding_packet` | (composes the above) | P4b |
| Financing strategy | `financing_strategy` | scenario comparison | P4b |
| Company aggregate / portfolio P&L | `portfolio_pnl` | aggregation/allocation | P4b |
| Scenario & sensitivity modelling | `scenario_model` | scenario engine over any calculator | P4b |
| Term-sheet review + counteroffer | `term_sheet_review`, `financial_counteroffer` | cost/covenant/dilution calculators | P4b |
| Treasury & liquidity planning | `treasury_liquidity_plan` | liquidity, cash concentration, payment-route economics | P4c |
| FX analysis & scenarios | `fx_exposure_analysis` | FX exposure/scenarios | P4c |
| Capital planning (debt/equity/dilution/investment/returns) | `capital_plan` | sources/uses, debt service, DSCR, runway, dilution, NPV/IRR | P4c |
| Instrument structuring & settlement planning | `instrument_blueprint` | milestone schedule, tranche/cash-lock, condition evaluation | P4c |
| Financial milestone analysis + monitoring + alerts | `milestone_monitoring_report` | condition evaluator; monitoring state | P5 |
| Negotiation support | (skill over term-sheet/counteroffer outcomes) | walk-away/trade-off analysis | P4c |
| Professional Capital artifacts | all `CapitalArtifactType`s for the above | — | with each outcome |

Phasing note: P4a/P4b/P4c are coherent increments inside Phase 4 (outcomes/skills/artifacts) per direction §17; the Workbench (Phase 3) delivers slice calculators first, then the remainder (direction §8).

## 2. Deferred **solely because financier-specific** (direction §2)

Financier onboarding & navigation/UX; underwriting workbench & pre-reads *as a financier user*; private credit-analysis workspace; lender portfolio/concentration/exposure management; financier allocation workflows; private financier relationship memory; internal lender pricing; lender approval workflows; financier credit decisioning; bilateral disclosure UX; two-active-principal conflict-of-interest operations.

Each maps to already-specified v1.1 constructs (financier mandates, financier outcomes `underwriting_pre_read`/`credit_memo_draft`/`allocation_memo_draft`/`portfolio_exposure_brief`, financier evidence/memory scopes, disclosure packages, financier surfaces) that activate **additively** later — see CA-101.

## 3. What keeps the foundation financier-compatible while deferred

- `principal_type` reserved values + `principal_id`/`mandate_id` on every foundational record from Phase 1.
- Generic contract names (task/outcome/artifact/…) — no `company_*` schemas.
- Mandate contract supports `allowedOutcomeTypes`/`permittedDataClasses`/authority ceilings — a financier mandate is a new row + policies, not a new system.
- Evidence visibility + memory ownership scoped per principal from day one.
- Outcome registry keyed by `supportedPrincipalTypes` — financier outcomes register without framework change.
- Disclosure packages specified (spec §5.4, §13.7) and stubbed as contracts; UX deferred.

Financier-direct implementation begins only after company-side validation + founder approval + a dedicated financier-scope plan (CA-109).
