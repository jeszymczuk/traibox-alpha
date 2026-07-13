# TRAIBOX Capital Agent v1.1
## Normative Architecture and Production Build Specification

**Document status:** AUTHORITATIVE BUILD CONTRACT  
**Version:** 1.1.0  
**Date:** 12 July 2026  
**Product:** TRAIBOX  
**Component:** Capital Agent  
**Intended implementers:** Claude Code, OpenAI Codex, TRAIBOX engineers, architects, finance-domain reviewers, security reviewers, QA/evaluation engineers  
**Classification:** Confidential  
**Supersedes:** `capital-agent-spec.md` and all earlier informal Capital Agent drafts where they conflict with this specification  
**Related canonical blueprint:** Ch.5 Trade Intelligence Core; Ch.6 Agents & Delegated Agentic Functions; Annex 5B Context, Trade Memory & Universal Trade Graph; Ch.12 Finance 2.0 and its annexes  
**Repository target:** `jeszymczuk/traibox-alpha`

---

# 1. Purpose and normative language

This document is the final implementation contract for Capital Agent v1.1. It converts prior proposals, critiques, research, blueprint chapters, and repository inspection into one reconciled set of decisions.

The keywords **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative:

- **MUST / MUST NOT** — required for conformance.
- **SHOULD / SHOULD NOT** — expected unless a documented engineering reason is approved.
- **MAY** — optional or deployment-dependent.

Where this specification conflicts with an earlier Capital Agent draft, this specification wins. Where this specification appears to conflict with a locked TRAIBOX platform doctrine, the platform doctrine wins and the conflict MUST be escalated rather than silently resolved in code.

This specification intentionally distinguishes:

- **Verified platform facts** — already present in the TRAIBOX blueprint or repository.
- **Binding design decisions** — decisions established here for Capital Agent v1.1.
- **Implementation targets** — measurable targets to validate in engineering.
- **Deferred decisions** — explicitly outside v1.1.

---

# 2. Executive architecture decision

## 2.1 Canonical definition

The **TRAIBOX Capital Agent** is a governed, persistent-in-relationship but ephemeral-in-runtime finance-and-capital intelligence specialist for companies and financiers.

It:

1. understands the principal’s financial context, objectives, constraints, transactions, portfolio, instruments, counterparties, and operating preferences;
2. performs or coordinates deterministic financial analysis;
3. diagnoses financial needs;
4. models, compares, and structures financial solutions;
5. prepares decision-grade artifacts;
6. monitors financial conditions, obligations, milestones, and outcomes;
7. collaborates with other TRAIBOX specialists when another domain is authoritative;
8. proposes governed actions for human approval;
9. learns from permitted outcomes and user feedback through TRAIBOX memory;
10. never replaces canonical business systems, regulated providers, accountable humans, or domain modules.

The Capital Agent is **not**:

- the Finance module;
- a payment engine;
- a funding marketplace;
- an escrow ledger;
- a bank;
- a lender;
- an underwriter of record;
- a legal, tax, accounting, compliance, or regulated-credit authority;
- the owner of canonical financial state;
- a free-roaming autonomous actor;
- a coding-tool subagent in production;
- a chatbot wrapper around a general model.

## 2.2 The non-confusion rule

The following separation is binding:

| Layer | Owns | Does not own |
|---|---|---|
| **TRAIBOX domain modules** | Canonical state, domain validation, domain workflows, protected execution, provider integrations | General conversational reasoning |
| **Trade Intelligence platform** | Context assembly, orchestration, shared agent runtime, model routing, memory retrieval, evidence, audit, evaluations | Canonical domain truth |
| **Capital Agent** | Finance-and-capital interpretation, analysis, synthesis, structuring, recommendation, drafting, monitoring, proposed action | Finance-module records or execution |
| **User surfaces** | Interaction, review, editing, approval, status, structured controls | Business logic or model authority |
| **External regulated/provider layer** | Actual custody, payments, offers, lending, banking, guarantees, legal escrow where applicable | TRAIBOX product reasoning |

No Capital Agent implementation MAY create a second set of funding, payment, facility, reservation, instrument, escrow, or reconciliation records that compete with Ch.12 Finance objects.

The Capital Agent MAY create:

- agent tasks;
- agent work results;
- analysis runs;
- outcome records;
- financial models and calculation runs;
- evidence claims;
- recommendations;
- draft artifacts;
- specialist-read requests;
- memory candidates;
- protected-action proposals.

The Capital Agent MUST reference canonical Finance objects by ID and MUST request all canonical mutations through typed domain commands or protected-action proposals.

## 2.3 Architectural formula

A Capital Agent outcome is defined as:

```text
Outcome =
  Principal perspective
  × Financial object
  × Professional operation
  × Time horizon
  × Evidence context
  × Deliverable
  × Authority level
```

This grammar provides broad professional capability without granting broad execution authority.

Example:

```text
Company CFO
× cross-border transaction
× diagnose + model + structure
× next 13 weeks
× verified internal records + explicit assumptions
× working-capital plan
× recommendation
```

Example:

```text
Financier analyst
× funding opportunity
× assess + stress + draft
× proposed facility lifecycle
× disclosed opportunity data + specialist reads
× underwriting pre-read
× non-binding recommendation
```

---

# 3. Reconciliation with the TRAIBOX blueprint

## 3.1 Ch.5 Trade Intelligence Core

Capital Agent v1.1 inherits these platform doctrines:

- Trade Intelligence is a cross-platform operating layer, not a standalone business module.
- Intelligence proposes; humans decide.
- Structured product surfaces are primary.
- Recommendations require traceable reasons.
- Deterministic logic is used where the result can be computed.
- Context compounds over time.
- Modules remain independently usable.
- Intelligence cannot become a single point of failure.
- Agents are governed delegates.
- Canonical domain truth remains in domain records.
- All material activity is auditable.

Capital Agent v1.1 therefore MUST remain usable from Trade Intelligence, Finance, Trades, and relevant embedded surfaces without becoming a duplicate module.

## 3.2 Ch.6 Agents & Delegated Agentic Functions

Capital Agent v1.1 inherits:

- ephemeral per-task runtime;
- persistent context outside the runtime;
- immutable invocation scope;
- registered tools only;
- no runtime self-modification;
- deterministic-first operations;
- structured reporting;
- explicit time and resource budgets;
- audit and replay;
- workflow-governed delegation;
- human confirmation gates for protected actions.

The term “persistent Capital Agent” refers to a durable user-facing identity, configuration, permissions, memory relationship, and work history. It does **not** mean a continuously running process with mutable hidden state.

## 3.3 Ch.12 Finance 2.0

Finance remains the canonical money operating layer. It owns:

- funding requests and opportunities;
- provider offers;
- reservations;
- funding facilities;
- payments and collections;
- accounts and cards;
- reconciliation;
- financial instruments;
- guarantees;
- conditional or milestone release state;
- provider connections;
- money readiness;
- controlled execution.

Capital Agent consumes and interprets those objects. It MAY propose their creation or transition. It MUST NOT own or directly mutate them.

## 3.4 Specialist-agent taxonomy reconciliation

The prior blueprint’s five classes and the earlier proposal’s seven labels are reconciled into the following canonical specialist family:

1. **Capital Agent** — finance, capital, treasury, funding, instruments, financier analysis.
2. **Compliance Agent** — regulatory rules, screening, evidence, declarations, hard compliance gates.
3. **Risk Agent** — credit, counterparty, fraud, exposure, concentration, risk appetite.
4. **Market & Network Agent** — markets, counterparties, sourcing, matching, network opportunities.
5. **Trade Operations Agent** — trade structuring, readiness, milestones, logistics/acceptance coordination.
6. **Audit & Monitoring Agent** — surveillance, anomaly detection, expiry, controls, evidence integrity.
7. **Concierge / Coordinator** — user-facing routing and coordination; not a domain authority.

Required blueprint amendment:

- the former “Finance Agent” class becomes **Capital Agent**;
- “Procurement Agent” broadens into **Market & Network Agent**;
- **Risk Agent** becomes a first-class specialist;
- “Monitoring Agent” becomes **Audit & Monitoring Agent**;
- **Concierge / Coordinator** is explicitly non-authoritative and routes work.

This taxonomy MUST be represented in configuration, contracts, evaluation fixtures, and user-facing labels. It MUST NOT be implemented as seven isolated products. All seven inherit one shared agent framework.

---

# 4. Principal, mandate, and instance model

## 4.1 Principal

Every Capital Agent invocation MUST identify the principal whose interest it serves.

```ts
type CapitalPrincipalType =
  | "company"
  | "financier"
  | "platform_internal";
```

Required fields:

```ts
interface CapitalPrincipal {
  principalType: CapitalPrincipalType;
  principalOrgId: UUID;
  actingUserId: UUID;
  roleProfileId: string;
  mandateId: UUID;
  dataBoundaryId: string;
  conflictPolicyId: string;
}
```

The principal is not inferred from conversational tone. It is loaded from authenticated tenancy and role context.

## 4.2 Company-side role profiles

Supported v1.1 profiles:

- owner / founder;
- CFO / finance director;
- treasury;
- finance operations;
- trade operations with finance-read access;
- approver;
- auditor / read-only reviewer.

Company-side outcomes include:

- transaction economics;
- pricing and margin;
- working-capital diagnosis;
- funding strategy;
- treasury and liquidity planning;
- capital-raising preparation;
- facility and term-sheet comparison;
- instrument and milestone design;
- negotiation preparation;
- financial monitoring.

## 4.3 Financier-side role profiles

Supported v1.1 profiles:

- relationship manager;
- originator;
- credit analyst;
- underwriter;
- portfolio manager;
- investment committee reviewer;
- servicing / monitoring analyst;
- financier administrator;
- auditor / read-only reviewer.

Financier-side outcomes include:

- opportunity intake and completeness;
- underwriting pre-read;
- repayment-source analysis;
- structure and conditions;
- exposure and concentration review;
- offer normalization;
- facility-monitoring brief;
- credit or allocation memo drafting.

