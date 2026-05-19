import type { ReplayStep } from '@traibox/contracts';

export function buildReplayHashPayload(steps: ReplayStep[]) {
  return steps.map((step) => ({
    source: step.source,
    kind: step.kind,
    occurred_at: step.occurred_at,
    trade_id: step.trade_id ?? null,
    object_id: step.object_id ?? null,
    trace_id: step.trace_id ?? null,
    status: step.status ?? null,
    hash: step.hash ?? null,
    payload_json: step.payload_json
  }));
}

export function replayCoverageGaps(
  steps: ReplayStep[],
  scope: { requestedTradeId: string | null; requestedObjectId: string | null; includeAudit: boolean }
): string[] {
  const gaps = new Set<string>();
  if (!steps.length) gaps.add('No replayable activity found for this scope.');
  if (!steps.some((step) => step.source === 'object')) gaps.add('No canonical object snapshot is present in replay scope.');
  if (!steps.some((step) => step.source === 'memory')) gaps.add('No Trade Memory events are present in replay scope.');
  if (scope.includeAudit && !steps.some((step) => step.source === 'audit')) gaps.add('No audit-chain events are present in replay scope.');
  if (scope.requestedTradeId && !steps.some((step) => step.source === 'readiness')) gaps.add('No readiness state is present for this trade replay.');
  if (scope.requestedTradeId && !steps.some((step) => step.source === 'proof')) gaps.add('No proof bundle is present for this trade replay.');
  return [...gaps];
}
