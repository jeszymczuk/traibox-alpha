# TRAIBOX (MVP)

Chat‑first, card‑driven trade workspace for the PT↔ES pilot.

## Repo layout

- `apps/web` — Next.js UI
- `apps/api` — Fastify API Edge (`/v1/*` + SSE)
- `apps/worker` — background jobs (anchoring, reconciliation, reports)
- `packages/contracts` — shared TypeScript types (cards, DTOs, events)
- `packages/db` — SQL migrations + DB helpers
- `packages/profiles` — deployment profiles (YAML) + schema
- `packages/proof` — deterministic bundles + verifier
- `packages/partner-sdk` — partner offer API types

## Prereqs

- Node.js 20+ (this repo uses TypeScript + modern ESM)
- pnpm via Corepack (recommended): `corepack enable`
- Docker (optional) for local Postgres

## Quick start (local dev)

1. Copy env:
   - `cp .env.example .env`
   - (Optional) For EU-wide pilot behaviour: set `DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml`
2. Start local Postgres (optional):
   - `docker compose up -d`
3. Install deps:
   - `pnpm install`
4. Run migrations:
   - `pnpm db:migrate`
5. Start dev:
   - `pnpm dev`

By default `AUTH_MODE=dev` accepts `Authorization: Bearer dev` and uses `DEV_USER_ID`.

## UI Demo Mode (hot reload)

Runs a frontend-only, mock “golden path” (Plan → Compliance → Finance → Payments → Proofs) so you can iterate on UI/UX without DB or credentials.

1. Install deps (once): `pnpm install`
2. Run: `pnpm demo`
3. Open: `http://localhost:3000/demo`

## Notes

- Production uses Supabase Postgres + Storage; API/worker connect via `DATABASE_URL` (direct pg) and enforce RLS via `SET LOCAL app.current_org`.
- External integrations (TrueLayer / ComplyAdvantage / Sumsub / XDC anchoring) are enabled when their env vars are configured; otherwise adapters run in mock mode.
- Pilot operations:
  - Operator runbook: `docs/pilot/eu-pilot-runbook.md`
  - Go-live (Vercel + Fly + Supabase): `docs/pilot/go-live.md`

## TrueLayer (AIS/PIS) setup (MVP)

This repo implements an OAuth + PKCE flow in the web app and exchanges the authorization code via the API.

**Required env vars**

- `TRUELAYER_CLIENT_ID`, `TRUELAYER_CLIENT_SECRET`
- `TRUELAYER_AUTH_BASE_URL` (default `https://auth.truelayer.com`)
- `TRUELAYER_BASE_URL` (default `https://api.truelayer.com`)
- `TOKENS_ENCRYPTION_KEY` (recommended for any non-local environment)
- Optional webhook verification: `TRUELAYER_WEBHOOK_SECRET`

**Redirect & webhook URLs**

- Redirect URL (web): `http://localhost:3000/banks/callback`
- Webhook URLs (api):
  - payments: `http://localhost:3001/webhooks/payments`
  - consents: `http://localhost:3001/webhooks/consents`

**Flow**

1. In a trade page, click **Connect bank** → API returns a TrueLayer authorize URL → browser redirects.
2. TrueLayer redirects back to `/banks/callback` with `code` and `state` → web calls `POST /v1/banks/exchange` using `consent_id` decoded from `state`.
3. Accounts are synced into `bank_accounts` for AIS consents.
4. Executing a payment returns `redirect_url` to complete SCA; webhook updates `payments.status`.

**Replay protection**

Webhook events are deduped (best-effort) by `tl-webhook-id` / `x-webhook-id` headers when present, otherwise by `sha256(raw_body)`.

## EU pilots: manual fallback (recommended)

For EU-wide pilots, some SMEs/banks may not be supported by AIS/PIS. TRAIBOX supports a **manual bank transfer fallback** to keep the end-to-end flow smooth:

- Create a manual sending account: `POST /v1/banks/manual/accounts` (or use the **Add manual account** button in the trade page UI).
- Compute routes and select `MANUAL_TRANSFER`.
- Execute payment → TRAIBOX redirects to `/payments/manual` with step-by-step instructions.
- Mark executed/failed in the manual page (writes attempts + emits `payment.completed|failed` SSE).

This keeps **Proofs** and audit evidence intact even when provider coverage is limited.

## Partner offers (real finance offers) (MVP)

For the Iberia pilot, “real offers” are submitted by real partners via the Partner API/Portal (not scraped).

### Finance demo offers

Profiles now include `finance.demo_offers_enabled`:

- `packages/profiles/profiles/dev.yaml`: `true` (fallback offers generated)
- `packages/profiles/profiles/staging.yaml`: `false` (partner flow)
- `packages/profiles/profiles/iberia-pilot.yaml`: `false` (partner flow)

When demo offers are disabled, `POST /v1/finance/offers` will create an `offer_requests` row and return `status=partial` until a partner submits offers. The UI updates via SSE (`offers.ready`).

### Bootstrap a partner (dev/staging)

This creates a partner + API key (returned once).

```bash
curl -sS -X POST "$API_BASE_URL/v1/admin/partners/bootstrap" \
  -H "Authorization: Bearer dev" \
  -H "X-Org-Id: <your-org-uuid>" \
  -H "Content-Type: application/json" \
  -H "X-Admin-Secret: $ADMIN_BOOTSTRAP_SECRET" \
  -d '{"display_name":"Bank Alpha (Pilot)","domains":["finance"],"stf_ready":true}'
```

Notes:
- Outside `AUTH_MODE=dev`, set `ADMIN_BOOTSTRAP_SECRET` (and pass `X-Admin-Secret`) or the endpoint is disabled.
- Requires the caller to be `owner|admin` in the org.

### Submit offers (Partner Portal)

Open the Partner Portal UI at `http://localhost:3000/partner`, paste the returned `api_key`, and submit offers for pending requests.