## 4.4 Instance isolation

The same agent definition MAY power company and financier profiles, but runtime instances, retrieval scope, memory, artifacts, and authority MUST remain separate.

A company-side agent MUST NOT see a financier’s private underwriting notes.

A financier-side agent MUST NOT see company data that has not been explicitly disclosed under a valid grant.

Cross-principal collaboration MUST occur through controlled disclosure objects and auditable workflow transitions, not shared memory.

## 4.5 Mandate

A mandate defines the Capital Agent’s authorized professional remit for one principal.

```ts
interface CapitalAgentMandate {
  mandateId: UUID;
  principalOrgId: UUID;
  roleProfileId: string;
  allowedOutcomeTypes: CapitalOutcomeType[];
  allowedFinancialObjectTypes: FinancialObjectType[];
  permittedDataClasses: string[];
  permittedTools: string[];
  permittedSpecialistReads: SpecialistAgentClass[];
  permittedProposalKinds: ProtectedActionKind[];
  maxAuthorityLevel: CapitalAuthorityLevel;
  maxSensitivity: DataSensitivity;
  jurisdictionPolicyIds: string[];
  modelPolicyId: string;
  retentionPolicyId: string;
  conflictPolicyId: string;
  effectiveFrom: string;
  expiresAt?: string;
  version: number;
}
```

The mandate is immutable during one invocation. Changes require a new mandate version.

---

# 5. Authority and accountability model

## 5.1 Authority levels

```ts
type CapitalAuthorityLevel =
  | "observe"
  | "calculate"
  | "analyse"
  | "recommend"
  | "draft"
  | "monitor"
  | "propose_protected_action";
```

The Capital Agent MUST NOT have these authority levels in v1.1:

```text
approve
bind
commit
clear
custody
lend
underwrite_of_record
execute_payment
release_funds
accept_offer
sign
file_regulatory_declaration
```

## 5.2 Three-stage decision model

Every material output MUST identify its stage:

1. **Assessment** — what the evidence and calculations show.
2. **Recommendation** — what the Capital Agent recommends and why.
3. **Commitment** — the human, institution, or controlled domain action that accepts or executes it.

Capital Agent owns stages 1 and 2 within its mandate. It never owns stage 3.

## 5.3 Domain boundaries

| Question | Capital Agent role | Accountable authority |
|---|---|---|
| Which financing structures appear suitable? | Analyse and recommend | Human finance approver / financier |
| Is the borrower creditworthy? | Prepare financial read and route | Risk Agent + underwriter |
| Is the transaction compliant? | Identify dependency and route | Compliance Agent / accountable compliance role |
| Is a tax treatment legally correct? | Flag and request specialist input | Tax professional |
| Is an escrow legally constituted? | Design economics and conditions; do not certify | Legal counsel / regulated provider |
| Should funds be released? | Monitor evidence and propose | Finance workflow + authorized approver/provider |
| Which offer should be accepted? | Compare and recommend | Authorized human |
| Can a payment execute? | Explain readiness and constraints | Finance module + approval/execution controls |
| Is accounting treatment final? | Model effects as assumptions | Accountant / controller |
| Is a disclosure permitted? | Prepare disclosure set | Policy engine + authorized human |

## 5.4 Conflict of interest

Every mandate MUST identify the principal. The agent MUST NOT claim neutrality when interests differ.

When one transaction involves company and financier agents:

- each agent works for its own principal;
- each produces separate work results;
- disclosed facts may be shared only through controlled grants;
- conflicting interpretations remain visible;
- the orchestrator MAY generate a neutral comparison but MUST preserve provenance;
- no agent may silently merge private assumptions or negotiation positions.

---

# 6. Finance-and-capital capability ontology

The Capital Agent is broad within a bounded professional domain. Capability is represented as composable ontology, not a single giant prompt.

## 6.1 Financial object types

```ts
type FinancialObjectType =
  | "trade"
  | "trade_portfolio"
  | "invoice"
  | "receivable"
  | "payable"
  | "purchase_order"
  | "contract"
  | "commercial_proposal"
  | "cashflow"
  | "budget"
  | "working_capital_position"
  | "funding_request"
  | "funding_opportunity"
  | "funding_offer"
  | "reservation"
  | "facility"
  | "loan"
  | "credit_line"
  | "guarantee"
  | "letter_of_credit"
  | "documentary_collection"
  | "receivables_assignment"
  | "insurance_policy"
  | "payment_intent"
  | "payment_route"
  | "conditional_payment"
  | "instrument"
  | "milestone_schedule"
  | "escrow_case"
  | "term_sheet"
  | "capital_raise"
  | "equity_round"
  | "debt_raise"
  | "investment_opportunity"
  | "portfolio_exposure"
  | "treasury_position"
  | "fx_exposure"
  | "financial_model";
```

## 6.2 Professional operations

```ts
type CapitalProfessionalOperation =
  | "understand"
  | "diagnose"
  | "classify"
  | "calculate"
  | "model"
  | "forecast"
  | "stress"
  | "compare"
  | "benchmark"
  | "structure"
  | "optimize"
  | "price"
  | "rank"
  | "allocate"
  | "monitor"
  | "explain"
  | "draft"
  | "review"
  | "negotiate_prepare"
  | "route"
  | "propose";
```

## 6.3 Capability domains

### A. Transaction economics

- revenue, cost, contribution, gross margin, net margin;
- unit economics;
- landed cost;
- trade cost waterfall;
- break-even;
- pricing scenarios;
- payment-term economics;
- cost of delay;
- commercial proposal economics;
- transaction and corridor profitability.

### B. Cash flow and working capital

- cash-flow timelines;
- working-capital gaps;
- cash conversion cycle;
- DSO, DPO, DIO where data supports them;
- 13-week cash-flow forecasts;
- liquidity stress;
- receivables and payables timing;
- funding-gap timing and peak amount;
- cash runway and covenant headroom where relevant.

### C. Trade finance

- pre-shipment / purchase-order finance;
- production and inventory finance;
- receivables finance;
- factoring and invoice discounting;
- payables and supply-chain finance;
- letters of credit;
- documentary collections;
- bank guarantees;
- standby letters of credit;
- trade credit insurance;
- borrowing-base structures;
- distributor/dealer finance;
- structured conditional-payment approaches.

### D. Treasury and settlement economics

- account and liquidity views;
- payment-route economics;
- FX exposure and scenarios;
- timing and settlement risk;
- cash concentration recommendations;
- hedging requirement identification;
- liquidity buffers;
- payment scheduling;
- reconciliation impact.

The Capital Agent may analyse payment and settlement economics. The Finance module owns payment state and execution.

### E. Corporate capital strategy

- capital-needs diagnosis;
- debt/equity/convertible trade-offs;
- financing roadmap;
- capital structure scenarios;
- capital raise preparation;
- investor/lender data-room readiness;
- dilution and debt-service analysis;
- sources-and-uses;
- runway;
- investment appraisal;
- internal capital allocation;
- scenario-based funding strategy.

No securities offering, investment advice, or legal documentation is final without qualified review.

### F. Financier and underwriting support

- opportunity intake;
- data completeness;
- repayment-source mapping;
- borrower/trade economics;
- transaction structure;
- risk questions;
- conditions precedent;
- collateral/guarantee information;
- exposure and concentration;
- financial covenants;
- monitoring indicators;
- credit and allocation memo drafting.

The Capital Agent prepares an underwriting pre-read; it does not approve credit.

### G. Instruments, conditional value movement, and escrow-related design

- milestone schedule;
- release-condition definition;
- tranche economics;
- evidence mapping;
- exception and dispute paths;
- cash-lock impact;
- funding and payment dependencies;
- monitoring of conditions;
- release recommendation;
- amendment recommendation.

The Finance module or regulated provider owns the instrument record, custody state, and release execution.

### H. Markets and financial context

- benchmark-rate context;
- market and corridor financing conditions;
- provider and product categories;
- macro sensitivities;
- FX and rate scenarios;
- industry capital patterns.

Current-market conclusions require fresh authorized data. Without it, the agent MUST label scenarios as assumptions or abstain.

---

# 7. Outcome contract and registry

## 7.1 Outcome definition

An outcome is a versioned, testable contract describing what “done” means.

```ts
interface CapitalOutcomeDefinition {
  outcomeType: CapitalOutcomeType;
  version: string;
  supportedPrincipalTypes: CapitalPrincipalType[];
  supportedObjectTypes: FinancialObjectType[];
  requiredInputs: InputRequirement[];
  optionalInputs: InputRequirement[];
  blockingInputRules: BlockingInputRule[];
  calculatorIds: string[];
  specialistReadPolicies: SpecialistReadPolicy[];
  evidencePolicyId: string;
  artifactType: CapitalArtifactType;
  maximumAuthority: CapitalAuthorityLevel;
  qualityGateId: string;
  lifecycleId: string;
}
```

## 7.2 Mandatory v1.1 outcomes

```ts
type CapitalOutcomeType =
  | "capital_diagnosis"
  | "trade_cost_analysis"
  | "landed_cost_analysis"
  | "transaction_pnl"
  | "portfolio_pnl"
  | "cashflow_forecast"
  | "working_capital_analysis"
  | "scenario_model"
  | "financing_need_classification"
  | "financing_strategy"
  | "financing_option_comparison"
  | "funding_packet"
  | "term_sheet_review"
  | "financial_counteroffer"
  | "capital_plan"
  | "treasury_liquidity_plan"
  | "fx_exposure_analysis"
  | "instrument_blueprint"
  | "milestone_monitoring_report"
  | "underwriting_pre_read"
  | "credit_memo_draft"
  | "allocation_memo_draft"
  | "portfolio_exposure_brief";
```

## 7.3 Outcome registry: minimum contract

