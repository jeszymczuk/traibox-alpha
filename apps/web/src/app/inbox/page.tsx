'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Inbox as InboxIcon, Loader2, Mail, RefreshCw, Send, Sparkles } from 'lucide-react';
import type { OrgMessageItem } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { WorkspaceGuard } from '../../components/workspace-guard';
import { Button, buttonClassName } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type Thread = {
  trade_id: string;
  trade_title: string;
  messages: OrgMessageItem[];
  latest: OrgMessageItem;
};

function initialsOf(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || 'TR'
  );
}

function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'YDAY' : `${d}d`;
}

function roleLabel(role: string) {
  return role === 'user' ? 'You' : role === 'assistant' ? 'TRAIBOX' : role;
}

export default function InboxPage() {
  const { auth, orgs, orgId, setOrgId } = useOrgSelection();
  const [messages, setMessages] = useState<OrgMessageItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMessages(orgId, 300);
      setMessages(res.messages ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load inbox');
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  const threads = useMemo<Thread[]>(() => {
    const byTrade = new Map<string, OrgMessageItem[]>();
    for (const m of messages) {
      const list = byTrade.get(m.trade_id) ?? [];
      list.push(m);
      byTrade.set(m.trade_id, list);
    }
    return [...byTrade.entries()]
      .map(([trade_id, list]) => {
        const sorted = [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        return {
          trade_id,
          trade_title: sorted[0]?.trade_title || `Trade ${trade_id.slice(0, 8).toUpperCase()}`,
          messages: sorted,
          latest: sorted[sorted.length - 1]!
        };
      })
      .sort((a, b) => new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime());
  }, [messages]);

  const activeThread = threads.find((t) => t.trade_id === selected) ?? threads[0] ?? null;
  const today = new Date().toDateString();
  const todayCount = messages.filter((m) => new Date(m.created_at).toDateString() === today).length;
  const agentReplies = messages.filter((m) => m.role !== 'user').length;
  const needsYou = threads.filter((t) => t.latest.role !== 'user').length;

  async function send() {
    if (!orgId || !activeThread || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.postTradeMessage(orgId, activeThread.trade_id, draft.trim());
      setDraft('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <div className="page-head" style={{ paddingTop: 0 }}>
          <div>
            <h1>Inbox</h1>
            <div className="sub">Every trade-scoped conversation in one place — your messages, TRAIBOX replies, and the trades they move.</div>
          </div>
          <div className="actions">
            <Button variant="secondary" onClick={() => void refresh()} disabled={loading || !orgId}>
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Refresh
            </Button>
          </div>
        </div>

        <WorkspaceGuard
          authStatus={auth.status}
          orgId={orgId}
          loaded={loaded}
          error={messages.length === 0 ? error : null}
          onRetry={() => void refresh()}
          module="Inbox"
        >
        {threads.length === 0 ? (
          <div className="pay-empty">
            <div className="ic">
              <Mail className="h-6 w-6" />
            </div>
            <h2>No conversations yet</h2>
            <p>Messages posted in your Trade Rooms — by you or by TRAIBOX — thread up here, grouped by trade.</p>
            <div className="pe-cta">
              <Link href="/trades" className={buttonClassName({ variant: 'secondary' })}>
                Open Trades →
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="metrics-row" style={{ marginBottom: 18 }}>
              <div className="metric">
                <div className="num cyan">{threads.length}</div>
                <div className="lbl">Active threads</div>
              </div>
              <div className="metric">
                <div className="num">{todayCount}</div>
                <div className="lbl">Messages today</div>
              </div>
              <div className="metric">
                <div className="num good">{agentReplies}</div>
                <div className="lbl">TRAIBOX replies</div>
              </div>
              <div className="metric">
                <div className={cn('num', needsYou > 0 && 'warn')}>{needsYou}</div>
                <div className="lbl">Awaiting your reply</div>
              </div>
            </div>

            <div className="ci-grid">
              <div className="ci-list">
                <div className="ci-list-head">
                  <InboxIcon className="h-4 w-4" />
                  <span>Threads</span>
                  <span className="filter">{messages.length} messages</span>
                </div>
                <div className="ci-list-body scroll-thin">
                  {threads.map((t) => (
                    <button
                      key={t.trade_id}
                      type="button"
                      className={cn('ci-item', activeThread?.trade_id === t.trade_id && 'on')}
                      onClick={() => setSelected(t.trade_id)}
                    >
                      <div className={cn('av', t.latest.role !== 'user' && 'v')}>{initialsOf(t.trade_title)}</div>
                      <div>
                        <div className="top">
                          <span className="from">{t.trade_title}</span>
                          <span className="ts">{ago(t.latest.created_at)}</span>
                        </div>
                        <div className="subj">
                          {roleLabel(t.latest.role)}: {t.latest.text.slice(0, 80)}
                        </div>
                        <div className="preview">
                          {t.messages.length} message{t.messages.length === 1 ? '' : 's'} on this trade
                        </div>
                        <div className="tags">
                          <span className="tag sent">TRX-{t.trade_id.slice(0, 8).toUpperCase()}</span>
                          {t.latest.role !== 'user' ? <span className="tag needs-you">AWAITING YOU</span> : <span className="tag drafted">YOU REPLIED</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="ci-detail">
                {activeThread ? (
                  <>
                    <div className="ci-detail-head">
                      <div className="av">{initialsOf(activeThread.trade_title)}</div>
                      <div className="info">
                        <div className="from">{activeThread.trade_title}</div>
                        <div className="meta">
                          TRX-{activeThread.trade_id.slice(0, 8).toUpperCase()} · {activeThread.messages.length} message
                          {activeThread.messages.length === 1 ? '' : 's'}
                        </div>
                      </div>
                      <div className="actions">
                        <Link href={`/trades/${activeThread.trade_id}`} className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                          Open trade <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                    <div className="ci-detail-body scroll-thin">
                      {activeThread.messages.map((m) => (
                        <div key={m.message_id} className="ci-msg">
                          <div className="msghead">
                            <span className={cn('who', m.role)}>{roleLabel(m.role)}</span>
                            <span className="ts">
                              {new Date(m.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                        </div>
                      ))}

                      <div className="ci-draft">
                        <div className="badge">
                          <span className="pip" />
                          Reply on this trade · posts to the Trade Room stream
                        </div>
                        <textarea
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          placeholder="Write a reply — it lands in the trade-scoped stream…"
                        />
                        <div className="draft-actions">
                          {error ? <span className="text-xs text-bad">{error}</span> : null}
                          <div style={{ flex: 1 }} />
                          <Button size="sm" disabled={sending || !draft.trim()} onClick={() => void send()}>
                            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
                          </Button>
                        </div>
                      </div>

                      <div className="ai-note" style={{ marginTop: 0 }}>
                        <div className="ib">
                          <Sparkles className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <b>Trade-scoped by design.</b> Every message here belongs to a trade&rsquo;s governed stream — replies are
                          recorded on the trade, and nothing external is sent without your explicit action.
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </>
        )}
        </WorkspaceGuard>
      </div>
    </AppShell>
  );
}
