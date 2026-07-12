# Guidance for coding agents (Claude Code, Codex, others)

## Capital Agent v1.1 (active workstream)

- **Normative architecture:** [docs/architecture/agents/capital-agent-v1.1.md](docs/architecture/agents/capital-agent-v1.1.md). Do not redesign its domain boundaries. Companion Phase 0 docs (implementation plan, decision register, threat model, data flow, company roadmap, first vertical slice, evaluation plan) live in the same directory.
- **Scope:** the **complete company-side** Capital Agent is the approved product. Direct **financier** functionality is **deferred by sequencing only** — the foundation must stay principal-neutral and financier-compatible (`principal_type ∈ {company, financier, platform_internal}`; generic contracts, never `company_*` schemas). See decision register CA-100/CA-101.
- **Capital Agent ↔ Finance boundary (strict, CA-102):** Finance owns canonical financial state and execution. The Capital Agent produces outcomes, deterministic calculation runs, evidence, versioned artifacts, recommendations, and protected-action **proposals**. Canonical Finance objects are created/changed only via proposal → human approval → typed Finance command → **independent Finance-domain validation** → Finance execution. Analysis or artifact generation must never create or mutate canonical Finance state, and a recommendation is never authorization.
- **No protected execution from model output.** Ever. Proposal-only.
- **Material arithmetic** runs in the deterministic Financial Workbench, never in the LLM.
- **First vertical slice** ([capital-agent-first-vertical-slice.md](docs/architecture/agents/capital-agent-first-vertical-slice.md)) is an early milestone with a **founder feel-test checkpoint** — it is not the final product scope.
- **PR #26** is a non-authoritative, do-not-merge draft spike. Inspect for reference only; do not merge, build on, or recreate its packet-builder framing or implicit `funding_request` creation.
- Coding-agent config files (this file, CLAUDE.md, `.claude/`, SKILL.md) guide implementation only — production behavior lives in TRAIBOX code, schemas, policies, tools, workflows, and tests.

## Repository practices

- Package manager: `corepack pnpm`. Gates: `pnpm typecheck && pnpm test && pnpm test:trade-brain && pnpm eval:trade-brain:ci && pnpm build && pnpm db:migrate:dry-run`.
- Migrations are additive (`packages/db/migrations/VNNN__*.sql`); every new table gets RLS; the Trade Brain deterministic eval gate must stay green.
- Web: Next.js App Router under `apps/web/src/app`; design system via `apps/web/src/styles` module CSS + glass tokens.
