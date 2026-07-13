# ADR-004: Next.js BFF and session boundary

- Status: Accepted
- Date: 2026-07-13
- Owners: @jeszymczuk

## Context

The current browser obtains Supabase sessions, copies access tokens to `localStorage`, calls the Fastify API directly, and places tokens in query strings for SSE and file transport. Partner tokens also persist in browser storage, external-participant access uses a URL token, and Intelligence transcripts are persisted locally. These behaviors are implementation reality, not the intended security boundary.

## Decision

The intended authenticated browser boundary is a thin Next.js backend-for-frontend (BFF) using secure server-managed sessions. Browser code communicates with the BFF; the BFF attaches credentials to the independently deployed application API.

The BFF may:

- create, rotate, revoke, and validate secure server-managed sessions;
- attach service or user credentials to application API requests;
- create request and trace correlation identifiers;
- proxy Server-Sent Events without query-string bearer tokens;
- normalize transport differences and safe error responses.

The BFF may not:

- make domain, Finance, approval, or policy decisions;
- own canonical product state;
- define or execute protected-action logic;
- decide agent authority;
- embed provider-specific business policy;
- mutate PostgreSQL or Storage directly as a substitute for the application API.

## Security requirements

- Use secure, HTTP-only, SameSite cookies appropriate to the deployment topology.
- Apply CSRF protection, origin validation, session rotation/revocation, and bounded expiry.
- Never store access tokens, refresh tokens, sensitive credentials, or private trade transcripts in browser persistence.
- Never place authentication tokens in query strings, except an explicitly approved short-lived, single-purpose signed artifact URL.
- Keep tenant and role authorization in the application API; never trust browser-provided org or role claims without server validation.

## Migration order

1. Define threat model, session contract, and same-origin/cross-origin topology.
2. Implement BFF session endpoints and API credential attachment.
3. Proxy SSE and downloads without query tokens.
4. Move user and partner flows off browser token persistence.
5. replace transcript persistence with approved server-side or ephemeral behavior.
6. remove compatibility paths only after tests and rollout evidence.

Each step requires compatibility, revocation, telemetry, rollback/forward-fix, and multi-tenant tests. C0.1 implements none of these runtime changes.

## Consequences

Fastify remains the canonical backend. Next.js gains a transport/session responsibility but no domain authority. Existing direct-browser behavior is tracked as remediation work and must not be copied into new surfaces.
