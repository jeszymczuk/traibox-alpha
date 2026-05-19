'use client';

import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../components/shell';
import { api } from '../lib/api';
import Link from 'next/link';
import { useAuth } from '../components/providers';

export default function HomePage() {
  const auth = useAuth();
  const [orgs, setOrgs] = useState<Array<any>>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [trades, setTrades] = useState<Array<any>>([]);
  const [orgName, setOrgName] = useState('');

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    void (async () => {
      const r = await api.listOrgs();
      setOrgs(r.orgs ?? []);
      const saved = localStorage.getItem('traibox_org_id');
      if (saved) setOrgId(saved);
    })();
  }, [auth.status]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!orgId) return;
    localStorage.setItem('traibox_org_id', orgId);
    void (async () => {
      const r = await api.listTrades(orgId);
      setTrades(r.trades ?? []);
    })();
  }, [auth.status, orgId]);

  const selectedOrg = useMemo(() => orgs.find((o) => o.org_id === orgId) ?? null, [orgs, orgId]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper text-ink p-6">Loading…</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper text-ink p-6">
        <div className="max-w-xl mx-auto rounded-2xl bg-white shadow-sm border border-black/5 p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="text-sm text-muted mt-2">This pilot uses Supabase Auth. Please sign in to continue.</p>
          <Link className="inline-flex mt-4 rounded-xl bg-accent text-white px-4 py-2 font-medium" href="/login">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AppShell
      orgId={orgId}
      orgs={orgs}
      onOrgChange={setOrgId}
      headerRight={
        <div className="text-sm text-muted">
          {selectedOrg ? (
            <span>
              Org: <span className="font-medium text-ink">{selectedOrg.name}</span>
            </span>
          ) : (
            <span>Select an org</span>
          )}
        </div>
      }
    >
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
          <h2 className="text-lg font-semibold">Create org</h2>
          <div className="mt-3 flex gap-2">
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Org name"
              className="flex-1 rounded-xl border border-black/10 px-3 py-2 bg-paper"
            />
            <button
              onClick={async () => {
                const r = await api.createOrg(orgName || 'New org');
                const list = await api.listOrgs();
                setOrgs(list.orgs ?? []);
                setOrgId(r.org_id);
                setOrgName('');
              }}
              className="rounded-xl bg-accent text-white px-4 py-2 font-medium"
            >
              Create
            </button>
          </div>
        </section>

        <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
          <h2 className="text-lg font-semibold">Trades</h2>
          {!orgId ? (
            <p className="text-sm text-muted mt-2">Select an org to view trades.</p>
          ) : trades.length === 0 ? (
            <p className="text-sm text-muted mt-2">No trades yet. Create one below.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {trades.map((t) => (
                <li key={t.trade_id} className="flex items-center justify-between rounded-xl border border-black/10 p-3">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted">
                      {t.corridor} • {t.status}
                    </div>
                  </div>
                  <Link className="text-accent font-medium text-sm" href={`/trade/${t.trade_id}`}>
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {orgId ? (
          <section className="rounded-2xl bg-white shadow-sm border border-black/5 p-5">
            <h2 className="text-lg font-semibold">New trade</h2>
            <NewTrade orgId={orgId} onCreated={(tradeId) => (window.location.href = `/trade/${tradeId}`)} />
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}

function NewTrade({ orgId, onCreated }: { orgId: string; onCreated: (tradeId: string) => void }) {
  const [text, setText] = useState('Sell 100 cases of wine to Madrid; 50% advance; ship next week');
  const [loading, setLoading] = useState(false);
  return (
    <div className="mt-3 space-y-2">
      <textarea
        className="w-full rounded-xl border border-black/10 px-3 py-2 bg-paper min-h-[90px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        disabled={loading}
        onClick={async () => {
          setLoading(true);
          try {
            const r = await api.parseTrade(orgId, { intent_text: text, hints: { currency: 'EUR' } });
            onCreated(r.trade_id);
          } finally {
            setLoading(false);
          }
        }}
        className="rounded-xl bg-accent text-white px-4 py-2 font-medium disabled:opacity-50"
      >
        {loading ? 'Creating…' : 'Generate plan'}
      </button>
    </div>
  );
}
