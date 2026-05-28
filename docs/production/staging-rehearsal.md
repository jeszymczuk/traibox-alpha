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
SUPABASE_JWT_SECRET="<secret>" \
SUPABASE_URL="<url>" \
SUPABASE_ANON_KEY="<anon key>" \
SUPABASE_SERVICE_ROLE_KEY="<service role>" \
TRUELAYER_CLIENT_ID="<id>" \
TRUELAYER_CLIENT_SECRET="<secret>" \
TRUELAYER_WEBHOOK_SECRET="<secret>" \
COMPLYADVANTAGE_API_KEY="<key>" \
EVM_RPC_URL="<url>" \
EVM_ANCHOR_REGISTRY_ADDRESS="<address>" \
EVM_ANCHOR_WALLET_PRIVATE_KEY="<secret>" \
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

## Pass Criteria

- `status` is `pass`, or `warn` only for an explicitly accepted degraded-mode condition.
- Runtime API and worker reports do not contain `fail`.
- Backup/restore evidence is `pass`.
- Migration preflight is `pass` or has an accepted destructive-SQL warning with CTO approval.
- HTTP smoke passes for `/healthz`, `/readyz`, `/metrics`, `/v1/api/catalog`, and web `/`.
- Pilot onboarding smoke includes all core scenarios and reusable Trade Passport proof points.

## Manual GitHub Action

Use `.github/workflows/staging-rehearsal.yml` to run the full rehearsal with repository secrets and workflow inputs.

Required secrets:

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
