# TRAIBOX browser security boundary

- Status: runtime realization of approved ADR-004
- Scope: C0.4 browser, Next.js BFF, session transport, Fastify ingress, SSE, and private files
- Canonical backend: the independently deployed Fastify application API
- Canonical product state: PostgreSQL behind Fastify; unchanged by this boundary

This document records how ADR-004 is implemented. It is not a second ADR and does not grant the BFF domain authority.

## Topology and trust zones

The runtime path is:

`browser -> same-origin Next.js BFF -> independently deployed Fastify API -> canonical domains and PostgreSQL/private Storage`

1. The browser is an untrusted execution zone. XSS, malicious extensions, compromised dependencies, forged DOM state, stale cached tenant state, and user-controlled headers or URLs are assumed possible.
2. Next.js is the browser trust boundary. It owns only authentication transport, durable browser sessions, CSRF, correlation, explicit API proxying, stream/file transport, and safe error normalization.
3. Fastify is the application authorization boundary. It independently verifies the server-attached user credential, organization membership, role, request schema, protected-action binding, approval, idempotency, and domain rules.
4. PostgreSQL and private Storage are trusted persistence behind the application API. The BFF may use PostgreSQL only for security-infrastructure rows; it does not mutate canonical TRAIBOX state or object storage.
5. Supabase Auth is a provider boundary. Provider access and refresh tokens remain server-side and are not TRAIBOX authorization decisions by themselves.

Protected assets include Supabase access/refresh tokens, API and partner bearer credentials, opaque browser session identifiers, PKCE verifiers and callback state, CSRF tokens, external-participant grants, private documents, financial and approval data, Intelligence transcripts, organization membership, role/tenant context, protected-action payloads, and provider responses.

## Responsibility boundary

The BFF may establish, validate, rotate, and revoke browser sessions; hold and refresh provider credentials; add trace IDs; forward an organization ID as an untrusted selector; proxy registered JSON, multipart, SSE, and file requests; and return redacted transport errors.

The BFF may not calculate Finance outcomes, approve or execute protected actions, infer membership or role, own canonical objects, write product state directly, redefine provider or domain policy, or turn a client claim into authority. Fastify and database RLS remain independently authoritative for every organization-scoped request.

## Session contract

### Identifier and persistence

- A login, development login, partner sign-in, or external exchange creates a fresh 256-bit opaque session ID.
- Only the SHA-256 digest of that ID is stored in `browser_sessions`; the raw ID exists only in the HTTP-only cookie.
- Session rows are durable PostgreSQL security infrastructure, so multiple Next.js instances share revocation, idle expiry, and rotation state.
- Provider/API credentials, refresh credentials, PKCE storage, and synchronizer CSRF material are encrypted with Node's AES-256-GCM implementation. Each ciphertext uses a fresh 96-bit nonce and context-specific associated data.
- `BROWSER_SESSION_KEYS` is an ordered `key-id:base64-key` keyring. The first key encrypts new material; older keys remain available for reads during rotation. Removing an old key before its sessions expire intentionally fails those sessions closed.
- Session rows and auth flows use forced RLS and are accessible only under the existing system actor policy. They are not tenant or product records.

### Cookie

Production uses `__Host-traibox_session` with `HttpOnly`, `Secure`, `SameSite=Lax`, and `Path=/`. No `Domain` attribute is set. Explicit local development uses the host-only `traibox_session` name without `Secure` because local HTTP is permitted only under the dev profile. `Lax` supports the same-origin app and top-level auth callback while CSRF controls protect unsafe methods independently.

The absolute lifetime is 12 hours and the idle lifetime is 30 minutes. The idle deadline never extends beyond the absolute deadline. External browser sessions are additionally bounded by the 12-hour API participant credential and the grant's earlier expiry. Partner sessions use the same bounded local session lifetime.

### Lifecycle, fixation, rotation, and revocation

- Sign-in initiation generates one-time state and a PKCE verifier. PKCE storage is encrypted in `browser_auth_flows` for ten minutes; callback state is stored only as a digest and is atomically consumed.
- The callback exchanges the authorization code server-side. It never serializes the provider session to browser code and redirects to a validated same-origin return path without callback parameters.
- A new session replaces and revokes any prior cookie session, preventing fixation.
- Provider refresh rotates the opaque session ID, CSRF token, access token, and refresh token atomically. Reuse of the replaced ID fails as replay.
- Session-held scope/display changes use the same rotation primitive. Organization role is not cached as session authority; Fastify re-evaluates it per request, so a role change takes effect without trusting stale BFF state.
- Logout is `POST`, requires exact-origin and CSRF validation, calls Supabase logout for user sessions, revokes the local row, and clears both possible cookie names. Provider failure still revokes the local browser session and returns a redacted failure.
- Malformed, expired, revoked, undecryptable, unknown-key, and replayed sessions fail closed.

