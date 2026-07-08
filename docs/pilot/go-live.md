# TRAIBOX — Pilot Go‑Live (Vercel + Fly.io + Supabase)

This is the **operator-friendly** go-live guide for the **EU pilot** (20 SMEs, multi‑country).

Goal: deploy **Web (Vercel)** + **API + Worker (Fly.io, EU)** + **DB/Storage/Auth (Supabase EU)** with:
- **Supabase Auth** (magic-link) for users
- Provider-neutral **payment execution rails**. The current staging adapter is **TrueLayer** for AIS/PIS; **iBanFirst** is the preferred cross-border B2B payments/FX candidate to add next.
- **ComplyAdvantage** screening
- **Manual payment fallback** enabled (critical for EU coverage)
- Optional provider-neutral ledger anchoring. The current first network is **XDC** via an EVM event adapter.

---

## 0) Pre‑flight checklist (recommended defaults)

- Use `packages/profiles/profiles/eu-pilot.yaml` (default corridor `EU-EU`, manual fallback ON).
- Set `AUTH_MODE=supabase` and configure `SUPABASE_JWT_SECRET` on the API.
- Set `TOKENS_ENCRYPTION_KEY` on API + worker (never store bank tokens plaintext in non-dev).
- Enable the selected payment rail webhook verification. For the current TrueLayer adapter:
  - Set `TRUELAYER_WEBHOOK_SECRET`
  - Keep `payments.truelayer.webhooks.verify_signatures: true` in the profile.
- Run the profile-aware preflight before deployment:

```bash
DEPLOYMENT_PROFILE_PATH="packages/profiles/profiles/eu-pilot.yaml" RUNTIME_TARGET=api pnpm pilot:check
DEPLOYMENT_PROFILE_PATH="packages/profiles/profiles/eu-pilot.yaml" RUNTIME_TARGET=worker pnpm pilot:check
```

---

## 1) Supabase setup (EU)

1) Create a Supabase project in an **EU region** (Iberia/EU as available).
2) **Auth**
   - Enable email magic links (default).
   - Grab:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - In Supabase **Project Settings → API**, also copy:
     - `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
     - `SUPABASE_JWT_SECRET` (server-side only; recommended so API verifies JWT locally)
3) **Storage buckets** (private)
   - Create private buckets:
     - `evidence`
     - `reports`
     - `bundles`
     - `exports`
   - TRAIBOX accesses storage via the service role key and serves downloads via `GET /v1/files` (authorized by DB).
4) **Database connection string**
   - Use the direct Postgres connection string (with SSL required).

---

## 2) Run DB migrations against Supabase

From the repo root:

```bash
corepack enable
pnpm install
DATABASE_URL="<your supabase postgres url>?sslmode=require" pnpm db:migrate:dry-run
```

For staging or production-like environments, dry-run must include approval and backup/restore evidence:

```bash
NODE_ENV=production \
ALLOW_PRODUCTION_MIGRATIONS=true \
MIGRATION_APPROVED_BY="<name/email>" \
BACKUP_RESTORE_CHECKED_AT="<ISO timestamp>" \
BACKUP_RESTORE_DRILL_ID="<id>" \
BACKUP_LOCATION="<location>" \
DATABASE_URL="<your supabase postgres url>?sslmode=require" \
pnpm db:migrate:dry-run
```

Then apply:

```bash
NODE_ENV=production \
ALLOW_PRODUCTION_MIGRATIONS=true \
MIGRATION_APPROVED_BY="<name/email>" \
BACKUP_RESTORE_CHECKED_AT="<ISO timestamp>" \
BACKUP_RESTORE_DRILL_ID="<id>" \
BACKUP_LOCATION="<location>" \
DATABASE_URL="<your supabase postgres url>?sslmode=require" \
pnpm db:migrate
```

Notes:
- Running migrations requires a DB user with permissions to create tables/functions and enable RLS.
- If you need a clean slate in a non-prod project, use `pnpm db:reset` (destructive).

---

## 3) Deploy API to Fly.io (EU)

1) Create the Fly app (choose region `mad`):

```bash
fly apps create traibox-api
```

2) Set secrets (minimum set for pilot):

```bash
fly secrets set \
  DATABASE_URL="..." \
  DEPLOYMENT_PROFILE_PATH="packages/profiles/profiles/eu-pilot.yaml" \
  AUTH_MODE="supabase" \
  SUPABASE_JWT_SECRET="..." \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  TOKENS_ENCRYPTION_KEY="..." \
  PARTNER_JWT_SECRET="..." \
  ADMIN_BOOTSTRAP_SECRET="..." \
  CORS_ORIGIN="https://<your-vercel-domain>" \
  WEB_BASE_URL="https://<your-vercel-domain>" \
  API_BASE_URL="https://<your-fly-api-domain>" \
  TRUELAYER_CLIENT_ID="..." \
  TRUELAYER_CLIENT_SECRET="..." \
  TRUELAYER_WEBHOOK_SECRET="..." \
  COMPLYADVANTAGE_API_KEY="..."
