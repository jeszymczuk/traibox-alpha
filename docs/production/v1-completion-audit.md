# TRAIBOX v1.0 Completion Audit (Blueprint v6.1)

Last updated: 2026-07-08
Repository baseline: `e736377`
Blueprint reference: TRAIBOX Blueprint v6.1 (7 workspaces + AI operating layer + governed execution + proof + memory + EU-first profile)

## 1) Current Execution Status

This audit tracks what is complete from the v1.0 completion program and what remains blocked outside code.

### Stage A — Staging Truth Setup

Status: `IN PROGRESS`

What passed locally:
- Main branch is synced with GitHub at `349a558` and PR #1 (`Complete blueprint-aligned frontend workspaces`) is merged.
- Latest GitHub CI on `main`: `PASS`.
- Local release gate: `PASS` (`typecheck`, `test`, `trade-brain tests`, `eval harness`, `build`).
- Migration guardrails dry-run: `PASS` (`V001..V010` applied, no pending migrations).
- Release gate CI: `PASS` (`typecheck`, `test`, `trade-brain tests`, `eval harness`, `build`, `alpha integration tests`).
- Staging fixture secret audit: `PASS`.
- Staging fixture rehearsal: `WARN` (expected warnings for degraded-mode signals and missing real staging URLs in fixture mode).
- GitHub staging readiness checker exists: `corepack pnpm staging:github:check`.
- Staging go/no-go evidence pack exists: `.github/workflows/staging-rehearsal.yml` uploads `staging-gonogo-evidence-pack`.
- Platform setup guide exists: `docs/production/real-staging-platform-setup.md`.
- GitHub secrets template exists: `docs/production/staging-github-secrets.template.txt`.

What is blocked (external runtime/secrets):
- GitHub Actions currently has no required `STAGING_*` staging secrets configured, so `corepack pnpm staging:github:check` correctly returns `FAIL`.
- Real profile checks (`eu-pilot`) fail without production-like env variables.
- Required runtime secrets/vars are not configured in this local shell for controlled pilot mode.
- Supabase/Fly/Vercel/TrueLayer/ComplyAdvantage/XDC staging values still need to be configured outside the repo.

