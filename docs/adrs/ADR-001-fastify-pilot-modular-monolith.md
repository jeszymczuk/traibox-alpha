# ADR-001: Fastify pilot modular monolith

- Status: Accepted
- Status semantics: intended post-approval
- Date: 2026-07-13
- Owners: @jeszymczuk
- Effective when: PR #38 is approved and merged into `main` by the repository owner
- Approval record: the merge of PR #38
- Draft branch authority: none over `main`

## Context

The pilot application API is an independently deployed TypeScript Fastify service. It is the canonical TRAIBOX application backend; Supabase is managed infrastructure, not the product backend. A framework rewrite during pilot governance work would add migration risk without evidence that Fastify prevents required boundaries.

## Decision

Approve the current Fastify API as the pilot modular monolith. Keep one deployable API while preserving explicit domain ownership, typed shared contracts, request authorization, policy enforcement, auditability, provider abstraction, canonical API ownership, and testable domain services.

NestJS is a reviewed medium-term target architecture, not an immediate migration. No workstream may introduce parallel canonical backends or move product workflow ownership into Next.js, Supabase, or database triggers.

## Required guardrails

- Domain code stays separable from Fastify route registration.
- Every canonical mutation is typed, authorized, independently validated, audited, and idempotent where externally consequential.
- Cross-domain dependencies are explicit and may not bypass Finance, Clearance, Approval, or agent boundaries.
- Provider schemas remain behind provider-neutral adapters.
- New domain modules include ownership and boundary tests.

## Reconsideration triggers

Open a superseding ADR when evidence shows one or more of:

- multiple developers own separate domains and need standardized module boundaries;
- repeated cross-domain coupling cannot be removed within the modular monolith;
- policy or authorization enforcement becomes inconsistent across routes;
- standardized dependency-injection or lifecycle boundaries are required;
- broad Temporal integration changes service composition;
- enterprise API governance requires framework-level facilities;
- measured Fastify maintainability, onboarding, or test costs exceed agreed thresholds;
- Finance, Clearance, or agent boundaries cannot be preserved reliably.

The superseding ADR must include measured examples, migration sequencing, compatibility, deployment, rollback/forward-fix, and test evidence. Framework preference alone is not a trigger.

## Consequences

Pilot delivery continues on Fastify without rewrite. Code quality is governed by boundaries and tests rather than framework branding. If triggers are met, migration remains an explicit reviewed program, not an incidental refactor.
