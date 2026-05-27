# TRAIBOX Production Release Safety

This checklist governs promotion from internal alpha/pilot into a production-like environment.

## Release Gates

Run:

```sh
pnpm release:gate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/traibox pnpm db:migrate:dry-run
```

CI/release workers with disposable Postgres can run the combined gate:

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/traibox \
ALPHA_INTEGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/traibox \
pnpm release:gate:ci
```

The release is blocked unless these pass:

- TypeScript typechecks.
- Unit and contract tests.
- Trade Brain tests.
- Trade Brain eval gate.
- Production build.
- Migration preflight.
- Real Postgres alpha scenario tests in CI.

## Runtime Preflight

Run once per service target:

```sh
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml RUNTIME_TARGET=api pnpm pilot:check
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml RUNTIME_TARGET=worker pnpm pilot:check
```

`status: "fail"` blocks release.

`status: "warn"` is allowed only when the degraded-mode path is explicitly accepted in the release note.

## Migration Safety

Before applying migrations to staging or production:

```sh
NODE_ENV=production DATABASE_URL="<url>" pnpm db:migrate:dry-run
```

Production-like migration runs require:

- `ALLOW_PRODUCTION_MIGRATIONS=true`
- `MIGRATION_APPROVED_BY=<name/email>`
- `BACKUP_RESTORE_CHECKED_AT=<ISO timestamp>`
- `BACKUP_RESTORE_DRILL_ID=<restore drill id>`
- `BACKUP_LOCATION=<backup system/location>`

Then run:

```sh
NODE_ENV=production \
ALLOW_PRODUCTION_MIGRATIONS=true \
MIGRATION_APPROVED_BY="<name/email>" \
BACKUP_RESTORE_CHECKED_AT="<ISO timestamp>" \
BACKUP_RESTORE_DRILL_ID="<id>" \
BACKUP_LOCATION="<location>" \
DATABASE_URL="<url>" \
pnpm db:migrate
```

Run the backup/restore evidence check independently when preparing a release note:

```sh
BACKUP_RESTORE_CHECKED_AT="<ISO timestamp>" \
BACKUP_RESTORE_DRILL_ID="<id>" \
BACKUP_LOCATION="<location>" \
pnpm db:backup:check
```

## Post-Deploy Smoke

Verify:

```sh
curl https://<api-domain>/healthz
curl https://<api-domain>/readyz
curl https://<api-domain>/metrics
curl https://<api-domain>/v1/api/catalog
```

Then run one controlled pilot story:

- Full Trade Room loop.
- Document upload and extraction.
- Readiness state.
- Approval.
- Proof bundle.
- Operations Center update.
- Standalone object attached to Trade Room.

## Rollback Policy

Rollback application code first.

Do not rollback database migrations unless a dedicated down-migration has been reviewed and a fresh backup/restore drill exists.

If a migration caused data-quality issues, prefer a forward repair migration with audit notes.
