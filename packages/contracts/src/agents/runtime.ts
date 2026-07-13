import type { UUID } from '../index';
import type { CanonicalObjectRef, CapitalAuthorityLevel, PrincipalType } from './common';

/**
 * INTERNAL runtime task contract (Phase 2 hardening, directive A1).
 *
 * The public `CapitalAgentTaskRequest` (agents/capital.ts) is what surfaces
 * submit; the TypeScript API authenticates the user, resolves organization and
 * principal, loads the exact mandate, and produces this fully RESOLVED task.
 * The governed Python runner consumes ONLY this shape and re-validates it —
 * nothing here is defaulted, inferred from conversation, or resolved
 * implicitly during execution.
 */

export const AGENT_RUNTIME_TASK_CONTRACT_VERSION = 'agent-runtime-task-v1' as const;

export interface ResolvedTaskConstraints {
  timeout_seconds?: number;
  max_model_steps?: number;
  max_tool_calls?: number;
  max_output_tokens?: number;
  max_cost_usd?: number;
  deadline?: string;
}

export interface ResolvedDocumentInput {
  source_id: string;
  content: string;
  content_hash?: string;
  media_type?: string;
}

export interface ResolvedAgentTask {
  contract_version: typeof AGENT_RUNTIME_TASK_CONTRACT_VERSION;
  task_id: UUID;
  /** Exact agent + definition version — never implicitly "the active one". */
  agent_id: string;
  definition_version: string;
  objective: string;
  /** Org-backed principal: principal_id equals organization_id (CA-113). */
  principal_id: UUID;
  principal_type: PrincipalType;
  organization_id: UUID;
  /** Exact mandate version, loaded server-side before resolution. */
  mandate_id: UUID;
  mandate_version: number;
  requested_outcome_type: string;
  /** Explicit — never defaulted, never inferred from objective text. */
  requested_authority: CapitalAuthorityLevel;
  trace_id: string;
  idempotency_key: string;
  tool_scope: string[];
  data_scope: string[];
  constraints: ResolvedTaskConstraints;
  authorized_object_refs: CanonicalObjectRef[];
  documents?: ResolvedDocumentInput[];
}
