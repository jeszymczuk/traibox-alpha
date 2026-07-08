# TRAIBOX Incident Playbook

Use this when TRAIBOX is degraded during an internal alpha, controlled pilot, or production-like rehearsal.

## Severity

- `SEV-1`: Users cannot access TRAIBOX, data isolation is suspect, protected actions may be unsafe, or proof/audit integrity is at risk.
- `SEV-2`: Core workflow is blocked for multiple pilot users, payments/funding/clearance execution cannot proceed, or readiness/proof is unavailable.
- `SEV-3`: A single module or provider is degraded, but manual fallback or replay remains available.

## First 10 Minutes

1. Assign an incident lead.
2. Freeze risky changes.
3. Check `/healthz`, `/readyz`, and `/metrics`.
4. Check latest deployment, migration, and CI status.
5. Confirm whether tenant isolation, audit chain, protected-action controls, and proof generation are affected.
6. If protected actions are affected, pause external execution and use manual human review only.

## Triage Commands

```sh
curl https://<api-domain>/healthz
curl https://<api-domain>/readyz
curl https://<api-domain>/metrics
curl https://<api-domain>/v1/api/catalog
```

For local/staging:

```sh
pnpm pilot:check
pnpm db:migrate:dry-run
BACKUP_RESTORE_REQUIRED=false pnpm db:backup:check
```

For production-like incidents, run `pnpm db:backup:check` with the latest restore-drill evidence rather than disabling the requirement.

## Degraded Mode

TRAIBOX may continue operating in degraded mode only if:

- Tenant isolation is intact.
- Audit and memory writes remain available.
- Protected actions remain human-controlled.
- Manual payment fallback is available.
- Proof/replay can recover after provider restoration.

## Provider-Specific Fallbacks

- Payment rail unavailable: use manual payment fallback. TrueLayer is the current AIS/PIS adapter; iBanFirst is the preferred cross-border B2B payments/FX candidate to add next.
- Funding provider unavailable: use partner portal/manual offer capture.
- Compliance provider unavailable: queue clearance checks and document evidence; do not submit declarations.
- Trade Brain unavailable: use deterministic alpha reasoning and capture human notes in memory.
- Object storage unavailable: stop external sharing and proof export until storage recovers.

## Closure

Before closing:

- Record timeline.
- Record customer/user impact.
- Verify audit-chain integrity.
- Generate or update proof bundle for affected trade work.
- Add regression test or runbook update.
- Decide whether data-subject or regulator notification review is needed.
