## Purpose

<!-- What outcome does this PR create, and why is it needed now? -->

## Scope

<!-- List what is deliberately included and excluded. -->

## Governing specifications

<!-- Cite exact paths/sections and their source-of-truth status. REVIEW, SUPERSEDED, ARCHIVED, and PENDING_IMPORT are not authority. -->

| Specification or ADR | Status | Section(s) applied |
| -------------------- | ------ | ------------------ |
|                      |        |                    |

- Source-of-truth conflict found: <!-- none, or describe -->
- Missing canonical source affecting this PR: <!-- none, or describe -->

## Architecture impact

- Architecture impact: <!-- none / describe -->
- ADR required: <!-- yes / no -->
- ADR added or superseded: <!-- path / n/a -->
- Canonical backend boundary preserved: <!-- yes / no / n/a -->
- Intelligence vs workflow-execution separation preserved: <!-- yes / no / n/a -->

## Routes and experience contracts

- Changed routes: <!-- none, or list actual paths -->
- Route-manifest entries changed: <!-- none, or list -->
- Changed screen contracts: <!-- none, or list approved contract paths -->
- Changed component contracts: <!-- none, or list approved contract paths -->
- Workspace, audience, role, and tenant behavior declared: <!-- yes / no / n/a -->

For UI changes, attach evidence for:

- [ ] Desktop
- [ ] Tablet
- [ ] Mobile
- [ ] Loading state
- [ ] Empty state
- [ ] Error state
- [ ] Permission-denied state
- [ ] Degraded/offline/AI-unavailable state
- [ ] Keyboard, focus, contrast, and reduced-motion expectations

## Protected actions

- Protected actions changed: <!-- none, or identifiers -->
- Agent/model authority changed: <!-- no / describe -->
- Human approval enforced: <!-- yes / no / n/a -->
- Typed independent domain validation present: <!-- yes / no / n/a -->
- Idempotency and replay evidence: <!-- describe / n/a -->
- Audit evidence: <!-- describe / n/a -->

## Data, migrations, and RLS

- Migrations added: <!-- no / list -->
- Additive by default: <!-- yes / no / n/a -->
- Tenant-owned tables affected: <!-- none / list -->
- RLS assessment and tenant-isolation tests: <!-- describe / n/a -->
- Retention and audit impact: <!-- describe / n/a -->
- Backup/recovery and forward-fix analysis: <!-- describe / n/a -->

## Security and privacy

- Authentication/session impact: <!-- none / describe -->
- Browser storage or URL-token impact: <!-- none / describe -->
- Sensitive-data impact: <!-- none / describe -->
- Threat/abuse cases considered: <!-- describe / n/a -->

## Providers

- Provider impact: <!-- none / describe -->
- Provider-neutral contract preserved: <!-- yes / no / n/a -->
- Customer-facing provider/infrastructure leakage introduced: <!-- no / describe -->

## Validation

<!-- Include exact commands and results. Do not claim checks that were not run. -->

| Check                   | Result | Classification if not passing |
| ----------------------- | ------ | ----------------------------- |
| YAML / formatting       |        |                               |
| `pnpm lint`             |        |                               |
| `pnpm typecheck`        |        |                               |
| `pnpm test`             |        |                               |
| `pnpm test:trade-brain` |        |                               |
| `pnpm eval:trade-brain` |        |                               |
| `pnpm build`            |        |                               |
| Other                   |        |                               |

Failure classifications: introduced by this PR, pre-existing, unavailable credentials, incomplete repository tooling, or unrelated.

## Compatibility and rollback

- Backward/forward compatibility implications: <!-- describe -->
- Rollout or migration order: <!-- describe / n/a -->
- Rollback or forward-fix plan: <!-- describe -->

## Known unresolved conflicts

<!-- State none, or list exact conflicts/owners/follow-up. -->

## Author confirmations

- [ ] I used only `CANONICAL` or `APPROVED` authority, or explicitly documented the exception.
- [ ] I did not silently reconstruct a `PENDING_IMPORT` source.
- [ ] I updated governance manifests where required.
- [ ] I preserved canonical API, tenant, agent, and protected-action boundaries.
- [ ] I did not include unrelated working-tree changes.