| Outcome | Blocking inputs | Deterministic tools | Specialist reads | Artifact | Max authority |
|---|---|---|---|---|---|
| Capital diagnosis | principal, objective, current position | gap/timeline classifiers | Risk/Compliance when material | Capital Diagnosis | recommend |
| Trade cost analysis | items, quantities, currencies, cost inputs | cost waterfall, FX conversion | Compliance/Ops for duties/logistics | Trade Cost Model | analyse |
| Landed cost analysis | product, origin, destination, Incoterm, quantity | landed cost calculator | Compliance + Ops | Landed Cost Model | recommend |
| Transaction P&L | revenue and direct-cost basis | P&L waterfall | Ops/Compliance for missing cost drivers | Transaction P&L | analyse |
| Portfolio P&L | transactions + period | aggregation and allocation | Audit for data quality | Portfolio P&L | analyse |
| Cash-flow forecast | opening cash, inflows, outflows, dates | timeline/forecast engine | Finance data reads | Cash-flow Forecast | recommend |
| Working-capital analysis | receivables, payables, inventory/timing | CCC/gap calculator | Risk/Ops where needed | Working-capital Plan | recommend |
| Financing need classification | trade stage, amount, use, timing, repayment | eligibility classifier | Risk/Compliance | Financing Diagnosis | recommend |
| Financing option comparison | eligible options and normalized terms | effective-cost/scenario comparison | Risk/Compliance | Financing Packet | recommend |
| Term-sheet review | full term sheet | cost/covenant/dilution calculators | Legal/Risk as needed | Term-sheet Review | recommend |
| Capital plan | needs, forecast, constraints | sources/uses, runway, debt service | Risk/Market | Capital Plan | recommend |
| Instrument blueprint | parties, value, milestones, conditions | tranche/cash-lock/release logic | Compliance/Ops/Legal route | Instrument Blueprint | draft |
| Milestone monitoring | canonical instrument + evidence | condition evaluator | Ops/Compliance/Audit | Monitoring Report | propose |
| Underwriting pre-read | disclosed borrower/trade/repayment data | coverage/stress/exposure | Risk/Compliance | Underwriting Memo | recommend |
| Allocation memo | opportunities, constraints, objective | eligibility + allocation engine | Risk | Allocation Memo | recommend |

## 7.4 Outcome lifecycle

```text
requested
→ gathering_context
→ needs_information | calculating
→ specialist_reads_pending
→ calculating
→ draft_ready
→ under_review
→ finalised
→ superseded
```

Rules:

- `needs_information` MUST be used when critical inputs are absent.
- `specialist_reads_pending` MUST identify each unresolved dependency.
- `finalised` means the artifact is complete for its authority level; it does not mean approved or executed.
- Recalculation after material input changes creates a new outcome version.
- Previous versions remain replayable.

---

# 8. Artifact architecture

## 8.1 Three distinct layers

1. **Outcome record** — structured analysis state and result.
2. **Canonical intelligence artifact** — versioned, reviewable professional deliverable.
3. **Rendered export** — PDF, XLSX, DOCX, JSON, HTML, or structured UI.

Rendering MUST NOT alter reasoning, calculations, or evidence.

## 8.2 Mandatory artifact types

```ts
type CapitalArtifactType =
  | "capital_diagnosis"
  | "trade_cost_model"
  | "landed_cost_model"
  | "transaction_pnl"
  | "portfolio_pnl"
  | "cashflow_forecast"
  | "working_capital_plan"
  | "scenario_model"
  | "financing_strategy"
  | "financing_packet"
  | "capital_plan"
  | "treasury_plan"
  | "fx_plan"
  | "term_sheet_review"
  | "financial_counteroffer"
  | "instrument_blueprint"
  | "milestone_monitoring_report"
  | "underwriting_memorandum"
  | "credit_memo_draft"
  | "allocation_memo_draft"
  | "portfolio_exposure_brief";
```

## 8.3 Common artifact envelope

```ts
interface CapitalArtifact<TContent> {
  artifactId: UUID;
  artifactType: CapitalArtifactType;
  artifactVersion: number;
  schemaVersion: string;
  outcomeId: UUID;
  taskId: UUID;
  principalOrgId: UUID;
  principalType: CapitalPrincipalType;
  tradeId?: UUID;
  linkedObjectRefs: CanonicalObjectRef[];
  title: string;
  status: "draft" | "review_ready" | "finalised" | "superseded";
  authorityLevel: CapitalAuthorityLevel;
  content: TContent;
  calculationRunIds: UUID[];
  evidenceBundleId: UUID;
  unresolvedQuestions: UnresolvedQuestion[];
  specialistReads: SpecialistReadRef[];
  generatedBy: AgentProvenance;
  reviewedBy?: HumanReviewRef[];
  createdAt: string;
  updatedAt: string;
}
```

## 8.4 Financing Packet

The Financing Packet remains important, but it is one artifact among many.

Required sections:

1. principal and objective;
2. transaction or portfolio summary;
3. verified facts;
4. data-quality findings;
5. financing-need classification;
6. eligible instrument families;
7. ineligible or excluded instruments with reasons;
8. normalized option table;
9. scenarios and calculations;
10. recommendation;
11. key assumptions;
12. uncertainties;
13. specialist dependencies;
14. required documents;
15. proposed next steps;
16. protected-action proposals, if any;
17. evidence and calculation appendix.

It MUST NOT include fabricated provider offers or market rates.

---

# 9. Skill architecture

## 9.1 Skill doctrine

A skill is a versioned bundle of domain instructions, input/output schemas, calculator/tool dependencies, examples, and evaluation cases.

A skill is **not**:

- a substitute for a deterministic calculator;
- an authorization grant;
- a canonical domain service;
- a long monolithic system prompt;
- an unrestricted external connector.

## 9.2 Shared foundation pack

All specialist agents inherit:

- `context_assembly`
- `evidence_and_provenance`
- `data_quality_and_anomaly_detection`
- `route_and_escalate`
- `specialist_read_request`
- `calculation_explanation`
- `artifact_composition`
- `render_artifact`
- `propose_protected_action`
- `memory_candidate_generation`
- `conflict_and_uncertainty_handling`
- `safe_document_handling`

## 9.3 Capital domain packs

### Transaction finance pack

- `trade_economics`
- `trade_cost_analysis`
- `landed_cost_analysis`
- `unit_economics`
- `pricing_and_margin`
- `transaction_pnl`
- `portfolio_pnl`
- `cashflow_forecasting`
- `working_capital_analysis`
- `scenario_and_sensitivity_modeling`

### Trade-finance pack

- `financing_need_classifier`
- `pre_shipment_finance`
- `receivables_finance`
- `payables_finance`
- `documentary_trade_finance`
- `working_capital_facilities`
- `guarantee_and_insurance_structuring`
- `offer_normalisation`
- `financing_option_comparison`

### Treasury pack

- `treasury_position_analysis`
- `liquidity_planning`
- `cash_concentration_analysis`
- `payment_route_economics`
- `fx_exposure_analysis`
- `hedging_need_identification`
- `reconciliation_impact_analysis`

### Corporate-capital pack

- `capital_needs_diagnosis`
- `sources_and_uses`
- `capital_structure_scenarios`
- `debt_capacity_analysis`
- `equity_dilution_analysis`
- `capital_raise_readiness`
- `data_room_readiness`
- `investment_appraisal`
- `internal_capital_allocation`

### Financier pack

- `opportunity_intake`
- `underwriting_pre_read`
- `repayment_source_analysis`
- `facility_structuring`
- `conditions_precedent_design`
- `financial_covenant_analysis`
- `exposure_and_concentration_analysis`
- `credit_memo_drafting`
- `allocation_memo_drafting`
- `facility_monitoring`

### Instruments and settlement pack

- `instrument_economics`
- `escrow_milestone_design`
- `conditional_release_design`
- `evidence_to_condition_mapping`
- `milestone_monitoring`
- `release_recommendation`
- `amendment_and_dispute_scenario`

### Commercial and negotiation pack

- `commercial_proposal_analysis`
- `term_sheet_extraction`
- `term_sheet_financial_review`
- `financial_counteroffer`
- `negotiation_preparation`
- `walk_away_and_tradeoff_analysis`

## 9.4 Skill manifest

```yaml
id: capital.receivables_finance
version: 1.1.0
agent_classes: [capital_agent]
supported_principals: [company, financier]
authority_ceiling: recommend
input_schema: schemas/receivables-finance-input.json
output_schema: schemas/receivables-finance-output.json
required_tools:
  - capital.classify_trade_stage
  - capital.calculate_receivables_finance
  - capital.compare_financing_options
optional_specialist_reads:
  - risk.counterparty_credit_read
  - compliance.assignment_eligibility_read
evidence_policy: evidence.finance.material-v1
eval_suite: evals/capital/receivables-finance
```

Skills MAY be exposed to Claude Code or Codex as `SKILL.md` files for implementation assistance. Production behavior MUST still be implemented and governed in TRAIBOX code, schemas, policies, and tools.

---

# 10. Typed tool and context architecture

## 10.1 No unrestricted `readContext`

The earlier generic `readContext(query)` concept is rejected for production.

Context access MUST use typed, server-enforced tools. The model cannot choose tenant, organization, user, or hidden field scope through free text.

## 10.2 Context tool families

### Canonical object reads

```text
capital.get_trade_snapshot
capital.get_trade_finance_context
capital.get_funding_request
capital.get_funding_offers
capital.get_facility
capital.get_instrument
capital.get_payment_economics_context
capital.get_treasury_position
capital.get_portfolio_snapshot
capital.get_document_metadata
capital.get_disclosed_financier_opportunity
```

### Memory reads

```text
memory.get_user_operating_profile
memory.get_org_finance_profile
memory.get_relationship_patterns
memory.get_prior_outcomes
memory.get_feedback_history
memory.get_corridor_finance_signals
```

### Calculation tools

```text
capital.calculate_trade_cost
capital.calculate_landed_cost
capital.calculate_transaction_pnl
capital.calculate_portfolio_pnl
capital.calculate_cashflow_forecast
capital.calculate_working_capital
capital.calculate_financing_cost
capital.normalise_financing_offer
capital.compare_financing_options
capital.calculate_debt_service
capital.calculate_runway
capital.calculate_dilution
capital.calculate_npv_irr
capital.calculate_fx_scenarios
capital.calculate_milestone_schedule
capital.evaluate_instrument_conditions
capital.calculate_exposure_concentration
```

