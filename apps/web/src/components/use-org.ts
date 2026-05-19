'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from './providers';

export function useOrgSelection() {
  const auth = useAuth();
  const [orgs, setOrgs] = useState<Array<any>>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshOrgs = async () => {
    if (auth.status !== 'authenticated') return;
    setLoading(true);
    try {
      const list = await api.listOrgs();
      setOrgs(list.orgs ?? []);
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
    try {
      localStorage.setItem('traibox_org_id', orgId);
    } catch {
      // ignore
    }
  }, [orgId]);

  const selectedOrg = useMemo(() => orgs.find((o) => o.org_id === orgId) ?? null, [orgs, orgId]);

  return { auth, orgs, setOrgs, orgId, setOrgId, selectedOrg, refreshOrgs, loading };
}