### Local development

Development access is server-side and explicit. It requires all of `AUTH_MODE=dev`, `TRAIBOX_ENABLE_DEV_AUTH=true`, `NODE_ENV!=production`, the `dev.yaml` deployment profile, and `DEV_USER_ID`. The browser receives only the opaque cookie; the BFF holds the `dev` API credential. Runtime readiness fails when controlled or production profiles attempt this mode, when browser security keys/API base/database configuration is missing, or when deprecated `NEXT_PUBLIC_*` credential/API variables are present.

## Supabase authentication

The browser posts only an email address and safe return path to `/api/auth/sign-in`. Next.js uses the server-only Supabase URL and anon/publishable key, PKCE flow, disabled provider session persistence, disabled automatic refresh, and disabled URL session detection. `/api/auth/callback` validates one-time state, exchanges the code on the server, rotates any prior session, and issues the cookie. Browser-visible session state is limited to authenticated state, session kind, safe display fields, CSRF token, and absolute expiry.

Exact allowed origins come from `BROWSER_ALLOWED_ORIGINS`; return paths must begin with one slash, cannot be scheme-relative or backslash-bearing, and cannot target auth state-changing endpoints.

## CSRF and origin handling

All cookie-authenticated `POST`, `PUT`, `PATCH`, and `DELETE` BFF requests require:

1. exact `Origin` membership in `BROWSER_ALLOWED_ORIGINS`, or a same-origin `Referer` fallback when Origin is absent;
2. a session-bound random synchronizer token in `X-CSRF-Token`; and
3. a currently active session.

The token is encrypted in the session row, returned by the minimal session endpoint, held only in browser memory, and rotated with the session. Missing, mismatched, stale, and cross-origin requests are rejected. SameSite is defense in depth, not the CSRF decision. Logout is never a GET mutation. Login initiation is unauthenticated but exact-origin checked; callback integrity comes from one-time PKCE state.

## Thin BFF route model

`/api/bff/[...path]` is not an unrestricted proxy. Every method/path combination must match `BFF_ROUTES`; every route declares its principal kind, query allowlist, and response mode. Unknown methods, traversal segments, encoded slashes/backslashes, arbitrary query keys, credential query keys, admin/internal routes, and absolute upstream URLs fail closed.

