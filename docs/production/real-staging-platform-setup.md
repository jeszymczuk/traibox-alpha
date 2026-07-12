# TRAIBOX Real Staging Platform Setup

Use this when moving from local/fixture alpha validation to a real staging environment.

This is the operator guide for moving the core alpha into real staging. The baseline `staging.yaml` profile intentionally uses manual payment execution, internal screening workflows, and unanchored verifiable proof bundles. TrueLayer, iBanFirst, ComplyAdvantage, and XDC remain provider adapters that are activated only in a provider-enabled pilot profile after commercial and technical access is approved.

## Current Staging Status

Verified on 2026-07-12:

- Supabase EU migrations `V001` through `V011`, RLS coverage, all six private storage buckets, modern token verification, and artifact round trips are validated.
- Fly API is deployed in `cdg`; `/healthz`, `/readyz`, `/metrics`, live CORS, all six alpha scenarios, and the real auth/document/proof path pass.
- Vercel staging web is deployed at `https://traibox-alpha-web.vercel.app` with the live Fly API and Supabase public configuration.
- GitHub Actions core `STAGING_*` secrets pass readiness checks, and the live API/web URLs are recorded as repository variables.
- Fly worker app exists but is intentionally not deployed yet.
- Trade Brain is container-validated but not deployed yet; the API remains in deterministic fallback mode.
- Vercel is not yet connected to GitHub for automatic deployments because the Vercel account still needs a GitHub Login Connection.
- The Fly account is trial-limited and stops machines after five minutes; activate billing before continuous worker operation or controlled pilot use.

Stage A is not complete until the remaining runtime and rehearsal evidence is green:

- `corepack pnpm staging:github:check` passes.
- `.github/workflows/staging-rehearsal.yml` produces `staging-gonogo-evidence-pack`.

## Platform Setup Order

Do these in order. Each later platform depends on values created earlier.

1. Supabase
2. Fly API validation
3. Vercel web
4. Fly Trade Brain
5. GitHub Actions core secrets and runtime URLs
6. Database/migration and staging rehearsal workflow
7. Fly worker, only after worker safety validation and CTO approval
8. Optional provider adapters, only when their pilot profile is selected

## 1. Supabase

Create a Supabase project in an EU region.

Collect these values:

- `SUPABASE_URL`: usually `https://<project-ref>.supabase.co`.
- `SUPABASE_ANON_KEY`: Supabase may show this as a publishable key on newer projects, or as legacy `anon`.
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase may show this as a secret key on newer projects, or as legacy `service_role`.
- `SUPABASE_JWT_SECRET`: optional legacy HS256 verifier only. Modern projects use the project URL plus publishable/anon key and authoritative Supabase user verification.
- `DATABASE_URL`: direct Postgres connection string. Add `?sslmode=require` if not already present.

Create private storage buckets:

- `evidence`
- `reports`
- `bundles`
- `exports`
- `documents`
- `document-packs`

Verify all six buckets exist and remain private:

```sh
corepack pnpm staging:storage:check
```

Do not paste Supabase secret values into chat or commit them to Git.

## 2. Fly API

Create the API app in an active EU region. TRAIBOX currently uses Paris (`cdg`):

```sh
fly apps create traibox-api
```

Set API secrets:

```sh
fly secrets set \
  DATABASE_URL="<supabase-postgres-url>" \
  DEPLOYMENT_PROFILE_PATH="/app/packages/profiles/profiles/staging.yaml" \
  AUTH_MODE="supabase" \
  SUPABASE_URL="<supabase-url>" \
  SUPABASE_ANON_KEY="<supabase-publishable-or-anon-key>" \
  SUPABASE_SERVICE_ROLE_KEY="<supabase-service-role-key>" \
  PARTNER_JWT_SECRET="<partner-jwt-secret>" \
  ADMIN_BOOTSTRAP_SECRET="<admin-bootstrap-secret>" \
  CORS_ORIGIN="https://<vercel-staging-domain>" \
  WEB_BASE_URL="https://<vercel-staging-domain>" \
  API_BASE_URL="https://<fly-api-domain>"
```

Deploy:

```sh
fly deploy --config apps/api/fly.toml
```

Verify:

```sh
curl https://<fly-api-domain>/healthz
curl https://<fly-api-domain>/readyz
curl https://<fly-api-domain>/metrics
```

## 3. Fly Worker

Create the worker app:

```sh
fly apps create traibox-worker
```

Set worker secrets. Use the same values as the API where applicable:

```sh
fly secrets set \
  DATABASE_URL="<supabase-postgres-url>" \
  DEPLOYMENT_PROFILE_PATH="/app/packages/profiles/profiles/staging.yaml" \
  AUTH_MODE="supabase" \
  SUPABASE_URL="<supabase-url>" \
  SUPABASE_ANON_KEY="<supabase-publishable-or-anon-key>" \
  SUPABASE_SERVICE_ROLE_KEY="<supabase-service-role-key>" \
  PARTNER_JWT_SECRET="<partner-jwt-secret>"
```

