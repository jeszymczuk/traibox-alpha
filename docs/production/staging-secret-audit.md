# TRAIBOX Staging Secret Audit

Run this before a real staging rehearsal to catch missing or placeholder env vars without printing secret values.

## Local Fixture Check

```sh
STAGING_SECRET_AUDIT_FIXTURE=true pnpm staging:secrets:check
```

The fixture check validates the audit machinery only. It is not proof that real staging is configured.

## Real Staging Check

Use the same runtime env mapping as `pnpm staging:rehearsal`:

```sh
DEPLOYMENT_PROFILE_PATH="packages/profiles/profiles/staging.yaml" \
DATABASE_URL="<staging postgres url>" \
AUTH_MODE=supabase \
SUPABASE_JWT_SECRET="<secret>" \
SUPABASE_URL="<url>" \
SUPABASE_ANON_KEY="<anon key>" \
SUPABASE_SERVICE_ROLE_KEY="<service role>" \
TRUELAYER_CLIENT_ID="<id>" \
TRUELAYER_CLIENT_SECRET="<secret>" \
TRUELAYER_WEBHOOK_SECRET="<secret>" \
IBANFIRST_API_KEY="<key>" \
IBANFIRST_WEBHOOK_SECRET="<secret>" \
COMPLYADVANTAGE_API_KEY="<key>" \
EVM_RPC_URL="<url>" \
EVM_ANCHOR_REGISTRY_ADDRESS="<address>" \
EVM_ANCHOR_WALLET_PRIVATE_KEY="<secret>" \
PARTNER_JWT_SECRET="<secret>" \
ALLOW_PRODUCTION_MIGRATIONS=false \
MIGRATION_APPROVED_BY="<name/email>" \
BACKUP_RESTORE_CHECKED_AT="<ISO timestamp>" \
BACKUP_RESTORE_DRILL_ID="<restore drill id>" \
BACKUP_LOCATION="<backup system/location>" \
STAGING_API_BASE_URL="https://<api-domain>" \
STAGING_WEB_BASE_URL="https://<web-domain>" \
pnpm staging:secrets:check
```

Provider secrets are conditional:

- `payments.active_provider: manual` requires no payment-provider secrets.
- `payments.active_provider: truelayer` requires `TRUELAYER_CLIENT_ID`, `TRUELAYER_CLIENT_SECRET`, and `TRUELAYER_WEBHOOK_SECRET` when webhook verification is enabled.
- `payments.active_provider: ibanfirst` requires `IBANFIRST_API_KEY` and `IBANFIRST_WEBHOOK_SECRET`.
- `ledger.anchoring.enabled: true` with `adapter: evm_event` requires `EVM_RPC_URL`, `EVM_ANCHOR_REGISTRY_ADDRESS`, and `EVM_ANCHOR_WALLET_PRIVATE_KEY`.

The report is written to:

- `artifacts/staging-secret-audits/latest.json`
- `artifacts/staging-secret-audits/<timestamp>.json`

## GitHub Secrets

The manual staging rehearsal workflow maps repository secrets into runtime env vars. Configure these secrets before running `.github/workflows/staging-rehearsal.yml`:

- `STAGING_DATABASE_URL`
- `STAGING_SUPABASE_JWT_SECRET`
- `STAGING_SUPABASE_URL`
- `STAGING_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `STAGING_TRUELAYER_CLIENT_ID`
- `STAGING_TRUELAYER_CLIENT_SECRET`
- `STAGING_TRUELAYER_WEBHOOK_SECRET`
- `STAGING_IBANFIRST_API_KEY`
- `STAGING_IBANFIRST_WEBHOOK_SECRET`
- `STAGING_COMPLYADVANTAGE_API_KEY`
- `STAGING_EVM_RPC_URL`
- `STAGING_EVM_ANCHOR_REGISTRY_ADDRESS`
- `STAGING_EVM_ANCHOR_WALLET_PRIVATE_KEY`
- `STAGING_PARTNER_JWT_SECRET`

The readiness checker only requires the provider-specific secrets selected by `DEPLOYMENT_PROFILE_PATH`; unused provider secrets may be absent.
