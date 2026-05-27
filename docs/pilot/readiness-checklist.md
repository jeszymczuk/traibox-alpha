# TRAIBOX Controlled Pilot Readiness Checklist

Use this checklist before inviting pilot users into a new environment.

## 1. Runtime Preflight

Run the profile-aware preflight for each service target:

```sh
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml RUNTIME_TARGET=api pnpm pilot:check
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml RUNTIME_TARGET=worker pnpm pilot:check
```

The check must return `status: "pass"` or an explicitly accepted `status: "warn"`.

Do not proceed with `status: "fail"`.

## 2. Health And Readiness

Check the deployed API:

```sh
curl https://<api-domain>/healthz
curl https://<api-domain>/readyz
curl https://<api-domain>/metrics
```

Expected:

- `/healthz` responds with service, profile, region, runtime status, degraded-mode flag, and uptime.
- `/readyz` confirms database reachability and runtime env validation.
- `/metrics` exposes runtime status, degraded mode, uptime, and runtime check failures.

## 3. Release Gates

Run:

```sh
pnpm release:gate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/traibox pnpm db:migrate:dry-run
```

CI must also pass:

- TypeScript typechecks.
- Unit and contract tests.
- Trade Brain tests.
- Trade Brain eval gate.
- Migration preflight against disposable Postgres.
- Real Postgres alpha scenario tests.
- Production build.

## 4. Backup And Migration Evidence

Before staging or production-like promotion, record fresh backup/restore evidence:

```sh
BACKUP_RESTORE_CHECKED_AT="<ISO timestamp>" \
BACKUP_RESTORE_DRILL_ID="<restore drill id>" \
BACKUP_LOCATION="<backup system/location>" \
pnpm db:backup:check
```

Production-like migrations require `ALLOW_PRODUCTION_MIGRATIONS=true`, `MIGRATION_APPROVED_BY`, and current backup/restore evidence.

## 5. Pilot Story Smoke

Run or demonstrate:

- Full Trade Room loop.
- Standalone payment.
- Standalone clearance check.
- Counterparty onboarding and screening.
- Funding request.
- Document-first flow.
- Standalone object attached to Trade Room.
- Proof bundle generated and verified.
- Operations Center updated.

## 6. Pilot Onboarding

Before inviting users, follow `docs/pilot/onboarding-flow.md`.

Confirm:

- Organization owner is assigned.
- Role-scoped users are created.
- Approval policy is visible.
- External participant access is scoped and expiring.
- First-session guided story is scheduled.

## 7. Degraded Mode Rules

If a provider is unavailable:

- Use manual payment fallback instead of blocking the pilot.
- Use partner-submitted finance offers instead of demo offers.
- Keep deterministic Trade Brain available when LLM mode is disabled.
- Record the degraded path in Operations Center, audit, proof, and Trade Memory.