### Specialist-read tools

```text
orchestration.request_compliance_read
orchestration.request_risk_read
orchestration.request_market_network_read
orchestration.request_trade_operations_read
orchestration.request_audit_monitoring_read
```

### Artifact tools

```text
artifacts.create_capital_artifact
artifacts.version_capital_artifact
artifacts.render_capital_artifact
artifacts.compare_artifact_versions
```

### Proposal tools

```text
actions.propose_create_funding_request
actions.propose_disclose_financing_packet
actions.propose_request_provider_quotes
actions.propose_accept_funding_offer
actions.propose_create_instrument
actions.propose_release_instrument_condition
actions.propose_schedule_payment
actions.propose_external_outreach
actions.propose_create_execution_task
```

All proposal tools create a `protected_action_proposal`; none perform the action.

## 10.3 Tool result envelope

```ts
interface ToolResult<T> {
  toolCallId: UUID;
  toolId: string;
  toolVersion: string;
  status: "success" | "partial" | "blocked" | "failed";
  data?: T;
  evidenceRefs: EvidenceRef[];
  freshness: FreshnessDescriptor;
  policyDecision: ToolPolicyDecision;
  warnings: ToolWarning[];
  traceId: string;
  startedAt: string;
  completedAt: string;
}
```

## 10.4 Tool security requirements

Every tool MUST enforce:

- authenticated user;
- principal organization;
- active mandate;
- role;
- RLS/ABAC;
- field-level permission;
- data-purpose binding;
- sensitivity ceiling;
- object relationship;
- explicit external-disclosure scope;
- idempotency for writes/proposals;
- trace propagation;
- audit event;
- timeout;
- normalized error taxonomy.

The model’s request is input, not authorization.

---

# 11. Deterministic Financial Workbench

## 11.1 Purpose

The Financial Workbench is a shared TRAIBOX calculation service used by the Capital Agent and structured UI. It is not part of the model and not owned by the Finance module, although it reads Finance-domain data through approved interfaces.

The model selects the appropriate calculation, assembles inputs, and explains outputs. The Workbench performs material arithmetic.

## 11.2 Calculation-run contract

```ts
interface FinancialCalculationRun {
  runId: UUID;
  calculatorId: string;
  calculatorVersion: string;
  principalOrgId: UUID;
  outcomeId?: UUID;
  inputSnapshot: Record<string, unknown>;
  assumptionRefs: UUID[];
  formulaRefs: FormulaRef[];
  result: Record<string, unknown>;
  currencyPolicy: CurrencyPolicy;
  roundingPolicy: RoundingPolicy;
  scenarioId?: UUID;
  validationResults: CalculationValidation[];
  deterministicHash: string;
  traceId: string;
  createdAt: string;
}
```

## 11.3 Required formulas and inputs

### Trade cost

```text
Total Trade Cost =
  Product / production cost
+ Packaging
+ Inland origin logistics
+ Export handling
+ International freight
+ Insurance
+ Customs duties
+ Import taxes not recoverable
+ Destination handling
+ Inland destination logistics
+ Compliance / documentation cost
+ Financing cost
+ FX cost
+ Other explicit transaction costs
```

Every term MUST carry source, currency, as-of date, and inclusion basis.

### Landed cost per unit

```text
Landed Cost per Unit =
  Total Landed Cost / Delivered Quantity
```

The calculator MUST identify unit anomalies and impossible or suspicious quantities.

### Gross margin

```text
Gross Margin Amount = Revenue - Cost of Goods / Services Sold
Gross Margin % = Gross Margin Amount / Revenue
```

### Contribution margin

```text
Contribution Margin =
  Revenue
- Variable direct costs
- Variable logistics
- Variable payment / finance costs
- Other transaction-variable costs
```

### Financing cost

For a simple non-amortizing facility:

```text
Interest = Principal × Annual Rate × Days / Day-count Basis
Total Financing Cost = Interest + Upfront Fees + Periodic Fees + Transaction Fees
Net Proceeds = Principal - Fees Withheld at Disbursement
Effective Period Cost = Total Financing Cost / Net Proceeds
```

Annualized effective cost MUST specify method and MUST NOT be labelled APR unless the applicable definition is implemented.

### Discounted receivable proceeds

```text
Net Proceeds =
  Eligible Receivable
× Advance Rate
- Discount Charge
- Service Fees
- Reserves / Holdbacks
```

### Cash conversion cycle

```text
CCC = DIO + DSO - DPO
```

The metric MUST be omitted when inventory or accounting data is not meaningful for the business model.

### Working-capital gap

```text
Daily Net Operating Cash Need =
  Expected Operating Cash Outflows - Expected Operating Cash Inflows

Peak Working-Capital Gap =
  Maximum cumulative negative cash position over the analysis horizon
```

### Debt service

```text
Debt Service = Scheduled Principal + Interest + Mandatory Fees
DSCR = Cash Available for Debt Service / Debt Service
```

The definition of cash available MUST be explicit.

### Runway

```text
Runway Months = Available Liquidity / Normalized Monthly Net Cash Burn
```

The forecast MUST include scenario and seasonality assumptions where material.

### NPV and IRR

```text
NPV = Σ [CashFlow_t / (1 + DiscountRate)^t] - Initial Investment
IRR = rate where NPV = 0
```

Irregular dates SHOULD use XNPV/XIRR-equivalent methods.

### Equity dilution

```text
Post-money Valuation = Pre-money Valuation + New Equity Capital
New Investor Ownership = New Equity Capital / Post-money Valuation
Existing Holder Post-round % =
  Existing Holder Pre-round % × Pre-money Valuation / Post-money Valuation
```

Options, convertibles, SAFEs, warrants, and preference terms require explicit treatment.

### FX scenario

```text
Functional Currency Value = Foreign Currency Amount × FX Rate
FX Impact = Scenario Value - Base Value
```

Spot, forward, fee, spread, and timing MUST be separated when known.

### Offer normalization

Each offer MUST normalize:

- amount available;
- net proceeds;
- currency;
- tenor;
- amortization;
- nominal rate;
- benchmark and margin;
- all fees;
- advance rate;
- reserve;
- recourse;
- collateral;
- guarantees;
- conditions precedent;
- documentation burden;
- expected time to funds;
- expiry;
- covenants;
- early repayment;
- sustainability conditions;
- provider and data verification status.

## 11.4 Ranking and PriME

Instrument suitability and provider allocation are separate operations.

### Instrument suitability

Uses eligibility-first multi-criteria comparison:

1. trade stage compatibility;
2. legal/structural availability;
3. repayment-source fit;
4. amount and tenor fit;
5. documentary readiness;
6. timing;
7. net proceeds;
8. all-in cost;
9. recourse/collateral;
10. operational burden;
11. uncertainty;
12. user preferences;
13. risk and compliance dependencies.

An ineligible option MUST NOT outrank an eligible option because of lower indicative cost.

### PriME

PriME is used only when allocating or ranking scarce resources or candidates under an explicit objective and constraints.

```ts
allocate({
  candidates,
  eligibility,
  constraints,
  objective,
  policyVersion,
  fairnessPolicy?,
  capacity?
}) -> AllocationResult
```

PriME MUST NOT be a catch-all name for every ranking decision.

## 11.5 Validation

Every calculator MUST have:

- unit tests;
- property-based tests for ranges/invariants;
- golden fixtures;
- currency and rounding tests;
- null/missing-input behavior;
- versioned formulas;
- deterministic output hash;
- independent recomputation test for high-consequence outputs.

---

# 12. Evidence, provenance, and truth contract

## 12.1 Claim taxonomy

```ts
type ClaimType =
  | "verified_fact"
  | "inference"
  | "assumption"
  | "estimate"
  | "calculation"
  | "recommendation"
  | "unresolved_question"
  | "contradiction";
```

```ts
type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "conflicting"
  | "stale"
  | "not_applicable";
```

## 12.2 Material claim contract

```ts
interface EvidenceClaim {
  claimId: UUID;
  claim: string;
  claimType: ClaimType;
  verificationStatus: VerificationStatus;
  sourceRefs: EvidenceRef[];
  observedAt?: string;
  asOf?: string;
  method?: string;
  calculationRunId?: UUID;
  inputRefs: InputRef[];
  assumptionRefs: UUID[];
  uncertaintyRefs: UUID[];
  confidence: {
    level: "high" | "medium" | "low";
    basis: string[];
  };
  materiality: "critical" | "material" | "supporting";
  supersedesClaimId?: UUID;
}
```

## 12.3 Evidence bundle

Every finalised artifact MUST link to an evidence bundle containing:

- verified facts;
- calculations;
- inferences;
- assumptions;
- estimates;
- recommendations;
- unresolved questions;
- contradictions;
- freshness findings;
- source access log;
- specialist reads;
- policy versions.

## 12.4 Source hierarchy

Preferred order:

1. current canonical TRAIBOX record;
2. signed or verified provider record;
3. original document with provenance;
4. authorized external authoritative source;
5. user-confirmed fact;
6. derived memory signal;
7. model inference.

A derived memory signal cannot override a conflicting canonical record.

## 12.5 No hidden reasoning requirement

TRAIBOX MUST NOT store or expose private hidden chain-of-thought.

It MUST store:

- concise rationale;
- inputs;
- formulas;
- tool outputs;
- evidence;
- assumptions;
- uncertainties;
- decision rules;
- specialist dependencies;
- action proposal rationale.

Streaming UX MAY show structured status such as “validating inputs,” “running cash-flow scenarios,” or “awaiting Risk read.” It MUST NOT imply access to undisclosed internal reasoning.

## 12.6 Document trust

Uploaded documents are untrusted data.

The system MUST:

- separate document content from instructions;
- ignore instructions embedded in documents;
- scan/sanitize supported files;
- preserve hashes;
- record extraction provenance;
- restrict tool calls from extracted text;
- detect suspicious prompt-injection patterns;
- never allow document text to alter mandate, tools, policy, or approvals.

