# TRAIBOX v1.0 Completion Audit (Blueprint v6.1)

Last updated: 2026-07-11

Repository baseline: `68fcf41`

Blueprint reference: TRAIBOX Blueprint v6.1

## 1. Executive Status

TRAIBOX is a broad internal alpha with the seven blueprint workspaces, typed standalone and trade-bound workflows, governed approvals, proof, memory, agent/eval infrastructure, and provider-neutral execution rails. The remaining path to private beta is primarily real-environment validation, deployment, integration hardening, and pilot evidence rather than greenfield product invention.

Current environment truth:

- GitHub `main` is synchronized and the latest CI is green.
- Fly API `traibox-api` is deployed in `cdg`; `/healthz`, `/readyz`, and `/metrics` pass.
- Supabase staging has all 11 migrations, 47 public tables, FORCE RLS on all 44 tenant tables, and policies on every RLS table.
- All six required Supabase artifact buckets exist and are private.
- All six alpha scenarios pass through the deployed API, producing queryable object, memory, proof, and trace records.
- Fly worker app exists but is intentionally not deployed.
- Staging web and Trade Brain are not deployed.
- GitHub Actions core staging secrets are configured and `staging:github:check` passes.
- External provider credentials are intentionally not required by the core `staging.yaml` profile.
- TrueLayer, iBanFirst, ComplyAdvantage, and XDC remain optional adapters activated by provider-enabled pilot profiles.

## 2. Completion Stages

### Stage A - Staging Truth Setup

Status: `IN PROGRESS`

Completed:

- Repository publishing, branch protections, and normal CI.
- Fly API production bundle/startup blocker fixed.
- API deployed and healthy in an active EU region.
- Supabase migrations, RLS policies, private buckets, backup/restore evidence, and six live scenarios validated.
- GitHub staging readiness passes with optional external providers intentionally disabled.
- Provider-neutral payment adapter layer and provenance surfaces implemented.
- Profile-aware secret, runtime, rehearsal, and go/no-go tooling implemented.

Remaining:

1. Merge the modern Supabase auth and storage readiness gate.
2. Synchronize the validated Supabase URL, publishable key, service key, and partner JWT into the Fly API.
3. Re-run physical document upload/download and document-pack round-trip checks.
4. Deploy the web application and configure API CORS/web URLs.
5. Deploy and validate Trade Brain and its eval gates.
6. Validate worker safety and obtain explicit CTO approval immediately before worker deployment.

Exit criteria:

- GitHub staging readiness passes.
- API and worker profile checks contain no failures.
- Migration dry-run and backup/restore guard pass.
- Web, API, storage, auth, and scenario runtime are validated.

### Stage B - Staging Rehearsal and Defect Closure

Status: `BLOCKED BY STAGE A`

Required:

- Run `.github/workflows/staging-rehearsal.yml` with real URLs and fresh restore evidence.
- Pass health/readiness/metrics, API catalog, web smoke, migrations, auth, SSE, and scenario checks.
- Fix every blocking defect and rerun until the evidence pack is GO or all warnings have named acceptance.

### Stage C - Founder Story Validation

Status: `READY AFTER STAGE B`

Required live path:

`/intelligence` -> `/trades` -> `/trade/<id>` -> `/operations` -> `/external-access` -> `/alpha`

Evidence pack:

- screenshots
- trace and replay IDs
- approval decisions
- proof bundle and manifest IDs
- Operations digest output
- standalone-to-Trade-Room attachment evidence

### Stage D - Controlled Pilot

Status: `READY AFTER STAGE C`

Run with 3-5 SMEs using isolated organizations and all six alpha scenarios:

- full Trade Room loop
- standalone payment
- standalone clearance
- counterparty onboarding and screening
- funding request
- document-first flow

Each scenario must cover happy, missing-data, blocked/risky, permission, approval, degraded, and replay paths.

### Stage E - Private Beta Hardening

Status: `PENDING`

Required gates:

- tenant isolation and external participant scope regression
- protected-action and step-up enforcement
- alert, incident, rollback, and restore drills
- retention/privacy and access review evidence
- latency, cost, workflow completion, and AI quality budgets
- no critical pilot defects

### Stage F - Private Beta to v1.0

Status: `PENDING`

Promote only after real users repeatedly complete core workflows, reliability targets hold, and support/incident procedures are proven. v1.0 is operationally reliable and pilot-proven, not feature-maximal.

## 3. Blueprint Benchmark

### Intelligence

Alpha capability exists for Copilot actions, governed agent tasks, document/readiness hooks, structured outputs, traces, replay, and eval reporting. Remaining work is deployed Trade Brain validation, release thresholds, latency/cost budgets, and pilot quality evidence.

### Trades

The Trade Room is the reference implementation with intent, documents, readiness, approvals, finance/clearance actions, proof, memory, and timeline. Remaining work is staging failure-path QA and deterministic next-best-action tuning.

### Finance, Network, and Clearance

Standalone and attachable flows exist at alpha depth. Remaining work is real-environment workflow completion QA and selective provider activation after access is approved.

### Operations Center

Approvals, blocked work, agents, quality/eval signals, memory, and provider evidence are surfaced. Remaining work is live triage ordering, digest tuning, and incident-oriented pilot validation.

### Governance and Security

RBAC/ABAC foundations, protected actions, external scopes, audit, proof, and retention configuration exist. Remaining work is production-like evidence: tenant tests, access reviews, restore/rollback, privacy operations, and alert drills.

### Platform

Postgres, outbox/SSE, object storage contracts, Temporal foundations, Trade Brain, Neo4j/UTG foundations, and provider adapters exist in the repo. Remaining work is deployed runtime validation and operational reliability.

## 4. Strict Next Actions

1. Complete live browser login and API-backed workspace smoke checks on `https://traibox-alpha-web.vercel.app`.
2. Add the GitHub Login Connection to Vercel and verify automatic preview/production deployment linkage.
3. Deploy Trade Brain and run real API/eval integration gates.
4. Review worker startup, idempotency, Temporal recovery, and duplicate-job safety; request CTO approval before deployment.
5. Activate Fly billing before continuous worker operation or pilot use.
6. Run the complete staging rehearsal and close defects.
7. Execute the founder story and create the evidence pack.
8. Run the 3-5 user controlled pilot.
9. Complete private-beta hardening gates.
10. Promote to private beta, then v1.0 only after measured reliability.

## 5. Non-Negotiable Boundaries

- Do not couple canonical TRAIBOX objects to a payment, screening, or ledger vendor.
- Do not execute protected actions without explicit human approval.
- Do not deploy the worker without explicit approval after its safety review.
- Do not write PII or commercial document content on-chain.
- Do not treat fixture/demo output as staging or pilot evidence.
- Do not invite pilot users while the go/no-go evidence says NO-GO.
