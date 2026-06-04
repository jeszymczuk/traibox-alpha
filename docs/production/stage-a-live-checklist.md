# TRAIBOX Stage A Live Checklist (Staging Truth Setup)

Purpose: move from local/fixture validation to real staging validation for TRAIBOX alpha -> beta readiness.

This checklist is execution-only. Do these steps in order, and do not skip validation commands.

---

## 1) Canonical staging variables (single source)

Use these exact names across GitHub, Fly.io, and Vercel.

### Core runtime
- `DATABASE_URL`
- `AUTH_MODE` (`supabase` for staging)
- `DEPLOYMENT_PROFILE_PATH` (`packages/profiles/profiles/staging.yaml`)
- `API_BASE_URL`
- `WEB_BASE_URL`
- `CORS_ORIGIN`

### Supabase
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (web/public)
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `SUPABASE_JWT_SECRET` (server only)

### Banking / payments
- `TRUELAYER_CLIENT_ID`
- `TRUELAYER_CLIENT_SECRET`
- `TRUELAYER_WEBHOOK_SECRET`

### Compliance
- `COMPLYADVANTAGE_API_KEY`

### Ledger / anchoring
- `EVM_RPC_URL`
- `EVM_ANCHOR_REGISTRY_ADDRESS`
- `EVM_ANCHOR_WALLET_PRIVATE_KEY`

### Partner / governance
- `PARTNER_JWT_SECRET`
- `ADMIN_BOOTSTRAP_SECRET`

### Migration safety / restore evidence
- `ALLOW_PRODUCTION_MIGRATIONS` (`true` for production-like migration run)
- `MIGRATION_APPROVED_BY`
- `BACKUP_RESTORE_CHECKED_AT` (ISO datetime)
- `BACKUP_RESTORE_DRILL_ID`
- `BACKUP_LOCATION`

### Staging rehearsal smoke URLs
- `STAGING_API_BASE_URL`
- `STAGING_WEB_BASE_URL`

---

## 2) Platform setup order

1. Supabase (EU project + DB URL + storage buckets + auth keys)
2. Fly API app (all server secrets)
3. Fly worker app (worker-required subset)
4. Vercel web app (public web envs)
5. GitHub Actions secrets (for CI/rehearsal workflows)

Do not start rehearsal until all five are done.

---

## 3) Fill-and-run commands

Run from repo root: `/Users/jerochas/Documents/New project`

### A) Local preflight with real staging env (no fixture mode)

```bash
export DATABASE_URL='<staging postgres url>'
export AUTH_MODE='supabase'
export DEPLOYMENT_PROFILE_PATH='packages/profiles/profiles/staging.yaml'
export SUPABASE_URL='https://<project>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
export SUPABASE_JWT_SECRET='<jwt-secret>'
export TRUELAYER_CLIENT_ID='<client-id>'
export TRUELAYER_CLIENT_SECRET='<client-secret>'
export TRUELAYER_WEBHOOK_SECRET='<webhook-secret>'
export COMPLYADVANTAGE_API_KEY='<complyadvantage-key>'
export EVM_RPC_URL='<rpc-url>'
export EVM_ANCHOR_REGISTRY_ADDRESS='<registry-address>'
export EVM_ANCHOR_WALLET_PRIVATE_KEY='<wallet-private-key>'
export PARTNER_JWT_SECRET='<partner-jwt-secret>'
export STAGING_API_BASE_URL='https://<staging-api-domain>'
export STAGING_WEB_BASE_URL='https://<staging-web-domain>'
```

```bash
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/staging.yaml RUNTIME_TARGET=api corepack pnpm pilot:check
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/staging.yaml RUNTIME_TARGET=worker corepack pnpm pilot:check
corepack pnpm staging:secrets:check
```

Expected:
- `pilot:check` = `pass` for both `api` and `worker`
- `staging:secrets:check` = `pass` with no missing required envs

### B) Migration safety gate (production-like)

```bash
export ALLOW_PRODUCTION_MIGRATIONS='true'
export MIGRATION_APPROVED_BY='<name-or-email>'
export BACKUP_RESTORE_CHECKED_AT='<ISO datetime>'
export BACKUP_RESTORE_DRILL_ID='<restore-drill-id>'
export BACKUP_LOCATION='<backup-location>'
```

```bash
DATABASE_ENV=staging corepack pnpm db:migrate:dry-run
```

If pending migrations exist and dry-run is clean, then:

```bash
DATABASE_ENV=staging corepack pnpm db:migrate
```

### C) Release gate with real staging DB integration tests

```bash
export ALPHA_INTEGRATION_DATABASE_URL="$DATABASE_URL"
DATABASE_ENV=staging corepack pnpm release:gate:ci
```

Expected:
- full `release:gate:ci` pass

### D) Real staging rehearsal (no fixture)

```bash
corepack pnpm staging:rehearsal
```

Expected:
- status `pass`
- no blocked health/readiness/smoke checks

Artifacts generated:
- `artifacts/staging-secret-audits/latest.json`
- `artifacts/staging-rehearsals/latest.json`

---

## 4) GitHub Actions secrets (minimum set)

Configure these repository secrets to match staging:

- `DATABASE_URL`
- `AUTH_MODE`
- `DEPLOYMENT_PROFILE_PATH`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
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
- `ADMIN_BOOTSTRAP_SECRET`
- `ALLOW_PRODUCTION_MIGRATIONS`
- `MIGRATION_APPROVED_BY`
- `BACKUP_RESTORE_CHECKED_AT`
- `BACKUP_RESTORE_DRILL_ID`
- `BACKUP_LOCATION`
- `STAGING_API_BASE_URL`
- `STAGING_WEB_BASE_URL`

After setting them, run:
- `.github/workflows/staging-rehearsal.yml`

---

## 5) Fly/Vercel target mapping

### Fly API app
- All server-side keys above
- `CORS_ORIGIN` = staging web URL
- `WEB_BASE_URL` and `API_BASE_URL` set to staging domains

### Fly worker app
- DB + profile + provider + ledger + storage keys needed by jobs
- no public web keys required

### Vercel web app
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## 6) Stage A exit criteria (must all be true)

- `pilot:check` passes (`api` + `worker`) against real staging env values.
- `staging:secrets:check` passes (non-fixture mode).
- migration dry-run passes for staging with restore evidence guard.
- `release:gate:ci` passes with staging DB integration.
- `staging:rehearsal` passes against real staging URLs.

If any single item fails, Stage A is not complete.

---

## 7) Immediate next step after Stage A

Move to Stage B:
- execute full staging rehearsal loop
- fix defects
- rerun until green
- then run Founder Story validation on live staging
