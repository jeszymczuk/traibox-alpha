'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Activity, CheckCircle2, Clock3, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import type { AlphaObject } from '@traibox/contracts';

import { api } from '../lib/api';
import { AppShell } from './shell';
import { useOrgSelection } from './use-org';
import { ProtectedActionApprovalCard, type ProtectedActionDecisionInput } from './protected-action-approval';
import { Button, buttonClassName } from './ui/button';
import { Surface } from './ui/surface';

export function ApprovalQueue() {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [approvals, setApprovals] = useState<AlphaObject[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setLoading('refresh');
    setError(null);
    try {
      const result = await api.queryAlphaObjects(orgId, { type: 'approval', limit: 250 });
      setApprovals(result.objects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load approvals');
    } finally {
      setLoading(null);
    }
  }

  useEffect(() => {
    if (auth.status === 'authenticated' && orgId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  if (auth.status === 'loading') return <div className="min-h-dvh bg-paper p-6 text-ink">Opening approval queue…</div>;
  if (auth.status === 'unauthenticated') return <div className="grid min-h-dvh place-items-center bg-paper p-5"><Surface className="max-w-lg p-6"><h1 className="text-xl font-semibold">Sign in to review approvals</h1><p className="mt-2 text-sm text-muted">Protected actions require organization-scoped human decisions.</p><Link className={`${buttonClassName()} mt-4`} href="/login">Go to login</Link></Surface></div>;

  async function decide(approval: AlphaObject, decision: 'approved' | 'rejected', input: ProtectedActionDecisionInput) {
    if (!orgId) return;
    setLoading(approval.object_id);
    setError(null);
    try {
      const result = await api.decideAlphaApproval(orgId, approval.object_id, {
        decision,
        notes: input.notes,
        step_up_verified: input.stepUpVerified,
        residual_risks_acknowledged: input.residualRisksAcknowledged,
        approval_step: input.approvalStep
      });
      setMessage(result.execution_task ? 'Decision recorded. A controlled execution task was created.' : `Decision recorded: ${decision}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record decision');
    } finally {
      setLoading(null);
    }
  }

  const pending = approvals.filter((approval) => approval.status === 'approval_required');
  const approved = approvals.filter((approval) => approval.status === 'approved');
  const rejected = approvals.filter((approval) => approval.status === 'rejected');

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId} headerRight={<span className="text-xs text-muted">{selectedOrg?.name ?? 'Select org'}</span>}>
      <div className="min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_left,rgba(227,160,8,0.12),transparent_30%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]">
        <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
          <Surface className="relative overflow-hidden p-5 md:p-7">
            <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-warn/15 blur-3xl" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">Operations Center · Human Control Plane</div>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Approve with context, not guesswork.</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">Every protected action exposes the recommendation, rationale, evidence, remaining risks, policy gates, and consequence before a human releases it into controlled execution.</p>
              </div>
              <div className="flex gap-2"><Button variant="secondary" disabled={loading === 'refresh'} onClick={refresh}><RefreshCw className={`h-4 w-4 ${loading === 'refresh' ? 'animate-spin' : ''}`} /> Refresh</Button><Link className={buttonClassName()} href="/operations-center">Open cockpit</Link></div>
            </div>
          </Surface>

          {error ? <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">{error}</div> : null}
          {message ? <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">{message}</div> : null}

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Waiting for decision" value={pending.length} icon={<Clock3 className="h-4 w-4 text-warn" />} />
            <Metric label="Approved" value={approved.length} icon={<CheckCircle2 className="h-4 w-4 text-success" />} />
            <Metric label="Rejected" value={rejected.length} icon={<XCircle className="h-4 w-4 text-error" />} />
            <Metric label="Total governed actions" value={approvals.length} icon={<ShieldCheck className="h-4 w-4 text-accent" />} />
          </section>

          <Surface className="p-5">
            <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-warn" /><h2 className="font-semibold">Decision queue</h2></div>
            <p className="mt-1 text-xs text-muted">Approvals are ordered by most recently updated. TRAIBOX never executes these actions merely because an agent recommended them.</p>
            <div className="mt-5 grid gap-4">
              {pending.length ? pending.map((approval) => <ProtectedActionApprovalCard key={approval.object_id} approval={approval} loading={loading === approval.object_id} onDecide={(decision, input) => decide(approval, decision, input)} />) : <div className="rounded-2xl border border-dashed border-border/15 p-8 text-center"><CheckCircle2 className="mx-auto h-6 w-6 text-success" /><h3 className="mt-3 font-semibold">Approval queue is clear</h3><p className="mt-2 text-sm text-muted">No protected actions are waiting for a human decision.</p></div>}
            </div>
          </Surface>

          {approved.length || rejected.length ? <Surface className="p-5"><h2 className="font-semibold">Recent decisions</h2><div className="mt-4 grid gap-2 md:grid-cols-2">{[...approved, ...rejected].slice(0, 8).map((approval) => <div key={approval.object_id} className="rounded-xl border border-border/10 bg-surface2/60 p-3"><div className="flex items-center justify-between gap-3"><div className="text-sm font-medium">{approval.title}</div><span className={`rounded-full px-2 py-1 text-[10px] ${approval.status === 'approved' ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}`}>{approval.status}</span></div><div className="mt-2 font-mono text-[10px] text-muted">{approval.trace_id}</div></div>)}</div></Surface> : null}
        </div>
      </div>
    </AppShell>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return <Surface className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-muted">{label}</div><div className="mt-2 font-mono text-2xl font-semibold">{value}</div></div><div className="rounded-xl bg-surface2 p-2">{icon}</div></div></Surface>;
}