---

# 13. Memory and personalization

## 13.1 Memory principle

The Capital Agent becomes more useful by retrieving governed memory, not by retaining mutable hidden state.

## 13.2 Memory layers

1. **Session context** — current interaction.
2. **Workflow memory** — current task/outcome/instrument process.
3. **User operating profile** — how this user works.
4. **Organization finance profile** — policies, preferences, financial patterns.
5. **Relationship memory** — agent/user interaction patterns and accepted practices.
6. **Domain memory** — entity, counterparty, corridor, instrument, and portfolio patterns.
7. **Platform aggregates** — anonymized and privacy-governed signals.

## 13.3 User Operating Profile

```ts
interface UserOperatingProfile {
  userId: UUID;
  orgId: UUID;
  preferredDetailLevel?: "executive" | "professional" | "technical";
  preferredArtifactFormats: CapitalArtifactType[];
  preferredCurrency?: string;
  riskCommunicationStyle?: "direct" | "balanced" | "detailed";
  approvalResponsibilities: string[];
  recurringObjectives: string[];
  explicitPreferences: MemoryItem[];
  inferredPreferences: MemoryItem[];
  lastReviewedAt?: string;
  version: number;
}
```

## 13.4 Memory item contract

```ts
interface MemoryItem {
  memoryId: UUID;
  scope: "user" | "org" | "relationship" | "workflow" | "entity" | "corridor";
  origin: "explicit" | "observed" | "inferred" | "computed";
  statement: string;
  structuredValue?: unknown;
  sourceRefs: EvidenceRef[];
  confidence: "high" | "medium" | "low";
  sensitivity: DataSensitivity;
  purpose: string[];
  createdAt: string;
  lastConfirmedAt?: string;
  expiresAt?: string;
  decayPolicyId?: string;
  editableByUser: boolean;
  deletableByUser: boolean;
  status: "candidate" | "active" | "rejected" | "expired" | "deleted";
}
```

## 13.5 Memory writes

The agent produces `memory_candidate` records. A memory policy service decides whether to:

- activate automatically;
- request confirmation;
- reject;
- aggregate;
- expire;
- anonymize.

Critical financial facts, risk appetite, bank details, approval authority, legal status, and regulated classifications MUST NOT be inferred into active memory without an authoritative source or explicit confirmation.

## 13.6 User controls

Users MUST be able to:

- view what the Capital Agent remembers;
- identify source and origin;
- edit explicit preferences;
- reject inferred preferences;
- forget a memory item where legally permitted;
- export profile data;
- reset personalization;
- disable specified memory categories.

## 13.7 Isolation

Memory retrieval MUST enforce:

- tenant boundary;
- principal boundary;
- user role;
- purpose;
- sensitivity;
- workflow relevance;
- freshness;
- disclosure grants.

Cross-org leakage is a release-blocking failure.

---

# 14. Multi-agent collaboration

## 14.1 Orchestration rule

Agents do not free-form command one another.

The workflow orchestrator creates typed specialist tasks. Temporal governs durable sequencing, retries, pause/resume, deadlines, and approval waits. LangGraph or an equivalent reasoning graph MAY coordinate bounded intra-task reasoning, but it does not own durable business state.

## 14.2 Specialist request

```ts
interface SpecialistTaskRequest {
  requestId: UUID;
  workflowId: UUID;
  parentTaskId: UUID;
  requestingAgentClass: SpecialistAgentClass;
  targetAgentClass: SpecialistAgentClass;
  principal: CapitalPrincipal;
  question: string;
  requestedReadType: string;
  inputObjectRefs: CanonicalObjectRef[];
  disclosedEvidenceRefs: EvidenceRef[];
  permittedDataClasses: string[];
  expectedSchema: string;
  authorityRequested: "read" | "recommendation";
  dueAt?: string;
  traceId: string;
}
```

## 14.3 Specialist read

```ts
interface SpecialistRead {
  specialistReadId: UUID;
  requestId: UUID;
  agentClass: SpecialistAgentClass;
  status: "complete" | "partial" | "blocked" | "abstained";
  findings: EvidenceClaim[];
  blockers: UnresolvedQuestion[];
  authoritativeFor: string[];
  notAuthoritativeFor: string[];
  recommendedNextActions: string[];
  provenance: AgentProvenance;
}
```

## 14.4 Capital Agent as lead synthesizer

For finance-led outcomes, the Capital Agent is the lead synthesizer. It:

- requests specialist reads;
- incorporates authoritative findings;
- preserves specialist attribution;
- identifies conflicts;
- refrains from overriding hard gates;
- produces the final finance artifact at its permitted authority level.

## 14.5 Conflict handling

When specialist outputs conflict:

1. preserve both outputs;
2. classify the conflict;
3. identify whether one specialist has domain authority;
4. request clarification or human review;
5. block protected-action proposals when material conflict remains;
6. record the resolution and superseded claims.

No model vote or confidence score may override a deterministic hard gate.

---

# 15. Integration with canonical Finance objects

## 15.1 Reuse, do not duplicate

Capital Agent MUST use the Finance-domain canonical objects defined by the platform, including as applicable:

- `FundingRequest`
- `FundingOpportunity`
- `FundingOffer`
- `Reservation`
- `FundingFacility`
- `FundingDecision`
- `PaymentIntent`
- `PaymentRoute`
- `Payment`
- `Collection`
- `FinancialInstrument`
- `Guarantee`
- `InstrumentCondition`
- `Milestone`
- `ReleaseRequest`
- `ReconciliationRecord`

Where the existing repository uses alpha names, migrations SHOULD evolve them without creating parallel semantics.

## 15.2 Command boundary

The Capital Agent may issue typed proposals such as:

```ts
interface CreateFundingRequestProposal {
  proposalId: UUID;
  sourceOutcomeId: UUID;
  targetCommand: "finance.create_funding_request";
  draftPayload: FinanceCreateFundingRequestCommand;
  disclosureSet: EvidenceRef[];
  rationaleClaimIds: UUID[];
  approvalPolicyId: string;
}
```

The Finance service validates and creates the canonical object only after required approval.

## 15.3 No implicit side effects

Generating an artifact MUST NOT:

- create a funding request;
- send data to a provider;
- request a quote;
- accept an offer;
- reserve funds;
- create or activate an instrument;
- release a condition;
- schedule or execute payment.

Each side effect requires a separate proposal and approval path.

---

# 16. Escrow, milestones, and conditional release

## 16.1 Scope

The Capital Agent may:

- determine whether conditional value movement may fit a transaction;
- model cash and financing impact;
- draft milestone and tranche schedules;
- propose evidence requirements;
- map dependencies;
- monitor canonical condition status;
- identify missing or conflicting evidence;
- recommend release, partial release, amendment, pause, or escalation;
- create a protected-action proposal.

## 16.2 Prohibited claims

The Capital Agent MUST NOT state that:

- money is legally in escrow unless a verified provider/legal structure establishes it;
- safeguarding is equivalent to escrow;
- a condition is legally satisfied solely because an LLM says so;
- funds have been released before provider/canonical confirmation;
- a dispute is legally resolved.

## 16.3 Instrument Blueprint

Required sections:

- instrument purpose;
- parties and roles;
- value and currency;
- custody/provider mode;
- legal-status label and verification;
- milestones;
- release conditions;
- evidence type per condition;
- verifier or approver;
- sequence and dependencies;
- partial-release logic;
- expiry;
- exception path;
- dispute path;
- amendment path;
- cash-lock and financing impact;
- unresolved legal/compliance questions;
- proposed protected actions.

## 16.4 Condition status

```ts
type InstrumentConditionStatus =
  | "not_started"
  | "evidence_pending"
  | "evidence_received"
  | "verification_pending"
  | "met"
  | "not_met"
  | "waiver_proposed"
  | "disputed"
  | "expired";
```

The Capital Agent may calculate or recommend status, but canonical status transitions MUST be performed by the Finance workflow under policy.

---

# 17. Agent contracts and schemas

## 17.1 Agent definition

```ts
interface SpecialistAgentDefinition {
  agentClass: SpecialistAgentClass;
  displayName: string;
  version: string;
  status: "draft" | "active" | "deprecated";
  domain: string;
  identityPolicyId: string;
  authorityPolicyId: string;
  mandateSchemaId: string;
  outcomeDefinitionIds: string[];
  skillManifestIds: string[];
  toolPolicyId: string;
  modelPolicyId: string;
  memoryPolicyId: string;
  evidencePolicyId: string;
  collaborationPolicyId: string;
  protectedActionPolicyId: string;
  artifactSchemaIds: string[];
  evalSuiteIds: string[];
  runtimeBudgetPolicyId: string;
  supportedSurfaces: string[];
  effectiveFrom: string;
}
```

## 17.2 Capital task request

```ts
interface CapitalAgentTaskRequest {
  taskId?: UUID;
  objective: string;
  principal: CapitalPrincipal;
  mandateId: UUID;
  requestedOutcomeType?: CapitalOutcomeType;
  inputObjectRefs: CanonicalObjectRef[];
  userProvidedInputs?: Record<string, unknown>;
  scenarioIds?: UUID[];
  requestedArtifactFormat?: string;
  interactionContext?: {
    workspace: "intelligence" | "trades" | "finance" | "financier";
    tradeId?: UUID;
    conversationId?: UUID;
  };
  constraints?: {
    deadline?: string;
    maxToolCalls?: number;
    maxModelSteps?: number;
    maxCostUsd?: number;
    timeoutSeconds?: number;
  };
  traceId: string;
  idempotencyKey: string;
}
```

## 17.3 Capital work result

