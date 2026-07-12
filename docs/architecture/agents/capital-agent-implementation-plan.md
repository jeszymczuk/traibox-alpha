# Capital Agent v1.1 — Grounded Implementation Plan (Phase 0)

Status: Phase 0 deliverable. Authoritative architecture: [capital-agent-v1.1.md](capital-agent-v1.1.md) (v1.1.0, 2026-07-12).
Branch: `feat/capital-agent-v1-1` off `main@9d1aead`. PR #26 is a superseded, do-not-merge draft spike (assessment in §15).

Every claim below is grounded in inspected files/symbols on current `main`, not assumed.

---

## 1. Current-state repository map

| Area | What exists today (verified) |
|---|---|
| Contracts | One monolith `packages/contracts/src/index.ts` (~2,300 lines) + `workflow-runtime.ts`. `GlassBox { reasons: string[] }` (index.ts:7). `AgentTaskRequest`/`AgentWorkResult`/`AgentTaskResponse` (index.ts:1861–1901). `IntelligenceRunRequest` incl. `agent?` field (added by spike; also on main? — no: main predates #26, field absent on main). `FundingRequestItem` (index.ts:2143) for the funding book list; **no** `FundingRequest` canonical interface — `funding_request` is an `AlphaObjectType` payload convention. `PROTECTED_ACTIONS` incl. `submit_funding_request` (index.ts:370). |
| Workflow runtime | `packages/contracts/src/workflow-runtime.ts`: `WorkflowRunKind = 'approval_chain' \| 'controlled_execution' \| 'attach_transition' \| 'proof_generation'` (line 1), `buildWorkflowRuntimeState`, `isWorkflowRunKind`. Consumed by `apps/api/src/services/alpha.ts` (`createWorkflowRunObject` at :856, :1262). **No Temporal anywhere** (no dependency in any package.json). Durable work = `apps/worker` (tsx watch, `src/jobs/`) + `workflow_runs`-style alpha objects + V009__alpha_workflow_worker.sql. |
| Agent runtime (API) | `apps/api/src/domains/intelligence/agent-runtime.ts`: `buildAgentRuntimePolicy` (:113) with allowlists (tools :73–86, data :88–96, writes :98–106), `agentRuntimePolicyViolations` (:151), `buildAgentReplayLog` (:161), `inferApprovalGates` regex inference (:354), `MAX_TIME_BUDGET_SECONDS=120` (:111). `POST /v1/agents/tasks` (server.ts:1319) → `launchAgentTaskAlpha` (alpha.ts:3784): synchronous, deterministic (no LLM), mints `alpha_agent_tasks` row + `agent_task`/`agent_work_result`/`ai_eval_result` triple. Trade Brain scope override via `requestTradeBrainAgentScope` with `local_deterministic_fallback`. |
| Approvals | `apps/api/src/domains/approvals/protected-actions.ts`: per-kind role/risk/evidence/consequence/execution-plan incl. `submit_funding_request`. `POST /v1/approvals` (server.ts:1019) → `requestApprovalAlpha` (alpha.ts:1216); `decideApprovalAlpha` (:1334) flips target and mints `released_not_executed` execution task. No payload hash, no SoD policy object, no expiry, no pre-execution revalidation. |
| Finance domain | Hybrid: relational tables (`offer_requests`, `finance_offers`, `allocation_decisions`, `reservations`, `payments` — read via `getTrade` apps/api/src/services/trades.ts:18, `listFunding` finance.ts:303, `rankOffers` finance.ts:462) **plus** alpha objects (`funding_request`/`funding_offer` payloads). The two layers share no IDs. |
| Trade Brain | `apps/trade-brain/app/` flat monolith: `core.py` (deterministic classifier + copilot + `stream_copilot_events`), `llm.py` (env-gated Anthropic; `TRADE_BRAIN_LLM_MODEL`, default `claude-sonnet-5`), `main.py` (FastAPI; `/v1/copilot/stream` SSE), `eval_harness.py` (JSONL suites in `evals/`, determinism gate 100/19). New on main: service-token auth (`TRADE_BRAIN_REQUIRE_AUTH`/`TRADE_BRAIN_SERVICE_TOKEN`). No `agents/`, `outcomes/`, `skills/`, `tools/`, `models/` packages yet. |
| DB | `packages/db/migrations/V001–V011` (Flyway-style, additive). RLS patterns in V001/V003/V008. `alpha_agent_tasks` (V007) has status/replay_log_json/result_json + org index. `pnpm db:migrate`, `db:migrate:dry-run`, `db:seed` (fixed dev org `…00cc`). |
| Proof | `packages/proof` exists (manifest/verification used by Operations Center). |
| Web | Next.js 15 App Router under `apps/web/src/app/*` (NOT `app/(workspace)/…` as the spec sketches — §26.6 paths must be adapted). Intelligence chat with SSE streaming + smooth render (`streaming-answer.tsx`), org guard, per-org localStorage transcripts. Module CSS design system (`styles/modules/*.css`, glass tokens). `AGENT_CLASSES` roster is presentational. |
| Evals/CI | `pnpm test` (vitest, API 74+), `pnpm test:trade-brain` (unittest 28), `pnpm eval:trade-brain:ci` (determinism gate), `pnpm release:gate(:ci)`. GitHub Actions "Verify TRAIBOX alpha". |
| Profiles | `packages/profiles` zod schema + runtime env validation (`validateRuntimeEnvironment`), YAML profiles. No `policies/` tree yet (spec §26.7 target). |

## 2. Specification-to-code mapping (spec § → repo target)

| Spec | Repo target | State |
|---|---|---|
| §4 Principal/Mandate | NEW `packages/contracts/src/agents/common.ts` + `agent_mandates` table | absent |
| §5 Authority levels | NEW `agents/common.ts`; enforced in Trade Brain framework + API | absent (closest: `can_execute_protected_actions:false` literal in agent-runtime.ts:139) |
| §7 Outcome registry | NEW `packages/contracts/src/outcomes/capital.ts` + `agent_outcomes` table + trade-brain `outcomes/registry.py` | absent |
| §8 Artifacts | NEW `contracts/src/artifacts/capital.ts` + `capital_artifacts(+_versions)` tables | absent (spike's packet payload is a precursor concept only) |
| §10 Typed tools | NEW trade-brain `tools/` registry; API-side enforcement stays server-side | partial precedent: allowlists in agent-runtime.ts |
| §11 Financial Workbench | NEW `apps/trade-brain/app/workbench/` (calculators, formula registry, deterministic hash) + `financial_calculation_runs`, `formula_registry` tables | absent |
| §12 Evidence claims | NEW `contracts/src/evidence/claims.ts` + `evidence_bundles/claims/references` tables; GlassBox adapter | absent; GlassBox is `{reasons: string[]}` |
| §13 Memory | NEW `contracts/src/memory/personalization.ts` + `memory_candidates`, `user_operating_profiles` | partial precedent: `writeMemory` L1/L2 events (alpha.ts:5386) |
| §14 Specialist reads | NEW `contracts/src/collaboration/specialist-read.ts` + tables + orchestration | absent |
| §18.5 WorkflowRunKind +5 | EXTEND `workflow-runtime.ts:1` union + `isWorkflowRunKind` | 4 kinds exist |
| §19 Proposals | NEW `contracts/src/actions/protected-action-proposal.ts` + `protected_action_proposals` table; integrates with existing `/v1/approvals` | approvals exist; proposal record/hash/SoD/expiry/revalidation absent |
| §20 Model port | NEW trade-brain `models/port.py`; config via profiles (llm.py env pattern generalizes) | partial: llm.py is Anthropic-specific |
| §24 Evals | EXTEND `eval_harness.py` JSONL pattern with `evals/capital/*` suites | harness exists |
| §26.4 API routes | NEW `/v1/agents/capital/tasks` etc. in server.ts (or a new `routes/capital.ts` module) | only `/v1/agents/tasks` + `/v1/intelligence/stream` exist |
| §26.6 Web | `apps/web/src/app/intelligence/capital/` + `components/capital/` (adapt spec's `(workspace)` paths to actual App Router layout) | chat surface exists |

## 3. Reused components (no rebuild)

- **SSE transport chain**: brain `StreamingResponse` → API `reply.hijack()` raw SSE (server.ts /v1/intelligence/stream) → web `streamAlphaIntelligence` parser → `StreamingAnswer` smooth render. v1.1 task events (`GET /v1/agents/capital/tasks/{id}/events`) reuse this exact pattern.
- **RLS/tx discipline**: `withTx` + `setAppContext` (`@traibox/db`), `assertTradeInCurrentOrg`, `ensureUser`.
- **Audit/memory/events trio**: `appendAudit` (alpha.ts:5376), `writeMemory` (:5386), `insertEvent` (:5411).
- **Approval queue + protected-action policy table** (domains/approvals/protected-actions.ts, approval-queue.tsx) — proposals layer on top; approvals stay the human gate.
- **Workflow runtime state machine** (workflow-runtime.ts) + `apps/worker` job loop for durable phases.
- **Eval harness** (eval_harness.py) — suite-per-JSONL extends to capital suites; determinism gate stays.
- **Profiles** runtime validation for model/policy config; **proof** package for artifact manifests (§26.8).
- **Design system**: glass tokens, module CSS, `streaming-answer.tsx`, approval cards.
- **Trade Brain service auth** (new on main): service-token pattern for brain-side capital endpoints.

## 4. Contracts requiring migration

- `GlassBox` → structured evidence claims with a compatibility adapter (`glassBoxFromClaims(claims): GlassBox` keeps `IntelligenceRunResponse`/eval payload shapes stable).
- `AgentTaskRequest/AgentWorkResult` (index.ts:1861–1886) → superseded by `CapitalAgentTaskRequest`/`CapitalAgentWorkResult` (spec §17.2–17.3) in `agents/capital.ts`; old shapes remain exported and served by `/v1/agents/tasks` (compat) until callers migrate.
- Monolith `index.ts` → focused modules (spec §26.1 list) with re-exports from `index.ts` (no import-path breakage; verified pattern: `export * from './workflow-runtime'` at index.ts:3).
- `WorkflowRunKind` union: +`agent_outcome`, `specialist_read`, `protected_action_proposal`, `capital_artifact_review`, `instrument_monitoring` (workflow-runtime.ts:1 + type guard :62).
- `IntelligenceRunRequest.agent?` (spike-only) — re-introduced only as a chat-surface routing hint that resolves to a `CapitalAgentTaskRequest`; not the task contract.

## 5. Database changes (additive, all RLS'd, FK to canonical objects)

New migration `V012__capital_agent_v1_1.sql` (split into V012–V014 if review prefers smaller units), following V007 conventions:
`agent_definitions`, `agent_mandates`, `agent_outcomes`, `capital_artifacts`, `capital_artifact_versions`, `financial_calculation_runs`, `formula_registry`, `evidence_bundles`, `evidence_claims`, `evidence_references`, `specialist_task_requests`, `specialist_reads`, `protected_action_proposals`, `memory_candidates`, `user_operating_profiles`, `agent_relationship_memory`, `agent_eval_runs`, `agent_eval_case_results`.
Reuse (do NOT duplicate): `alpha_agent_tasks` (evolves via nullable FK columns `mandate_id`, `outcome_id` rather than a parallel `agent_tasks` table — deviation from spec §26.2's literal `agent_tasks` name, justified: identical purpose, avoids dual-write; recorded in decision register). No Finance-table duplication; `evidence_references`/`linkedObjectRefs` point at existing rows by (table, id) ref contract.

## 6. API changes

- NEW versioned routes (spec §26.4) in a new `apps/api/src/routes/capital.ts` registered from server.ts (server.ts is ~2k+ lines; do not grow it): tasks CRUD + events (SSE), outcomes, artifacts (+versions/render), calculations, evidence, proposals (+submit-for-approval), memory profile.
- All writes: auth + org/principal binding + role/mandate validation + RLS + idempotency key + audit + trace + normalized errors (matches existing route discipline; idempotency precedent: payments `idempotency_key`).
- `/v1/agents/tasks` unchanged (compat). `/v1/intelligence/stream` gains only the thin routing hint that creates a capital task and streams its events (no Capital logic in alpha.ts — see §14-conflict-10 remediation).
- Brain: NEW FastAPI routers under `apps/trade-brain/app/api/` for capital task execution, honoring the new service-token auth.

## 7. Workflow changes

- Extend `WorkflowRunKind` (+5) and emit `capital.*` structured events (spec §23.2) through existing `insertEvent`.
- `apps/worker/src/jobs/`: new jobs — capital outcome execution (async > interactive-budget tasks), proposal expiry sweep, artifact render, monitoring schedules, eval batch. Temporal is **not present** (assumption §31.1 invalid today) — v1.1 runs on the existing worker/jobs + workflow_runs pattern; Temporal adoption becomes a recorded deferred decision (see §14).

## 8. UI changes

- NEW `apps/web/src/components/capital/` (spec §22.3 set: mandate badge, objective card, facts/assumptions/questions tabs, calculation inspector, option table, specialist strip, artifact preview, evidence drawer, proposal card, version history, memory controls) + `apps/web/src/app/intelligence/capital/` surface; entry points from chat "Call an Agent", trade workspace, Finance.
- Reuse glass tokens/module CSS; spike's `artifact.css` primitives + pop-out sheet pattern carry forward (see §15).
- Chat remains one adapter; structured surface is primary (spec §22.5). Spec's `app/(workspace)/…` paths adapted to the repo's actual `src/app/...` layout.

## 9. Evaluation changes

- `evals/capital/*.jsonl` suites into the existing harness + list/run plumbing; wire into `pnpm eval:trade-brain:ci` and `release:gate`.
- Calculator golden fixtures + property tests (Workbench) in trade-brain unit tests (`pnpm test:trade-brain`).
- Binary safety gates (spec §24.2) as dedicated suites: tenancy/principal isolation, no-execution, fabrication, injection, lineage completeness.
- 30-scenario suite (§24.3) built incrementally per phase; Golden A (pre-shipment) and Golden B (receivables) first.

## 10. Compatibility strategy

- Additive-only migrations; old routes/contracts keep working via re-exports + adapters (GlassBox adapter, `/v1/agents/tasks` compat, alpha_agent_tasks evolution).
- Trade Brain determinism gate stays green: capital code paths are new modules; `core.py` untouched in Phases 1–3, then incrementally delegates behind compat endpoints.
- The chat surface keeps working unchanged until Phase 7 swaps its Capital entry to the new task API.
- Dev/demo flows (internal alpha scenarios, seed org) unaffected.

## 11. Security risks (top, with controls)

1. Cross-principal leakage (company↔financier) — new: principal/mandate columns + RLS on every new table + isolation eval gate (binary).
2. Prompt injection via financed documents — untrusted-document boundary in brain `security/`; injection suites.
3. Proposal tampering — payload hash + approval binds to hash + expiry + revalidation (spec §19.2); tests: modified payload invalidates.
4. SoD bypass — proposer≠approver enforcement in approvals service; test: invoker self-approve rejected.
5. Model-executed action — no execution tool exists in the brain tool registry at all (structural, not policy).
6. Fabricated financials — Workbench-only arithmetic; artifact renderer refuses material values without `calculationRunId` lineage.
7. Secret exposure — service-token pattern (already on main) + no secrets in prompts.

## 12. Phase plan (maps to spec §27, gates = Appendix B commands)

| Phase | Deliverable | Exit gate |
|---|---|---|
| 0 (this) | Spec copy, this plan, decision register, threat model, data-flow, eval plan, AGENTS.md/CLAUDE.md pointers | no ownership ambiguity; no production code |
| 1 | Contracts modules + adapters; V012+ migrations + RLS; formula-registry seed | `pnpm typecheck` + `db:migrate:dry-run` + `pnpm test` |
| 2 | Trade-brain shared agent framework (definition/mandate/scope/runner/result/policies + model port + typed tool registry) + one minimal non-Capital sample config | `test:trade-brain` + `eval:trade-brain:ci` + unauthorized-tool tests |
| 3 | Financial Workbench calculators + fixtures + hashes + inspector API | calculator suite 100% |
| 4 | Outcome registry + first 10 outcomes + artifacts + evidence bundles | outcome schema/eval pass |
| 5 | Specialist reads + memory/personalization + principal isolation | cross-principal tests |
| 6 | Protected-action proposals (hash/SoD/expiry/revalidation) + approval integration | zero direct-execution paths |
| 7 | UX surfaces (capital components + intelligence/capital + financier isolation) | golden paths without chat |
| 8 | 30-scenario suite + red team + release-gate wiring | all binary gates |

## 13. Files expected to change (by phase, condensed)

- P1: `packages/contracts/src/{agents,evidence,outcomes,artifacts,calculations,memory,collaboration,actions}/*.ts`, `index.ts` (re-exports), `workflow-runtime.ts`, `packages/db/migrations/V012+__*.sql`.
- P2: `apps/trade-brain/app/{agents/framework,agents/capital,models,tools,evidence}/**`, `main.py` (routers), tests.
- P3: `apps/trade-brain/app/workbench/**`, calculator tests/fixtures.
- P4: `apps/trade-brain/app/{outcomes,skills}/**`, `apps/api/src/routes/capital.ts`, server.ts (register), artifact schemas.
- P5: memory/collaboration modules both sides; profiles `policies/**`.
- P6: approvals service (SoD/hash/expiry/revalidation), proposals routes, worker expiry job.
- P7: `apps/web/src/components/capital/**`, `apps/web/src/app/intelligence/capital/**`, chat entry swap.
- P8: `apps/trade-brain/evals/capital/**`, CI/release-gate wiring.

## 14. Unresolved architecture conflicts (escalation register)

1. **Temporal absent** (spec §20.1/§31.1 assumes it). Repo reality: custom worker + workflow_runs. Proposal: build v1.1 on the existing runtime (it already satisfies §18.5's durable/replayable requirements at alpha scale); record Temporal as a deferred platform decision. *Needs founder/architecture sign-off.*
2. **`agent_tasks` table name** (spec §26.2) vs existing `alpha_agent_tasks`. Proposal: evolve `alpha_agent_tasks` additively (mandate/outcome FKs) instead of a parallel table. *Recorded as deviation; needs sign-off.*
3. **Web route shape** — spec's `apps/web/app/(workspace)/…` doesn't exist; actual layout is `apps/web/src/app/…`. Proposal: adapt paths, keep intent. *Low risk; recorded.*
4. **Canonical Finance objects** — spec §15.1 lists `FundingRequest` et al. as canonical; repo has hybrid relational + alpha-object funding with no shared IDs. Proposal: v1.1 references BOTH layers via a typed `CanonicalObjectRef {layer: 'relational'|'alpha', table/type, id}` and does not attempt Finance-side consolidation (that's a Finance-module workstream). *Needs sign-off — affects `finance.create_funding_request` command target.*
5. **Seven-class taxonomy labels** (spec §3.4) vs web `AGENT_CLASSES` five-class marketing roster (page.tsx:76–118). Proposal: canonical seven in `agent_definitions`; web roster re-labeled in Phase 7. *Cosmetic-to-moderate.*

## 15. PR #26 Salvage Assessment

PR #26 (`claude/capital-agent`, commit `0a63627`, now a do-not-merge draft) is a pre-v1.1 spike. Verified conflicts with v1.1, mapped to the twelve known conflicts (numbers in parentheses): reduces the agent to a packet builder (1); binds directly to `funding_request` **and creates it implicitly on artifact generation**, violating §15.3 (2); defaults to `submit_funding_request` (3); assumes no migrations/contracts (4, its design doc states this as a principle); no principal/mandate isolation (5); no Workbench — `tenor_days: 90` and indicative amounts are hard-coded in `composeFinancingPacket` (6, 9); no evidence-claim contract — checklist presence is keyword heuristics in `hasEvidenceInTrade` (7, 8); `runSpecialistAgentStream` lives inside generic `alpha.ts` (10); gates inferred from objective wording regexes, wording even test-pinned to avoid the word "payment" (11); registry treats specialists as one-liner entries with no versioning/mandates/outcomes (12).

Per-file classification (all 11 changed files):

| File | Classification | Rationale vs v1.1 |
|---|---|---|
| `apps/api/src/domains/intelligence/agent-registry.ts` | **Retain concept only** | Registry-driven resolution + @-mention parsing are sound UX concepts; the definition shape (no version/mandate/authority/outcome refs) is superseded by §17.1 `SpecialistAgentDefinition` + DB-backed `agent_definitions`. Conflicts 3, 11, 12. |
| `apps/api/src/domains/intelligence/specialists/capital-agent.ts` | **Discard** (salvage two micro-patterns) | Packet-builder framing is conflict 1; heuristic evidence (8), hard-coded indicative terms (9), and single-artifact assumption are structural. Salvageable micro-patterns: pure-composition-for-testability and relational/alpha provenance labeling — both re-emerge naturally in Workbench/evidence design, not by copying code. |
| `apps/api/src/services/alpha.ts` (runSpecialistAgentStream + branch) | **Supersede** | Conflict 10 (Capital logic in generic Alpha service) and conflict 2 (implicit funding_request creation violates §15.3). The transactional-persistence discipline and honest error/blocked-task handling are the house style anyway (launchAgentTaskAlpha) — nothing unique to keep. New home: trade-brain capital runner + `routes/capital.ts`. |
| `apps/api/src/server.ts` (agent field on 2 zod bodies) | **Supersede** | v1.1 exposes dedicated `/v1/agents/capital/*` routes; the chat surface routes through a thin hint that constructs a `CapitalAgentTaskRequest`. The 2-line zod addition is trivially re-derived. |
| `packages/contracts/src/index.ts` (`agent?: string`) | **Retain concept only** | A chat-surface routing hint survives in spirit; the field itself is superseded by the first-class task contract (conflict 4). |
| `apps/api/src/domains/intelligence/agent-registry.test.ts` | **Discard** | Pins the superseded architecture (objective-wording guard is a monument to conflict 11). The *practice* of scope-pinning tests carries into Phase 2 framework tests. |
| `apps/web/src/app/intelligence/page.tsx` (arming, steps, artifact frames) | **Retain concept only** | Arm-the-specialist UX, live step checklist, optional/render-guarded ChatEntry fields, and unknown-frame-tolerant SSE handling all match §22 (status communication, chat-as-adapter). Re-implemented in Phase 7 against task events, not copied (the spike binds them to the superseded stream branch). |
| `apps/web/src/components/financing-packet-artifact.tsx` | **Refactor substantially** | Inline card + pop-out sheet + Escape/focus/reduced-motion handling directly prefigure §22.3 artifact preview/evidence drawer. Data contract (ad-hoc packet), direct `/v1/approvals` call (bypasses §19 proposals), and single-artifact assumption must go; the interaction shell is reusable. |
| `apps/web/src/styles/modules/artifact.css` | **Retain unchanged** (rename/extend) | Design-system-compliant `.af-*` primitives (card, rows, checklist, sheet, scrim, steps) are contract-free CSS; Phase 7 extends them for the full component set. |
| `apps/web/src/app/layout.tsx` (css import) | **Retain unchanged** | One-line import; stands or falls with artifact.css. |
| `docs/agent-runtime-design.md` | **Supersede** | Its core principle ("no new endpoints/migrations/action kinds") is conflict 4 and is explicitly reversed by v1.1 §26. Phase 0 marks it superseded-by-v1.1 (banner) or removes it; historical value only. |

Handling rule (per founder instruction): none of the above is cherry-picked/copied/merged until this plan is accepted; "retain" classifications are design guidance for fresh implementation on `feat/capital-agent-v1-1`, with PR #26 consulted read-only.

---

*Next Phase 0 artifacts:* decision register, threat model, data-flow, evaluation plan, AGENTS.md/CLAUDE.md pointers. *Phase 0 exit gate:* founder sign-off on §14 conflicts 1, 2 and 4.
