# TRAIBOX Repository Constitution

- Status: **CANONICAL** for repository governance
- Decision: **C0.1**
- Applies from: **2026-07-13**
- Owner: **@jeszymczuk**

## 1. Purpose and authority

This constitution establishes the enforceable product, architecture, security, data, and development baseline for this repository. It governs how implementation authority is selected; it does not fabricate the missing product chapters listed in `source-of-truth.yaml`.

The precedence order is:

1. Ch.0 — TRAIBOX Vision, Mission and Why We Exist
2. Product Architecture v6.1
3. v7 Pilot-Ready Architecture Cut
4. reconciled Ch.2 Experience System
5. Ch.17 v3 Frontend Architecture
6. Ch.17.A Screen and Component Contracts
7. Ch.16 Technology Architecture plus approved ADRs
8. Ch.18 Security and Privacy
9. Ch.26 pilot delivery baseline
10. Ch.28 QA and release readiness
11. active Ch.31 roadmap
12. domain chapters and annexes
13. executable repository contracts, migrations, and tests

When two sources at different levels disagree, the higher source governs. When two genuinely authoritative sources at the same level disagree, implementation stops until the conflict is resolved or formally recorded by an approved governance decision.

## 2. Document lifecycle

Only these uppercase statuses are valid:

- `CANONICAL`: controlling source at its declared scope.
- `APPROVED`: accepted implementation authority at its declared scope.
- `REVIEW`: proposal or evidence awaiting approval; not implementation authority.
- `SUPERSEDED`: replaced historical material; never current authority.
- `ARCHIVED`: retained historical material; never current authority.
- `PENDING_IMPORT`: known authoritative material is unavailable; do not reconstruct it.

`REVIEW`, `SUPERSEDED`, `ARCHIVED`, and `PENDING_IMPORT` material governs only when an approved decision activates a specific, named section. Repository contracts and tests reveal implementation reality but never silently override approved product architecture.

The repository does not currently contain verified authoritative copies of Ch.0, Product Architecture v6.1, the v7 cut, reconciled Ch.2, Ch.17 v3, Ch.17.A, Ch.16, Ch.18, Ch.26, Ch.28, or active Ch.31. Their status is `PENDING_IMPORT`. The local Ch.17.A “Implementation Copy” is `REVIEW`, not a substitute for the authoritative source.

## 3. Product architecture

### 3.1 Canonical workspaces

TRAIBOX has seven canonical customer workspaces:

1. Intelligence
2. Trades
3. Finance
4. Network
5. Clearance
6. Operations Center
7. Settings

Payments is a Finance capability, not a top-level customer workspace. Inbox is not a canonical top-level workspace. Partner and financier experiences use separate role-specific shells, permissions, and information architecture.

The route reality and compatibility decisions are recorded in `route-manifest.yaml`. Existing drift may remain until an approved remediation PR; this constitution does not authorize redirects or behavior changes.

### 3.2 Route and component gates

No production route may be added without manifest registration, an approved screen contract, workspace ownership, audience and role behavior, tenant behavior, loading/empty/error/permission-denied/degraded states, accessibility expectations, and responsive evidence.

Ch.17 v3 and Ch.17.A must be imported and reconciled before their contents are used as authority. Until then, new production routes are blocked unless an approved governance decision provides a complete route-specific screen contract. After authoritative Ch.17.A import, no shared production component may be introduced without a component contract.

## 4. Pilot system architecture

The approved current architecture is:

- Next.js web application, currently deployed on Vercel;
- independently deployed Fastify TypeScript application API on Fly.io;
- independently deployed background worker on Fly.io;
- Supabase-managed PostgreSQL;
- private Supabase Storage;
- Supabase Auth for the pilot;
- Python/FastAPI Trade Brain intelligence plane;
- the current worker for non-durable background work.

The independently deployed TypeScript application API is the canonical TRAIBOX application backend. Canonical Trade, Finance, Payment, Clearance, Approval, instrument, escrow, and agent-related mutations pass through its authorization, validation, policy, idempotency, independent domain validation, and audit controls.

Supabase is approved managed infrastructure for PostgreSQL, private object storage, and authentication. Supabase PostgREST, Edge Functions, frontend business logic, database triggers containing product workflow logic, and direct browser-to-database mutations are not the canonical backend.

Fastify is approved as the pilot modular monolith by ADR-001. NestJS is a reviewed medium-term target, not an immediate migration. PostgreSQL is canonical transactional truth. ADR-002 governs the PostgreSQL UTG adapter and any later derived Neo4j layer. ADR-003 governs durable workflow adoption. The Trade Brain is an intelligence plane and does not own canonical state.

## 5. Authenticated browser boundary

ADR-004 defines the intended boundary: a thin Next.js BFF with secure, server-managed sessions.

