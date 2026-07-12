# Capital Agent v1.1 — Data Flow

Normative boundary flow (Decision CA-102). Every arrow is a typed contract; every store is RLS-scoped to org + principal.

## 1. The governed flow (only path to canonical Finance change)

```text
[User (company principal)] ── objective ──▶ [Capital Agent task]
      (auth + org + role + mandate loaded server-side; never inferred from chat)
        │
        ▼
[Typed context reads]  ──▶ authorized trade + Finance context via CanonicalObjectRef
        │                   (relational layer AND alpha layer; read-only; no id joins across layers)
        ▼
[Capital outcome]  (lifecycle: requested → … → needs_information | calculating → draft_ready → finalised)
        │
        ▼
[Financial Workbench]  ──▶ FinancialCalculationRun (versioned calculator + formula,
        │                   input/result hashes, provenance, warnings) — LLM never does material arithmetic
        ▼
[Evidence bundle]  ──▶ typed EvidenceClaims (verified_fact | inference | assumption | estimate |
        │               calculation | recommendation | unresolved_question | contradiction)
        ▼
[Versioned Capital artifact]  (draft → review_ready → finalised → superseded; render never alters content)
        │
        ▼
[Recommendation]  (assessment vs recommendation vs commitment stages; agent never owns commitment)
        │
        ▼ (optional)
[Protected-action proposal]  (payload + payload hash + rationale claims + SoD + expiry + idempotency)
        │
        ▼
[Human approval]  (existing approval queue; binds to exact payload hash; proposer ≠ approver per SoD)
        │
        ▼
[Typed Finance command]  e.g. finance.create_funding_request
        │
        ▼
[Finance domain: INDEPENDENT validation]  (authz, principal, mandate, canonical state, proposal
        │                                   status, payload integrity+hash, approval, idempotency,
        │                                   expiry, SoD, provider requirements, eligibility)
        ▼
[Finance execution] ──▶ canonical Finance object / execution result (system of record: Finance)
```

**Hard rule:** no edge exists from analysis, calculation, recommendation, artifact generation, or monitoring directly to canonical Finance state. The spike's implicit `funding_request` insert (PR #26, alpha.ts `runSpecialistAgentStream`) is the anti-pattern this flow forbids.

## 2. Stores and ownership

| Store | Owner | Written by | Read by |
|---|---|---|---|
| `alpha_agent_tasks` (evolved: +principal/mandate/outcome refs) | Intelligence | agent runtime | surfaces, audit |
| `agent_mandates`, `agent_definitions` | Intelligence | admin/config flows | runtime (immutable per invocation) |
| `agent_outcomes`, `financial_calculation_runs`, `formula_registry` | Intelligence | runtime / Workbench | inspectors, artifacts, replay |
| `evidence_bundles/claims/references` | Intelligence | runtime | inspectors, approvals, replay |
| `capital_artifacts(+_versions)` | Intelligence | runtime (versions append-only) | surfaces, proposals |
| `protected_action_proposals` | Intelligence | runtime (proposal-only) | approval queue, Finance command handler |
| `memory_candidates`, `user_operating_profiles`, org finance profile | Intelligence (governed memory) | memory policy service | retrieval (purpose-bound) |
| `specialist_task_requests/reads` | Orchestration | orchestrator | lead agent, audit |
| Relational Finance tables + Finance alpha objects | **Finance** | **Finance command handlers only** | Capital Agent (typed reads) |
| Audit chain, events, workflow_runs | Platform | all of the above (append-only) | Operations Center, replay |

## 3. Trust boundaries

1. **User ↔ platform** — authenticated session; role/mandate resolved server-side.
2. **Model ↔ tools** — model requests are input, not authorization; typed tools enforce org/principal/mandate/RLS/field/purpose/sensitivity server-side; no unrestricted `readContext`.
3. **Documents ↔ agent** — uploaded/external documents are untrusted data; embedded instructions cannot alter policy, mandate, tools, authority, disclosure, workflow, or approvals.
4. **Intelligence ↔ Finance** — crossed only by the typed-command path above, post-approval, with independent Finance-side revalidation.
5. **Principal ↔ principal** — company memory/evidence/artifacts never visible to a future financier principal implicitly; cross-principal sharing only via explicit controlled disclosure packages (deferred with financier UX).
6. **Brain ↔ API** — service-token authenticated (`TRADE_BRAIN_SERVICE_TOKEN`, already on main).

## 4. What never flows

- Hidden chain-of-thought → any store (only concise rationale, inputs, formulas, evidence, assumptions, uncertainty, decisions).
- Document-embedded instructions → policy/mandate/tool scope.
- Company private memory → financier scope (future) without a disclosure package.
- Model output → provider execution, payment, offer acceptance, fund release (no such tool exists in the registry — structural, not policy).
- Agent recommendation → Finance authorization.
