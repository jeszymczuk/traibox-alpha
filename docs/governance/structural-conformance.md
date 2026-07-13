# C0.2 structural conformance

- Status: **REVIEW** operational and audit evidence
- Decision scope: **C0.2**
- Governing baseline: C0.1 repository constitution, source-of-truth map, route manifest, protected-action manifest, status vocabulary, and ADR-001 through ADR-005
- Runtime authority: **none**; these tools inspect repository structure and do not define product behavior

## Commands

```bash
pnpm audit:component-tokens
pnpm conformance
pnpm conformance:test
pnpm lint
```

`audit:component-tokens` validates the current scan against the committed confirmed-debt baseline. `conformance` runs every structural gate. `conformance:test` runs positive logic and negative fixtures. `lint` uses the ESLint 9 flat configuration and fails for new unsuppressed findings.

The maintenance-only `pnpm audit:component-tokens:update` command rewrites the audit and component baseline. It must never run in CI. Review its entire diff before accepting it.

## Checks and deliberate limits

| Check | Validates | Deliberately does not validate |
| --- | --- | --- |
| Governance schema | strict YAML syntax and shapes, allowed statuses/severities/gates, activation metadata, IDs, duplicates, and referenced paths | missing product meaning or approval of REVIEW evidence |
| Route coverage | exact `page.tsx` tree coverage, normalized paths, sources, duplicates, required structural metadata, and allowed route statuses | final workspace ownership, redirects, screen semantics, responsive behavior, or Ch.17/17.A meaning |
| Protected actions | exact shared-contract/manifest identifiers and immutable critical metadata for `send_payment` and `accept_funding_offer` | runtime repair, approval binding, Finance/Payments policy, or marking either critical finding resolved |
| ADR registration | files, README index, source-of-truth registration, numbers, statuses, activation, and supersession integrity | new architecture decisions |
| API alignment | AST-extracted Fastify registrations against the executable contract catalog, methods, normalized paths, visible role guards, protected-action evidence, duplicates, and metadata | starting services, calling providers, credential use, or interpreting behavior as product authority |
| Status vocabulary | only explicitly registered AST/YAML/SQL sources, domain ownership, implementation/manifest set drift, alias conflicts, and accidental state-machine collapse | arbitrary prose/UI-copy scanning or a global replacement lifecycle |
| ESLint debt | exact parity between ESLint suppressions and owned machine debt; no new tooling suppression | semantic runtime refactors to remove pre-existing lint debt |
| Design tokens | canonical file locations, dark/light variable symmetry, required token families, Tailwind variable references, duplicate definitions, and new confirmed styling drift | component redesign, token-value changes, invented tokens, or ambiguous literal-color remediation |

## Baselines

Baselines live under `scripts/conformance/baselines/` and are `REVIEW` evidence of unresolved debt, never approval of behavior. Each entry records an exact fingerprint, rule, source, owner, severity, rationale, and remediation condition. The component baseline also records normalized value, classification, context identifier, evidence line, and a semantic token only when the mapping is clear.

The current baselines are:

- `component-token-debt.json`: confirmed existing production styling debt measured by the Phase 0 audit;
- `api-catalog-debt.json`: exact existing Fastify/catalog, role, and protected-action annotation discrepancies;
- `status-vocabulary-debt.json`: exact existing registered-source vocabulary drift;
- `eslint-debt.json`: exact per-file/per-rule ESLint suppression counts.

To add an entry, first prove that the discrepancy exists on the adoption baseline, assign an owner and remediation condition, run the relevant maintenance command only after review, and inspect every generated entry. Do not baseline malformed governance, missing required metadata, weakened critical gates, secrets, new drift, or unexplained discrepancies.

To remediate debt, fix it in the correctly scoped PR and remove the exact baseline entry. Stale entries fail conformance or ESLint, so removal is part of remediation. API/status maintenance is available through `tsx scripts/conformance/baseline-maintenance.mts <api-catalog|status-vocabulary>`; ESLint maintenance uses `eslint --suppress-all` followed by the `eslint` maintenance mode. These commands are intentionally not CI scripts.

## Updating governance correctly

Edit the governing manifest and implementation in the same scoped change when authority permits it. Preserve strict field names, allowed vocabularies, unique identifiers, activation metadata, valid repository paths, and critical protected-action gates. Register a route before adding its `page.tsx`; register an Accepted ADR in both the ADR index and source-of-truth map. Never use a baseline to make malformed governance pass.

## Interpreting CI

An unbaselined finding means structural reality changed and must be reconciled or explicitly reviewed before merge. A stale baseline means debt was removed or moved and the evidence record must also be removed. A crashed check is a critical tooling failure. Failure messages identify the rule and source; they do not authorize a product fix outside the PR scope.

Semantic route, workspace, screen, component, responsive, interaction, and product-meaning checks remain blocked by the priority `PENDING_IMPORT` sources, especially Ch.17 v3 and Ch.17.A. The gate records implementation structure without promoting it to product authority.

Component remediation belongs to C0.6 because C0.2 only measures and prevents new confirmed debt. `send_payment` and `accept_funding_offer` runtime approval-binding repair belongs to C0.3 because C0.2 must preserve the critical evidence and may not change execution behavior.
