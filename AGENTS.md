# TRAIBOX Repository Implementation Constitution

This file is the repository-wide instruction baseline for human and automated contributors. Read it before changing any file. The detailed governing rules are in `docs/governance/repository-constitution.md`; the machine-readable evidence maps are in `docs/governance/`.

## 1. Determine authority before implementation

1. Read `docs/governance/source-of-truth.yaml` and apply its precedence order.
2. A document may govern implementation only when its recorded status is `CANONICAL` or `APPROVED`.
3. `REVIEW`, `SUPERSEDED`, `ARCHIVED`, and `PENDING_IMPORT` material is not implementation authority unless an approved governance decision activates a named section.
4. Do not reconstruct a missing chapter from memory, an implementation copy, an old branch, or an unverified draft. Record it as `PENDING_IMPORT` and identify the blocked decision.
5. Repository contracts, migrations, routes, and tests reveal implementation reality. They do not silently override approved product architecture.
6. If two authoritative sources genuinely conflict, stop and report the exact sections. Do not choose silently.

PR #26 is a superseded, non-authoritative spike and must not be used as implementation authority. PR #30 is an unmerged source branch: inspect it only when the task explicitly calls for context, and never merge or copy it wholesale.

## 2. Architectural boundaries

- The canonical backend is the independently deployed TypeScript application API. Fastify is the approved pilot modular-monolith implementation under ADR-001; NestJS is a reviewed medium-term option, not a current migration.
- Supabase is approved pilot managed infrastructure for PostgreSQL, private object storage, and authentication. PostgREST, Edge Functions, browser business logic, database workflow triggers, and direct browser-to-database mutations are not the canonical TRAIBOX backend.
- PostgreSQL is canonical transactional truth. The PostgreSQL UTG implementation is an adapter behind a stable service contract; any later Neo4j graph is derived and non-canonical under ADR-002.
- The Python/FastAPI Trade Brain is the intelligence plane. It may analyse, assess, explain, recommend, draft, and prepare evidence; it does not own canonical product state.
- The current worker is approved only for non-durable background work. Apply ADR-003 before introducing long-lived or protected multi-step workflow execution.
- Provider implementations stay behind provider-neutral ports and adapters. External schemas do not define TRAIBOX contracts.

## 3. Product and route governance

The seven canonical customer workspaces are Intelligence, Trades, Finance, Network, Clearance, Operations Center, and Settings. Payments is a Finance capability. Inbox is not a canonical top-level workspace. Partner and financier experiences require role-specific shells, permissions, and information architecture.

Before adding or changing a production route:

1. register it in `docs/governance/route-manifest.yaml`;
2. cite an approved screen contract;
3. declare workspace, audience, role, and tenant behavior;
4. implement loading, empty, error, permission-denied, degraded, accessibility, and responsive behavior;
5. update route tests and navigation evidence.

Until authoritative Ch.17 v3 and Ch.17.A are imported, do not treat `docs/frontend/ch17a-screen-component-contracts.md` as approved authority. Once Ch.17.A is imported, every new shared production component also requires an approved component contract.

## 4. Security and session boundary

Follow ADR-004. The intended authenticated browser boundary is a thin Next.js BFF with secure server-managed sessions. The BFF may manage sessions, attach credentials, correlate requests, proxy SSE, normalize transport, and safely normalize errors. It may not own domain decisions, Finance calculations, approval decisions, canonical state, protected-action logic, agent authorization, or provider-specific business policy.

Never store credentials, access or refresh tokens, or private trade transcripts in `localStorage`, `sessionStorage`, or IndexedDB. Never place an authentication token in a query string except for an explicitly approved, short-lived, single-purpose signed artifact URL. Existing browser token storage, query-token transport, direct browser API access, and persisted intelligence transcripts are remediation evidence, not approved patterns to copy.

## 5. Agents and protected actions

Use only protected-action identifiers present in `docs/governance/protected-actions.yaml` and the shared contract. A model or agent may never directly execute a protected action or mutate canonical Trade, Finance, Payment, Clearance, Approval, instrument, or escrow state.

Canonical execution requires typed validation, authorization, policy evaluation, idempotency where required, independent domain validation, human approval where required, audit evidence, and replayability. Agent reasoning and business workflow execution are separate responsibilities.

### Capital Agent v1.1 (active workstream)

- Normative architecture: `docs/architecture/agents/capital-agent-v1.1.md` (registered in `docs/governance/source-of-truth.yaml`). Do not redesign its domain boundaries or enable protected execution from model output. Companion Phase 0 documents (implementation plan, decision register, threat model, data flow, company roadmap, first vertical slice, evaluation plan) live in the same directory.
- Scope: the complete **company-side** Capital Agent is the approved product. Direct financier functionality is deferred by sequencing only — the foundation stays principal-neutral and financier-compatible (`principal_type ∈ {company, financier, platform_internal}`; generic contracts, never `company_*` schemas). See decision register CA-100/CA-101.
- Capital Agent ↔ Finance boundary (strict, CA-102): Finance owns canonical financial state and execution. The Capital Agent produces outcomes, deterministic calculation runs, evidence, versioned artifacts, recommendations, and protected-action **proposals** only. Canonical Finance objects change only via proposal → human approval → typed Finance command → independent Finance-domain validation → Finance execution. A recommendation is never authorization.
- Material arithmetic runs in the deterministic Financial Workbench, never in the LLM.
- The first vertical slice (`docs/architecture/agents/capital-agent-first-vertical-slice.md`) is an early milestone with a founder feel-test checkpoint, not the final product scope.

## 6. Data, migrations, and RLS

- Every tenant-owned table needs explicit ownership, enabled and forced RLS where applicable, tenant-isolation tests, audit consideration, and retention consideration.
- Migrations are additive by default.
- A destructive or irreversible migration requires an approved ADR, explicit migration approval, backup/recovery analysis, compatibility analysis, and rollback or forward-fix analysis.
- Never put product workflow decisions in database triggers.

## 7. When an ADR is required

Create or supersede an ADR for an architecture deviation, a backend/framework boundary change, a new canonical data store, a durable workflow engine, a new authenticated browser/session pattern, a design-system replacement, a provider abstraction breach, or a destructive/irreversible migration. Add approved ADRs to `docs/adrs/README.md` and `docs/governance/source-of-truth.yaml`.

## 8. Workstream and pull-request discipline

- One implementation agent authors a workstream. A different agent may review it. Claude Code and Codex must not implement the same workstream independently in parallel.
- Preserve unrelated work. Do not clean, reset, stash, overwrite, or commit it without explicit authorization.
- Complete `.github/pull_request_template.md`; declare specifications, architecture, routes, contracts, protected actions, security, migrations/RLS, providers, validation, compatibility, rollback, and unresolved conflicts.
- Do not claim a check passed unless it was run in the current worktree.

## 9. Validation baseline

Run the checks applicable to the change without production credentials:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:trade-brain
pnpm eval:trade-brain
pnpm build
```

For YAML changes, parse every changed YAML file. For migrations, also run the migration dry-run and tenant-isolation coverage appropriate to the change. For UI changes, provide desktop, tablet, mobile, keyboard, loading, empty, error, permission-denied, and degraded evidence. Classify every failure as introduced, pre-existing, credential-related, tooling-related, or unrelated.

## 10. Mandatory stop conditions

Stop and report when authoritative instructions conflict; a required canonical source is missing and a decision depends on it; permissions block safe progress; a destructive action is required; unrelated work risks loss; protected-action boundaries cannot be established; or required evidence cannot be determined from repository inspection.
