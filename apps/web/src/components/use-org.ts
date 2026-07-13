'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { reconcileOrganizationSelection, shouldClearTenantCache } from '../lib/org-selection';
import { useAuth } from './providers';

export function useOrgSelection() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const previousOrgId = useRef<string | null>(null);
  const [orgs, setOrgs] = useState<Array<any>>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshOrgs = async () => {
    if (auth.status !== 'authenticated') return;
    setLoading(true);
    try {
      const list = await api.listOrgs();
      const next = list.orgs ?? [];
      setOrgs(next);
      // Reconcile the selection against the orgs the user can actually access.
      // A stale localStorage org id (e.g. an org they've left or that no longer
      // exists) would otherwise wedge the app on a "Not a member" error, so fall
      // back to the first available org whenever the current one isn't valid.
      setOrgId((current) => reconcileOrganizationSelection(next, current));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const saved = localStorage.getItem('traibox_org_id');
    if (saved) setOrgId(saved);
    void refreshOrgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);

  useEffect(() => {
    if (!orgId) return;
    if (shouldClearTenantCache(previousOrgId.current, orgId)) queryClient.clear();
    previousOrgId.current = orgId;
    try {
      localStorage.setItem('traibox_org_id', orgId);
    } catch {
      // ignore
    }
  }, [orgId, queryClient]);

  const selectedOrg = useMemo(() => orgs.find((o) => o.org_id === orgId) ?? null, [orgs, orgId]);

  return { auth, orgs, setOrgs, orgId, setOrgId, selectedOrg, refreshOrgs, loading };
}