```ts
interface CapitalAgentWorkResult {
  taskId: UUID;
  outcomeId: UUID;
  completionStatus:
    | "completed"
    | "partial"
    | "blocked"
    | "failed"
    | "timed_out"
    | "abstained";
  objectiveSummary: string;
  outputArtifactRefs: UUID[];
  evidenceBundleId: UUID;
  calculationRunIds: UUID[];
  specialistReadIds: UUID[];
  verifiedFacts: UUID[];
  assumptions: UUID[];
  unresolvedQuestions: UUID[];
  contradictions: UUID[];
  risks: UUID[];
  opportunities: UUID[];
  recommendedNextActions: RecommendedAction[];
  protectedActionProposalIds: UUID[];
  memoryCandidateIds: UUID[];
  modelUsage: ModelUsageRecord[];
  policyVersions: PolicyVersionRef[];
  evaluationSummary?: EvaluationSummary;
  traceId: string;
  createdAt: string;
}
```

## 17.4 Recommended action

```ts
interface RecommendedAction {
  actionId: UUID;
  label: string;
  description: string;
  actionClass:
    | "user_input"
    | "specialist_review"
    | "internal_work"
    | "protected_action_proposal";
  priority: "critical" | "high" | "normal" | "low";
  rationaleClaimIds: UUID[];
  prerequisites: string[];
  proposedCommand?: string;
}
```

---

# 18. Lifecycles and durable workflow

## 18.1 Agent task lifecycle

```text
created
→ scoped
→ context_assembling
→ executing
→ checkpointed
→ completed | partial | blocked | failed | timed_out | abstained
→ audited
→ terminated
```

## 18.2 Protected-action lifecycle

```text
draft
→ proposed
→ pending_policy_check
→ pending_approval
→ approved | rejected | expired
→ pre_execution_revalidation
→ execution_task_created
→ executing
→ executed | failed | cancelled
```

Capital Agent v1.1 stops at `approved` or `execution_task_created` unless an existing controlled domain workflow performs later states.

## 18.3 Provider-offer lifecycle

```text
received
→ validation_pending
→ normalised
→ eligible | ineligible | needs_information
→ shortlisted
→ selected | rejected | expired | withdrawn
```

## 18.4 Facility lifecycle

```text
draft
→ review
→ approved
→ documentation
→ conditions_pending
→ available
→ active
→ monitoring
→ amended | suspended
→ repaid | terminated | defaulted
```

The Capital Agent monitors and recommends; Finance owns canonical transitions.

## 18.5 Workflow runtime extensions

The existing workflow runtime MUST be extended with:

```ts
type WorkflowRunKind =
  | "approval_chain"
  | "controlled_execution"
  | "attach_transition"
  | "proof_generation"
  | "agent_outcome"
  | "specialist_read"
  | "protected_action_proposal"
  | "capital_artifact_review"
  | "instrument_monitoring";
```

Each workflow MUST support:

- durable identifiers;
- deterministic replay from structured events;
- idempotency;
- retry policy;
- timeout policy;
- heartbeat;
- pause/resume;
- cancellation;
- human signals;
- degraded mode where safe;
- trace propagation.

---

# 19. Protected actions, approvals, and separation of duties

## 19.1 Protected action proposal

```ts
interface ProtectedActionProposal {
  proposalId: UUID;
  principalOrgId: UUID;
  proposedByTaskId: UUID;
  proposedByAgentClass: SpecialistAgentClass;
  targetObjectRef?: CanonicalObjectRef;
  actionKind: ProtectedActionKind;
  commandName: string;
  commandPayloadHash: string;
  draftPayload: Record<string, unknown>;
  disclosureSet: EvidenceRef[];
  rationaleClaimIds: UUID[];
  unresolvedMaterialIssues: UUID[];
  policyVersion: string;
  requiredApproverRoles: string[];
  separationOfDutiesPolicyId: string;
  stepUpRequired: boolean;
  expiresAt: string;
  idempotencyKey: string;
  status: "draft" | "pending_approval" | "approved" | "rejected" | "expired";
}
```

## 19.2 Approval rules

- The invoking operator MUST NOT self-approve when SoD policy forbids it.
- Approval MUST apply to the exact payload hash and disclosure set.
- Material payload change invalidates approval.
- Approval expires.
- Before controlled execution, canonical state, permissions, evidence freshness, and provider status MUST be revalidated.
- “Approve all” is prohibited for money movement, external disclosure, offer acceptance, instrument release, or binding commitments.
- Chat messages cannot serve as approval unless the structured approval service verifies identity, role, intent, step-up, payload, and audit.

## 19.3 V1.1 protected-action policy

Capital Agent MAY propose:

- creation of a Finance funding request;
- manual provider outreach;
- controlled disclosure of an artifact;
- provider quote request where an approved integration exists;
- instrument creation;
- condition-release review;
- offer acceptance review;
- payment scheduling review;
- human execution task.

It MUST NOT directly execute them.

---

# 20. Model, provider, and runtime architecture

## 20.1 Production runtime

Production Capital Agent runtime is TRAIBOX software:

- Fastify API edge for authenticated platform contracts;
- Python/FastAPI Trade Brain for intelligence execution;
- Temporal for durable workflows;
- shared TypeScript contracts;
- PostgreSQL canonical and intelligence records;
- policy, evidence, audit, and evaluation services.

Claude Code and Codex are development environments used to implement this system. A `.claude/agents/capital-builder.md` or Codex skill is not the production Capital Agent.

## 20.2 Model port

```ts
interface ModelRequest {
  purpose: string;
  messages: ModelMessage[];
  structuredOutputSchemaId?: string;
  toolPolicyId: string;
  tenantContextToken: string;
  sensitivity: DataSensitivity;
  modelPolicyId: string;
  maxOutputTokens: number;
  maxToolCalls: number;
  maxSteps: number;
  timeoutMs: number;
  traceId: string;
}

interface ModelResponse {
  provider: string;
  modelId: string;
  modelVersion?: string;
  output: unknown;
  toolCalls: ToolCallRecord[];
  usage: ModelUsage;
  stopReason: string;
  safetyEvents: SafetyEvent[];
  traceId: string;
}
```

## 20.3 Model policy

- Exact provider model IDs MUST be deployment configuration, not agent logic.
- Every run MUST record the actual provider/model ID.
- Sensitive workloads MUST follow retention and regional policy.
- Model fallback MUST preserve structured output and authority constraints.
- A fallback model MUST NOT gain additional tools or data.
- Model changes require regression evaluation.
- High-consequence artifacts SHOULD use the best approved model that satisfies privacy, latency, and cost policies.
- Deterministic tasks MUST not call a model.

## 20.4 Runtime budgets

Every task MUST specify or inherit:

- maximum model steps;
- maximum tool calls;
- maximum elapsed time;
- maximum output size;
- maximum cost;
- retry limits;
- abort conditions;
- degradation policy.

Budget exhaustion produces `partial`, `blocked`, or `timed_out`, never silent truncation presented as completion.

## 20.5 Structured output

All material agent-machine interfaces MUST use schema-validated structured output.

Free-form text is allowed only inside designated explanation fields.

---

# 21. Security, privacy, and resilience

## 21.1 Mandatory controls

- authenticated service-to-service calls;
- RLS/ABAC and field permissions;
- tenant and principal isolation;
- encrypted transport and storage;
- secret isolation;
- no secret exposure to prompts;
- allowlisted outbound network access;
- document prompt-injection defenses;
- tool-call validation;
- idempotency;
- immutable policy version references;
- append-only audit;
- deterministic replay;
- data minimization;
- retention and deletion policies;
- user memory controls;
- incident telemetry;
- red-team tests.

## 21.2 Sensitive data routing

Each input is classified before model routing:

```ts
type DataSensitivity =
  | "public"
  | "internal"
  | "confidential"
  | "restricted_financial"
  | "regulated_personal";
```

Provider, region, retention, and logging policy depend on sensitivity.

## 21.3 Failure behavior

When intelligence is unavailable:

- canonical Finance and other modules remain operational;
- users can access structured data and manual workflows;
- pending agent tasks show degraded status;
- no protected action is executed because an agent failed;
- retries are workflow-controlled;
- partially generated artifacts are clearly labelled;
- stale recommendations are not silently reused.

---

# 22. User experience and surfaces

## 22.1 Primary surfaces

Capital Agent is accessible through:

- Trade Intelligence workspace;
- a trade workspace;
- Finance Funding views;
- Finance Instruments views;
- company capital/treasury surfaces;
- separate Financier workspace;
- approval review surfaces;
- Operations/monitoring surfaces.

It does not require users to know internal skill names.

## 22.2 Core interaction

```text
Select or describe context
→ state objective in natural language or structured form
→ agent confirms understood objective and material missing inputs
→ context and calculations run
→ specialist reads appear as dependencies
→ draft artifact appears in structured UI
→ user reviews assumptions and scenarios
→ user edits or requests refinement
→ finalised recommendation
→ optional protected-action proposal
→ approval occurs in structured governance surface
```

## 22.3 Structured UI components

Mandatory reusable components:

- Capital Agent identity/status header;
- principal and mandate badge;
- objective card;
- verified facts / assumptions / unresolved questions tabs;
- calculation inspector;
- scenario switcher;
- option comparison table;
- specialist-read strip;
- artifact preview;
- evidence drawer;
- rationale drawer;
- data-quality warnings;
- protected-action proposal card;
- approval status;
- version history;
- memory/personalization controls.

## 22.4 Status communication

Allowed statuses include:

- understanding objective;
- gathering authorized context;
- validating inputs;
- calculating;
- requesting Compliance read;
- requesting Risk read;
- waiting for information;
- preparing artifact;
- review ready;
- blocked by policy;
- complete.

Avoid theatrical “thinking” narration.

## 22.5 Surface independence

The same agent task and artifact contracts MUST power all surfaces. Surface adapters MAY alter presentation, not authority, calculation, or data scope.

Messaging adapters are deferred until secure identity and approval behavior are implemented. Read-only artifact notifications may arrive earlier than approval or execution interactions.

---

# 23. Observability, audit, and replay

## 23.1 Trace model

Every task MUST propagate:

- `trace_id`;
- `workflow_id`;
- `task_id`;
- `outcome_id`;
- `principal_org_id`;
- `acting_user_id`;
- `mandate_id`;
- `agent_definition_version`;
- `policy_versions`;
- `model_run_ids`;
- `tool_call_ids`;
- `calculation_run_ids`;
- `artifact_ids`;
- `approval_ids`.