The BFF may manage sessions, attach credentials, correlate requests, proxy SSE, normalize transport, and safely normalize errors. It may not contain domain decisions, Finance calculations, approval decisions, canonical state ownership, protected-action logic, agent authorization decisions, or provider-specific business policy.

Sensitive credentials, access tokens, refresh tokens, and private trade transcripts must not be stored in `localStorage`, `sessionStorage`, or IndexedDB. Authentication tokens must not appear in URL query strings except for an explicitly approved, short-lived, single-purpose signed artifact URL.

Current implementation evidence requiring remediation:

- Supabase session persistence and copied user access tokens use browser storage.
- partner access tokens use `localStorage`.
- SSE and file-download helpers put user tokens in query strings.
- external participant tokens are accepted from a page query string.
- Intelligence stream transcripts are persisted in `localStorage`.
- browser components call the application API directly rather than through a BFF.

These are observed compatibility risks, not approved patterns. C0.1 records them and changes no runtime behavior.

## 6. Agents and protected actions

A model or agent may analyse, assess, explain, recommend, draft, prepare evidence, and propose an action. It may not directly execute a protected action or directly mutate canonical Trade, Finance, Payment, Clearance, Approval, instrument, or escrow state.

Canonical execution requires typed validation, authorization, policy evaluation, idempotency where required, independent domain validation, human approval where required, audit evidence, and replayability. Reasoning and workflow execution remain separate architectural responsibilities.

Only identifiers that actually exist in the shared contract are recorded in `protected-actions.yaml`. That manifest is an evidence map, not permission by itself. Its discrepancies are release risks to remediate in scoped follow-up work.

## 7. Data and migrations

PostgreSQL is the canonical transactional source of truth. Every tenant-owned table requires explicit ownership, RLS, tenant-isolation tests, audit consideration, and retention consideration.

Migrations are additive by default. A destructive or irreversible migration requires an approved ADR, explicit migration approval, backup/recovery analysis, compatibility analysis, and rollback or forward-fix analysis. Database triggers may enforce integrity and audit invariants; they may not contain product workflow decisions.

## 8. Providers and customer-facing abstraction

Provider implementations remain behind provider-neutral ports and adapters. External providers adapt to TRAIBOX contracts; TRAIBOX contracts are not defined by provider schemas. Customer UI must not hardcode model-provider names, model identifiers, cloud-provider details, or internal infrastructure implementation details.

## 9. Development governance

An architecture deviation requires an ADR. One implementation agent authors a workstream; another may review it. Claude Code and Codex must not independently implement the same workstream in parallel.

Contributors stop and report contradictory authoritative instructions rather than selecting silently. Pull requests must identify governing specifications, source status, architecture, routes, protected actions, security/privacy, migrations/RLS, screen/component contracts, providers, validation, compatibility, rollback, and unresolved conflicts.

## 10. Recorded baseline conflicts

The following conflicts are evidence, not changes authorized by this PR:

1. The current navigation exposes Payments and Inbox as top-level workspaces, contrary to the seven-workspace model.
2. `/operations` and `/operations-center` are separate implemented screens; only Operations Center is canonical.
3. legacy `/intelligence/workspace`, `/finance/workspace`, `/network/workspace`, and `/clearance/workspace` routes remain implemented without redirects.
4. the Ch.17.A implementation copy calls itself active and the design tokens cite a missing Ch.17 section; ADR-005 activates Design System v2 while the missing chapters remain `PENDING_IMPORT`.
5. direct browser token storage, token-in-query transport, and direct API access conflict with ADR-004.
6. direct payment execution is catalogued as protected but does not bind an approved approval object; payment-intent execution does.
7. funding-offer acceptance is catalogued as protected and idempotent but creates an active reservation without approval binding.
8. the shared contract declares more protected actions than the API catalog annotates; proof share requests exist in Fastify but are absent from the executable endpoint catalog.

## 11. Pull-request and validation gate

Use `.github/pull_request_template.md`. Run applicable YAML parsing, formatting, lint, typecheck, tests, Trade Brain tests, Trade Brain evaluation, and build checks without production credentials. Report all failures and classify them as introduced, pre-existing, credential-related, tooling-related, or unrelated.

PR #26 is superseded historical context and not authority. PR #30 is an unmerged source branch and must not be merged or copied wholesale. Neither may be modified by governance work.

## 12. C0 dependency boundary

C0 work that depends on authoritative Ch.17 v3 or Ch.17.A includes final route canonicalization, approved per-screen behavior, component-contract enforcement, responsive requirements, and automated conformance rules. PR-C0.2 should implement a read-only conformance linter over the approved C0.1 manifests; it must not infer missing product specifications or silently “fix” runtime drift.
