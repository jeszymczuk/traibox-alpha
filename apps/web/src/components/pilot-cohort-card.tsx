'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ClipboardCheck, ShieldAlert, UsersRound } from 'lucide-react';
import { ALPHA_SCENARIOS, PILOT_ISSUE_SEVERITIES, PILOT_SESSION_OUTCOMES, type AlphaObject, type AlphaScenarioId, type PilotIssueSeverity, type PilotSessionOutcome } from '@traibox/contracts';

import { buildPilotCohortSummary, readPilotSessionPayload, type PilotSessionRecordInput } from '../features/pilot/pilot-cohort';
import { Button } from './ui/button';
import { Surface } from './ui/surface';

export function PilotCohortCard({
  objects,
  loading,
  onRecord
}: {
  objects: AlphaObject[];
  loading: boolean;
  onRecord: (input: PilotSessionRecordInput) => Promise<void>;
}) {
  const summary = useMemo(() => buildPilotCohortSummary(objects), [objects]);
  const [participantAlias, setParticipantAlias] = useState('SME-01');
  const [scenarioId, setScenarioId] = useState<AlphaScenarioId>('full_trade_room_loop');
  const [outcome, setOutcome] = useState<PilotSessionOutcome>('completed');
  const [issueSeverity, setIssueSeverity] = useState<PilotIssueSeverity>('none');
  const [notes, setNotes] = useState('');
  const blockedWithoutSeverity = outcome === 'blocked' && issueSeverity === 'none';
  const canSubmit = participantAlias.trim().length > 0 && !blockedWithoutSeverity && !loading;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    await onRecord({ participantAlias: participantAlias.trim(), scenarioId, outcome, issueSeverity, notes: notes.trim() });
    setNotes('');
  }

  return (
    <Surface className="overflow-hidden border-accent/20 bg-[radial-gradient(circle_at_top_right,rgba(17,116,102,0.12),transparent_34%),rgb(var(--surface-1))]">
      <div className="border-b border-border/10 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
              <UsersRound className="h-3.5 w-3.5 text-accent" />
              Controlled pilot
            </div>
            <h2 className="mt-3 text-xl font-semibold">Cohort evidence, not anecdotes</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Record each guided SME session as a tenant-scoped report. TRAIBOX preserves the result in audit and organization memory without storing participant names.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto lg:min-w-[320px]">
            <Metric label="Participants" value={summary.participantCount} />
            <Metric label="Completed" value={summary.completedCount} />
            <Metric label="Blocked" value={summary.blockedCount} tone={summary.blockedCount ? 'warn' : undefined} />
            <Metric label="Coverage" value={`${summary.scenarioCoveragePercent}%`} />
          </div>
        </div>
      </div>

      <div className="grid gap-5 px-5 py-4 xl:grid-cols-[0.9fr_1.1fr]">
        <form className="space-y-3 rounded-2xl border border-border/10 bg-paper/65 p-4" onSubmit={submit}>
          <div>
            <div className="text-sm font-semibold">Record guided session</div>
            <p className="mt-1 text-xs leading-5 text-muted">Use an alias such as SME-01. Do not enter a person’s name or email.</p>
          </div>
          <label className="block text-xs text-muted">
            Participant alias
            <input className="input-glass mt-1 w-full" value={participantAlias} onChange={(event) => setParticipantAlias(event.target.value)} maxLength={40} />
          </label>
          <label className="block text-xs text-muted">
            Scenario
            <select className="input-glass mt-1 w-full" value={scenarioId} onChange={(event) => setScenarioId(event.target.value as AlphaScenarioId)}>
              {ALPHA_SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-muted">
              Outcome
              <select className="input-glass mt-1 w-full" value={outcome} onChange={(event) => setOutcome(event.target.value as PilotSessionOutcome)}>
                {PILOT_SESSION_OUTCOMES.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted">
              Issue severity
              <select className="input-glass mt-1 w-full" value={issueSeverity} onChange={(event) => setIssueSeverity(event.target.value as PilotIssueSeverity)}>
                {PILOT_ISSUE_SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs text-muted">
            Operator notes
            <textarea className="input-glass mt-1 min-h-24 w-full resize-y" value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={1000} />
          </label>
          {blockedWithoutSeverity ? <p className="text-xs text-error">Choose a severity before recording a blocked session.</p> : null}
          <Button type="submit" disabled={!canSubmit}>
            <ClipboardCheck className="h-4 w-4" />
            {loading ? 'Recording…' : 'Record evidence'}
          </Button>
        </form>

        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Signal label="Scenario coverage" value={`${summary.scenarioCoverageCount}/${summary.scenarioTotal}`} summary="Completed scenario types" />
            <Signal label="Critical issues" value={String(summary.criticalIssueCount)} summary="Must be zero before beta" tone={summary.criticalIssueCount ? 'error' : undefined} />
            <Signal label="Pilot sessions" value={String(summary.sessions.length)} summary="Audited reports on record" />
          </div>
          <div className="rounded-2xl border border-border/10 bg-paper/65 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold">Recent session evidence</div>
              <ShieldAlert className="h-4 w-4 text-muted" />
            </div>
            <div className="mt-3 space-y-2">
              {summary.sessions.length ? (
                summary.sessions.slice(0, 6).map((session) => {
                  const payload = readPilotSessionPayload(session);
                  const scenario = ALPHA_SCENARIOS.find((item) => item.id === payload?.scenario_id);
                  return (
                    <div key={session.object_id} className="rounded-xl border border-border/10 bg-surface2/50 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{payload?.participant_alias ?? 'Pilot session'} · {scenario?.title ?? 'Unknown scenario'}</div>
                          <p className="mt-1 text-xs text-muted">{payload?.notes || 'No operator note.'}</p>
                        </div>
                        <span className="rounded-full border border-border/10 bg-paper px-2 py-1 text-[10px] text-muted">{label(payload?.outcome ?? session.status)}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-xl bg-surface2/50 px-3 py-4 text-sm text-muted">No real pilot sessions recorded yet. Synthetic founder evidence remains separate.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}

function Metric({ label: metricLabel, value, tone }: { label: string; value: string | number; tone?: 'warn' }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-paper/70 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{metricLabel}</div>
      <div className={tone === 'warn' ? 'mt-1 text-xl font-semibold text-warn' : 'mt-1 text-xl font-semibold'}>{value}</div>
    </div>
  );
}

function Signal({ label: signalLabel, value, summary, tone }: { label: string; value: string; summary: string; tone?: 'error' }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-paper/65 p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">{signalLabel}</div>
      <div className={tone === 'error' ? 'mt-2 text-2xl font-semibold text-error' : 'mt-2 text-2xl font-semibold'}>{value}</div>
      <p className="mt-1 text-xs text-muted">{summary}</p>
    </div>
  );
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}