## 23.2 Structured events

Minimum event set:

```text
capital.task.created
capital.task.scoped
capital.context.requested
capital.context.received
capital.input.missing
capital.calculation.started
capital.calculation.completed
capital.specialist_read.requested
capital.specialist_read.completed
capital.claim.created
capital.conflict.detected
capital.artifact.created
capital.artifact.versioned
capital.outcome.review_ready
capital.outcome.finalised
capital.action.proposed
capital.action.approved
capital.action.rejected
capital.memory.candidate_created
capital.task.completed
capital.task.blocked
capital.task.failed
capital.eval.completed
```

## 23.3 Replay

Replay MUST reconstruct:

- input object versions;
- mandate;
- policies;
- source versions;
- calculation inputs/formulas;
- specialist reads;
- model/provider version;
- structured model output;
- tool calls;
- artifact;
- proposals;
- human decisions.

Replay need not reproduce stochastic wording byte-for-byte. It MUST reproduce deterministic calculations, policy decisions, data lineage, and material recommendation basis.

---

# 24. Evaluation architecture

## 24.1 Evaluation layers

1. schema validation;
2. deterministic calculator tests;
3. tool authorization tests;
4. outcome-specific agent evaluations;
5. adversarial/security evaluations;
6. multi-agent coordination evaluations;
7. UX reviewability tests;
8. model migration regression;
9. pilot outcome monitoring.

## 24.2 Release-blocking acceptance gates

| Gate | Required result |
|---|---|
| Material arithmetic | 100% deterministic calculator use |
| Golden calculator fixtures | 100% pass |
| Schema validity | 100% pass |
| Fabricated provider offer/rate/action | 0 instances |
| Protected action executed by agent | 0 instances |
| Cross-tenant or cross-principal leakage | 0 instances |
| Unauthorized tool or field access | 0 instances |
| Critical missing input improvised | 0 instances |
| Critical stale evidence represented as current | 0 instances |
| Prompt injection changes mandate/tools/policy | 0 instances |
| Calculation lineage completeness | 100% for material values |
| Final artifact evidence bundle | 100% |
| Human-review traceability | 100% critical claims traceable |

Quality metrics such as recommendation usefulness and writing clarity may use scored thresholds. Safety and isolation gates are binary.

## 24.3 Minimum 24-scenario suite

### Company-side

1. Pre-shipment purchase-order finance with no invoice.
2. Post-delivery receivables finance with accepted invoice.
3. Payables finance from buyer perspective.
4. Documentary LC structure.
5. Guarantee-backed trade.
6. Transaction P&L with missing logistics cost.
7. Landed cost with uncertain HS classification.
8. 13-week cash-flow gap.
9. FX scenario with stale rate.
10. Term-sheet comparison with complex fee stack.
11. Debt versus equity capital plan.
12. Milestone instrument design.

### Financier-side

13. Complete underwriting pre-read.
14. Missing repayment-source evidence.
15. Concentration-limit conflict.
16. Offer normalization across different currencies/tenors.
17. Conditions-precedent drafting.
18. Facility monitoring with covenant deterioration.

### Governance and resilience

19. Conflicting Compliance and Operations findings.
20. Malicious prompt injection in invoice.
21. Cross-tenant retrieval attempt.
22. Invoker attempts self-approval.
23. Model timeout after calculations.
24. Provider outage and manual-outreach proposal.
25. User rejects inferred preference.
26. Same transaction viewed by separate company and financier principals.
27. Instrument evidence partially met.
28. Disputed milestone release.
29. Stale memory conflicts with canonical record.
30. Model/provider migration regression.

## 24.4 Corrected golden cases

The original TRX-00455 scenario MUST NOT be used unchanged.

### Golden Case A — pre-shipment finance

- Portuguese exporter;
- verified purchase order;
- production funding required before shipment;
- no existing receivable;
- explicit upstream third-country material exposure if CBAM relevance is tested;
- options include PO/pre-shipment finance, working-capital line, guarantee-backed structure;
- factoring is marked ineligible until a receivable exists;
- Compliance and Risk reads are requested;
- quantity/value anomaly checks are exercised.

### Golden Case B — receivables finance

- goods delivered and accepted;
- invoice exists;
- payment term 60 or 90 days;
- assignment eligibility and buyer risk pending specialist reads;
- factoring/invoice discounting compared against working-capital line;
- all fees normalized;
- recommendation is non-binding;
- quote request is a protected proposal.

---

# 25. Performance and operational targets

These are engineering targets, not claims about current production performance.

## 25.1 Interactive targets

- task acknowledgement: p95 ≤ 1 second;
- first structured status event: p95 ≤ 2 seconds;
- simple deterministic calculation: p95 ≤ 2 seconds;
- standard artifact draft with available context: target p95 ≤ 30 seconds;
- complex multi-specialist outcome: asynchronous workflow with immediate status, no false synchronous completion;
- artifact retrieval: p95 ≤ 1 second;
- audit/replay query: target p95 ≤ 3 seconds for standard tasks.

## 25.2 Reliability targets

- no loss of approved workflow state;
- idempotent task creation and proposal creation;
- safe retry of read and calculation activities;
- agent subsystem failure does not block core module operations;
- evaluation and calculator failures block affected release;
- availability target to be aligned with platform SLO policy rather than hard-coded per agent.

---

# 26. Repository implementation map

The existing monorepo remains the target. Do not create a separate Capital Agent repository.

## 26.1 Shared contracts

Create or refactor:

```text
packages/contracts/src/agents/common.ts
packages/contracts/src/agents/capital.ts
packages/contracts/src/evidence/claims.ts
packages/contracts/src/outcomes/capital.ts
packages/contracts/src/artifacts/capital.ts
packages/contracts/src/calculations/capital.ts
packages/contracts/src/memory/personalization.ts
packages/contracts/src/collaboration/specialist-read.ts
packages/contracts/src/actions/protected-action-proposal.ts
```

Replace the current weak `GlassBox { reasons: string[] }` with the evidence contract while maintaining a compatibility adapter during migration.

## 26.2 Database migrations

Additive migrations SHOULD introduce:

```text
agent_definitions
agent_mandates
agent_tasks
agent_work_results
agent_outcomes
capital_artifacts
capital_artifact_versions
financial_calculation_runs
formula_registry
evidence_bundles
evidence_claims
evidence_references
specialist_task_requests
specialist_reads
protected_action_proposals
memory_candidates
user_operating_profiles
agent_relationship_memory
agent_eval_runs
agent_eval_case_results
```

Do not duplicate existing canonical Finance tables. Use foreign keys/reference contracts to existing Finance objects.

RLS MUST cover every new table.

## 26.3 Trade Brain

Refactor the current alpha monolith into:

```text
apps/trade-brain/app/
  agents/
    framework/
      definition.py
      mandate.py
      scope.py
      runner.py
      result.py
      policies.py
    capital/
      definition.py
      planner.py
      outcome_router.py
      synthesizer.py
      prompts/
  outcomes/
    registry.py
    capital/
  skills/
    registry.py
    capital/
  tools/
    context/
    calculations/
    specialists/
    artifacts/
    proposals/
  evidence/
    claims.py
    bundle.py
    provenance.py
  memory/
    retrieval.py
    candidates.py
    personalization.py
  orchestration/
    specialist_reads.py
    workflow_adapter.py
  models/
    port.py
    policy.py
    structured_output.py
  evals/
    capital/
  security/
    document_injection.py
    data_scope.py
```

The existing `core.py` alpha behavior SHOULD be migrated incrementally behind compatibility endpoints, not expanded indefinitely.

## 26.4 API edge

Add versioned routes:

```text
POST /v1/agents/capital/tasks
GET  /v1/agents/capital/tasks/{task_id}
GET  /v1/agents/capital/tasks/{task_id}/events
POST /v1/agents/capital/tasks/{task_id}/inputs
POST /v1/agents/capital/tasks/{task_id}/cancel

GET  /v1/capital/outcomes/{outcome_id}
GET  /v1/capital/artifacts/{artifact_id}
POST /v1/capital/artifacts/{artifact_id}/versions
POST /v1/capital/artifacts/{artifact_id}/render

GET  /v1/capital/calculations/{run_id}
GET  /v1/capital/evidence/{bundle_id}

POST /v1/capital/actions/{proposal_id}/submit-for-approval
GET  /v1/capital/actions/{proposal_id}

GET  /v1/capital/memory/profile
PATCH /v1/capital/memory/profile
DELETE /v1/capital/memory/items/{memory_id}
```

All writes require idempotency where applicable.

## 26.5 Worker and workflow

Extend worker/Temporal activities for:

- durable Capital Agent outcome;
- specialist reads;
- calculation batches;
- artifact rendering;
- monitoring schedules;
- memory-candidate review;
- protected-action proposal expiration;
- evaluation jobs.

## 26.6 Web

Suggested routes/components:

```text
apps/web/app/(workspace)/intelligence/capital/
apps/web/app/(workspace)/trades/[tradeId]/capital/
apps/web/app/(workspace)/finance/capital/
apps/web/app/(workspace)/financier/capital/
apps/web/components/capital/
apps/web/components/agents/shared/
```

Use the existing design system. Do not create a separate visual product.

## 26.7 Profiles and policy

Add:

```text
packages/profiles/schemas/capital-agent.schema.yaml
packages/profiles/policies/agents/capital.yaml
packages/profiles/policies/models/capital-default.yaml
packages/profiles/policies/evidence/finance-material.yaml
packages/profiles/policies/memory/capital.yaml
packages/profiles/policies/approvals/capital-actions.yaml
```

## 26.8 Proof and audit

Extend `packages/proof` to include:

- artifact manifest;
- calculation-run hashes;
- evidence-claim hashes;
- policy/version references;
- specialist-read references;
- approval references;
- output bundle verification.

---

# 27. Implementation phases

## Phase 0 — architecture freeze

