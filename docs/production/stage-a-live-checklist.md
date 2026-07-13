# TRAIBOX Stage A Live Checklist (Staging Truth Setup)

Purpose: move from local/fixture validation to real staging validation for TRAIBOX alpha -> beta readiness.

This checklist is execution-only. Do these steps in order, and do not skip validation commands.

For a platform-by-platform setup guide, use `docs/production/real-staging-platform-setup.md`.
For a placeholder-only GitHub secrets template, use `docs/production/staging-github-secrets.template.txt`.

---

## 1) Canonical staging variables (single source)

Use these exact names in deployed runtimes such as Fly.io, Vercel, Supabase-backed services, and local shell preflights.

Important: GitHub Actions uses `STAGING_*` repository secret names and maps them into these canonical runtime env names inside `.github/workflows/staging-rehearsal.yml`. Use section 4 for the exact GitHub secret names.

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
- `SUPABASE_JWT_SECRET` (optional legacy HS256 verifier; not required for modern Supabase projects)

### Banking / payments
Required values depend on `payments.active_provider`.

For `active_provider: truelayer`:
- `TRUELAYER_CLIENT_ID`
- `TRUELAYER_CLIENT_SECRET`
- `TRUELAYER_WEBHOOK_SECRET`

For `active_provider: ibanfirst`:
- `IBANFIRST_API_KEY`
- `IBANFIRST_WEBHOOK_SECRET`

For `active_provider: manual`, no payment-provider secret is required.

### Compliance
Required only when the selected profile enables ComplyAdvantage:
- `COMPLYADVANTAGE_API_KEY`

### Ledger / anchoring
Required only when `ledger.anchoring.enabled: true` and `adapter: evm_event`:
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

If any platform step is unclear, stop and use `docs/production/real-staging-platform-setup.md` before continuing.

After adding GitHub Actions secrets, verify the repo-side secret map without exposing values:

```bash
corepack pnpm staging:github:check
```

Expected:
- status `pass`
- no missing `STAGING_*` GitHub secrets
- workflow inputs listed for the manual rehearsal run

---

## 3) Fill-and-run commands

Run from repo root: `/Users/jerochas/Documents/New project`

### A) Local preflight with real staging env (no fixture mode)

```bash
export DATABASE_URL='<staging postgres url>'
export AUTH_MODE='supabase'
export DEPLOYMENT_PROFILE_PATH='packages/profiles/profiles/staging.yaml'
export SUPABASE_URL='https://<project>.supabase.co'
export SUPABASE_ANON_KEY='<publishable-or-anon-key>'
export SUPABASE_SERVICE_ROLE_KEY='<service-role-key>'
export PARTNER_JWT_SECRET='<partner-jwt-secret>'
export STAGING_API_BASE_URL='https://<staging-api-domain>'
export STAGING_WEB_BASE_URL='https://<staging-web-domain>'
```

```bash
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/staging.yaml RUNTIME_TARGET=api corepack pnpm pilot:check
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/staging.yaml RUNTIME_TARGET=worker corepack pnpm pilot:check
corepack pnpm staging:secrets:check
corepack pnpm staging:storage:check
```

Expected:
- `pilot:check` has no `fail` for either `api` or `worker`; an explicit degraded-mode `warn` is acceptable while optional providers and LLM mode are disabled
- `staging:secrets:check` = `pass` with no missing required envs
- `staging:storage:check` = `pass` with all six required buckets private

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

Configure these repository secrets to match staging. These are secret *names only*; do not commit values.

- `STAGING_DATABASE_URL`
- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `STAGING_PARTNER_JWT_SECRET`

Provider-specific GitHub secrets are required only when the selected profile activates that provider. The provider-enabled profiles remain `eu-pilot.yaml` and `iberia-pilot.yaml`.

Do not configure restore evidence or staging URLs as long-lived GitHub secrets. The staging rehearsal workflow receives them as manual `workflow_dispatch` inputs so every rehearsal records fresh operator evidence:

- `api_base_url`
- `web_base_url`
- `backup_restore_checked_at`
- `backup_restore_drill_id`
- `backup_location`
- `migration_approved_by` (optional)
- `allow_pending_migrations`

After setting them, run:
- `corepack pnpm staging:github:check`
- `.github/workflows/staging-rehearsal.yml`

After the GitHub workflow completes, download the `staging-gonogo-evidence-pack` artifact and confirm:

- `go-no-go-summary.md` exists.
- `artifacts/staging-rehearsals/latest.json` includes `operator_evidence.ready_for_pilot_invitation`.
- no pilot users are invited until the summary is GO, or every warning has a named operator acceptance.

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
- server-only `TRAIBOX_API_BASE_URL`
- server-only `SUPABASE_URL`
- server-only `SUPABASE_ANON_KEY`
- server-only `DATABASE_URL` and `BROWSER_SESSION_KEYS`
- exact `BROWSER_ALLOWED_ORIGINS`

---

## 6) Stage A exit criteria (must all be true)

- `pilot:check` has no failures (`api` + `worker`) against real staging env values.
- `staging:secrets:check` passes (non-fixture mode).
- `staging:storage:check` passes against Supabase.
- migration dry-run passes for staging with restore evidence guard.
- `release:gate:ci` passes with staging DB integration.
- `staging:rehearsal` passes against real staging URLs.
- `staging-gonogo-evidence-pack` has been downloaded and attached to the pilot go/no-go decision.

If any single item fails, Stage A is not complete.

---

## 7) Immediate next step after Stage A

Move to Stage B:
- execute full staging rehearsal loop
- fix defects
- rerun until green
- then run Founder Story validation on live staging
