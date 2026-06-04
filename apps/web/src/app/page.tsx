'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '../components/shell';
import { api } from '../lib/api';
import Link from 'next/link';
import { Surface } from '../components/ui/surface';
import { Button, buttonClassName } from '../components/ui/button';
import { useOrgSelection } from '../components/use-org';

export default function HomePage() {
  const { auth, orgs, orgId, setOrgId, selectedOrg, refreshOrgs } = useOrgSelection();
  const [trades, setTrades] = useState<Array<any>>([]);
  const [orgName, setOrgName] = useState('');

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    if (!orgId) return;
    void (async () => {
      const r = await api.listTrades(orgId);
      setTrades(r.trades ?? []);
    })();
  }, [auth.status, orgId]);

  if (auth.status === 'loading') {
    return <div className="min-h-dvh bg-paper text-ink p-6">Loading…</div>;
  }

  if (auth.status === 'unauthenticated') {
    return (
      <div className="min-h-dvh bg-paper text-ink p-6">
        <Surface className="max-w-xl mx-auto p-6">
          <h1 className="text-xl font-semibold">Sign in to TRAIBOX</h1>
          <p className="text-sm text-muted mt-2">This pilot uses Supabase Auth. Please sign in to continue.</p>
          <div className="mt-4">
            <Link className={buttonClassName()} href="/login">
              Go to login
            </Link>
          </div>
        </Surface>
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
        <Surface className="p-5">
          <h2 className="text-lg font-semibold">Create org</h2>
          <div className="mt-3 flex gap-2">
            <input
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              placeholder="Org name"
              className="flex-1 rounded-xl border border-border/10 px-3 py-2 bg-surface2"
            />
            <Button
              onClick={async () => {
                const r = await api.createOrg(orgName || 'New org');
                await refreshOrgs();
                setOrgId(r.org_id);
                setOrgName('');
              }}
            >
              Create
            </Button>
          </div>
        </Surface>

        <Surface className="p-5">
          <h2 className="text-lg font-semibold">Trades</h2>
          {!orgId ? (
            <p className="text-sm text-muted mt-2">Select an org to view trades.</p>
          ) : trades.length === 0 ? (
            <p className="text-sm text-muted mt-2">No trades yet. Create one below.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {trades.map((t) => (
                <li key={t.trade_id} className="flex items-center justify-between rounded-xl border border-border/10 bg-surface2/40 p-3">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs text-muted">
                      {t.corridor} • {t.status}
                    </div>
                  </div>
                  <Link className="text-accent font-medium text-sm" href={`/trades/${t.trade_id}`}>
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Surface>

        {orgId ? (
          <Surface className="p-5">
            <h2 className="text-lg font-semibold">New trade</h2>
            <NewTrade orgId={orgId} onCreated={(tradeId) => (window.location.href = `/trades/${tradeId}`)} />
          </Surface>
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
        className="w-full rounded-xl border border-border/10 px-3 py-2 bg-surface2 min-h-[90px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
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
      >
        {loading ? 'Creating…' : 'Generate plan'}
      </Button>
    </div>
  );
}
