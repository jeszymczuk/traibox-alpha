# ADR-002: PostgreSQL UTG pilot adapter

- Status: Accepted
- Date: 2026-07-13
- Owners: @jeszymczuk

## Context

The current Universal Trade Graph (UTG) service projects relationships from canonical PostgreSQL trade, object, approval, proof, audit, memory, event, and payment records. Pilot queries are bounded and implemented behind `/v1/utg/*` service contracts. Introducing a graph database now would create another operational system without measured need.

## Decision

Approve PostgreSQL as the initial UTG implementation behind a stable UTG service contract. PostgreSQL remains canonical transactional truth.

Neo4j or another graph engine may later serve a derived graph layer. It must be rebuildable from canonical records, carry lineage and tenant scope, and never become the source of transactional truth or accept canonical domain mutations.

## Required guardrails

- Callers depend on the UTG contract, not PostgreSQL-specific query shapes.
- Every node and edge is derived from tenant-scoped canonical data with evidence references.
- Projection lag, rebuild, deletion/retention, and authorization behavior are explicit.
- Graph-specific storage cannot bypass application API authorization or RLS.

## Adoption triggers for a graph layer

Open a superseding ADR only when production-like measurements demonstrate:

- approved use cases need materially deeper or more variable traversals;
- graph query complexity is repeatedly unmaintainable in the PostgreSQL projection;
- graph-specific workloads dominate and cannot be isolated efficiently;
- agreed latency or throughput objectives are missed after reasonable PostgreSQL tuning;
- projection code is less maintainable than a derived graph adapter;
- PostgreSQL cannot meet an approved UTG use case without unacceptable risk or cost.

The ADR must include benchmark datasets, traversal depths, query plans, latency targets, tenant-isolation design, projection/rebuild semantics, operating cost, failure behavior, and rollback.

## Consequences

The pilot avoids premature dual-write and dual-truth complexity. A future graph database is an optional read projection with explicit evidence-based adoption criteria.
