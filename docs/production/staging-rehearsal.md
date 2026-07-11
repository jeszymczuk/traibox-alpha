# TRAIBOX Staging Deployment Rehearsal

Use this before inviting pilot users or promoting a pilot build.

The rehearsal proves four things together:

- Release gate passes against disposable infrastructure.
- Real staging env vars satisfy API and worker runtime policy.
- Migration preflight has explicit approval and fresh backup/restore evidence.
- Deployed staging responds to health/readiness/API catalog checks and the pilot onboarding smoke is covered.

## Local Fixture Rehearsal

This validates the rehearsal machinery without real secrets:

```sh
STAGING_REHEARSAL_FIXTURE=true pnpm staging:rehearsal
```

Fixture mode expects local Postgres at `postgres://postgres:postgres@localhost:54321/traibox` unless `DATABASE_URL` is set.

Fixture mode writes `artifacts/staging-rehearsals/latest.json` and should return `status: "warn"` because HTTP smoke is intentionally skipped and fixture credentials are not deployable.

## Real Staging Rehearsal

Run the secret audit first:

```sh
pnpm staging:secrets:check
pnpm staging:storage:check
```

Use `docs/production/staging-secret-audit.md` for the full env mapping.

Run the release gate against disposable Postgres first:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/traibox \
DATABASE_ENV=ci \
ALPHA_INTEGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/traibox \
pnpm release:gate:ci
```

Use the disposable Postgres port for the environment you are running in, for example `5432` in GitHub Actions or `54321` with this repo's local Docker Compose.

Do not point `ALPHA_INTEGRATION_DATABASE_URL` at the real staging database. The alpha scenario tests write fixture data.

Then run the staging rehearsal with real pilot env vars:

```sh
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/staging.yaml \
DATABASE_ENV=staging \
DB_PRODUCTION_LIKE=true \
DATABASE_URL="<staging postgres url>" \
AUTH_MODE=supabase \
SUPABASE_URL="<url>" \
SUPABASE_ANON_KEY="<anon key>" \
SUPABASE_SERVICE_ROLE_KEY="<service role>" \
PARTNER_JWT_SECRET="<secret>" \
ALLOW_PRODUCTION_MIGRATIONS=true \
MIGRATION_APPROVED_BY="<name/email>" \
BACKUP_RESTORE_CHECKED_AT="<ISO timestamp>" \
BACKUP_RESTORE_DRILL_ID="<restore drill id>" \
BACKUP_LOCATION="<backup system/location>" \
STAGING_API_BASE_URL="https://<api-domain>" \
STAGING_WEB_BASE_URL="https://<web-domain>" \
pnpm staging:rehearsal
```

The report is written to:

- `artifacts/staging-rehearsals/latest.json`
- `artifacts/staging-rehearsals/<timestamp>.json`

The report includes `operator_evidence`, an operator-facing go/no-go section:

- `ready_for_pilot_invitation` is `true` only for real staging rehearsals with no failing or skipped evidence items.
- `checklist` summarizes release gate evidence, API/worker runtime, backup/restore, migration preflight, deployment URLs, HTTP smoke, pilot onboarding smoke, and the timestamped rehearsal artifact.
- `next_operator_actions` lists exactly what must be fixed or attached before inviting pilot users.

Fixture reports are useful for testing the machinery, but `operator_evidence.ready_for_pilot_invitation` remains `false` in fixture mode.

To generate the human-readable summary locally after `pnpm staging:rehearsal`, run:

```sh
pnpm staging:gonogo:summary
```

This writes:

- `artifacts/staging-rehearsals/go-no-go-summary.md`

## Pass Criteria

- `status` is `pass`, or `warn` only for an explicitly accepted degraded-mode condition.
- Runtime API and worker reports do not contain `fail`.
- All six Supabase artifact buckets exist and are private.
- Backup/restore evidence is `pass`.
- Migration preflight is `pass` or has an accepted destructive-SQL warning with CTO approval.
- HTTP smoke passes for `/healthz`, `/readyz`, `/metrics`, `/v1/api/catalog`, and web `/`.
- Pilot onboarding smoke includes all core scenarios and reusable Trade Passport proof points.
- `operator_evidence.ready_for_pilot_invitation` is `true`, or every warning has an explicit operator acceptance recorded in the pilot go/no-go pack.

## Manual GitHub Action

Use `.github/workflows/staging-rehearsal.yml` to run the full rehearsal with repository secrets and workflow inputs.

When the workflow completes, download the `staging-gonogo-evidence-pack` artifact. It contains:

- staging rehearsal JSON reports
- secret audit JSON reports
- storage readiness JSON reports
- `go-no-go-summary.md`
- pilot readiness, onboarding, EU pilot, staging rehearsal, and secret audit runbooks

Required secrets:

- `STAGING_DATABASE_URL`
- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `STAGING_PARTNER_JWT_SECRET`

Provider-specific secrets are additional requirements only when a provider-enabled deployment profile is selected.
