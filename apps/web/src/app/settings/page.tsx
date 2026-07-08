'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Database, KeyRound, Loader2, PlugZap, ShieldCheck, TriangleAlert, UserPlus, Users } from 'lucide-react';
import type { AlphaObject, OrgAccessResponse, OrgRole } from '@traibox/contracts';
import { LEDGER_RAIL_PROVIDER_CATALOG, PAYMENT_RAIL_PROVIDER_CATALOG, PROTECTED_ACTIONS, SMART_CONTRACT_RAIL_PROVIDER_CATALOG } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { WorkspaceGuard } from '../../components/workspace-guard';
import { Button } from '../../components/ui/button';
import { api, type RuntimeCheck, type RuntimeReadinessResponse } from '../../lib/api';
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

type ProviderReadinessItem = {
  id: string;
  title: string;
  category: 'Payments' | 'Proof anchoring' | 'Smart contracts';
  state: 'ready' | 'warning' | 'blocked' | 'planned';
  summary: string;
  capabilities: string[];
  protectedActions: string[];
  checks: RuntimeCheck[];
  fallback?: string;
  licenseBoundary?: boolean;
  network?: string;
};

export default function SettingsPage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [pane, setPane] = useState<Pane>('workspace');
  const [access, setAccess] = useState<OrgAccessResponse | null>(null);
  const [settingsObjects, setSettingsObjects] = useState<AlphaObject[]>([]);
  const [allocationPolicies, setAllocationPolicies] = useState<any[]>([]);
  const [runtimeReadiness, setRuntimeReadiness] = useState<RuntimeReadinessResponse | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('member');
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    const [accessResult, settingsResult, policyResult, runtimeResult] = await Promise.all([
      api.getOrgAccess(orgId),
      api.queryAlphaObjects(orgId, { origin_workspace: 'settings', limit: 40 }),
      api.listAllocationPolicies(orgId),
      api.getRuntimeReadiness()
        .then((result) => ({ result, error: null }))
        .catch((err) => ({ result: null, error: err instanceof Error ? err.message : 'Runtime readiness unavailable' }))
    ]);
    setAccess(accessResult);
    setSettingsObjects(settingsResult.objects ?? []);
    setAllocationPolicies(policyResult.policies ?? []);
    setRuntimeReadiness(runtimeResult.result);
    setRuntimeError(runtimeResult.error);
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
  const providerReadiness = useMemo(() => buildProviderReadiness(runtimeReadiness), [runtimeReadiness]);

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
                      <h3>Execution rails readiness</h3>
                      <div className="desc">Provider-neutral rails stay explicit: active, fallback, planned, and blocked states are visible before money, proof, or smart-contract work moves.</div>
                      <div className="field">
                        <div className="lbl">Runtime profile</div>
                        <div className="val">
                          {runtimeReadiness ? `${runtimeReadiness.runtime.profile_id} · ${runtimeReadiness.runtime.region}` : 'not connected'}
                        </div>
                      </div>
                      <div className="field">
                        <div className="lbl">
                          Runtime status<span className="hint">from API /readyz</span>
                        </div>
                        <div className="val">
                          <RailStatusPill state={runtimeReadiness ? readinessStateFromSeverity(runtimeReadiness.runtime.status) : 'warning'} label={runtimeReadiness ? runtimeReadiness.runtime.status : 'unavailable'} />
                          {runtimeReadiness?.runtime.degraded_mode ? <span className="ml-1 rounded-full bg-warn/10 px-2 py-1 text-[10px] text-warn">degraded mode</span> : null}
                        </div>
                      </div>
                      <div className="field">
                        <div className="lbl">Database</div>
                        <div className="val">{runtimeReadiness?.database ? (runtimeReadiness.database.ok ? `connected · ${runtimeReadiness.database.latency_ms}ms` : 'blocked') : 'not checked'}</div>
                      </div>
                      {runtimeError ? (
                        <div className="ai-note" style={{ marginTop: 12 }}>
                          <div className="ib">
                            <TriangleAlert className="h-3.5 w-3.5" />
                          </div>
                          <div>Runtime readiness could not be loaded: {runtimeError}. The provider catalog below still shows intended alpha rails.</div>
                        </div>
                      ) : null}
                    </div>

                    <div className="grid gap-3 lg:grid-cols-2">
                      {providerReadiness.map((rail) => (
                        <div key={rail.id} className="settings-card" style={{ margin: 0 }}>
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[10px] uppercase tracking-[0.18em] text-text-3">{rail.category}</div>
                              <h3 className="mt-1">{rail.title}</h3>
                            </div>
                            <RailStatusPill state={rail.state} label={rail.state} />
                          </div>
                          <div className="desc">{rail.summary}</div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {rail.capabilities.slice(0, 5).map((capability) => (
                              <span key={capability} className="fin-pill prepared">
                                {capability.replaceAll('_', ' ')}
                              </span>
                            ))}
                          </div>
                          <div className="mt-3 grid gap-2 text-xs text-text-2">
                            {rail.fallback ? <RailFact label="Fallback" value={rail.fallback} /> : null}
                            {rail.network ? <RailFact label="Network" value={rail.network} /> : null}
                            {rail.licenseBoundary !== undefined ? <RailFact label="License boundary" value={rail.licenseBoundary ? 'licensed partner rail required' : 'internal/manual evidence only'} /> : null}
                            {rail.protectedActions.length ? <RailFact label="Protected actions" value={rail.protectedActions.map((action) => action.replaceAll('_', ' ')).join(', ')} /> : null}
                          </div>
                          {rail.checks.length ? (
                            <div className="mt-3 space-y-2">
                              {rail.checks.map((check) => (
                                <div key={check.key} className="rounded-2xl border border-border/10 bg-surface2/50 px-3 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium">{check.key.replaceAll('.', ' · ')}</div>
                                    <RailStatusPill state={readinessStateFromSeverity(check.severity)} label={check.severity} />
                                  </div>
                                  <div className="mt-1 text-xs text-text-3">{check.message}</div>
                                  {check.env_vars?.length ? <div className="mt-1 font-mono text-[10px] text-text-3">{check.env_vars.join(' · ')}</div> : null}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-3 rounded-2xl border border-border/10 bg-surface2/50 px-3 py-2 text-xs text-text-3">
                              No live runtime check is required for this rail in the current profile.
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="settings-card">
                      <h3>Integration principles</h3>
                      <div className="desc">These are the rails TRAIBOX can orchestrate without locking the product into one provider.</div>
                      <div className="field">
                        <div className="lbl">Payments</div>
                        <div className="val">manual fallback · TrueLayer primary candidate · iBanFirst planned for cross-border/FX</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Proof / XDC</div>
                        <div className="val">hash anchoring only; no PII on-chain</div>
                      </div>
                      <div className="field">
                        <div className="lbl">Smart contracts</div>
                        <div className="val">draft, simulate, and request approval before any binding deployment</div>
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

function buildProviderReadiness(runtimeReadiness: RuntimeReadinessResponse | null): ProviderReadinessItem[] {
  const checks = runtimeReadiness?.runtime.checks ?? [];
  const activeProvider = activePaymentProvider(checks);
  const manualFallbackEnabled = checks.some((check) => check.key === 'payments.provider_strategy' && /manual fallback is enabled/i.test(check.message));
  const truelayerChecks = checks.filter((check) => check.key.startsWith('payments.truelayer'));
  const ledgerChecks = checks.filter((check) => check.key === 'ledger.anchoring');

  const paymentItems = PAYMENT_RAIL_PROVIDER_CATALOG.map((rail) => {
    const isActive = rail.provider === activeProvider;
    const isManual = rail.provider === 'manual';
    const isTrueLayer = rail.provider === 'truelayer';
    const railChecks = isManual ? checks.filter((check) => check.key === 'payments.provider_strategy') : isTrueLayer ? truelayerChecks : [];
    const state =
      rail.status === 'planned'
        ? 'planned'
        : worstState(railChecks, isActive || isManual ? 'ready' : manualFallbackEnabled && rail.provider !== activeProvider ? 'warning' : 'planned');
    return {
      id: `payment:${rail.provider}`,
      title: rail.display_name,
      category: 'Payments',
      state,
      summary: isActive
        ? 'Active payment rail for this deployment profile.'
        : isManual && manualFallbackEnabled
          ? 'Manual fallback keeps pilots moving when a live bank rail is unavailable.'
          : rail.status === 'planned'
            ? 'Planned provider-neutral rail; not wired for live execution in alpha.'
            : 'Available rail, but not the active provider in this deployment profile.',
      capabilities: [...rail.capabilities],
      protectedActions: [...rail.protected_actions],
      checks: railChecks,
      fallback: 'fallback_provider' in rail ? String(rail.fallback_provider) : undefined,
      licenseBoundary: rail.requires_license_boundary
    } satisfies ProviderReadinessItem;
  });

  const ledgerItems = LEDGER_RAIL_PROVIDER_CATALOG.map((rail) => {
    const isEvm = rail.provider === 'evm_event';
    const state = rail.status === 'planned' ? 'planned' : worstState(isEvm ? ledgerChecks : [], isEvm && ledgerChecks.length ? 'ready' : 'planned');
    return {
      id: `ledger:${rail.provider}`,
      title: rail.display_name,
      category: 'Proof anchoring',
      state,
      summary: isEvm
        ? 'Anchors proof-bundle and trade-finance evidence hashes without putting commercial data or PII on-chain.'
        : 'Planned proof rail for future provider flexibility.',
      capabilities: [...rail.capabilities],
      protectedActions: [],
      checks: isEvm ? ledgerChecks : [],
      network: 'default_network' in rail ? rail.default_network : undefined,
      licenseBoundary: false
    } satisfies ProviderReadinessItem;
  });

  const smartContractItems = SMART_CONTRACT_RAIL_PROVIDER_CATALOG.map((rail) => ({
    id: `smart-contract:${rail.provider}`,
    title: rail.display_name,
    category: 'Smart contracts' as const,
    state: 'planned' as const,
    summary: rail.real_value_execution_enabled
      ? 'Real-value execution must still pass protected-action approval gates.'
      : 'Alpha supports architecture and orchestration intent only; no autonomous binding deployment.',
    capabilities: [...rail.capabilities],
    protectedActions: [...rail.protected_actions],
    checks: [],
    licenseBoundary: rail.real_value_execution_enabled
  }));

  return [...paymentItems, ...ledgerItems, ...smartContractItems];
}

function activePaymentProvider(checks: RuntimeCheck[]) {
  const strategy = checks.find((check) => check.key === 'payments.provider_strategy');
  const match = strategy?.message.match(/active provider is ([a-z0-9_-]+)/i);
  return match?.[1] ?? 'manual';
}

function worstState(checks: RuntimeCheck[], fallback: ProviderReadinessItem['state']): ProviderReadinessItem['state'] {
  if (checks.some((check) => check.severity === 'fail')) return 'blocked';
  if (checks.some((check) => check.severity === 'warn')) return 'warning';
  if (checks.some((check) => check.severity === 'pass')) return 'ready';
  return fallback;
}

function readinessStateFromSeverity(severity: RuntimeCheck['severity']): ProviderReadinessItem['state'] {
  if (severity === 'fail') return 'blocked';
  if (severity === 'warn') return 'warning';
  return 'ready';
}

function RailStatusPill({ state, label }: { state: ProviderReadinessItem['state']; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em]',
        state === 'ready' && 'bg-success/10 text-success',
        state === 'warning' && 'bg-warn/10 text-warn',
        state === 'blocked' && 'bg-error/10 text-error',
        state === 'planned' && 'bg-surface2 text-text-3'
      )}
    >
      {state === 'ready' ? <CheckCircle2 className="h-3 w-3" /> : state === 'blocked' ? <TriangleAlert className="h-3 w-3" /> : null}
      {label.replaceAll('_', ' ')}
    </span>
  );
}

function RailFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/10 bg-surface2/50 px-3 py-2">
      <span className="text-text-3">{label}</span>
      <span className="max-w-[68%] text-right font-medium text-ink">{value}</span>
    </div>
  );
}
