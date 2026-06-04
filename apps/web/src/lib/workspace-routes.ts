import type { ObjectRouteConfig } from '../components/object-workspace';

export const intelligenceSessionsConfig: ObjectRouteConfig = {
  eyebrow: 'Intelligence · Sessions',
  title: 'Turn conversations into governed trade work.',
  description: 'Inspect intelligence sessions, agent work, structured outputs, evidence, recommendations, and the trade context they can create or update.',
  workspace: 'intelligence',
  types: ['agent_task', 'agent_work_result'],
  detailBase: '/intelligence/sessions',
  emptyTitle: 'No intelligence sessions yet',
  emptyBody: 'Ask TRAIBOX to structure fragmented trade activity or launch a governed agent task.',
  primaryHref: '/intelligence',
  primaryLabel: 'Start intelligence session',
  accent: 'blue'
};

export const intelligenceRunsConfig: ObjectRouteConfig = {
  ...intelligenceSessionsConfig,
  eyebrow: 'Intelligence · Agent Runs',
  title: 'Inspect scoped agent work and replayable outcomes.',
  description: 'Every run declares its objective, permitted tools, inputs, policy constraints, model usage, result, and human decision.',
  types: ['agent_task', 'agent_work_result', 'ai_eval_result'],
  detailBase: '/intelligence/runs',
  emptyTitle: 'No agent runs yet'
};

export const fundingConfig: ObjectRouteConfig = {
  eyebrow: 'Finance · Funding',
  title: 'Make funding requests finance-ready.',
  description: 'Track funding requests, offers, missing proof, approval gates, and attach-to-trade lineage without forcing a full transaction first.',
  workspace: 'finance',
  types: ['funding_request', 'funding_offer', 'trade_finance_instrument'],
  detailBase: '/finance/funding',
  emptyTitle: 'No funding workflows yet',
  emptyBody: 'Create a standalone funding request from Finance, then attach it when broader trade context becomes useful.',
  primaryHref: '/finance',
  primaryLabel: 'Create funding request',
  accent: 'green'
};

export const paymentsConfig: ObjectRouteConfig = {
  ...fundingConfig,
  eyebrow: 'Finance · Payments',
  title: 'Prepare payment execution with human control.',
  description: 'Inspect payment intents, routes, readiness, approvals, and proof before money movement is released.',
  types: ['payment_intent', 'payment_route'],
  detailBase: '/finance/payments',
  emptyTitle: 'No payment intents yet',
  primaryLabel: 'Create payment intent'
};

export const counterpartiesConfig: ObjectRouteConfig = {
  eyebrow: 'Network · Counterparties',
  title: 'Build reusable counterparty trust context.',
  description: 'Inspect onboarding, screening, Trade Passport visibility, evidence, and friction before reusing a counterparty across trades.',
  workspace: 'network',
  types: ['counterparty', 'onboarding_flow', 'screening_result', 'trade_passport', 'matchmaking_result'],
  detailBase: '/network/counterparties',
  emptyTitle: 'No counterparties yet',
  emptyBody: 'Start onboarding or screening from Network to create reusable trust context.',
  primaryHref: '/network',
  primaryLabel: 'Onboard counterparty',
  accent: 'amber'
};

export const invitationsConfig: ObjectRouteConfig = {
  ...counterpartiesConfig,
  eyebrow: 'Network · Invitations',
  title: 'Coordinate external participation without permission drift.',
  description: 'Review scoped invitations and external access grants with expiry, target context, audit, and memory visibility.',
  types: ['external_access_grant', 'onboarding_flow'],
  detailBase: '/network/counterparties',
  emptyTitle: 'No invitations or external grants yet',
  primaryLabel: 'Create network action'
};

export const passportConfig: ObjectRouteConfig = {
  eyebrow: 'Clearance · Trade Passport',
  title: 'Inspect reusable proof of trade readiness.',
  description: 'Review identity, trust context, evidence provenance, clearance signals, and controlled visibility in one reusable passport.',
  workspace: 'clearance',
  types: ['trade_passport', 'counterparty', 'screening_result'],
  detailBase: '/clearance/passport',
  emptyTitle: 'No Trade Passport yet',
  emptyBody: 'Create onboarding and screening context, then build a reusable Trade Passport.',
  primaryHref: '/clearance',
  primaryLabel: 'Create clearance workflow',
  accent: 'amber'
};

export const complianceConfig: ObjectRouteConfig = {
  ...passportConfig,
  eyebrow: 'Clearance · Compliance Requirements',
  title: 'Resolve requirements with evidence, not checklists alone.',
  description: 'Inspect clearance checks, risk findings, rule-pack requirements, missing evidence, and approval gates.',
  types: ['clearance_check', 'risk_finding', 'screening_result'],
  detailBase: '/clearance/compliance/requirements',
  emptyTitle: 'No compliance requirements yet'
};

export const reportsConfig: ObjectRouteConfig = {
  ...passportConfig,
  eyebrow: 'Clearance · Reports',
  title: 'Generate reports backed by structured evidence.',
  description: 'Inspect report readiness, evidence provenance, proof lineage, and the trade or standalone workflow behind each result.',
  types: ['report', 'proof_bundle'],
  detailBase: '/clearance/reports',
  emptyTitle: 'No clearance reports yet'
};

export const proofConfig: ObjectRouteConfig = {
  eyebrow: 'Trades · Proof',
  title: 'Verify the evidence trail behind execution.',
  description: 'Inspect proof bundle readiness, artifact lineage, approvals, replay steps, and controlled sharing context.',
  workspace: 'trades',
  types: ['proof_bundle', 'document', 'approval', 'readiness_state'],
  emptyTitle: 'No proof bundle yet',
  emptyBody: 'Generate proof from the Trade Room after readiness and governed execution artifacts exist.',
  primaryHref: '/trades',
  primaryLabel: 'Open Trades',
  accent: 'blue'
};