Deploy:

```sh
fly deploy --config apps/worker/fly.toml
```

The worker has no public web URL. Do not deploy it until worker startup, Temporal/recovery behavior, and duplicate-job safety have passed review.

## 4. Vercel Web

Create/import the project in Vercel.

Set:

- Root directory: `apps/web`
- Build command: default or repo build command
- Output: Next.js default

Set Vercel environment variables:

```txt
NEXT_PUBLIC_API_BASE_URL=https://<fly-api-domain>
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-publishable-or-anon-key>
```

Deploy and keep the staging web URL. It becomes:

- `STAGING_WEB_BASE_URL`
- `WEB_BASE_URL`
- `CORS_ORIGIN`

## 5. Fly Trade Brain

Create `traibox-trade-brain`, generate one strong service token without printing it, and set the same token on the Trade Brain and API apps. From the repository root, deploy with `fly deploy apps/trade-brain --config fly.toml` so Fly uses the service directory as the Docker build context. Then configure the API with:

```txt
TRADE_BRAIN_URL=https://traibox-trade-brain.fly.dev
TRADE_BRAIN_SERVICE_TOKEN=<same-strong-service-token>
TRADE_BRAIN_TIMEOUT_MS=8000
```

The service must pass public `/health`, reject unauthenticated `/v1/*` requests, and return all versioned eval suites for an authenticated API request. LLM enrichment remains off until a reviewed model-provider key and eval threshold are configured.

## 6. Optional Provider Activation

Do not block core staging on uncontracted providers. When a provider-enabled profile is intentionally selected, configure the matching adapter. For TrueLayer, configure:

- Redirect URL: `https://<vercel-staging-domain>/banks/callback`
- Payments webhook: `https://<fly-api-domain>/webhooks/payments`
- Consents webhook: `https://<fly-api-domain>/webhooks/consents`

The webhook signing secret must match:

- Fly API `TRUELAYER_WEBHOOK_SECRET`
- Fly worker `TRUELAYER_WEBHOOK_SECRET`
- GitHub `STAGING_TRUELAYER_WEBHOOK_SECRET`

If TrueLayer is not ready, keep `staging.yaml` selected and do not demo live provider execution. ComplyAdvantage and XDC/EVM credentials are likewise required only when their profile switches are enabled.

## 7. GitHub Actions Secrets

In GitHub, open:

`Settings -> Secrets and variables -> Actions -> New repository secret`

Create one secret for each name in:

`docs/production/staging-github-secrets.template.txt`

Create these repository variables under the same Actions settings page:

- `STAGING_API_BASE_URL`
- `STAGING_WEB_BASE_URL`
- `STAGING_TRADE_BRAIN_URL`

Then run:

```sh
corepack pnpm staging:github:check
```

Expected:

- `status: "pass"`
- `missing_secrets: []`
- `missing_variables: []`
- `provider_readiness` shows the manual rail as `ready` and unconfigured providers as intentional `planned` or `disabled` states.

## 8. Staging Rehearsal

Run the GitHub workflow:

`.github/workflows/staging-rehearsal.yml`

Workflow inputs are not permanent secrets. Fill them fresh each rehearsal:

- `api_base_url`: deployed Fly API URL
- `web_base_url`: deployed Vercel web URL
- `backup_restore_checked_at`: ISO timestamp of latest restore drill
- `backup_restore_drill_id`: restore drill identifier
- `backup_location`: backup system/location
- `migration_approved_by`: approver name/email
- `allow_pending_migrations`: usually `false`; set `true` only when intentionally rehearsing pending migrations

After the workflow completes, download:

`staging-gonogo-evidence-pack`

Open:

`go-no-go-summary.md`

Pilot users must not be invited until the summary is GO, or every warning has named operator acceptance.

## Fast Verification Commands

Use these after the platform values exist:

```sh
corepack pnpm staging:github:check
```

```sh
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/staging.yaml RUNTIME_TARGET=api corepack pnpm pilot:check
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/staging.yaml RUNTIME_TARGET=worker corepack pnpm pilot:check
```

```sh
corepack pnpm staging:secrets:check
corepack pnpm staging:storage:check
```

```sh
corepack pnpm staging:rehearsal
corepack pnpm staging:gonogo:summary
```

## Decision Rule

- If `staging:github:check` fails, fix GitHub secrets first.
- If `pilot:check` fails, fix runtime env on Fly/API/worker.
- If `/readyz` fails, fix deployed API/database/runtime config.
- If staging rehearsal fails, do not invite pilot users.
- If go/no-go summary says NO-GO, do not invite pilot users.
