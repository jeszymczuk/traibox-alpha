# TRAIBOX Architecture Decision Records

This directory contains architecture decisions intended for approval under C0.1 and subordinate to higher-precedence canonical product sources. `docs/governance/source-of-truth.yaml` records their intended authority and activation condition.

## C0.1 activation

The statuses in this index and ADR-001 through ADR-005 are their intended post-approval statuses. They become effective only when PR #38 is approved and merged into `main` by the repository owner. The unmerged draft branch has no authority over `main`; the merge of PR #38 is the founder approval record for C0.1.

## Status vocabulary

- `Proposed`: under review; not implementation authority.
- `Accepted`: intended to be approved and active after its recorded activation condition is satisfied.
- `Superseded`: replaced by a named later ADR.
- `Deprecated`: retained temporarily with an explicit removal path.

After activation, changing an Accepted decision requires a superseding ADR; editing history in place is prohibited except for typo or link repair that does not change meaning.

## Accepted decisions

| ADR                                                     | Decision                           | Status   |
| ------------------------------------------------------- | ---------------------------------- | -------- |
| [ADR-001](ADR-001-fastify-pilot-modular-monolith.md)    | Fastify pilot modular monolith     | Accepted |
| [ADR-002](ADR-002-postgres-utg-pilot-adapter.md)        | PostgreSQL UTG pilot adapter       | Accepted |
| [ADR-003](ADR-003-durable-workflow-adoption-trigger.md) | Durable workflow adoption triggers | Accepted |
| [ADR-004](ADR-004-nextjs-bff-session-boundary.md)       | Next.js BFF and session boundary   | Accepted |
| [ADR-005](ADR-005-design-system-v2.md)                  | Design System v2 foundation        | Accepted |

## ADR requirement

Create or supersede an ADR before changing a canonical backend or framework boundary, canonical data store, authenticated browser/session boundary, durable workflow substrate, provider-abstraction rule, design-system foundation, or destructive/irreversible migration strategy.

Each ADR must state context, decision, hard constraints, measurable reconsideration triggers, compatibility/rollback consequences, and affected governance manifests.
