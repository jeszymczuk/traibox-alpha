import { describe, expect, it } from 'vitest';
import type { ReplayStep } from '@traibox/contracts';

import { buildReplayHashPayload, replayCoverageGaps } from './replay-coverage';

const baseStep: ReplayStep = {
  step_id: 'object:1',
  source: 'object',
  kind: 'object.payment_intent',
  title: 'Payment intent',
  summary: 'Created',
  occurred_at: '2026-05-19T08:20:00.000Z',
  trade_id: null,
  object_id: '00000000-0000-0000-0000-000000000001',
  trace_id: 'trc_1',
  actor: null,
  status: 'pending_input',
  payload_json: { type: 'payment_intent' }
};

describe('replay coverage domain rules', () => {
  it('builds deterministic hash input from replay-relevant fields only', () => {
    expect(buildReplayHashPayload([{ ...baseStep, title: 'Changed title that should not affect replay hash input' }])).toEqual([
      {
        source: 'object',
        kind: 'object.payment_intent',
        occurred_at: '2026-05-19T08:20:00.000Z',
        trade_id: null,
        object_id: '00000000-0000-0000-0000-000000000001',
        trace_id: 'trc_1',
        status: 'pending_input',
        hash: null,
        payload_json: { type: 'payment_intent' }
      }
    ]);
  });

  it('reports missing replay coverage for trade-scoped replay', () => {
    expect(replayCoverageGaps([baseStep], { requestedTradeId: 'trade-1', requestedObjectId: null, includeAudit: true })).toEqual([
      'No Trade Memory events are present in replay scope.',
      'No audit-chain events are present in replay scope.',
      'No readiness state is present for this trade replay.',
      'No proof bundle is present for this trade replay.'
    ]);
  });

  it('passes coverage when the replay scope contains object, memory, audit, readiness, and proof', () => {
    const steps: ReplayStep[] = [
      baseStep,
      { ...baseStep, step_id: 'memory:1', source: 'memory', kind: 'proof.completed' },
      { ...baseStep, step_id: 'audit:1', source: 'audit', kind: 'alpha.proof.bundle.ready' },
      { ...baseStep, step_id: 'readiness:1', source: 'readiness', kind: 'readiness.evaluated' },
      { ...baseStep, step_id: 'proof:1', source: 'proof', kind: 'proof.bundle.ready' }
    ];

    expect(replayCoverageGaps(steps, { requestedTradeId: 'trade-1', requestedObjectId: null, includeAudit: true })).toEqual([]);
  });
});