Required envs for real staging checks:
- `DATABASE_URL`
- `AUTH_MODE` (must not be `dev` for controlled rollout)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`
- `TRUELAYER_CLIENT_ID`
- `TRUELAYER_CLIENT_SECRET`
- `TRUELAYER_WEBHOOK_SECRET`
- `COMPLYADVANTAGE_API_KEY`
- `EVM_RPC_URL`
- `EVM_ANCHOR_REGISTRY_ADDRESS`
- `EVM_ANCHOR_WALLET_PRIVATE_KEY`
- `PARTNER_JWT_SECRET`
- `STAGING_API_BASE_URL`
- `STAGING_WEB_BASE_URL`

Required GitHub Actions repository secret names:
- `STAGING_DATABASE_URL`
- `STAGING_SUPABASE_JWT_SECRET`
- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `STAGING_TRUELAYER_CLIENT_ID`
- `STAGING_TRUELAYER_CLIENT_SECRET`
- `STAGING_TRUELAYER_WEBHOOK_SECRET`
- `STAGING_COMPLYADVANTAGE_API_KEY`
- `STAGING_EVM_RPC_URL`
- `STAGING_EVM_ANCHOR_REGISTRY_ADDRESS`
- `STAGING_EVM_ANCHOR_WALLET_PRIVATE_KEY`
- `STAGING_PARTNER_JWT_SECRET`

### Stage B — Staging Rehearsal + Defect Closure

Status: `READY TO EXECUTE (after Stage A secret/platform setup)`

Runbook:
- `docs/production/staging-rehearsal.md`
- `docs/production/staging-secret-audit.md`
- `docs/production/real-staging-platform-setup.md`

Exit criteria:
- Health/readiness/smoke checks pass against deployed staging.
- No auth/webhook/provider wiring failures.
- Rehearsal status `PASS` with no blocking warnings.

### Stage C — Founder Story Validation (live staging)

Status: `READY TO EXECUTE (after Stage B)`

Required path:
- `/intelligence` -> `/trades` -> `/trade/<id>` -> `/operations` -> `/external-access` (+ `/alpha` internal control room)

Evidence to capture:
- Screenshot pack
- Trace IDs
- Proof bundle IDs
- Approval decision records
- Replay hash
- Operations digest artifacts

### Stage D — Controlled Pilot (3-5 SMEs/users)

Status: `READY TO EXECUTE (after Stage C)`

Runbook:
- `docs/pilot/onboarding-flow.md`

Required scenarios:
- `full_trade_room_loop`
- `standalone_payment`
- `standalone_clearance`
- `counterparty_onboarding_screening`
- `funding_request`
- `document_first`

### Stage E — Hardening Gates for Private Beta

Status: `PENDING`

Required completion:
- Observability drills (alerts, incident, rollback).
- Backup/restore evidence in production-like context.
- Tenant isolation and protected-action regression tests.
- External participant scope checks.
- Retention/privacy operational checks.

### Stage F — Private Beta -> v1.0

Status: `PENDING`

Promotion policy:
- Move to private beta only after Stage E is green.
- Move to v1.0 only after repeated core workflow reliability with real users and proven support/incident operations.

## 2) Blueprint v6.1 Benchmark Matrix

### Intelligence (Ch.5-9)
- Current: alpha depth implemented (Copilot actions, agent tasks, extraction/readiness hooks, eval surfaces).
- Remaining: production eval governance thresholds, replay review UX, latency/cost release budgets.

### Trades (Ch.10 + Ch.4)
- Current: full lifecycle reference flow implemented.
- Remaining: UX determinism and failure guardrails at staging/pilot scale.

### Finance / Network / Clearance (Ch.11-13)
- Current: thin-but-real standalone + attachable flows implemented.
- Remaining: real provider reliability and corridor QA in staging.

### Operations Center (Ch.14)
- Current: approvals/tasks/evals/memory/event cockpit implemented.
- Remaining: operator-grade prioritization and alert tuning under pilot load.

### Settings / Governance / Security (Ch.15/18/30)
- Current: protected-action controls and policy surfaces implemented.
- Remaining: governance evidence and periodic audit controls in live environments.

### Platform Systems (Ch.16-25)
- Current: alpha stack operational with DB, APIs, workflows, proof/eval harness.
- Remaining: staging deployment proof, webhook reliability, rollback/restore drill completion.

## 3) Commands Run in This Audit

- `DATABASE_URL=postgres://postgres:postgres@localhost:54321/traibox DATABASE_ENV=ci corepack pnpm db:migrate:dry-run`
- `DATABASE_URL=postgres://postgres:postgres@localhost:54321/traibox DATABASE_ENV=ci ALPHA_INTEGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:54321/traibox corepack pnpm release:gate:ci`
- `STAGING_REHEARSAL_FIXTURE=true corepack pnpm staging:rehearsal`
- `STAGING_SECRET_AUDIT_FIXTURE=true corepack pnpm staging:secrets:check`
- `DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml RUNTIME_TARGET=api corepack pnpm pilot:check` (expected fail without real envs)
- `DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml RUNTIME_TARGET=worker corepack pnpm pilot:check` (expected fail without real envs)

## 4) Next Action List (Strict Order)

1. Follow `docs/production/real-staging-platform-setup.md` to configure Supabase, Fly API, Fly worker, Vercel, TrueLayer, ComplyAdvantage, XDC/EVM anchoring, and GitHub Actions secrets.
2. Use `docs/production/staging-github-secrets.template.txt` as a placeholder-only checklist while entering real GitHub secret values.
3. Run `corepack pnpm staging:github:check` until GitHub secret-name readiness passes.
4. Re-run `pilot:check` (`api`, `worker`) with real staging envs until both pass.
5. Run real staging secret audit (not fixture).
6. Deploy API/worker/web + migrations to staging.
7. Run full staging rehearsal (real URLs), close all blocking failures, and download `staging-gonogo-evidence-pack`.
8. Execute founder story on staging and attach screenshots, trace IDs, proof IDs, approval records, replay hash, and Operations digest output.
9. Start controlled pilot with 3-5 users and close defects by severity.
10. Complete hardening gates (alerts, rollback, restore, governance checks).
11. Promote to private beta.
12. Promote to v1.0 only after beta reliability and support readiness thresholds are met.
