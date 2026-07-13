# ADR-003: Durable workflow adoption trigger

- Status: Accepted
- Status semantics: intended post-approval
- Date: 2026-07-13
- Owners: @jeszymczuk
- Effective when: PR #38 is approved and merged into `main` by the repository owner
- Approval record: the merge of PR #38
- Draft branch authority: none over `main`

## Context

The current independently deployed worker runs bounded polling loops for workflow monitoring, bank synchronization, and anchoring. It is suitable for non-durable pilot work but is not a general durable workflow engine. Agent reasoning must remain distinct from business workflow execution.

## Decision

Approve the current worker for non-durable background work. Do not introduce Temporal or an equivalent engine merely for scheduling convenience.

A durable workflow engine becomes mandatory before production workflows require any of:

- waits lasting hours or days;
- reliable resumption from external callbacks;
- resumable human approvals;
- compensation across completed steps;
- deterministic replay of workflow code;
- durable retry and recovery across deployments or outages;
- protected multi-step financial execution;
- long-lived workflow state not safely represented by current canonical state machines.

## Required guardrails

- Jobs must be bounded, idempotent where repeated, observable, and safe after restart.
- Canonical state stays in PostgreSQL behind the application API/domain boundary.
- A model may propose work but may not act as the workflow engine or execute protected actions.
- Retry logic must not create unapproved external consequences.

## Adoption procedure

When a trigger appears, open a superseding ADR before implementation. It must define workflow ownership, command/event contracts, approval and policy checkpoints, idempotency, compensation, replay, versioning, secrets, tenancy, audit, deployment topology, migration of in-flight work, and rollback/forward-fix.

## Consequences

The pilot keeps operational complexity low while establishing a non-negotiable boundary before long-lived or protected workflows appear. Temporal remains a candidate, not a preselected dependency.
