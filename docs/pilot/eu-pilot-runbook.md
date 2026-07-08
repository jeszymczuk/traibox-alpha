# TRAIBOX — EU Pilot Runbook (Next Week)

This runbook is written for **operators**, not engineers. It focuses on running the pilot safely and smoothly.

If you need deployment steps (Vercel + Fly.io + Supabase), use: `docs/pilot/go-live.md`.

Before inviting pilot users, complete: `docs/pilot/readiness-checklist.md`.

The final go/no-go evidence comes from the GitHub **Staging Rehearsal** workflow. Download the `staging-gonogo-evidence-pack` artifact and open `go-no-go-summary.md` before inviting any SME.

## 0) Choose the “mode” (recommended defaults)

- **Payments:** Use **AIS/PIS when available**, otherwise use **Manual Transfer fallback**.
- **KYB/KYC:** Use **KYB‑lite** (doc upload + screening + manual review) unless Sumsub is fully validated.
- **Finance offers:** Use **Partner submissions** (Partner Portal / Partner API).

## 1) Configure the deployment profile

Set in `.env`:

```
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml
```

Key behaviours in this profile:
- avoids defaulting corridor to PT↔ES
- enables ComplyAdvantage
- enables provider-neutral payment execution rails; TrueLayer is the current AIS/PIS adapter if env vars are present
- enables **manual payments fallback**
- disables “demo offers” (expects partner offers)

## 2) Required credentials / env vars

In `.env` (or Fly/Vercel secrets in staging/prod):

- Postgres: `DATABASE_URL`
- Current payment adapter: `TRUELAYER_CLIENT_ID`, `TRUELAYER_CLIENT_SECRET` (+ webhook secret if used). iBanFirst should be added as the preferred cross-border B2B payments/FX adapter once partner/API access is confirmed.
- ComplyAdvantage: `COMPLYADVANTAGE_API_KEY`
- Partner auth: `PARTNER_JWT_SECRET`
- (Optional) Protect partner bootstrap in non‑dev: `ADMIN_BOOTSTRAP_SECRET`

## 3) Start the app locally (staging rehearsal)

1. `docker compose up -d`
2. `pnpm install`
3. `pnpm db:migrate`
4. `pnpm dev`

Open:
- Web: `http://localhost:3000`
- API: `http://localhost:3001/healthz`
- API readiness: `http://localhost:3001/readyz`
- API metrics: `http://localhost:3001/metrics`

Run the profile-aware preflight:

```
DEPLOYMENT_PROFILE_PATH=packages/profiles/profiles/eu-pilot.yaml RUNTIME_TARGET=api pnpm pilot:check
```

For real staging, use `.github/workflows/staging-rehearsal.yml` instead of local fixture output. The pilot invitation rule is simple:

- `ready_for_pilot_invitation: true` means proceed to controlled founder story validation.
- `ready_for_pilot_invitation: false` means do not invite SMEs yet.
- Warnings are acceptable only when a named operator records the acceptance in the pilot go/no-go pack.

## 4) Operator checklist for each SME (happy path)

### A) Org + Trade
1. Create/select org
2. Create a trade (parse intent)
3. Confirm Plan looks reasonable (items + corridor + incoterm)

### B) Compliance (real)
1. Click **Run compliance**
2. Confirm status becomes **passed/warnings/failed**
3. Download the PDF report

### C) Finance (partner)
1. Click **Request offers**
2. If status is `partial`, open Partner Portal (`/partner`) and submit offers for that request (requires a Partner API key; see `docs/pilot/go-live.md`)
3. Confirm `offers.ready` and **Accept** an offer (idempotent)

### D) Payments
Option 1 — **Open-banking payment rail supported**
1. Click **Connect bank** → complete consent
2. Compute routes
3. Execute payment → complete SCA
4. Confirm webhook updates status to executed/failed

Option 2 — **Manual fallback**
1. Click **Add manual account** and provide the SME’s sending IBAN
2. Compute routes → select `MANUAL_TRANSFER`
3. Execute payment → follow the `/payments/manual` instructions
4. Mark executed/failed

### E) Proofs
1. Click **Build proof pack**
2. Download the ZIP
3. Confirm root + anchoring status show (anchoring may be pending depending on worker schedule)

## 5) “If something fails” quick triage

- **Bank not supported / consent fails:** use **Manual fallback** (do not block the pilot).
- **Payment rail webhook not arriving:** reconciliation worker may mark executed when AIS transactions match; otherwise use manual completion for MANUAL payments only.
- **No finance offers:** confirm the partner is bootstrapped and partner submitted offers for the latest `offer_request`.
- **Compliance provider timeout:** rerun compliance; report should still be generated with clear status.
