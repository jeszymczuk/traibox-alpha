# Pulse Connectors — Design

**Status:** Proposed · not implemented
**Scope:** Turn Pulse from an internal-signals view (trade-memory insights + SSE) into a live external-signal surface: user-configured "pulses" that pull fresh data on open and accept webhook pushes, with every signal landing as a governed event.
**Origin:** Founder suggestion (2026-07-08): pulses should behave like webhooks and retrieve real data when a pulse is opened.

---

## 1. Principles

1. **Every external signal becomes a governed event.** Pulse stays a *view over the rails*, not a parallel feed — signals thread into trade memory, Trade Room streams, and the audit chain exactly like internal events, so insights can reason over them.
2. **Pull-on-open is the default; push is the upgrade.** Most sources (FX rates, news queries, schedules) don't push. Opening a pulse triggers an on-demand, rate-limited fetch so data is fresh at the moment of attention. Sources that can push (carrier tracking, payment providers, market alert services) additionally register a webhook.
3. **Signals are advisory.** A pulse can flag ("SGD weakened 1.2% — affects TRX-00501") but never mutates trade state; acting on a signal goes through the normal governed flows.
4. **Per-org isolation.** Connector credentials, queries, and results are org-scoped under RLS like everything else.

## 2. Architecture

```
            ┌─────────────────────────────────────────────────────────┐
 webhook    │ apps/api                                                │
 (push) ───▶│ POST /webhooks/pulse/:connector ─▶ pulse_signals        │
            │        │  dedupe: (org, connector, external_id) — V005  │
            │        ▼                                                │
 open pulse │ POST /v1/pulse/:subscriptionId/refresh (pull-on-open)   │
 (pull) ───▶│   adapter.fetch() → normalize → pulse_signals           │
            │        │  rate limit + freshness window per connector   │
            │        ▼                                                │
            │ insertEvent('pulse.signal', …) → SSE → /intelligence    │
            └─────────────────────────────────────────────────────────┘
```

- **Adapters** live beside `truelayer.ts` / `payment-adapters.ts` as the reference shape: `fetch(config) → NormalizedSignal[]`, plus optional `verifyWebhook(headers, body)` and `parseWebhook(body) → NormalizedSignal[]`.
- **Pull-on-open**: the Pulse tab calls `refresh` for visible subscriptions whose `last_fetched_at` is older than the connector's freshness window (e.g. FX 5 min, news 30 min). Cache-hit returns stored signals instantly; miss fetches live. This is the founder's "retrieve real data when opening a pulse" — attention-driven freshness without background polling cost.
- **Push**: reuses the `V005__webhook_dedupe` pattern (unique on `(org_id, provider_id, topic, dedupe_key)`); signature verification per connector.
- **Scheduled sweep (optional, Stage 2 worker)**: subscriptions may opt into background refresh via the `apps/worker` scheduler so blocked-severity signals can alert even when nobody is looking.

## 3. Data model (migration `V0xx__pulse.sql`)

```sql
pulse_subscriptions (
  subscription_id uuid PK,
  org_id uuid NOT NULL REFERENCES orgs,
  connector_id text NOT NULL,           -- 'fx_rates' | 'news' | 'carrier_tracking' | …
  label text NOT NULL,                  -- "EUR/SGD watch"
  config jsonb NOT NULL,                -- {pair:'EURSGD', threshold_pct:1.0} — validated per adapter
  trade_id uuid NULL REFERENCES trades, -- optional scoping: signal auto-links to the trade
  mode text NOT NULL DEFAULT 'pull',    -- pull | push | both
  freshness_seconds int NOT NULL DEFAULT 300,
  last_fetched_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active',-- active | paused | error
  created_at / updated_at
)

pulse_signals (
  signal_id uuid PK,
  org_id, subscription_id FK,
  external_id text NULL,                -- dedupe key for pushed signals
  severity text NOT NULL,               -- info | watch | blocked
  source text NOT NULL,                 -- short chip label: FX, NEWS, CARRIER…
  title text NOT NULL,
  detail text NULL,
  affects jsonb NULL,                   -- {trade_ids:[], amount_impact:…}
  raw jsonb NULL,
  observed_at timestamptz NOT NULL,
  created_at
)
```

## 4. API surface

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/pulse/connectors` | catalog of available adapters + config schemas |
| GET/POST | `/v1/pulse/subscriptions` | list / create (config validated by adapter schema) |
| PATCH/DELETE | `/v1/pulse/subscriptions/:id` | pause, edit, remove |
| POST | `/v1/pulse/subscriptions/:id/refresh` | **pull-on-open**; returns fresh or cached signals with `fetched: live\|cache` |
| GET | `/v1/pulse/signals` | org-scoped feed (merged into the Pulse tab alongside memory insights) |
| POST | `/webhooks/pulse/:connector` | push ingestion, HMAC-verified, deduped |

## 5. Pilot connectors (in build order)

1. **FX rates** (pull) — free public API (e.g. frankfurter.app, no key); config = currency pair + move threshold; `affects` computed from trades whose plan currency matches. Proves the whole pull-on-open path with zero credential handling.
2. **News watch** (pull) — keyword/entity query against a news API; entities default to counterparty names on file.
3. **Carrier tracking** (push+pull) — container/booking reference; webhook when the provider supports it; signals feed the Trade Room lifecycle (`lifecycle.Ship` — this is the event the escrow conditions design wants).
4. **Regulatory calendar** (pull) — CBAM/filing deadlines from a maintained dataset; blocked-severity as deadlines approach.

## 6. UI deltas (small — the v9 Pulse shell exists)

The Pulse tab gains a "Your pulses" section above the insight feed: subscription chips with live/cached freshness stamps, an "Add a pulse" flow (connector picker → config form → optional trade scope), and pull-on-open wiring (refresh visible subscriptions on tab mount). External signals render as the same v9 `signal` rows with the connector chip as `source`. Signals with `trade_ids` deep-link to the Trade Room, whose stream shows them via the existing SSE path.

## 7. Rollout

1. **Phase 0:** schema + subscriptions CRUD + FX adapter with pull-on-open, UI section behind `profile.pulse.enabled`.
2. **Phase 1:** news adapter + trade auto-linking + severity thresholds.
3. **Phase 2:** webhook ingestion + carrier tracking + worker background sweep for blocked-severity monitors.

## 8. Open questions

- Credential storage for keyed connectors (per-org encrypted config vs. platform-level keys with per-org quotas) — FX/news pilots avoid this; carrier tracking forces the decision.
- Whether a pulse signal should be able to *create* attention items (e.g. auto-open an exception in Operations Center) or only inform — leaning: inform only until the recurring-workflow scheduler exists, then policy-gated escalation.
