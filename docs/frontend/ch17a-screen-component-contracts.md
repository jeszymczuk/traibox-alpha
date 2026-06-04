# Ch.17.A — Screen & Component Contracts (Implementation Copy)

Status: active frontend contract baseline aligned with approved Ch.17 / Ch.17.A.

## 1) Mandatory Screen Contract Template

Use this template for each production route:

```text
SCREEN CONTRACT

Screen name:
Route:
Workspace:
Purpose:
Primary user / persona:
Secondary users:
Entry points:
Required data:
Primary object:
Secondary objects:
Primary CTA:
Secondary actions:
Context panel mode (default):
Events subscribed to:
Events emitted:
Loading state:
Empty state:
Error state:
Permission-denied state:
Offline / degraded state:
AI-unavailable behavior:
SSE-disconnected behavior:
Protected actions on this screen:
Evidence generated:
Audit events emitted:
Mobile behavior:
Accessibility requirements:
Golden paths this screen participates in:
```

## 2) Implemented Route Coverage (v6.1-aligned)

Canonical routes now implemented:

- `/intelligence`
- `/intelligence/sessions/[sessionId]`
- `/intelligence/runs/[runId]`
- `/trades`
- `/trades/[tradeId]`
- `/trades/[tradeId]/proof`
- `/finance`
- `/finance/funding`
- `/finance/funding/[fundingId]`
- `/finance/payments/[paymentId]`
- `/network`
- `/network/counterparties/[partyId]`
- `/network/invitations`
- `/clearance`
- `/clearance/passport/[passportId]`
- `/clearance/compliance/requirements/[requirementId]`
- `/clearance/reports/[reportId]`
- `/operations-center`
- `/operations-center/approvals`
- `/settings`
- `/settings/policies`
- `/settings/permissions`

Compatibility route:
- `/trade/[tradeId]` redirects to `/trades/[tradeId]`.

All canonical routes use organization-scoped, API-backed workspace screens. Detail routes expose structured records, readiness, evidence provenance, Trade Memory, replay, proof generation, and attach-to-trade behavior where relevant. Approval and governance routes use dedicated protected-action and policy interfaces.

## 3) Working Contracts (Core Demo Surfaces)

### 3.1 Intelligence Home
- Route: `/intelligence`
- Purpose: action-oriented AI workspace to parse intent, extract docs, launch governed agents, and attach results to trade context.
- Primary CTA: run intelligence request.
- Protected actions: never directly executed; approval flow required.
- Evidence: created objects, readiness updates, agent task artifacts, memory events.

### 3.2 Trades Hub
- Route: `/trades`
- Purpose: create and monitor Trade Rooms, start full lifecycle from messy input, run reference story.
- Primary CTA: create trade room or run full story.
- Evidence: trade objects, readiness states, approvals, proof bundles, timeline events.

### 3.3 Trade Room
- Route: `/trades/[tradeId]`
- Purpose: operational center for readiness, execution, approvals, proof, and attach/link/convert actions.
- Primary CTA: next governed action from readiness state.
- Protected actions: payment/funding/clearance declarations require approval.
- Evidence: approval objects, proof bundles, replay trace, audit/memory events.

### 3.4 Operations Center
- Route: `/operations-center`
- Purpose: global queue for attention/approvals/exceptions with context-aware drill-through.
- Primary CTA: resolve top-priority blocked/pending item.
- Evidence: approval decisions, task updates, eval run records, audit verification artifacts.

### 3.5 External Access
- Route: `/external-access`
- Purpose: scoped participant portal for token-bound actions (document/task/onboarding submissions).
- Primary CTA: submit allowed scoped artifact/action.
- Protected actions: constrained by grant scopes and permission checks.
- Evidence: submission artifacts + audit/memory/proof trail.

## 4) Component Contract Baseline

Reusable components that require contract discipline:

- `AppShell`: workspace navigation, org scope, global context controls.
- `ObjectWorkspaceList`: queryable object queues with status/search filters, readiness, and trade context.
- `ObjectWorkspaceDetail`: structured detail surface with evidence, memory, replay, proof, readiness, and composition actions.
- `ApprovalQueue`: global protected-action decision surface with explicit human-control requirements.
- `GovernanceWorkspace`: role, scoped-access, policy, and protected-action governance views.
- `ProtectedActionApprovalCard`: explicit approval decision UX with step-up and risk acknowledgement.
- `ControlledExecutionTaskCard`: execution state updates with audit-safe fields.
- `TradeCard`: structured, non-chat-first action cards for critical trade surfaces.

Contract rule:
- New reusable component must declare inputs, outputs/events, loading/error states, and protected-action behavior.
