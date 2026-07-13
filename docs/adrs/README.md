# TRAIBOX Architecture Decision Records

This directory contains approved architecture decisions subordinate to higher-precedence canonical product sources. `docs/governance/source-of-truth.yaml` records their authority.

## Status vocabulary

- `Proposed`: under review; not implementation authority.
- `Accepted`: approved and active.
- `Superseded`: replaced by a named later ADR.
- `Deprecated`: retained temporarily with an explicit removal path.

Changing an Accepted decision requires a superseding ADR; editing history in place is prohibited except for typo or link repair that does not change meaning.

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
