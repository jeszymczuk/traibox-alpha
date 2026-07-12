# Capital Agent v1.1 — Evaluation Plan (Company-Side)

Extends the existing harness (apps/trade-brain/app/eval_harness.py — JSONL suites in `evals/`, suite-per-file, wired into `pnpm eval:trade-brain:ci` and `release:gate(:ci)`). The deterministic classifier gate (100/19) stays green and untouched.

## 1. Layers (spec §24.1, company-side)

1. **Schema validation** — every contract payload (task, outcome, claim, artifact, proposal) validates; vitest + zod in `packages/contracts`.
2. **Deterministic calculator tests** — per calculator: unit tests, golden fixtures, currency/rounding/day-count tests, null/missing behavior, property/invariant tests where practical, deterministic hash stability; independent recomputation for high-consequence outputs. Location: trade-brain unit tests (`pnpm test:trade-brain`) + fixtures under `apps/trade-brain/tests/workbench/fixtures/`.
3. **Tool authorization tests** — foreign org/principal ids rejected; field/purpose/sensitivity enforced; model-supplied ids are not authorization.
4. **Outcome evaluations** — per outcome: positive, missing-data (`needs_information`), conflicting-data (contradiction visible), adversarial cases. JSONL suites under `apps/trade-brain/evals/capital/`.
5. **Security/adversarial** — injection (instructions in invoices/contracts/term sheets), cross-tenant, cross-principal, self-approval, payload tampering, execution-attempt probes.
6. **Coordination** — specialist read request/response contracts, conflict preservation (Phase 5+).
7. **UX reviewability** — artifact renders complete (facts/assumptions/questions/calc lineage present); inspector reachability.
8. **Model migration regression** — model port swap re-runs suites before activation.
9. **Pilot outcome monitoring** — feel-test findings + accepted/rejected recommendation tracking feed memory + refinement.

## 2. Binary release-blocking gates (spec §24.2; all zero-tolerance)

Material arithmetic 100% Workbench · golden fixtures 100% · schema validity 100% · fabricated offer/rate/action = 0 · agent-executed protected action = 0 · cross-tenant/principal leak = 0 · unauthorized tool/field access = 0 · improvised critical input = 0 · stale-as-current = 0 · injection alters mandate/tools/policy = 0 · calc lineage 100% for material values · evidence bundle 100% on finalised artifacts · **Finance-boundary: analysis/artifact/monitoring produce zero canonical Finance writes** (added per CA-102).

## 3. Suite build-out by phase

| Phase | Suites added |
|---|---|
| P1 | contract schema tests; RLS/principal-column presence tests; migration dry-run in CI |
| P2 | framework: mandate immutability, authority ceiling, unauthorized tool/data/write, budget exhaustion honesty, replay reconstruction |
| P3 | full calculator layer (fixtures + properties + hashes) for slice calculators, then the rest |
| P4 | Golden Cases A/B/C as JSONL outcome suites + fabrication/abstention cases; artifact completeness |
| P5 | memory governance (no inferred critical facts; user controls), collaboration contracts |
| P6 | proposal integrity (hash binding, modified-payload invalidation, expiry, SoD, revalidation, no-direct-execution) + Finance-boundary suite |
| P7 | UX reviewability checks (component-level tests) |
| P8 | consolidated company-side scenario suite (company + governance/resilience subset of spec §24.3: scenarios 1–12, 19–25, 29–30), red team, release-gate wiring |

## 4. Commands (gates run per phase; Appendix B)

`pnpm typecheck` · `pnpm test` · `pnpm test:trade-brain` · `pnpm eval:trade-brain:ci` · `pnpm build` · `pnpm db:migrate:dry-run` · `pnpm test:alpha:integration` (DB-backed; RLS/boundary tests live here where they need Postgres).

Financier-side scenarios (spec §24.3 13–18, 26–28) are authored with the financier workstream, not now.