The upstream host and protocol come only from server-side `TRAIBOX_API_BASE_URL`. The proxy forwards a deliberately small header set: safe Accept/Content-Type, server-selected Authorization, untrusted organization selector, trace ID, idempotency key, locale, and SSE last-event ID. Browser Authorization, role, admin, service, forwarding, host, cookie, and internal headers are ignored. Requests have bounded bodies (just above the API's 20 MiB upload limit), cancellation, redirects disabled, and timeouts. Authenticated responses are `no-store`; hop-by-hop headers are reconstructed rather than copied. Upstream errors are reduced to status class, a stable message, and a safe trace ID without hosts, stacks, tokens, or provider bodies.

## SSE, uploads, and private files

- EventSource connects to same-origin `/api/bff/v1/events` with only the HTTP-only cookie. The organization selector and optional trade ID contain no credential. Next.js attaches Authorization, preserves SSE content type, heartbeat bytes, cancellation, `Last-Event-ID`, no buffering, and a bounded long-stream timeout.
- Intelligence POST streaming also traverses the registered BFF path. No client bearer header is constructed.
- Multipart document uploads are size-bounded and proxied unchanged after session/CSRF/origin checks.
- File downloads use same-origin `/api/bff/v1/files`. Fastify independently verifies user membership and that the exact storage URL belongs to an allowed organization record before reading Storage. The BFF never fetches that URL itself. It forces `Content-Disposition: attachment` with a sanitized filename, `X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`.
- Fastify no longer accepts query-string credentials for `/v1/events` or `/v1/files`.

## Partner and external participant handling

Partner API keys are submitted once to `/api/auth/partner`. Next.js exchanges the key server-to-server, stores the resulting partner credential encrypted, returns only the partner ID, and replaces the browser session. Partner profile/offer requests use the partner-scoped BFF registry. No partner token is stored, passed between components, placed in a URL, or accepted by the generic client helper.

External invitation credentials (`txp_`) are scope-bound, revocable, one-time exchange material with a database-enforced 24-hour exchange deadline. The invitation URL reaches a server component and immediately redirects through `/api/auth/external`; browser JavaScript never parses the exchange value. Fastify atomically consumes the exchange and issues a distinct `txs_` participant credential with a maximum 12-hour life. Only Next.js receives and encrypts that credential. Replaying `txp_` fails, regular participant APIs reject it, and revoking the grant also revokes active `txs_` rows. The final `/external-access` URL contains no secret, so redirects and normal portal history do not retain credential material.

The initial invitation URL and the Supabase callback authorization code are narrowly scoped one-time bootstrap exceptions: both are short-lived, single-purpose, scope-bound, server-consumed, replay-protected, removed by immediate 303 redirect, and never treated as general application bearer credentials.

## Browser persistence and tenant switching

Production browser persistence is limited to presentation preferences: theme and a non-authoritative organization ID. On startup, the client idempotently removes legacy `traibox_auth_token`, partner token/ID, Supabase auth-storage keys, access/refresh-token-like keys, and `traibox.intel.stream.*` transcripts from both local and session storage. Intelligence conversation state is memory-only. There is no IndexedDB persistence path for auth, partner, transcript, document, Finance, approval, or protected-action data.

The saved organization ID is reconciled against the fresh Fastify membership list. Stale or cross-tenant values fall back safely. A change between two organizations clears the React Query cache, and pages reload organization-scoped state. The selector is forwarded as untrusted input; Fastify membership, role checks, RLS context, and object ownership still decide access.

## CORS and browser response headers

Fastify CORS denies browser origins by default in controlled profiles. `CORS_ORIGIN` is an exact allowlist; the only fallback is `http://localhost:3000` under the explicit non-controlled dev profile. Wildcard origin/credentials combinations are not used, and admin/internal headers are absent from the allowlist. Hijacked Intelligence streaming no longer reflects arbitrary Origin values.

Next.js sets a practical CSP with `default-src 'self'`, no wildcard script/connect sources, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, and `form-action 'self'`. Next.js hydration currently requires the documented temporary production `script-src 'unsafe-inline'`; `unsafe-eval` exists only in local Next development for source transformation and is omitted in production. Headers also include `nosniff`, strict-origin referrer policy, restrictive Permissions Policy, DENY framing, same-origin opener policy, and production HSTS.

## Threat treatment

- **XSS:** HTTP-only session and server-held credentials prevent direct token theft. XSS can still act as the user while active; CSP, no sensitive persistence, short idle expiry, CSRF rotation, and independent Fastify authorization reduce impact.
- **CSRF:** exact origin/referer plus session synchronizer token protects unsafe methods; no state-changing logout GET exists.
- **Fixation/replay:** every sign-in/refresh changes the opaque ID; old rows are atomically revoked. Callback, external exchange, and CSRF values are one-time or rotation-bound.
- **Token theft:** raw session IDs are never stored server-side; provider/partner/participant credentials use authenticated encryption and server-only keys; URL/file/event credentials were removed.
- **Redirect/history abuse:** exact return-path parsing and 303 cleanup prevent open redirects and durable callback/exchange material in normal browser history.
- **SSRF/path traversal:** the upstream base is server-only, routes and query keys are registered, redirects are disabled, and path segments are validated. File storage references are identifiers validated and fetched by Fastify, not network targets fetched by the BFF.
- **Cross-tenant confusion:** browser organization state is a preference only. Fastify checks membership/role and sets RLS context on each request; cache state is cleared at tenant switch.
- **Log leakage:** the new boundary does not log request cookies, Authorization, provider responses, callback code/state, magic-link material, or exchange values. Client errors are redacted. Deployment access logs should continue to redact query strings on the two bootstrap callback paths.

## Compatibility, rollout, rollback, and key rotation

Roll out the additive migration before web deployment, configure server-only database/API/Supabase/key/origin values, deploy Fastify with header-only event/file auth and external exchange support, then deploy Next.js. Existing browser token compatibility is intentionally not preserved. Users with legacy state are signed out and cleaned on next load. Existing C0.3 protected-action payload binding, approval consumption, tenant checks, and domain execution remain in Fastify and are unchanged.

Key rotation is forward-only: prepend a new key ID/value, deploy all Next.js instances, wait beyond the maximum session/auth-flow lifetime, then remove the old key. Emergency credential compromise uses the same new-key deploy plus revocation of session rows and provider sessions. Database rollback of V012 is not required for application rollback: old binaries ignore additive tables/columns. A security rollback should prefer forward-fix—disable web ingress or revoke sessions—because restoring browser bearer-token compatibility is prohibited.

## Residual risks

1. XSS can issue same-origin actions during an active session even though it cannot read the HTTP-only credential; CSP hardening should move Next.js inline bootstrapping to nonce/hash support when the framework deployment path is ready.
2. Invitation and auth callback bootstrap values necessarily appear in the first request URL. They are one-time and immediately cleaned, but hosting/CDN access-log query redaction must be verified operationally.
3. Expired/revoked security rows require an operational retention cleanup job; accumulation does not extend authority but should be bounded.
4. PostgreSQL compromise exposes encrypted provider material and key IDs; compromise of both PostgreSQL and the server environment/keyring exposes active credentials. Database and deployment-secret access remain separate operational controls.
5. The BFF has no domain response cache. This is intentional for C0.4; future caching requires tenant-keyed design and a separate governed review.
