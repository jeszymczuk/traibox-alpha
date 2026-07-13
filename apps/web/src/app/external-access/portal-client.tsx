'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, FileText, LockKeyhole, Network, RefreshCw, Send, ShieldCheck, Sparkles } from 'lucide-react';
import type {
  AlphaObject,
  DocumentRequestSubmissionResponse,
  ExternalOnboardingEvidenceResponse,
  ExternalParticipantSessionResponse,
  ExternalParticipantTaskUpdateResponse
} from '@traibox/contracts';

import { Button } from '../../components/ui/button';
import { StatusChip } from '../../components/ui/status';
import { Surface } from '../../components/ui/surface';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

const SAMPLE_TEXT =
  'Supplier invoice INV-1042. Supplier: Atlantic Components Lda. Buyer: Iberica Buyer SL. Beneficiary IBAN PT50002700000001234567833. Amount EUR 12500. Payment terms net 30.';

export function ExternalAccessPortal() {
  const params = useSearchParams();
  const exchangeError = params.get('error');
  const [session, setSession] = useState<ExternalParticipantSessionResponse | null>(null);
  const [submission, setSubmission] = useState<DocumentRequestSubmissionResponse | null>(null);
  const [taskUpdate, setTaskUpdate] = useState<ExternalParticipantTaskUpdateResponse | null>(null);
  const [onboardingEvidence, setOnboardingEvidence] = useState<ExternalOnboardingEvidenceResponse | null>(null);
  const [filename, setFilename] = useState('requested-evidence.txt');
  const [text, setText] = useState(SAMPLE_TEXT);
  const [taskNote, setTaskNote] = useState('I reviewed the scoped task and uploaded/confirmed the requested evidence.');
  const [taskStatus, setTaskStatus] = useState<'in_progress' | 'ready_for_review' | 'blocked'>('ready_for_review');
  const [onboardingFilename, setOnboardingFilename] = useState('onboarding-evidence.txt');
  const [onboardingText, setOnboardingText] = useState(
    'Counterparty onboarding evidence. Registration number ES-B-88319921. Authorized contact: Maria Alvarez, Head of Operations. LEI pending confirmation.'
  );
  const [completedFields, setCompletedFields] = useState('registration_number, authorized_contact');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [onboardingSubmitting, setOnboardingSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const target = session?.target;
  const visibleObjects = session?.visible_objects ?? [];
  const isDocumentRequest = target?.type === 'document_request';
  const taskObject = target?.type === 'execution_task' ? target : visibleObjects.find((object) => object.type === 'execution_task');
  const passport = target?.type === 'trade_passport' ? target : visibleObjects.find((object) => object.type === 'trade_passport');
  const counterparty = target?.type === 'counterparty' ? target : visibleObjects.find((object) => object.type === 'counterparty');
  const onboardingFlow = target?.type === 'onboarding_flow' ? target : visibleObjects.find((object) => object.type === 'onboarding_flow');
  const proofBundle = target?.type === 'proof_bundle' ? target : visibleObjects.find((object) => object.type === 'proof_bundle');
  const canSubmit = Boolean(session?.allowed_actions.includes('submit_requested_document') && isDocumentRequest && target?.status !== 'completed');
  const canUpdateTask = Boolean(session?.allowed_actions.includes('submit_task_update') && taskObject && !['completed', 'cancelled'].includes(taskObject.status));
  const canSubmitOnboarding = Boolean(session?.allowed_actions.includes('submit_onboarding_evidence') && (passport || counterparty || onboardingFlow));
  const canViewProof = Boolean(session?.allowed_actions.some((action) => ['view_proof_summary', 'view_artifact_manifest', 'download_verified_bundle'].includes(action)) && proofBundle);
  const requestedItems = useMemo(() => {
    const payload = target?.payload_json;
    return Array.isArray(payload?.requested_items) ? payload.requested_items.filter((item): item is string => typeof item === 'string') : [];
  }, [target]);
  const passportTrust = passport?.payload_json?.trust_context && typeof passport.payload_json.trust_context === 'object' ? passport.payload_json.trust_context as Record<string, unknown> : null;

  async function refresh() {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.getExternalParticipantSession();
      setSession(result);
    } catch (err) {
      setSession(null);
      setError(err instanceof Error ? err.message : 'Could not load scoped access');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function submitEvidence() {
    if (!target?.object_id) return;
    setSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.submitExternalDocumentRequest(target.object_id, {
        filename,
        text,
        submitted_by: {
          name: session?.participant.name,
          email: session?.participant.email,
          role: session?.participant.role
        }
      });
      setSubmission(result);
      setMessage('Evidence submitted. TRAIBOX extracted it, updated readiness, and generated proof.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit requested evidence');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTaskUpdate() {
    if (!taskObject?.object_id) return;
    setTaskSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.submitExternalExecutionTaskUpdate(taskObject.object_id, {
        status: taskStatus,
        note: taskNote
      });
      setTaskUpdate(result);
      setMessage('Task update submitted. TRAIBOX recorded it in audit and Trade Memory for the internal team.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit task update');
    } finally {
      setTaskSubmitting(false);
    }
  }

  async function submitOnboardingEvidence() {
    setOnboardingSubmitting(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.submitExternalOnboardingEvidence({
        filename: onboardingFilename,
        text: onboardingText,
        evidence_type: 'counterparty_onboarding',
        completed_fields: completedFields.split(',').map((field) => field.trim()).filter(Boolean),
        submitted_by: {
          name: session?.participant.name,
          email: session?.participant.email,
          role: session?.participant.role
        }
      });
      setOnboardingEvidence(result);
      setMessage('Onboarding evidence submitted. TRAIBOX extracted fields, updated readiness, and generated proof.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit onboarding evidence');
    } finally {
      setOnboardingSubmitting(false);
    }
  }

  return (
    <div className="min-h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(79,143,244,0.20),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(47,176,110,0.16),transparent_28%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))] text-ink">
      <header className="border-b border-border/10 bg-paper/70 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold tracking-tight">TRAIBOX</div>
            <div className="text-xs text-muted">Scoped external access</div>
          </div>
          <Link className="text-sm font-medium text-accent" href="/">
            Back to TRAIBOX
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 p-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Surface className="relative overflow-hidden p-6 lg:col-span-2">
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs text-accent">
                <LockKeyhole className="h-3.5 w-3.5" />
                Permission-aware participant portal
              </div>
              <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight">Work inside a scoped TRAIBOX portal without joining the whole workspace.</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                This session is scoped to one grant. You can only see the approved target, permitted context, allowed actions, and connected evidence.
              </p>
            </div>
            <Button variant="secondary" disabled={loading} onClick={refresh}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              Refresh access
            </Button>
          </div>
        </Surface>

        {error || exchangeError ? (
          <Surface className="border-error/20 bg-error/5 p-5 lg:col-span-2">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-error" />
              <div>
                <h2 className="font-semibold text-error">Access issue</h2>
                <p className="mt-1 text-sm text-muted">{error ?? 'This external access link is invalid, expired, or already used.'}</p>
              </div>
            </div>
          </Surface>
        ) : null}

        {message ? (
          <Surface className="border-success/20 bg-success/5 p-5 lg:col-span-2">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-success" />
              <div>
                <h2 className="font-semibold text-success">Submitted</h2>
                <p className="mt-1 text-sm text-muted">{message}</p>
              </div>
            </div>
          </Surface>
        ) : null}

        <Surface className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Access Grant</h2>
              <p className="mt-1 text-xs leading-5 text-muted">The secure exchange resolves to one participant, one grant, and one target.</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-accent" />
          </div>

          {loading && !session ? (
            <div className="mt-5 rounded-2xl border border-border/10 bg-surface2/50 p-4 text-sm text-muted">Loading scoped access...</div>
          ) : session ? (
            <div className="mt-5 space-y-3">
              <InfoRow label="Participant" value={`${session.participant.name ?? 'External participant'} · ${session.participant.role}`} />
              <InfoRow label="Email" value={session.participant.email ?? 'Not provided'} />
              <InfoRow label="Target" value={session.target ? `${session.target.type} · ${session.target.title}` : 'Trade-level scoped access'} />
              <InfoRow label="Status" value={session.target?.status ?? session.grant.status} />
              <InfoRow label="Expires" value={session.expires_at ? new Date(session.expires_at).toLocaleString() : 'No expiry set'} />
              <InfoRow label="Visible context" value={`${session.visible_objects.length} scoped object${session.visible_objects.length === 1 ? '' : 's'}`} />
              {session.portal_summary.trust_score !== undefined ? <InfoRow label="Trust score" value={`${session.portal_summary.trust_score}%`} /> : null}
              {session.portal_summary.proof_ready !== undefined ? <InfoRow label="Proof ready" value={session.portal_summary.proof_ready ? 'yes' : 'not yet'} /> : null}
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Scopes</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {session.scopes.map((scope) => (
                    <StatusChip key={scope} tone="neutral" label={scope} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Allowed actions</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {session.allowed_actions.map((action) => (
                    <StatusChip key={action} tone={action.includes('submit') ? 'success' : 'neutral'} label={action} />
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-accent/15 bg-accent/10 p-3 text-xs leading-5 text-muted">{session.portal_summary.guarded_notice}</div>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-border/10 bg-surface2/50 p-4 text-sm text-muted">No access session loaded.</div>
          )}
        </Surface>

        <Surface className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Requested Evidence</h2>
              <p className="mt-1 text-xs leading-5 text-muted">Submit only the evidence requested by this scoped access grant.</p>
            </div>
            <FileText className="h-5 w-5 text-accent" />
          </div>

          {session && !isDocumentRequest ? (
            <div className="mt-5 rounded-2xl border border-border/10 bg-surface2/50 p-4 text-sm text-muted">
              This access grant is not a document request. You can inspect the scoped target but cannot upload evidence here.
            </div>
          ) : null}

          {session && isDocumentRequest ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-border/10 bg-surface2/50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium">{target?.title}</div>
                  <StatusChip tone={target?.status === 'completed' ? 'success' : 'warn'} label={target?.status ?? 'pending'} />
                </div>
                {target?.summary ? <p className="mt-2 text-xs leading-5 text-muted">{target.summary}</p> : null}
                {requestedItems.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {requestedItems.map((item) => (
                      <StatusChip key={item} tone="neutral" label={item} />
                    ))}
                  </div>
                ) : null}
              </div>

              <label className="block text-sm">
                <span className="text-muted">Filename</span>
                <input
                  value={filename}
                  onChange={(event) => setFilename(event.target.value)}
                  disabled={!canSubmit || submitting}
                  className="mt-1 w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2"
                />
              </label>

              <label className="block text-sm">
                <span className="text-muted">Evidence text</span>
                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  disabled={!canSubmit || submitting}
                  className="mt-1 min-h-[180px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 leading-6"
                />
              </label>

              <Button disabled={!canSubmit || submitting || !filename.trim() || !text.trim()} onClick={submitEvidence}>
                <Send className="h-4 w-4" />
                {submitting ? 'Submitting...' : target?.status === 'completed' ? 'Already completed' : 'Submit evidence'}
              </Button>
            </div>
          ) : null}
        </Surface>

        <Surface className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Task Collaboration</h2>
              <p className="mt-1 text-xs leading-5 text-muted">Send a scoped progress update without completing any protected internal execution step.</p>
            </div>
            <ClipboardCheck className="h-5 w-5 text-accent" />
          </div>

          {taskObject ? (
            <div className="mt-5 space-y-4">
              <ScopedObjectCard object={taskObject} />
              <label className="block text-sm">
                <span className="text-muted">Task status</span>
                <select
                  value={taskStatus}
                  onChange={(event) => setTaskStatus(event.target.value as 'in_progress' | 'ready_for_review' | 'blocked')}
                  disabled={!canUpdateTask || taskSubmitting}
                  className="mt-1 w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2"
                >
                  <option value="ready_for_review">Ready for internal review</option>
                  <option value="in_progress">Still in progress</option>
                  <option value="blocked">Blocked</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-muted">Update note</span>
                <textarea
                  value={taskNote}
                  onChange={(event) => setTaskNote(event.target.value)}
                  disabled={!canUpdateTask || taskSubmitting}
                  className="mt-1 min-h-[120px] w-full rounded-2xl border border-border/10 bg-surface2 px-4 py-3 leading-6"
                />
              </label>
              <Button disabled={!canUpdateTask || taskSubmitting || !taskNote.trim()} onClick={submitTaskUpdate}>
                <Send className="h-4 w-4" />
                {taskSubmitting ? 'Sending...' : 'Send task update'}
              </Button>
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-border/10 bg-surface2/50 p-4 text-sm text-muted">No execution task is visible to this grant.</div>
          )}
        </Surface>

        <Surface className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Trade Passport</h2>
              <p className="mt-1 text-xs leading-5 text-muted">Reusable trust context is visible only when this grant includes passport scope.</p>
            </div>
            <Network className="h-5 w-5 text-accent" />
          </div>

          {passport || counterparty || onboardingFlow ? (
            <div className="mt-5 space-y-4">
              {passport ? <ScopedObjectCard object={passport} /> : null}
              {counterparty ? <ScopedObjectCard object={counterparty} /> : null}
              {passportTrust ? (
                <div className="rounded-2xl border border-accent/15 bg-accent/10 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-muted">Trust context</div>
                      <div className="mt-1 text-lg font-semibold">{String(passportTrust.score ?? 'pending')}%</div>
                    </div>
                    <StatusChip tone={String(passportTrust.status ?? '').includes('blocked') ? 'error' : 'success'} label={String(passportTrust.status ?? 'visible')} />
                  </div>
                  <SignalList label="Missing trust items" items={arrayFromUnknown(passportTrust.missing_items)} />
                </div>
              ) : null}

              {canSubmitOnboarding ? (
                <div className="space-y-3 rounded-2xl border border-border/10 bg-surface2/50 p-4">
                  <div className="text-sm font-medium">Submit onboarding evidence</div>
                  <input
                    value={onboardingFilename}
                    onChange={(event) => setOnboardingFilename(event.target.value)}
                    disabled={onboardingSubmitting}
                    className="w-full rounded-xl border border-border/10 bg-paper px-3 py-2 text-sm"
                  />
                  <input
                    value={completedFields}
                    onChange={(event) => setCompletedFields(event.target.value)}
                    disabled={onboardingSubmitting}
                    className="w-full rounded-xl border border-border/10 bg-paper px-3 py-2 text-sm"
                    placeholder="registration_number, authorized_contact"
                  />
                  <textarea
                    value={onboardingText}
                    onChange={(event) => setOnboardingText(event.target.value)}
                    disabled={onboardingSubmitting}
                    className="min-h-[130px] w-full rounded-2xl border border-border/10 bg-paper px-4 py-3 text-sm leading-6"
                  />
                  <Button disabled={onboardingSubmitting || !onboardingFilename.trim() || !onboardingText.trim()} onClick={submitOnboardingEvidence}>
                    <Sparkles className="h-4 w-4" />
                    {onboardingSubmitting ? 'Submitting...' : 'Submit onboarding evidence'}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-border/10 bg-surface2/50 p-4 text-sm text-muted">No Trade Passport or counterparty context is visible to this grant.</div>
          )}
        </Surface>

        <Surface className="p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold">Scoped Context And Proof</h2>
              <p className="mt-1 text-xs leading-5 text-muted">Everything below is filtered by the grant scopes; unrelated workspace objects stay hidden.</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-accent" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {visibleObjects.length ? visibleObjects.map((object) => <ScopedObjectCard key={object.object_id} object={object} />) : (
              <div className="rounded-2xl border border-border/10 bg-surface2/50 p-4 text-sm text-muted">No additional scoped context is visible.</div>
            )}
          </div>
          {canViewProof && proofBundle ? (
            <div className="mt-4 rounded-2xl border border-success/20 bg-success/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Proof summary visible</div>
                  <p className="mt-1 text-xs leading-5 text-muted">Artifact manifests and downloads remain controlled by the exact scopes on this grant.</p>
                </div>
                <StatusChip tone="success" label={proofBundle.status} />
              </div>
            </div>
          ) : null}
        </Surface>

        {submission ? (
          <Surface className="border-success/20 bg-success/5 p-5 lg:col-span-2">
            <h2 className="font-semibold">Submission Result</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <ResultTile label="Request" value={submission.request.status} />
              <ResultTile label="Document" value={submission.document.type} />
              <ResultTile label="Extraction" value={submission.extraction_result.status} />
              <ResultTile label="Readiness" value={`${submission.readiness.overall} · ${Math.round(submission.readiness.score)}%`} />
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">
              TRAIBOX recorded this external action in audit and Trade Memory, then generated a proof bundle from the submitted evidence.
            </p>
          </Surface>
        ) : null}

        {taskUpdate ? (
          <Surface className="border-success/20 bg-success/5 p-5 lg:col-span-2">
            <h2 className="font-semibold">Task Update Recorded</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <ResultTile label="Task" value={taskUpdate.task.status} />
              <ResultTile label="Actor" value="external participant" />
              <ResultTile label="Protected action" value="not executed" />
            </div>
          </Surface>
        ) : null}

        {onboardingEvidence ? (
          <Surface className="border-success/20 bg-success/5 p-5 lg:col-span-2">
            <h2 className="font-semibold">Onboarding Evidence Result</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <ResultTile label="Document" value={onboardingEvidence.document.status} />
              <ResultTile label="Extraction" value={onboardingEvidence.extraction_result.status} />
              <ResultTile label="Readiness" value={`${onboardingEvidence.readiness.overall} · ${Math.round(onboardingEvidence.readiness.score)}%`} />
              <ResultTile label="Proof" value={onboardingEvidence.proof_bundle.status} />
            </div>
          </Surface>
        ) : null}
      </main>
    </div>
  );
}

function ScopedObjectCard({ object }: { object: AlphaObject }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-surface2/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{object.type.replaceAll('_', ' ')}</div>
          <div className="mt-1 text-sm font-semibold">{object.title}</div>
        </div>
        <StatusChip tone={object.status === 'completed' || object.status === 'approved' || object.status === 'ready_for_review' ? 'success' : object.status === 'blocked' ? 'error' : 'warn'} label={object.status} />
      </div>
      {object.summary ? <p className="mt-2 text-xs leading-5 text-muted">{object.summary}</p> : null}
      <div className="mt-3 text-[11px] text-muted">ID {object.object_id.slice(0, 8)}</div>
    </div>
  );
}

function SignalList({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <StatusChip key={item} tone="neutral" label={item} />
        ))}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 break-words text-sm font-medium">{value}</div>
    </div>
  );
}

function ResultTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-success/20 bg-paper/60 px-3 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-success">{value}</div>
    </div>
  );
}

function arrayFromUnknown(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
