# Specialist-Agent Runtime — Design (Stage 2, v1)

Status: **implemented** (first specialist: Capital Agent). This doc records the architecture so the
remaining specialists (Matchmaker, Compliance Officer, Trade Operator, Audit Sentinel, Risk Analyst,
Concierge) can be added as registry entries, not new plumbing.

## Principle

**No new endpoints, no DB migrations, no new protected-action kinds.** A specialist run rides the
existing streaming chat pipe (`POST /v1/intelligence/stream`), the existing governed-object
substrate (`alpha_objects`, `alpha_agent_tasks`), the existing scoped runtime policy
(`buildAgentRuntimePolicy`, `agent-scope-alpha-v2`), and the existing approval governance
(`/v1/approvals` + `PROTECTED_ACTIONS`). Agents **never execute** protected actions
(`can_execute_protected_actions: false` is a literal type) — they *propose* them; a human approves
in the existing queue.

## Anatomy of a specialist

A specialist is one registry entry (`apps/api/src/domains/intelligence/agent-registry.ts`):

```
SpecialistDefinition = {
  id                       // 'capital_agent'
  displayName              // 'Capital Agent' — must match web AGENT_CLASSES naming
  objectType               // governed object it produces ('funding_request')
  proposedProtectedAction  // gate it proposes ('submit_funding_request')
  scope                    // permitted_tools / data_access / write_permissions /
                           // approval_gates / time_budget — validated against the
                           // agent-runtime allowlists at module load (test-pinned)
  objective(ctx)           // load-bearing wording: drives inferApprovalGates regexes
                           // AND the web Agents-tab ACTIVE keyword match
}
```

plus one worker module (`specialists/<id>.ts`) that gathers **read-only** data via existing
RLS-safe service functions and composes a typed artifact payload.

## Run flow (`runSpecialistAgentStream`, alpha.ts)

`runIntelligenceStream` resolves a specialist from `body.agent` (or a leading `@Display Name`
mention) and branches:

1. **Scope** — `buildAgentRuntimePolicy(scope)`; any violation → honest `error` frame, stop.
2. **Accept** — INSERT `alpha_agent_tasks` status `in_progress`, replay log seeded via
   `buildAgentReplayLog`; emit `agent_status`.
3. **Work** — each tool step runs real reads (`getTrade`, `queryAlphaObjects`, …), appends to the
   replay log, and emits an `agent_step` frame so the chat shows live progress.
4. **Narrative** — grounded LLM stream via `streamTradeBrainCopilotEvents` (packet data embedded in
   the prompt); `delta` frames forward as-is. Deterministic markdown fallback when the brain is
   down, so the path works in CI and degraded mode.
5. **Persist (transactional, not best-effort)** — one tx mints the governed object
   (`funding_request`, status `draft`, artifact payload inside), the `agent_task` +
   `agent_work_result` + `ai_eval_result` trio (mirroring `launchAgentTaskAlpha`), flips the task
   row to `completed`, and writes audit + L1/L2 memory + events. Failure → `error` frame.
6. **Deliver** — `artifact` frame (typed packet + proposed action), then the standard `meta`
   (`saved_object_id`, follow-ups) and `done`.

New SSE frame types (`agent_status`, `agent_step`, `artifact`) are additive: the web client's
parser forwards unknown frames, and old transcripts stay loadable because every new `ChatEntry`
field is optional and renderer-guarded.

## Web surface

- Attach-menu → "Call an Agent" now *arms* the agent (`calledAgent` state + indicator chip) instead
  of only prepending `@Name` text; `send()` passes `agent` in the body (mention parse remains as
  server-side fallback).
- Steps render as a live checklist above the streamed narrative.
- The artifact renders as an **inline expandable card** (v2.0 glass tokens, `.af-` module CSS) with
  a **pop-out right sheet** (scrim, Escape, reduced-motion) — `financing-packet-artifact.tsx`.
- The proposed action renders as a button → existing `POST /v1/approvals`
  (`kind: submit_funding_request`, target = the funding_request object) → existing approval queue,
  which on approve flips the object and mints the `released_not_executed` execution task from the
  per-kind plan in `domains/approvals/protected-actions.ts`.

## Known constraints (carried from the subsystem audit)

- Objective wording is load-bearing twice: `inferApprovalGates` regexes it (the word "payment"
  silently adds a `send_payment` gate) and the Agents-tab ACTIVE state keyword-matches it.
- `alpha_agent_tasks` + `agent_task` object + `agent_work_result` payload triplicate task data —
  shape changes touch all three plus eval `evidence_refs`.
- Relational finance (offer_requests/finance_offers) and alpha funding objects are disconnected
  layers; the packet labels provenance and never joins their ids.
- pg numerics arrive as strings (`Number()` at the boundary); `listFunding` is role-gated
  (owner/admin/finance) so v1 reads only role-open sources (`getTrade`, `/v1/query`).
- localStorage transcripts are `JSON.parse`-cast unchecked — every new `ChatEntry` field must stay
  optional and render-guarded.

## Adding the next specialist (checklist)

1. Registry entry (scope validated by `agent-registry.test.ts` — add the new id to its table).
2. Worker module composing its artifact payload from existing read services.
3. Artifact renderer (or reuse `financing-packet-artifact.tsx` patterns / generalize).
4. Objective wording: include the Agents-tab keywords for that class; avoid stray gate triggers.
5. No new endpoints; no migrations; propose — never execute — protected actions.
