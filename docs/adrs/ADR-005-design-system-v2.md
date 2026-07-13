# ADR-005: Design System v2

- Status: Accepted
- Status semantics: intended post-approval
- Date: 2026-07-13
- Owners: @jeszymczuk
- Effective when: PR #38 is approved and merged into `main` by the repository owner
- Approval record: the merge of PR #38
- Draft branch authority: none over `main`

## Context

The repository contains Design System v2 tokens, themes, and component styling. The token file claims a missing Ch.17 section as source. Authoritative Ch.17 v3 and Ch.17.A are `PENDING_IMPORT`, so that claim cannot establish product-spec authority by itself. A stable visual baseline is still required to prevent competing redesigns during pilot work.

## Decision

Approve Design System v2 as the current visual foundation:

- dark-first presentation with a supported light counterpart;
- controlled glass hierarchy;
- approved typography tokens;
- semantic status colors;
- canonical design tokens;
- calm professional density.

New UI work must compose existing semantic tokens and shared primitives. It may extend the system through approved component contracts but may not introduce a competing visual language.

## Required guardrails

- Do not hand-pick duplicate colors or spacing when a semantic token exists.
- Accessibility, focus, reduced motion, contrast, responsive behavior, and all required screen states are part of the system.
- Customer-facing UI does not expose provider, model, cloud, or internal infrastructure details.
- Import and reconcile Ch.17 v3/Ch.17.A before treating their missing contents as authority.

## Supersession trigger

A competing redesign, replacement token system, new foundational typography/color model, or incompatible component architecture requires a superseding ADR with user evidence, migration plan, route/component impact, accessibility validation, compatibility, and rollback/forward-fix.

## Consequences

Design System v2 is locked for current work without modifying runtime UI in C0.1. The missing chapter imports remain explicit governance dependencies rather than being reconstructed from CSS comments.
