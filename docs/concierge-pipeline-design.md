# Concierge Pipeline — Design

**Status:** Proposed · not implemented
**Scope:** External counterparty email → triage → translation → AI-drafted reply → human-approved send, threaded into the governed Trade Room stream and the `/inbox` UI.
**Why now:** The v9 design (view-inbox, "Concierge inbox") promises triaged counterparty mail with one-click translations and drafts awaiting approval. Today `/inbox` threads internal `trade_messages` only — `role` is only ever written as `'user'`, and nothing ingests external mail. This doc specifies the missing pipeline so the backend work can be scheduled deliberately.

---

## 1. Principles (inherited from the platform)

1. **Nothing external is sent without explicit human approval.** Outbound replies are a protected action with the same typed-verb + approval-chain machinery as payments (`PROTECTED_ACTIONS` in `packages/contracts`); we add one kind: `send_external_message`.
2. **Originals are preserved.** Translation and drafting never mutate the source message; they attach derived artifacts with provenance (`model`, `prompt_rev`, `trace_id`).
3. **Everything is trade-scopable but nothing requires a trade.** Messages arrive unassigned, get classified, and can be attached to a trade the same way standalone alpha objects attach (`AttachMode` semantics).
4. **Deterministic ingestion, advisory intelligence.** Ingestion/dedupe/threading is deterministic code; classification, translation, and drafting are advisory agent outputs that a human confirms — mirroring the "AI explains; AI does not satisfy" stance of clearance and escrow.

## 2. Architecture

```
                 ┌────────────────────────────────────────────────────────────┐
 inbound email   │ apps/api                                                   │
 (provider push) │                                                            │
 ──────────────▶ │ POST /webhooks/inbound-email ──▶ email_messages (raw+meta) │
                 │        │ dedupe: (org, provider, message-id)               │
                 │        ▼                                                   │
                 │ concierge worker (apps/worker)                             │
                 │   1. thread-match  (References/In-Reply-To → email_threads)│
                 │   2. classify      (counterparty? trade? intent? urgency?) │
                 │   3. translate     (if lang ≠ org locale; store artifact)  │
                 │   4. draft reply   (tone-matched; store artifact)          │
                 │   5. emit SSE `concierge.message.triaged`                  │
                 │        ▼                                                   │
                 │ /v1/concierge/* read+action endpoints                      │
                 └────────────────────────────────────────────────────────────┘
                          ▼                                    ▲
                 apps/web /inbox (existing UI, extended)   approval + typed send
```

- **Ingestion** is a webhook, following the existing `/webhooks/payments` handler and the `V005__webhook_dedupe.sql` replay-protection pattern (unique on `(org_id, provider_id, topic, dedupe_key)`; dedupe key = RFC 5322 `Message-ID`). Provider adapters (Postmark/SES/Mailgun inbound parse — pick one for pilot) live beside `truelayer.ts` as the reference adapter shape. Each org gets a provisioned inbound address (`{org-slug}@mail.traibox.com`) plus optional BCC-forwarding for users who keep their own mailbox.
- **Processing** runs in `apps/worker` (which already exists for alpha workflow jobs — see `V009__alpha_workflow_worker.sql`), not in the request path. Each step writes its artifact and advances `email_messages.triage_status`; failures park the message in `triage_status='needs_human'` rather than dropping it.
- **LLM calls** go through the existing Trade Brain service boundary (`TRADE_BRAIN_URL`, profile-gated under `profile.tradebrain.*`), so model choice, timeouts, and eval hooks stay centralized. Dev profile runs a deterministic mock, same as HS-code mapping does today.

## 3. Data model (new migration `V011__concierge.sql`)

```sql
email_threads (
  thread_id uuid PK,
  org_id uuid NOT NULL REFERENCES orgs,
  subject_norm text,                 -- normalized subject for fallback threading
  counterparty_object_id uuid NULL,  -- link to alpha counterparty when matched
  trade_id uuid NULL REFERENCES trades,
  status text NOT NULL DEFAULT 'open',   -- open | snoozed | archived
  created_at / updated_at
)

email_messages (
  email_id uuid PK,
  org_id, thread_id FK,
  direction text NOT NULL,           -- inbound | outbound
  provider_id text, provider_message_id text,   -- dedupe pair
  from_addr text, from_name text, to_addrs jsonb, cc_addrs jsonb,
  subject text, body_text text, body_html text, attachments jsonb,
  lang_detected text,
  triage_status text NOT NULL DEFAULT 'received',
    -- received | classified | translated | drafted | needs_human | filed | replied
  classification jsonb,              -- {intent, urgency, trade_candidates[], confidence}
  received_at timestamptz, created_at
)

email_artifacts (
  artifact_id uuid PK,
  email_id FK, org_id,
  kind text NOT NULL,                -- translation | draft_reply | summary
  lang_from text, lang_to text,
  body text NOT NULL,
  provenance jsonb NOT NULL,         -- {model, prompt_rev, trace_id, tokens}
  superseded_by uuid NULL,           -- regenerated drafts chain, never overwrite
  created_at
)
```

