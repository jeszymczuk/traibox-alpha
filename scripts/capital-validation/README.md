# Capital Agent v1.1 — founder validation package (NON-PRODUCTION)

A narrow internal validation surface for founder review of the governed
company-side Capital Agent backend. It runs the REAL outcome engine (the same
code the API calls), entirely in-process: **no database, no manual database
editing, no canonical state, no protected actions, no financier surface**.

## Prerequisites (one-time)

From the repository root — the only local service needed is Python 3.9+ with
the Trade Brain dependencies:

```bash
python3 -m pip install -r apps/trade-brain/requirements.txt
```

(Optional, for the full API path instead of in-process validation:
`docker compose up -d postgres trade-brain` starts the local stack; the
scripts below do NOT require it.)

## Run the golden scenarios

```bash
python3 scripts/capital-validation/run_golden.py A   # pre-shipment PO funding
python3 scripts/capital-validation/run_golden.py B   # post-delivery accepted invoice
python3 scripts/capital-validation/run_golden.py C   # missing + contradictory information
```

Each prints: outcome status, per-category evidence coverage (verified vs
user-provided vs missing), trust-model notes, every deterministic calculation
with its audit hashes, assumptions, targeted questions, contradictions, the
recommendation, and the rendered artifact.

Synthesis wording is deterministic by default. To validate governed model
wording, set `TRADE_BRAIN_LLM_ENABLED=1` and `ANTHROPIC_API_KEY` in your
environment first — figures in model wording remain structurally guarded.

## What the founder should judge

1. **Honesty of classification** — Golden A must mark receivables finance
   structurally ineligible (no receivable exists) and classify a pre-shipment
   need; Golden B must mark it eligible with complete pricing; Golden C must
   ask targeted questions instead of inventing numbers.
2. **Traceability** — every material figure appears in the calculation
   appendix with input/result hashes.
3. **Evidence discipline** — canonical facts read as verified; company-typed
   facts read as user-provided; contradictions stay visible.
4. **Draft quality** — is the artifact a credible working draft for an SME?

This package is explicitly **not** the product UX; production user workflows
are a later phase.
