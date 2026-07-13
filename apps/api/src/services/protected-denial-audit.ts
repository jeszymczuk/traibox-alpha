import type pg from 'pg';
import { setAppContext, withTx } from '@traibox/db';
import { idempotencyFingerprint } from '../domains/approvals/protected-execution.js';

export type AuditedProtectedAction = 'send_payment' | 'accept_funding_offer';

export async function recordProtectedDenial(
  pool: pg.Pool,
  input: {
    orgId: string;
    userId: string;
    traceId: string;
    action: AuditedProtectedAction;
    target: { type: 'payment_intent' | 'funding_offer'; id?: string | null };
    approvalId?: string | null;
    code: string;
    classification: string;
    payloadHash?: string | null;
    idempotencyKey?: string | null;
  }
): Promise<void> {
  if (!input.orgId || !input.userId) return;
  const evidence: Record<string, unknown> = {
    action: input.action,
    target: {
      type: input.target.type,
      ...(safeUuid(input.target.id) ? { id: safeUuid(input.target.id) } : {})
    },
    ...(safeUuid(input.approvalId) ? { approval_id: safeUuid(input.approvalId) } : {}),
    actor_id: input.userId,
    org_id: input.orgId,
    trace_id: input.traceId,
    classification: input.classification,
    error_code: input.code,
    ...(isSha256(input.payloadHash) ? { payload_hash: input.payloadHash, payload_hash_scope: 'attempted_canonical_execution' } : {}),
    ...(safeText(input.idempotencyKey) ? { idempotency_fingerprint: idempotencyFingerprint(input.idempotencyKey!) } : {}),
    at: new Date().toISOString()
  };
  await withTx(pool, async (client) => {
    await setAppContext(client, { userId: input.userId, orgId: input.orgId });
    await client.query('INSERT INTO audit_events(org_id, trade_id, actor, action, payload_json) VALUES($1,$2,$3,$4,$5)', [
      input.orgId,
      null,
      `user:${input.userId}`,
      'protected_execution.denied',
      JSON.stringify(evidence)
    ]);
  });
}

function safeText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

function safeUuid(value: unknown): string | null {
  const normalized = safeText(value);
  return normalized && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}
