import type pg from 'pg';
import {
  ProtectedExecutionError,
  assertValidatedProtectedExecutionAuthorization,
  hashCanonicalPayload,
  isProtectedExecutionConsumption,
  type ProtectedExecutionConsumption,
  type ValidatedProtectedExecutionAuthorization
} from './protected-execution.js';

type ConsumptionInput = Omit<ProtectedExecutionConsumption, 'status' | 'action' | 'target' | 'payload_hash'>;

export async function consumeProtectedExecutionApproval(
  client: pg.PoolClient,
  authorization: ValidatedProtectedExecutionAuthorization,
  input: ConsumptionInput
): Promise<ProtectedExecutionConsumption> {
  assertValidatedProtectedExecutionAuthorization(authorization);
  const consumption: ProtectedExecutionConsumption = Object.freeze({
    status: 'succeeded',
    action: authorization.action,
    target: authorization.target,
    payload_hash: authorization.payloadHash,
    ...input
  });

  const updated = await client.query<{ payload_json: Record<string, unknown> }>(
    `UPDATE alpha_objects
        SET payload_json=jsonb_set(payload_json, '{protected_execution_consumption}', $1::jsonb, true),
            trace_id=$2
      WHERE object_id=$3
        AND org_id=$4
        AND type='approval'
        AND status='approved'
        AND NOT (payload_json ? 'protected_execution_consumption')
        AND payload_json->>'protected_action'=$5
        AND payload_json->'target'->>'type'=$6
        AND payload_json->'target'->>'id'=$7
        AND payload_json->'protected_execution_binding'->>'payload_hash'=$8
        AND payload_json->'protected_execution_binding'->>'org_id'=$4::text
      RETURNING payload_json`,
    [
      JSON.stringify(consumption),
      input.trace_id,
      authorization.approvalId,
      authorization.binding.org_id,
      authorization.action,
      authorization.target.type,
      authorization.target.id,
      authorization.payloadHash
    ]
  );
  if (updated.rowCount === 1) return consumption;
  if (updated.rowCount && updated.rowCount > 1) {
    throw unsafeBlocked('Approval consumption compare-and-set affected more than one row');
  }

  const current = await client.query<{ type: string; status: string; payload_json: Record<string, unknown> }>(
    `SELECT type, status, payload_json
       FROM alpha_objects
      WHERE object_id=$1 AND org_id=$2
      FOR UPDATE`,
    [authorization.approvalId, authorization.binding.org_id]
  );
  const row = current.rows[0];
  const existing = row?.payload_json?.protected_execution_consumption;
  if (!row || row.type !== 'approval' || row.status !== 'approved' || !isProtectedExecutionConsumption(existing)) {
    throw unsafeBlocked('Approval authorization is stale or no longer consumable');
  }
  if (hashCanonicalPayload(existing) !== hashCanonicalPayload(consumption)) {
    throw new ProtectedExecutionError(
      'approval_consumption_conflict',
      'Approval was already consumed with materially different immutable execution data',
      409,
      'approval_reuse_conflict'
    );
  }
  return existing;
}

function unsafeBlocked(message: string): ProtectedExecutionError {
  return new ProtectedExecutionError('unsafe_action_blocked', message, 403, 'stale_or_forged_authorization');
}