RLS on `org_id` throughout, same `setAppContext` discipline as every other table. Attachments are stored via the existing document upload path (`/v1/documents/upload`) so extraction/readiness can consume them — an invoice arriving by email becomes the same `document` object a manual upload produces.

## 4. API surface

| Method | Path | Notes |
|---|---|---|
| POST | `/webhooks/inbound-email` | auth mode `webhook`, provider signature check, dedupe, 200-fast |
| GET | `/v1/concierge/threads` | org-scoped list w/ latest message, triage badges, counterparty + trade links |
| GET | `/v1/concierge/threads/:threadId` | full thread incl. artifacts |
| POST | `/v1/concierge/messages/:emailId/file` | attach thread to trade (`{trade_id, mode}`) — also mirrors a summary into `trade_messages` so the Trade Room stream shows "Concierge filed …" |
| POST | `/v1/concierge/messages/:emailId/retriage` | re-run classify/translate/draft (idempotency key) |
| POST | `/v1/concierge/messages/:emailId/draft` | regenerate draft with user guidance `{instructions, lang}` |
| POST | `/v1/concierge/messages/:emailId/send` | **protected action `send_external_message`** — requires approval per policy + typed verb `SEND`; body is the approved artifact id, not free text, so what was reviewed is what is sent |

`trade_messages.role` gains `'concierge'` for the mirrored stream entries (contract `ChatRole` union extension) — this is what finally makes the `/inbox` "TRAIBOX replies / awaiting you" metrics meaningful.

## 5. Agent loop details

- **Classification** (step 2): match `from_addr` domain against counterparty payloads and org invitations; candidate trades ranked by counterparty link, subject references (TRX ids, invoice numbers), and recency. Below `profile.concierge.autofile_confidence` (default 0.8) the message stays `needs_human` with candidates surfaced as chips — never silently filed.
- **Translation** (step 3): only when `lang_detected` ≠ org locale. Original always shown behind the v9 "Show original" toggle. Store as artifact, not in-place.
- **Drafting** (step 4): prompt assembled from thread history + linked trade context (readiness gaps, payment states) + org tone examples (last N outbound messages to this counterparty). Draft is `email_artifacts.kind='draft_reply'`; regeneration supersedes, preserving the chain for audit.
- **Auto-ack** (optional, per-profile flag, default **off**): even the "AUTO-ACK SENT" tag in v9 requires a standing, explicitly-configured policy (e.g. "acknowledge booking confirmations from known logistics senders") and is logged as a protected-action execution under that policy id.

## 6. Security & privacy

- Inbound webhook validates provider HMAC; raw MIME retained 30 days then stripped to parsed parts (configurable).
- Prompt inputs are org-scoped only; no cross-org tone examples, matching the "financiers see only their evidence" isolation stance.
- Outbound sending uses the provider's authenticated domain with per-org `Reply-To`; SPF/DKIM setup is a pilot-onboarding checklist item.
- Every artifact carries `trace_id` and lands in the audit chain (`appendAudit`) like other alpha mutations.

## 7. UI deltas (small — the v9 shell already exists)

`/inbox` swaps its data source from `listMessages` to `/v1/concierge/threads` when the profile flag `concierge.enabled` is on, else keeps today's internal-messages behavior. Adds: translated banner + show-original, draft card with Edit/Regenerate/Send (typed-verb modal already built for payments — reuse `pa-modal`), needs-you filter, file-to-trade picker. Trade Room stream gains `concierge`-role message styling (`tr-msg .av.proc` already in CSS).

## 8. Rollout

1. **Phase 0 (schema + ingestion):** migration, webhook, dedupe, raw listing behind profile flag. No AI.
2. **Phase 1 (triage):** worker classification + file-to-trade; `/inbox` shows real external mail with candidates.
3. **Phase 2 (translate + draft):** artifacts + regenerate; send stays manual copy-paste.
4. **Phase 3 (governed send):** `send_external_message` protected action + provider outbound + auto-ack policies.

Each phase is independently shippable and testable against the mock provider adapter in dev.

## 9. Open questions

- Provider choice for pilot (Postmark inbound parse is the least infra; SES is cheapest at volume).
- Whether `email_threads.counterparty_object_id` should auto-create a counterparty object on first contact from an unknown domain, or queue an "invite counterparty" suggestion (leaning: suggestion only — object creation is a user act).
- Retention/legal-hold policy per jurisdiction for raw mail — needs input before Phase 0 ships to real orgs.
