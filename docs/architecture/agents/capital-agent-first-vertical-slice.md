# Capital Agent v1.1 — First Company-Side Vertical Slice

Status: design (Phase 0). **This slice is the first production-quality milestone of the full architecture — not the Capital Agent's scope** (CA-108). It exists to validate the real interaction and architecture early, then be refined after the founder feel-test (CA-109) while the roadmap continues.

## 1. User story

A company user (exporter/CFO/finance manager) selects one trade and asks the Capital Agent to assess it financially and show how to fund it. The agent understands the transaction, asks targeted questions where material data is missing, runs deterministic calculations, and delivers an inspectable, versioned Capital artifact with a recommendation — optionally proposing (never executing) a protected action.

## 2. Slice scope (direction §13)

One selected trade →
- transaction financial **diagnosis**;
- **trade-cost** and **landed-cost** analysis;
- **transaction P&L** and margin;
- **cash-flow timing**;
- **working-capital requirement** and **funding-gap** analysis;
- **financing-options comparison** (eligibility-first; stage-aware);
- deterministic **calculation runs** (Workbench: trade cost, landed cost, P&L waterfall, cash-flow timeline, WC gap, financing cost, receivables proceeds, offer normalization, option comparison);
- typed **evidence** (claims with verification status), **assumptions**, **unresolved questions**;
- **versioned Capital artifact** (capital_diagnosis + financing comparison content);
- **recommendation** (assessment/recommendation stages only);
- optional **protected-action proposal** (e.g. propose `finance.create_funding_request`) — *proposal record only*;
- **no automatic creation of canonical Finance state** (CA-102 enforced and tested);
- structured company-side UX: objective card, facts/assumptions/questions tabs, **calculation inspector**, option table, **evidence inspector**, **artifact review**, **proposal review**.

Out of slice (still in v1.1 company scope, per roadmap): 13-week forecast, portfolio P&L, treasury/FX/capital planning, term-sheet review, instruments, monitoring/alerts, memory personalization UI (foundations land in Phase 1–2; controls UX in Phase 5/7).

## 3. Golden validation cases (direction §14 — slice acceptance)

**A — Pre-shipment PO finance.** PO exists; production must be funded before shipment; **no invoice, no receivable**. Expected: factoring/invoice finance classified **ineligible** with reasons; pre-shipment/PO-finance alternatives evaluated; no fabricated invoice/receivable/acceptance.

**B — Post-delivery accepted invoice.** Delivered + invoice + acceptance evidence + receivable. Expected: receivables finance evaluated; net proceeds, cost, tenor, conditions and cash-flow effect compared via Workbench runs.

**C — Insufficient information.** Material costs/timing/contract data missing. Expected: outcome enters `needs_information` with **targeted questions**; no fabricated inputs; unresolved questions distinguished from assumptions; provisional analysis only with clearly labelled assumptions.

## 4. Founder feel-test checklist (direction §15 — product-quality checkpoint)

Assess: understood the commercial transaction · asked the right questions · calculations accurate · calculations inspectable · evidence/assumptions clear · uncertainty honest · artifact supports a real decision · recommendation useful · UX intuitive · materially better than a spreadsheet · materially better than ordinary LLM chat · would use again · which capability next · what needs refinement.

Afterwards: refine the slice, continue the approved company-side phases. The feel-test does not authorize stopping the roadmap unless the founder explicitly narrows/redirects/pauses/stops. Financier-direct work needs explicit founder approval + its own plan.

## 5. Architecture the slice must exercise end-to-end

Principal+mandate loading → typed context reads (`CanonicalObjectRef`, both Finance layers, read-only) → outcome lifecycle incl. `needs_information` → Workbench runs with hashes/lineage → evidence bundle with claim taxonomy → versioned artifact → recommendation → optional proposal with payload hash/SoD/expiry → approval queue integration → **zero Finance writes anywhere in the path** → audit/replay/events throughout → structured UX with inspectors. Chat entry remains an adapter into this same task contract.
