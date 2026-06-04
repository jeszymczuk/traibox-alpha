'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, LockKeyhole, RefreshCw, ShieldCheck, Users } from 'lucide-react';

import { api } from '../lib/api';
import { AppShell } from './shell';
import { useOrgSelection } from './use-org';
import { Button, buttonClassName } from './ui/button';
import { Surface } from './ui/surface';

type GovernanceMode = 'permissions' | 'policies';

export function GovernanceWorkspace({ mode }: { mode: GovernanceMode }) {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [access, setAccess] = useState<any>(null);
  const [objects, setObjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const [accessResult, objectResult] = await Promise.all([api.getOrgAccess(orgId), api.queryAlphaObjects(orgId, { limit: 250 })]);
      setAccess(accessResult);
      setObjects(objectResult.objects);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load governance controls');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth.status === 'authenticated' && orgId) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  if (auth.status !== 'authenticated') return <div className="grid min-h-dvh place-items-center bg-paper p-5"><Surface className="max-w-lg p-6"><h1 className="text-xl font-semibold">{auth.status === 'loading' ? 'Loading governance…' : 'Sign in to review governance'}</h1>{auth.status === 'unauthenticated' ? <Link className={`${buttonClassName()} mt-4`} href="/login">Go to login</Link> : null}</Surface></div>;

  const approvals = objects.filter((object) => object.type === 'approval');
  const external = objects.filter((object) => object.type === 'external_access_grant');
  const protectedActions = [...new Set(approvals.map((object) => String(object.payload_json?.protected_action ?? 'protected_action')))];

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId} headerRight={<span className="text-xs text-muted">{selectedOrg?.name ?? 'Select org'}</span>}>
      <div className="min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_left,rgba(47,176,110,0.10),transparent_30%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]">
        <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
          <Surface className="relative overflow-hidden p-5 md:p-7">
            <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-success/15 blur-3xl" />
            <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div><div className="text-[11px] uppercase tracking-[0.2em] text-muted">Settings · Governance</div><h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{mode === 'permissions' ? 'Permissions and scoped access' : 'Policies and protected actions'}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{mode === 'permissions' ? 'Review organization roles, external participant scopes, and the boundaries that keep each trade context isolated.' : 'Review the controls that determine when human approval, step-up verification, evidence, and replay are mandatory.'}</p></div>
              <div className="flex gap-2"><Button variant="secondary" disabled={loading} onClick={refresh}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</Button><Link className={buttonClassName()} href="/settings">Settings home</Link></div>
            </div>
          </Surface>
          {error ? <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">{error}</div> : null}
          {mode === 'permissions' ? <Permissions access={access} external={external} /> : <Policies approvals={approvals} protectedActions={protectedActions} />}
        </div>
      </div>
    </AppShell>
  );
}

function Permissions({ access, external }: { access: any; external: any[] }) {
  const roles = access?.roles ?? access?.members ?? [];
  return <><section className="grid gap-3 md:grid-cols-3"><Metric label="Organization members" value={roles.length} icon={<Users className="h-4 w-4" />} /><Metric label="External grants" value={external.length} icon={<KeyRound className="h-4 w-4" />} /><Metric label="Active scoped grants" value={external.filter((item) => !['cancelled', 'archived'].includes(item.status)).length} icon={<ShieldCheck className="h-4 w-4" />} /></section><Surface className="p-5"><h2 className="font-semibold">Role-to-action matrix</h2><p className="mt-1 text-xs text-muted">Alpha governance keeps protected actions explicit even when broad workspace access is granted.</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs"><thead className="text-muted"><tr><th className="pb-3">Role</th><th className="pb-3">View</th><th className="pb-3">Prepare</th><th className="pb-3">Approve</th><th className="pb-3">Manage policy</th></tr></thead><tbody className="divide-y divide-border/10">{['owner', 'admin', 'ops', 'finance', 'compliance', 'viewer', 'external participant'].map((role) => <tr key={role}><td className="py-3 font-medium">{role}</td><Cell ok /><Cell ok={role !== 'viewer' && role !== 'external participant'} /><Cell ok={['owner', 'admin', 'finance', 'compliance'].includes(role)} /><Cell ok={['owner', 'admin'].includes(role)} /></tr>)}</tbody></table></div></Surface><Surface className="p-5"><h2 className="font-semibold">External participant scopes</h2><div className="mt-4 grid gap-2 md:grid-cols-2">{external.length ? external.slice(0, 8).map((grant) => <div key={grant.object_id} className="rounded-xl border border-border/10 bg-surface2/60 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{grant.title}</span><span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{grant.status}</span></div><div className="mt-2 text-[11px] text-muted">{Array.isArray(grant.payload_json?.scopes) ? grant.payload_json.scopes.join(' · ') : 'Scoped access recorded'}</div></div>) : <p className="text-sm text-muted">No external access grants recorded.</p>}</div></Surface></>;
}

function Policies({ approvals, protectedActions }: { approvals: any[]; protectedActions: string[] }) {
  return <><section className="grid gap-3 md:grid-cols-3"><Metric label="Protected-action records" value={approvals.length} icon={<LockKeyhole className="h-4 w-4" />} /><Metric label="Action kinds observed" value={protectedActions.length} icon={<ShieldCheck className="h-4 w-4" />} /><Metric label="Waiting for approval" value={approvals.filter((item) => item.status === 'approval_required').length} icon={<KeyRound className="h-4 w-4" />} /></section><Surface className="p-5"><h2 className="font-semibold">Protected action policy</h2><p className="mt-1 text-xs text-muted">Agents may prepare and recommend these actions, but a human must explicitly approve them.</p><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{(protectedActions.length ? protectedActions : ['send_payment', 'submit_funding_request', 'accept_funding_offer', 'send_documents_externally', 'invite_external_counterparty', 'submit_clearance_declaration', 'share_proof_bundle_externally']).map((action) => <div key={action} className="rounded-xl border border-border/10 bg-surface2/60 p-3"><div className="flex items-center gap-2 text-sm font-medium"><LockKeyhole className="h-3.5 w-3.5 text-warn" />{action.replaceAll('_', ' ')}</div><div className="mt-3 flex flex-wrap gap-1"><Pill>Human approval</Pill><Pill>Evidence</Pill><Pill>Audit</Pill><Pill>Replay</Pill></div></div>)}</div></Surface><Surface className="p-5"><h2 className="font-semibold">Policy enforcement health</h2><div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{['Step-up verification required', 'Residual risks visible', 'External execution blocked by default', 'Decision trail added to proof'].map((item) => <div key={item} className="flex items-center gap-2 rounded-xl border border-success/20 bg-success/10 p-3 text-xs text-success"><CheckCircle2 className="h-4 w-4" />{item}</div>)}</div></Surface></>;
}

function Cell({ ok = false }: { ok?: boolean }) { return <td className="py-3">{ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <span className="text-muted">—</span>}</td>; }
function Pill({ children }: { children: React.ReactNode }) { return <span className="rounded-full bg-paper px-2 py-1 text-[10px] text-muted">{children}</span>; }
function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <Surface className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-muted">{label}</div><div className="mt-2 font-mono text-2xl font-semibold">{value}</div></div><div className="rounded-xl bg-surface2 p-2 text-accent">{icon}</div></div></Surface>; }