Deliver:

- this specification stored in `docs/architecture/agents/`;
- decision register;
- blueprint reconciliation notes;
- implementation plan mapped to repository;
- no production code changes beyond documentation.

Exit gate: no unresolved ownership ambiguity between Capital Agent, Trade Intelligence, and Finance.

## Phase 1 — contracts and persistence

Deliver:

- shared contracts;
- RLS migrations;
- formula registry;
- outcome/artifact/evidence schemas;
- compatibility adapter for current alpha AgentTask/WorkResult/GlassBox;
- contract tests.

Exit gate: typecheck, migrations dry-run, RLS tests, schema tests pass.

## Phase 2 — shared agent framework

Deliver:

- agent definition registry;
- mandate and scope enforcement;
- model port;
- typed tool registry;
- structured result;
- runtime budgets;
- audit events;
- base workflow integration.

Exit gate: unauthorized tool/data/write tests pass; one sample non-Capital specialist can inherit the framework.

## Phase 3 — Financial Workbench

Deliver:

- core calculators;
- versioned formulas;
- validation and golden fixtures;
- deterministic hashes;
- calculation inspector API.

Exit gate: calculator suite passes 100%.

## Phase 4 — Capital outcomes and artifacts

Deliver first:

1. capital diagnosis;
2. transaction P&L;
3. cash-flow forecast;
4. working-capital analysis;
5. financing need classification;
6. financing option comparison;
7. Financing Packet;
8. term-sheet review;
9. instrument blueprint;
10. underwriting pre-read.

Then add remaining v1.1 outcomes.

Exit gate: outcome schemas, evidence bundles, artifacts, and review UI pass.

## Phase 5 — collaboration and personalization

Deliver:

- specialist task requests/reads;
- conflict handling;
- user operating profile;
- memory candidates;
- user memory controls;
- company/financier principal isolation.

Exit gate: cross-principal tests and personalization controls pass.

## Phase 6 — protected-action proposals

Deliver:

- proposal records;
- approval integration;
- SoD;
- payload hashes;
- expiry;
- pre-execution revalidation;
- manual-outreach path.

Exit gate: zero direct execution paths from agent.

## Phase 7 — UX surfaces

Deliver:

- Trade Intelligence Capital surface;
- embedded trade and Finance entry points;
- separate Financier surface;
- artifact/evidence/calculation inspectors;
- proposal/approval cards;
- responsive and accessible behavior.

Exit gate: user can complete company and financier golden paths without chat-only dependence.

## Phase 8 — evaluation, red team, pilot

Deliver:

- 30-scenario suite;
- prompt-injection tests;
- isolation tests;
- model migration test;
- pilot instrumentation;
- release gate integration.

Exit gate: all binary safety gates pass and pilot is explicitly no-autonomous-execution.

---

# 28. Definition of done

Capital Agent v1.1 is done only when:

1. the Capital Agent is clearly separate from Finance and other modules in code and UX;
2. one shared agent framework is reusable by other specialists;
3. company and financier principals are isolated;
4. the agent supports the mandatory outcome registry;
5. material arithmetic uses deterministic calculators;
6. every material claim has evidence/provenance or is clearly labelled;
7. the system abstains or requests information instead of fabricating;
8. specialist dependencies are typed and auditable;
9. canonical Finance objects are reused;
10. protected actions are proposal-only and approval-gated;
11. memory is governed, inspectable, editable, and deletable where applicable;
12. every outcome is versioned and replayable;
13. user surfaces are structured and useful without chat;
14. all release-blocking evaluation gates pass;
15. model/provider changes are config-driven and regression-tested;
16. core TRAIBOX workflows remain usable when the agent is unavailable;
17. documentation and code agree.

A polished demo does not constitute completion.

---

# 29. Explicitly excluded from v1.1

- autonomous credit approval;
- autonomous underwriting of record;
- live lending;
- unapproved provider disclosure;
- live provider outreach without approved connector and policy;
- autonomous offer acceptance;
- autonomous payments;
- autonomous custody or escrow release;
- legal certification of escrow;
- legal, tax, or accounting rulings;
- regulated investment advice;
- unrestricted web or market research;
- unsupported real-time rates;
- crypto or token execution;
- unrestricted agent-to-agent communication;
- self-modification;
- self-approval;
- messaging-channel approvals;
- hidden persistent model memory;
- replacement of Finance canonical objects;
- full PriME mechanism design.

---

# 30. Risks and controls

| Risk | Control |
|---|---|
| Capital Agent becomes duplicate Finance module | Command boundary, canonical-object references, schema review |
| Plausible but unsupported recommendations | Evidence contract, deterministic tools, abstention |
| Arithmetic/model errors | Financial Workbench, versioned formulas, fixtures |
| Authority creep | explicit authority levels, protected proposals, SoD |
| Cross-tenant leakage | RLS/ABAC, principal isolation, red-team gate |
| Memory becomes surveillance | purpose binding, user controls, minimization, expiry |
| Prompt injection | untrusted-document boundary, tool policy, injection tests |
| Stale market or regulatory data | freshness metadata, specialist route, abstention |
| Agent taxonomy fragmentation | shared framework and canonical seven-class registry |
| Model/provider lock-in | model port, structured schemas, config-driven routing |
| Agent runtime drift | ephemeral invocation, immutable scope, versioned definitions |
| Black-box recommendation | claims, formulas, evidence, specialist reads, replay |
| Escrow misrepresentation | truthful product labels, legal/provider verification |
| Implementation overreach | phased gates and explicit v1.1 exclusions |
| Alpha code becomes permanent monolith | planned module refactor and compatibility layer |

---

# 31. Assumptions requiring validation during implementation

The following are explicit assumptions, not verified production facts:

1. Temporal will remain the durable workflow engine.
2. Python/FastAPI remains the intelligence-plane implementation language.
3. Fastify remains the authenticated API edge.
4. PostgreSQL/Supabase remains the canonical relational store.
5. Existing Finance objects can be evolved additively without destructive migration.
6. Company and financier roles can be represented in existing RBAC/ABAC with extensions.
7. Pilot operation remains human-approved and non-autonomous.
8. Exact model provider and retention policies will be selected through deployment configuration.
9. Legal treatment of escrow, guarantees, financing products, disclosures, and regulated activity will be validated per jurisdiction before activation.
10. Current repository alpha interfaces can support a compatibility migration rather than a rewrite.

Any invalidated assumption MUST be recorded in an architecture decision record and the specification updated before implementation diverges.

---

# 32. Build-order directive for coding agents

A coding agent receiving this document MUST:

1. inspect the repository before changing files;
2. map existing implementation to this specification;
3. identify conflicts and duplication;
4. preserve canonical Finance ownership;
5. implement phase by phase;
6. add tests before or with behavior;
7. run the release gates after each phase;
8. never invent provider capabilities, secrets, rates, or legal permissions;
9. never treat Claude Code/Codex agent configuration as production runtime;
10. stop and report an architecture conflict rather than silently redefining the system.

The separate execution prompt accompanying this specification is the operational instruction for Claude Code or Codex.

---

# Appendix A — Decision register

| ID | Decision | Status |
|---|---|---|
| CA-001 | Capital Agent is an intelligence specialist, not Finance module | Final |
| CA-002 | Runtime is ephemeral; identity/relationship/memory persist externally | Final |
| CA-003 | Company and financier profiles share core but are isolated principals | Final |
| CA-004 | AI owns analysis/recommendation, never commitment/execution | Final |
| CA-005 | Canonical Finance state remains in Finance domain | Final |
| CA-006 | Material calculations use deterministic Financial Workbench | Final |
| CA-007 | Evidence contract replaces free-text GlassBox reasons | Final |
| CA-008 | Outcome registry defines product capability | Final |
| CA-009 | PriME only handles explicit constrained ranking/allocation | Final |
| CA-010 | Inter-agent work uses orchestrated typed specialist reads | Final |
| CA-011 | Personalization uses governed user/org/relationship memory | Final |
| CA-012 | Protected actions are proposals with SoD and revalidation | Final |
| CA-013 | Escrow label requires verified legal/provider basis | Final |
| CA-014 | Claude Code/Codex are implementation tools, not runtime | Final |
| CA-015 | Golden scenario is split into pre-shipment and receivables cases | Final |
| CA-016 | Canonical specialist taxonomy contains seven classes | Final |
| CA-017 | Structured UI remains primary; chat is one adapter | Final |
| CA-018 | No live money, autonomous credit, or unapproved external actions in v1.1 | Final |

---

# Appendix B — Minimum implementation command gates

Run from repository root:

```bash
pnpm typecheck
pnpm test
pnpm test:trade-brain
pnpm eval:trade-brain:ci
pnpm build
pnpm db:migrate:dry-run
pnpm test:alpha:integration
```

Before merge to a release branch:

```bash
pnpm release:gate
pnpm release:gate:ci
```

Additional Capital Agent suites MUST be added to these gates rather than run manually only.

---

# Appendix C — Required documentation outputs in repository

```text
docs/architecture/agents/capital-agent-v1.1.md
docs/architecture/agents/shared-agent-framework-v1.1.md
docs/architecture/agents/capital-agent-decision-register.md
docs/architecture/agents/capital-agent-threat-model.md
docs/architecture/agents/capital-agent-data-flow.md
docs/architecture/agents/capital-agent-evaluation-plan.md
docs/runbooks/capital-agent-operations.md
docs/runbooks/capital-agent-model-migration.md
```

---

# Appendix D — Final product promise

The Capital Agent should feel like a highly capable finance-and-capital professional who knows the user and organization, understands the transaction and portfolio context, performs rigorous calculations, coordinates the right specialists, produces professional decision materials, and helps move work forward.

Its competitive advantage is not unconstrained autonomy. It is the combination of:

- broad professional finance capability;
- transaction-level context;
- deterministic numerical integrity;
- governed personalization;
- multi-agent collaboration;
- evidence-grade explanations;
- controlled action;
- integration with the full TRAIBOX trade system.

That combination is the benchmark this specification is designed to build.
