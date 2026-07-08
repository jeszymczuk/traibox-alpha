'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Building2, Database, KeyRound, Loader2, PlugZap, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { AlphaObject, OrgAccessResponse, OrgRole } from '@traibox/contracts';
import { PROTECTED_ACTIONS } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { WorkspaceGuard } from '../../components/workspace-guard';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type Pane = 'workspace' | 'team' | 'actions' | 'integrations';

const ROLE_OPTIONS: OrgRole[] = ['admin', 'finance', 'ops', 'member', 'auditor'];

function initialsOf(name: string) {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '??'
  );
}

export default function SettingsPage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [pane, setPane] = useState<Pane>('workspace');
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
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-2 md:px-8">
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <div className="sub">Workspace, team, protected actions, integrations — the operating rules before trade moves.</div>
          </div>
        </div>

        <WorkspaceGuard authStatus={auth.status} orgId={orgId} module="Settings">
          <>
            {error ? <div className="mb-3 text-sm text-bad">{error}</div> : null}
            {message ? (
              <div className="ai-note" style={{ marginTop: 0, marginBottom: 14 }}>
                <div className="ib">
                  <ShieldCheck className="h-3.5 w-3.5" />
                </div>
                <div>{message}</div>
              </div>
            ) : null}

            <div className="settings-grid">
              <nav className="settings-side">
                <button type="button" className={cn(pane === 'workspace' && 'on')} onClick={() => setPane('workspace')}>
                  <Building2 className="h-4 w-4" /> Workspace
                </button>
                <button type="button" className={cn(pane === 'team' && 'on')} onClick={() => setPane('team')}>
                  <Users className="h-4 w-4" /> Team &amp; permissions
                </button>
                <button type="button" className={cn(pane === 'actions' && 'on')} onClick={() => setPane('actions')}>
                  <ShieldCheck className="h-4 w-4" /> Protected actions
                </button>
                <button type="button" className={cn(pane === 'integrations' && 'on')} onClick={() => setPane('integrations')}>
                  <PlugZap className="h-4 w-4" /> Integrations &amp; privacy
                </button>
              </nav>

              <div>
                {pane === 'workspace' ? (
                  <>
                    <div className="settings-card">
                      <h3>Workspace</h3>
                      <div className="desc">Customer organisation that owns this workspace.</div>
                      <div className="field">
                        <div className="lbl">Name</div>
                        <div className="val">{access?.org.name ?? selectedOrg?.name ?? '—'}</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Org id</div>
                        <div className="val">{orgId ? `${orgId.slice(0, 13)}…` : '—'}</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Country</div>
                        <div className="val">{String(access?.org.country ?? selectedOrg?.country ?? 'not set')}</div>
                      </div>
                      <div className="field">
                        <div className="lbl">
                          Your role<span className="hint">governs which protected actions you can decide</span>
                        </div>
                        <div className="val">{String(access?.org.role ?? selectedOrg?.role ?? 'member')}</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Deployment profile</div>
                        <div className="val">EU-first internal alpha</div>
                      </div>
                    </div>

                    <div className="settings-card">
                      <h3>Finance allocation policies</h3>
                      <div className="desc">Policies applied when ranking financier offers.</div>
                      {allocationPolicies.length === 0 ? (
                        <p className="text-sm text-text-3">No allocation policies yet.</p>
                      ) : (
                        allocationPolicies.slice(0, 6).map((policy) => (
                          <div key={policy.policy_id} className="field">
                            <div className="lbl">{String(policy.market ?? 'market')}</div>
                            <div className="val">
                              {String(policy.policy_id)} · v{String(policy.version)}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </>
                ) : null}

                {pane === 'team' ? (
                  <>
                    <div className="settings-card">
                      <h3>Team &amp; permissions</h3>
                      <div className="desc">Members of {access?.org.name ?? 'this workspace'}.</div>
                      {(access?.members ?? []).map((member) => (
                        <div key={member.user_id} className="team-row">
                          <div className="av">{initialsOf(member.display_name ?? member.email ?? member.user_id)}</div>
                          <div>
                            <div className="nm">{member.display_name ?? member.email ?? member.user_id.slice(0, 8)}</div>
                            <div className="em">{member.email ?? `joined ${new Date(member.created_at).toLocaleDateString('en-GB')}`}</div>
                          </div>
                          <span className="role">{member.role}</span>
                          <span className="stat">{new Date(member.created_at).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
                        </div>
                      ))}
                      {!access?.members.length ? <p className="text-sm text-text-3">Select an organization to see members.</p> : null}
                    </div>

                    <div className="settings-card">
                      <h3>Invite a teammate</h3>
                      <div className="desc">Invites are recorded as governed org-access artifacts in alpha.</div>
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={inviteEmail}
                          onChange={(event) => setInviteEmail(event.target.value)}
                          className="input-glass"
                          style={{ maxWidth: 280 }}
                          placeholder="name@company.com"
                        />
                        <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as OrgRole)} className="input-glass" style={{ maxWidth: 140 }}>
                          {ROLE_OPTIONS.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <Button disabled={!inviteEmail.trim() || loading === 'invite'} onClick={inviteMember}>
                          {loading === 'invite' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                          {loading === 'invite' ? 'Recording…' : 'Record invite'}
                        </Button>
                      </div>
                      {(access?.invites ?? []).length > 0 ? (
                        <div className="mt-4">
                          {(access?.invites ?? []).slice(0, 5).map((invite) => (
                            <div key={invite.invite_id} className="field">
                              <div className="lbl">{invite.email}</div>
                              <div className="val">{invite.role}</div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="mt-3 text-xs text-text-3">
                        Fine-grained scopes live in{' '}
                        <Link href="/settings/permissions" className="text-cyan-text hover:underline">
                          Permissions
                        </Link>{' '}
                        and{' '}
                        <Link href="/settings/policies" className="text-cyan-text hover:underline">
                          Policies
                        </Link>
                        .
                      </div>
                    </div>
                  </>
                ) : null}

                {pane === 'actions' ? (
                  <>
                    <div className="settings-card">
                      <h3>Protected action policy</h3>
                      <div className="desc">
                        Agents may recommend, draft, monitor, prepare, explain, and coordinate. They must not execute these actions without
                        explicit human approval and controlled execution.
                      </div>
                      {Object.entries(protectedActionsByGroup).map(([group, actions]) => (
                        <div key={group} className="field" style={{ alignItems: 'start' }}>
                          <div className="lbl" style={{ textTransform: 'capitalize' }}>
                            {group}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {actions.map((action) => (
                              <span key={action} className="fin-pill prepared">
                                {action.replaceAll('_', ' ')}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="settings-card">
                      <h3>Policy checkpoints</h3>
                      <div className="desc">Create a typed Settings report so policy state becomes queryable memory, not just UI text.</div>
                      <Button disabled={!orgId || loading === 'checkpoint'} onClick={createPolicyCheckpoint}>
                        {loading === 'checkpoint' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                        {loading === 'checkpoint' ? 'Creating…' : 'Create settings checkpoint'}
                      </Button>
                      {settingsObjects.length > 0 ? (
                        <div className="mt-4">
                          {settingsObjects.slice(0, 5).map((object) => (
                            <div key={object.object_id} className="field">
                              <div className="lbl">{object.title}</div>
                              <div className="val">
                                {object.type.replaceAll('_', ' ')} · {object.status.replaceAll('_', ' ')}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {pane === 'integrations' ? (
                  <>
                    <div className="settings-card">
                      <h3>Integrations</h3>
                      <div className="desc">Provider depth is explicit — sandbox stays labeled sandbox.</div>
                      <div className="field">
                        <div className="lbl">Payments</div>
                        <div className="val">sandbox / manual fallback</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Funding</div>
                        <div className="val">sandbox financier</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Files</div>
                        <div className="val">local object storage</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Realtime</div>
                        <div className="val">SSE events</div>
                      </div>
                    </div>

                    <div className="settings-card">
                      <h3>Data &amp; privacy</h3>
                      <div className="field">
                        <div className="lbl">
                          Tenant isolation<span className="hint">every query runs under org context</span>
                        </div>
                        <div className="val">PostgreSQL RLS</div>
                      </div>
                      <div className="field">
                        <div className="lbl">External access</div>
                        <div className="val">scoped grants only</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Audit</div>
                        <div className="val">
                          hash-chained events ·{' '}
                          <Link href="/operations-center" className="text-cyan-text hover:underline">
                            verify →
                          </Link>
                        </div>
                      </div>
                      <div className="field">
                        <div className="lbl">Proof</div>
                        <div className="val">bundles by default</div>
                      </div>
                    </div>
                    <div className="ai-note" style={{ marginTop: 0 }}>
                      <div className="ib">
                        <KeyRound className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <b>Governance is configuration, not convention.</b> These values come from the deployment profile — changing them
                        is an explicit, audited act.
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </>
        </WorkspaceGuard>
      </div>
    </AppShell>
  );
}
