import {
  ALPHA_SCENARIOS,
  PILOT_ISSUE_SEVERITIES,
  PILOT_SESSION_OUTCOMES,
  type AlphaObject,
  type AlphaScenarioId,
  type ObjectLifecycleStatus,
  type PilotIssueSeverity,
  type PilotSessionOutcome,
  type PilotSessionPayload
} from '@traibox/contracts';

export type PilotSessionRecordInput = {
  participantAlias: string;
  scenarioId: AlphaScenarioId;
  outcome: PilotSessionOutcome;
  issueSeverity: PilotIssueSeverity;
  notes: string;
};

export type PilotCohortSummary = {
  sessions: AlphaObject[];
  participantCount: number;
  completedCount: number;
  blockedCount: number;
  criticalIssueCount: number;
  scenarioCoverageCount: number;
  scenarioTotal: number;
  scenarioCoveragePercent: number;
};

export function isPilotSessionReport(object: AlphaObject): boolean {
  return object.type === 'report' && object.payload_json?.artifact_kind === 'controlled_pilot_session';
}

export function readPilotSessionPayload(object: AlphaObject): PilotSessionPayload | null {
  if (!isPilotSessionReport(object)) return null;
  const payload = object.payload_json;
  const participantAlias = typeof payload.participant_alias === 'string' ? payload.participant_alias.trim() : '';
  const scenarioId = payload.scenario_id;
  const outcome = payload.outcome;
  const issueSeverity = payload.issue_severity;
  if (!participantAlias) return null;
  if (!ALPHA_SCENARIOS.some((scenario) => scenario.id === scenarioId)) return null;
  if (!PILOT_SESSION_OUTCOMES.includes(outcome as PilotSessionOutcome)) return null;
  if (!PILOT_ISSUE_SEVERITIES.includes(issueSeverity as PilotIssueSeverity)) return null;

  return {
    artifact_kind: 'controlled_pilot_session',
    schema_version: 'pilot-session-v1',
    participant_alias: participantAlias,
    scenario_id: scenarioId as AlphaScenarioId,
    outcome: outcome as PilotSessionOutcome,
    issue_severity: issueSeverity as PilotIssueSeverity,
    ...(typeof payload.notes === 'string' && payload.notes.trim() ? { notes: payload.notes.trim() } : {}),
    recorded_at: typeof payload.recorded_at === 'string' ? payload.recorded_at : object.created_at,
    evidence: isRecord(payload.evidence) ? (payload.evidence as PilotSessionPayload['evidence']) : {}
  };
}

export function buildPilotCohortSummary(objects: AlphaObject[]): PilotCohortSummary {
  const sessions = objects.filter(isPilotSessionReport).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const payloads = sessions.map(readPilotSessionPayload).filter((payload): payload is PilotSessionPayload => payload !== null);
  const participants = new Set(payloads.map((payload) => payload.participant_alias.toLocaleLowerCase()));
  const coveredScenarios = new Set(payloads.filter((payload) => payload.outcome === 'completed').map((payload) => payload.scenario_id));
  const completedCount = payloads.filter((payload) => payload.outcome === 'completed').length;
  const blockedCount = payloads.filter((payload) => payload.outcome === 'blocked').length;
  const criticalIssueCount = payloads.filter((payload) => payload.issue_severity === 'critical').length;
  const scenarioTotal = ALPHA_SCENARIOS.length;

  return {
    sessions,
    participantCount: participants.size,
    completedCount,
    blockedCount,
    criticalIssueCount,
    scenarioCoverageCount: coveredScenarios.size,
    scenarioTotal,
    scenarioCoveragePercent: Math.round((coveredScenarios.size / scenarioTotal) * 100)
  };
}

export function pilotOutcomeToLifecycleStatus(outcome: PilotSessionOutcome): ObjectLifecycleStatus {
  if (outcome === 'scheduled') return 'draft';
  if (outcome === 'in_progress') return 'in_progress';
  if (outcome === 'completed') return 'completed';
  if (outcome === 'blocked') return 'blocked';
  return 'cancelled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
