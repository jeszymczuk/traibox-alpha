'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bell, Database, KeyRound, LockKeyhole, PlugZap, RefreshCw, ShieldCheck, SlidersHorizontal, Users } from 'lucide-react';
import type { AlphaObject, OrgAccessResponse, OrgRole } from '@traibox/contracts';
import { PROTECTED_ACTIONS } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { Button, buttonClassName } from '../../components/ui/button';
import { Surface } from '../../components/ui/surface';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

const ROLE_OPTIONS: OrgRole[] = ['admin', 'finance', 'ops', 'member', 'auditor'];

export default function SettingsPage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [access, setAccess] = useState<OrgAccessResponse | null>(null);
  const [settingsObjects, setSettingsObjects] = useState<AlphaObject[]>([]);
  const [allocationPolicies, setAllocationPolicies] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    const [accessResult, settingsResult, policyResult] = await Promise.all([
      api.getOrgAccess(orgId),
      api.queryAlphaObjects(orgId, { origin_workspace: 'settings', limit: 40 }),
      api.listAllocationPolicies(orgId)
    ]);
    setAccess(accessResult);
    setSettingsObjects(settingsResult.objects ?? []);
    setAllocationPolicies(policyResult.policies ?? []);
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load settings'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const protectedActionsByGroup = useMemo(
    () => ({
      money: PROTECTED_ACTIONS.filter((action) => action.includes('payment') || action.includes('funding') || action.includes('escrow')),
      external: PROTECTED_ACTIONS.filter((action) => action.includes('external') || action.includes('documents')),
      compliance: PROTECTED_ACTIONS.filter((action) => action.includes('compliance') || action.includes('clearance') || action.includes('identity')),
      commitments: PROTECTED_ACTIONS.filter((action) => action.includes('binding') || action.includes('execution'))
    }),
    []
  );

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper p-6 text-ink">Loading...</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper p-6 text-ink">
        <Surface className="mx-auto max-w-xl p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="mt-2 text-sm text-muted">Settings control organization policy, protected actions, integrations, and deployment profile.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  async function inviteMember() {
    if (!orgId || !inviteEmail.trim()) return;
    setLoading('invite');
    setError(null);
    setMessage(null);
    try {
      await api.inviteOrgMember(orgId, { email: inviteEmail.trim(), role: inviteRole });
      setInviteEmail('');
      setMessage('Invite recorded for review. In alpha this stays as an internal org access artifact.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create invite');
    } finally {
      setLoading(null);
    }
  }

  async function createPolicyCheckpoint() {
    if (!orgId) return;
    setLoading('checkpoint');
    setError(null);
    setMessage(null);
    try {
      await api.createAlphaObject(orgId, 'report', {
        title: 'Settings policy checkpoint',
        summary: 'Protected-action, deployment, integration, privacy, and approval policy snapshot for alpha governance.',
        status: 'ready_for_review',
        origin_workspace: 'settings',
        payload: {
          deployment_profile: 'EU-first internal alpha',
          protected_actions: PROTECTED_ACTIONS,
          approval_policy: {
            step_up_required_by_default: true,
            residual_risk_acknowledgement_required: true,
            agents_may_execute_protected_actions: false,
            controlled_execution_required_after_approval: true
          },
          integrations: {
            payments: 'sandbox/manual fallback',
            funding: 'sandbox financier',
            storage: 'local object storage profile',
            realtime: 'SSE'
          },
          privacy: {
            tenant_isolation: 'RLS',
            external_access: 'scoped grants',
            proof: 'audit/proof skeleton plus bundle artifacts'
          }
        },
        evidence_refs: []
      });
      setMessage('Settings policy checkpoint created as a queryable alpha report object.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create settings checkpoint');
    } finally {
      setLoading(null);
    }
  }

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId} headerRight={<div className="text-sm text-muted">{selectedOrg?.name ?? 'Select org'}</div>}>
      <div className="min-h-[calc(100dvh-56px)] bg-[radial-gradient(circle_at_top_right,rgba(27,94,124,0.18),transparent_32%),linear-gradient(180deg,rgb(var(--paper)),rgb(var(--surface-2)))]">
        <div className="mx-auto max-w-7xl space-y-5 p-6">
          <Surface className="relative overflow-hidden p-6">
            <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-accent/10 blur-2xl" />
            <div className="relative flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border/10 bg-surface2 px-3 py-1 text-xs text-muted">
                  <SlidersHorizontal className="h-3.5 w-3.5 text-accent" />
                  Settings Workspace · governance and controls
                </div>
                <h1 className="mt-4 text-3xl font-semibold tracking-tight">Set the operating rules before trade moves.</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                  Settings makes org access, protected actions, approval policies, deployment profile, integrations, notifications, and data controls visible as part of TRAIBOX governance.
                </p>
              </div>
              <Button variant="secondary" disabled={!orgId || loading === 'refresh'} onClick={() => refresh()}>
                <RefreshCw className={cn('h-4 w-4', loading === 'refresh' ? 'animate-spin' : '')} />
                Refresh
              </Button>
            </div>
          </Surface>

          {error ? <div className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">{error}</div> : null}
          {message ? <div className="rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">{message}</div> : null}

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Surface className="p-5">
              <SectionTitle icon={<LockKeyhole className="h-4 w-4" />} title="Organization And Deployment" />
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Info label="Organization" value={access?.org.name ?? selectedOrg?.name ?? 'Select org'} />
                <Info label="Country" value={access?.org.country ?? selectedOrg?.country ?? 'Not set'} />
                <Info label="Your role" value={String(access?.org.role ?? selectedOrg?.role ?? 'member')} />
                <Info label="Deployment profile" value="EU-first internal alpha" />
              </div>
              <div className="mt-4 rounded-2xl border border-border/10 bg-surface2/50 p-3 text-sm leading-6 text-muted">
                Tenant isolation uses PostgreSQL RLS, protected actions require approval and step-up by default, and sandbox integrations stay explicit until provider depth is added.
              </div>
            </Surface>

            <Surface className="p-5">
              <SectionTitle icon={<Users className="h-4 w-4" />} title="Team, Roles, And Scoped Access" />
              <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
                <div className="space-y-2">
                  {(access?.members ?? []).map((member) => (
                    <div key={member.user_id} className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
                      <div className="text-sm font-medium">{member.display_name ?? member.email ?? member.user_id.slice(0, 8)}</div>
                      <div className="mt-1 text-xs text-muted">{member.role} · joined {new Date(member.created_at).toLocaleDateString()}</div>
                    </div>
                  ))}
                  {!access?.members.length ? <p className="rounded-2xl border border-border/10 bg-surface2/50 p-3 text-sm text-muted">Select an organization to see members.</p> : null}
                </div>
                <div className="rounded-2xl border border-border/10 bg-paper/70 p-3">
                  <div className="text-sm font-medium">Invite teammate</div>
                  <input
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    className="mt-3 w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm"
                    placeholder="name@company.com"
                  />
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as OrgRole)}
                    className="mt-2 w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2 text-sm"
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <Button className="mt-3 w-full" disabled={!inviteEmail.trim() || loading === 'invite'} onClick={inviteMember}>
                    {loading === 'invite' ? 'Recording...' : 'Record invite'}
                  </Button>
                  <div className="mt-3 space-y-1">
                    {(access?.invites ?? []).slice(0, 3).map((invite) => (
                      <div key={invite.invite_id} className="text-xs text-muted">
                        {invite.email} · {invite.role}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Surface>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
            <Surface className="p-5">
              <SectionTitle icon={<ShieldCheck className="h-4 w-4" />} title="Protected Action Policy" />
              <p className="mt-2 text-sm leading-6 text-muted">
                Alpha agents may recommend, draft, monitor, prepare, explain, and coordinate. They must not execute these actions without explicit human approval and controlled execution.
              </p>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {Object.entries(protectedActionsByGroup).map(([group, actions]) => (
                  <div key={group} className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted">{group}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {actions.map((action) => (
                        <span key={action} className="rounded-full bg-paper px-2 py-1 text-[11px] text-muted">
                          {action.replaceAll('_', ' ')}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Surface>

            <Surface className="p-5">
              <SectionTitle icon={<Database className="h-4 w-4" />} title="Policy Checkpoints" />
              <p className="mt-2 text-sm leading-6 text-muted">Create a typed Settings report so policy state becomes queryable memory, not just UI text.</p>
              <Button className="mt-4 w-full" disabled={!orgId || loading === 'checkpoint'} onClick={createPolicyCheckpoint}>
                {loading === 'checkpoint' ? 'Creating...' : 'Create settings checkpoint'}
              </Button>
              <div className="mt-4 space-y-2">
                {settingsObjects.slice(0, 5).map((object) => (
                  <div key={object.object_id} className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
                    <div className="text-sm font-medium">{object.title}</div>
                    <div className="mt-1 text-xs text-muted">{object.type.replaceAll('_', ' ')} · {object.status}</div>
                  </div>
                ))}
                {!settingsObjects.length ? <p className="rounded-2xl border border-border/10 bg-surface2/50 p-3 text-sm text-muted">No Settings objects yet.</p> : null}
              </div>
            </Surface>
          </section>

          <section className="grid gap-4 lg:grid-cols-3">
            <ControlCard icon={<PlugZap className="h-4 w-4" />} title="Integrations" items={['Payments: sandbox/manual fallback', 'Funding: sandbox financier', 'Files: local object storage', 'Realtime: SSE events']} />
            <ControlCard icon={<Bell className="h-4 w-4" />} title="Notifications" items={['Approval required', 'Execution task updated', 'Proof bundle ready', 'Risk or readiness changed']} />
            <ControlCard icon={<KeyRound className="h-4 w-4" />} title="Data And Privacy" items={['RLS tenant isolation', 'Scoped external grants', 'Audit chain records', 'Proof bundles by default']} />
          </section>

          <Surface className="p-5">
            <SectionTitle icon={<SlidersHorizontal className="h-4 w-4" />} title="Finance Allocation Policies" />
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {allocationPolicies.slice(0, 6).map((policy) => (
                <div key={policy.policy_id} className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
                  <div className="text-sm font-medium">{policy.policy_id}</div>
                  <div className="mt-1 text-xs text-muted">{policy.market} · v{policy.version}</div>
                </div>
              ))}
              {!allocationPolicies.length ? <p className="rounded-2xl border border-border/10 bg-surface2/50 p-3 text-sm text-muted">No allocation policies yet.</p> : null}
            </div>
          </Surface>
        </div>
      </div>
    </AppShell>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-xl bg-surface2 p-2 text-accent">{icon}</span>
      <h2 className="font-semibold">{title}</h2>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border/10 bg-surface2/50 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 text-sm font-medium">{value}</div>
    </div>
  );
}

function ControlCard({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <Surface className="p-5">
      <SectionTitle icon={icon} title={title} />
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-2 text-sm text-muted">
            {item}
          </div>
        ))}
      </div>
    </Surface>
  );
}
