import { describe, expect, it } from 'vitest';
import type { AlphaObject } from '@traibox/contracts';

import { buildPilotCohortSummary, pilotOutcomeToLifecycleStatus, readPilotSessionPayload } from './pilot-cohort';

describe('pilot cohort instrumentation', () => {
  it('summarizes participant, outcome, severity, and scenario coverage signals', () => {
    const objects = [
      pilotReport('one', 'SME-01', 'full_trade_room_loop', 'completed', 'none'),
      pilotReport('two', 'SME-01', 'standalone_payment', 'blocked', 'high'),
      pilotReport('three', 'SME-02', 'document_first', 'completed', 'critical'),
      alphaObject({ object_id: 'unrelated', type: 'report', payload_json: { artifact_kind: 'other_report' } })
    ];

    expect(buildPilotCohortSummary(objects)).toEqual(
      expect.objectContaining({
        participantCount: 2,
        completedCount: 2,
        blockedCount: 1,
        criticalIssueCount: 1,
        scenarioCoverageCount: 2,
        scenarioTotal: 6,
        scenarioCoveragePercent: 33
      })
    );
  });

  it('rejects malformed pilot payloads and maps outcomes to shared lifecycle states', () => {
    expect(readPilotSessionPayload(alphaObject({ payload_json: { artifact_kind: 'controlled_pilot_session' } }))).toBeNull();
    expect(pilotOutcomeToLifecycleStatus('scheduled')).toBe('draft');
    expect(pilotOutcomeToLifecycleStatus('in_progress')).toBe('in_progress');
    expect(pilotOutcomeToLifecycleStatus('completed')).toBe('completed');
    expect(pilotOutcomeToLifecycleStatus('blocked')).toBe('blocked');
    expect(pilotOutcomeToLifecycleStatus('cancelled')).toBe('cancelled');
  });
});

function pilotReport(
  id: string,
  participantAlias: string,
  scenarioId: string,
  outcome: string,
  issueSeverity: string
): AlphaObject {
  return alphaObject({
    object_id: id,
    status: outcome === 'completed' ? 'completed' : outcome === 'blocked' ? 'blocked' : 'in_progress',
    payload_json: {
      artifact_kind: 'controlled_pilot_session',
      schema_version: 'pilot-session-v1',
      participant_alias: participantAlias,
      scenario_id: scenarioId,
      outcome,
      issue_severity: issueSeverity,
      recorded_at: '2026-07-13T10:00:00.000Z',
      evidence: {}
    }
  });
}

function alphaObject(overrides: Partial<AlphaObject> = {}): AlphaObject {
  return {
    object_id: 'pilot-object',
    org_id: '00000000-0000-0000-0000-000000000001',
    type: 'report',
    status: 'completed',
    origin_workspace: 'operations',
    owner_id: '00000000-0000-0000-0000-000000000002',
    trade_id: null,
    title: 'Pilot session',
    summary: 'Controlled pilot evidence',
    payload_json: {},
    permissions_json: {},
    evidence_refs_json: [],
    audit_refs_json: [],
    trace_id: 'trc_pilot',
    created_at: '2026-07-13T10:00:00.000Z',
    updated_at: '2026-07-13T10:00:00.000Z',
    ...overrides
  };
}
