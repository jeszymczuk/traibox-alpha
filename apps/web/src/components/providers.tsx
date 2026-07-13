'use client';

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api';
import { clearLegacySensitiveBrowserState, loadBrowserSession } from '../lib/client-session';
import { reconcileOrganizationSelection } from '../lib/org-selection';
import { executeTenantTransition, tenantRenderKey, TenantTransitionState, type TenantSnapshot } from '../lib/tenant-transition';
import { ThemeProvider } from './theme';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
const AuthContext = createContext<{ status: AuthStatus }>({ status: 'loading' });

type Organization = {
  org_id: string;
  name: string;
  country?: string | null;
  role?: string | null;
  [key: string]: unknown;
};
type TenantContextValue = {
  auth: { status: AuthStatus };
  orgs: Organization[];
  orgId: string | null;
  setOrgId: (orgId: string | null) => void;
  selectedOrg: Organization | null;
  refreshOrgs: () => Promise<void>;
  loading: boolean;
  tenantEpoch: number;
};
const TenantContext = createContext<TenantContextValue | null>(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function useTenantContext(): TenantContextValue {
  const value = useContext(TenantContext);
  if (!value) throw new Error('Tenant context is unavailable');
  return value;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    void (async () => {
      clearLegacySensitiveBrowserState();
      try {
        const session = await loadBrowserSession();
        setStatus(session.authenticated ? 'authenticated' : 'unauthenticated');
      } catch {
        setStatus('unauthenticated');
      }
    })();
  }, []);

  const ctx = useMemo(() => ({ status }), [status]);

  return (
    <ThemeProvider>
      <AuthContext.Provider value={ctx}>
        <QueryClientProvider client={client}>
          <TenantProvider>{children}</TenantProvider>
        </QueryClientProvider>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}

function TenantProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const transitionState = useRef(new TenantTransitionState());
  const orgRequest = useRef(0);
  const [snapshot, setSnapshot] = useState<TenantSnapshot>(() => transitionState.current.snapshot());
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);

  const persistSelection = useCallback((orgId: string | null) => {
    try {
      if (orgId) localStorage.setItem('traibox_org_id', orgId);
      else localStorage.removeItem('traibox_org_id');
    } catch {
      // The preference is optional and never authoritative.
    }
  }, []);

  const transitionTenant = useCallback(
    async (nextOrgId: string | null) => {
      const current = transitionState.current.snapshot();
      if (current.visibleOrgId === nextOrgId && current.pendingOrgId === null) return true;
      return executeTenantTransition({
        state: transitionState.current,
        nextOrgId,
        cancelQueries: () => queryClient.cancelQueries(),
        clearQueries: () => queryClient.clear(),
        apply: setSnapshot,
        persist: persistSelection
      });
    },
    [persistSelection, queryClient]
  );

  const refreshOrgs = useCallback(async () => {
    if (auth.status !== 'authenticated') return;
    const requestId = ++orgRequest.current;
    setLoading(true);
    try {
      const list = await api.listOrgs();
      if (requestId !== orgRequest.current) return;
      const nextOrgs = (list.orgs ?? []) as Organization[];
      setOrgs(nextOrgs);
      let preferred = transitionState.current.snapshot().visibleOrgId;
      if (!preferred) {
        try {
          preferred = localStorage.getItem('traibox_org_id');
        } catch {
          preferred = null;
        }
      }
      await transitionTenant(reconcileOrganizationSelection(nextOrgs, preferred));
    } finally {
      if (requestId === orgRequest.current) setLoading(false);
    }
  }, [auth.status, transitionTenant]);

  useEffect(() => {
    if (auth.status === 'authenticated') {
      void refreshOrgs();
      return;
    }
    orgRequest.current += 1;
    setOrgs([]);
    setLoading(false);
    void transitionTenant(null);
  }, [auth.status, refreshOrgs, transitionTenant]);

  const visibleOrgId = auth.status === 'authenticated' ? snapshot.visibleOrgId : null;
  const renderSnapshot = useMemo<TenantSnapshot>(
    () => ({ ...snapshot, visibleOrgId, pendingOrgId: auth.status === 'authenticated' ? snapshot.pendingOrgId : null }),
    [auth.status, snapshot, visibleOrgId]
  );
  const selectedOrg = useMemo(
    () => orgs.find((organization) => organization.org_id === visibleOrgId) ?? null,
    [orgs, visibleOrgId]
  );
  const value = useMemo<TenantContextValue>(
    () => ({
      auth,
      orgs,
      orgId: visibleOrgId,
      setOrgId: (orgId) =>
        void transitionTenant(orgId && orgs.some((organization) => organization.org_id === orgId) ? orgId : null),
      selectedOrg,
      refreshOrgs,
      loading,
      tenantEpoch: renderSnapshot.epoch
    }),
    [auth, loading, orgs, refreshOrgs, renderSnapshot.epoch, selectedOrg, transitionTenant, visibleOrgId]
  );

  return (
    <TenantContext.Provider value={value}>
      <Fragment key={tenantRenderKey(renderSnapshot)}>{children}</Fragment>
    </TenantContext.Provider>
  );
}
