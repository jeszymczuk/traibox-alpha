import type { AlphaObjectType, ProtectedActionKind } from '@traibox/contracts';

/**
 * Registry-driven specialist agents (Stage 2). A specialist is configuration over
 * the existing governed substrate — scoped runtime policy, agent-task lifecycle,
 * streamed narrative, governed artifact object, proposed (never executed)
 * protected action. Adding a specialist means adding an entry here plus a worker
 * module under ./specialists; no new endpoints, migrations, or action kinds.
 *
 * Load-bearing wording: `objective()` output is regex-scanned by
 * inferApprovalGates (agent-runtime.ts) — the word "payment" silently adds a
 * send_payment gate — and keyword-matched by the web Agents tab to flip a
 * specialist ACTIVE. Keep it aligned with both.
 */
export type SpecialistScope = {
  permittedTools: string[];
  dataAccess: string[];
  writePermissions: string[];
  approvalGates: ProtectedActionKind[];
  timeBudgetSeconds: number;
};

export type SpecialistDefinition = {
  id: string;
  /** Must match the web AGENT_CLASSES display name for @-mention resolution. */
  displayName: string;
  description: string;
  /** Governed object the run produces. */
  objectType: AlphaObjectType;
  /** Gate the run proposes for human approval (never executes). */
  proposedProtectedAction: ProtectedActionKind | null;
  scope: SpecialistScope;
  objective: (ctx: { tradeId?: string | null }) => string;
};

export const AGENT_REGISTRY: Record<string, SpecialistDefinition> = {
  capital_agent: {
    id: 'capital_agent',
    displayName: 'Capital Agent',
    description: 'Assembles a financing packet from the trade book: options, offers, readiness gaps, and the evidence pack.',
    objectType: 'funding_request',
    proposedProtectedAction: 'submit_funding_request',
    scope: {
      permittedTools: ['memory.query', 'readiness.evaluate', 'funding.prepare', 'attachments.suggest', 'approvals.request'],
      dataAccess: ['selected_objects', 'trade_room_memory_l1', 'organization_memory_l2', 'readiness_states', 'audit_replay'],
      writePermissions: ['create_agent_task', 'create_agent_work_result', 'create_memory_event', 'recommend_next_action', 'create_approval_request'],
      approvalGates: ['submit_funding_request'],
      timeBudgetSeconds: 120
    },
    // "financing"/"funding" infers the submit_funding_request gate and matches the
    // Agents-tab keywords ('fund','financ',…). Deliberately avoids "payment".
    objective: (ctx) => (ctx.tradeId ? `Assemble a financing packet for trade ${ctx.tradeId}` : 'Assemble a financing packet from the current funding book')
  }
};

/**
 * Resolve a specialist from an explicit agent id, falling back to a leading
 * "@Display Name" mention in the message (the attach-menu's legacy affordance).
 */
export function resolveSpecialist(agentId?: string | null, message?: string | null): SpecialistDefinition | null {
  if (agentId) {
    const direct = AGENT_REGISTRY[agentId.trim().toLowerCase()];
    if (direct) return direct;
  }
  const text = (message ?? '').trimStart();
  if (text.startsWith('@')) {
    for (const specialist of Object.values(AGENT_REGISTRY)) {
      if (text.toLowerCase().startsWith(`@${specialist.displayName.toLowerCase()}`)) return specialist;
    }
  }
  return null;
}

/** Strip a leading "@Display Name" mention so the model sees the real request. */
export function stripSpecialistMention(message: string, specialist: SpecialistDefinition): string {
  const mention = `@${specialist.displayName}`;
  const trimmed = message.trimStart();
  if (trimmed.toLowerCase().startsWith(mention.toLowerCase())) {
    return trimmed.slice(mention.length).trimStart();
  }
  return message;
}