```

Optional (only if anchoring is enabled in profile):

```bash
fly secrets set \
  EVM_RPC_URL="..." \
  EVM_ANCHOR_REGISTRY_ADDRESS="..." \
  EVM_ANCHOR_WALLET_PRIVATE_KEY="..." \
  EVM_CHAIN_ID="50" \
  EVM_CONFIRMATIONS="3"
```

3) Deploy:

```bash
fly deploy --config apps/api/fly.toml
```

4) Verify health, readiness, and metrics:

```bash
curl https://<your-fly-api-domain>/healthz
curl https://<your-fly-api-domain>/readyz
curl https://<your-fly-api-domain>/metrics
```

---

## 4) Deploy Worker to Fly.io (EU)

1) Create the Fly app:

```bash
fly apps create traibox-worker
```

2) Set secrets (same DB + profile + integration keys as API):

```bash
fly secrets set \
  DATABASE_URL="..." \
  DEPLOYMENT_PROFILE_PATH="packages/profiles/profiles/eu-pilot.yaml" \
  SUPABASE_URL="..." \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  TOKENS_ENCRYPTION_KEY="..." \
  TRUELAYER_CLIENT_ID="..." \
  TRUELAYER_CLIENT_SECRET="..." \
  TRUELAYER_WEBHOOK_SECRET="..." \
  EVM_RPC_URL="..." \
  EVM_ANCHOR_REGISTRY_ADDRESS="..." \
  EVM_ANCHOR_WALLET_PRIVATE_KEY="..." \
  EVM_CHAIN_ID="50"
```

3) Deploy:

```bash
fly deploy --config apps/worker/fly.toml
```

Notes:
- The worker has **no public HTTP service**. It runs anchoring + bank sync loops.

---

## 5) Deploy Web to Vercel

1) Import the repo into Vercel.
2) Set **Root Directory** to `apps/web`.
3) Set env vars:

```bash
NEXT_PUBLIC_API_BASE_URL=https://<your-fly-api-domain>
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Deploy.

---

## 6) TrueLayer configuration (critical)

In TrueLayer Console:

- **Redirect URL** (OAuth): `https://<your-vercel-domain>/banks/callback`
  - TRAIBOX keeps `redirect_uri` stable and encodes `consent_id` into OAuth `state`.
- **Webhooks**:
  - Payments: `https://<your-fly-api-domain>/webhooks/payments`
  - Consents: `https://<your-fly-api-domain>/webhooks/consents`
- Set the webhook signing secret to match `TRUELAYER_WEBHOOK_SECRET`.

---

## 7) Partner offers (real finance offers)

For the pilot, “real offers” are submitted by partners via the Partner API/Portal (not scraped).

Bootstrap a partner (returns an API key once):

```bash
curl -sS -X POST "https://<your-fly-api-domain>/v1/admin/partners/bootstrap" \
  -H "Authorization: Bearer <your supabase access token>" \
  -H "X-Org-Id: <your-org-uuid>" \
  -H "X-Admin-Secret: <ADMIN_BOOTSTRAP_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Bank Alpha (Pilot)","domains":["finance"],"stf_ready":true}'
```

Then open the Partner Portal UI:
- `https://<your-vercel-domain>/partner`

Paste the returned `api_key` and submit offers for any pending requests.

---

## 8) Pilot smoke test (10 minutes)

1) Open web app → login with magic link.
2) Create org.
3) New trade → “Generate plan”.
4) Compliance → “Run compliance” → download PDF.
5) Finance → “Request offers”:
   - If partner flow is enabled, open Partner Portal (`/partner`) and submit an offer.
6) Payments:
   - Try TrueLayer connect; if the bank isn’t supported, use **Manual account** + **MANUAL_TRANSFER** route.
7) Proofs → build bundle → download ZIP → verify anchoring status.

If anything blocks payments, do not debug live with SMEs — switch to **manual fallback** for that org/trade and continue.

Before inviting the first SME, complete `docs/pilot/onboarding-flow.md`.
