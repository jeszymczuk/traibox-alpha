'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowUp,
  Bot,
  Building2,
  ChevronDown,
  Cpu,
  Eye,
  FileText,
  GitBranch,
  Globe,
  Layers,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Newspaper,
  Paperclip,
  Play,
  Plug,
  Plus,
  Radar,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AlphaObject, IntelligenceRunResponse, MemoryInsight, SSEEvent, TradeBrainEvalRun, TradeBrainEvalSuiteSummary, TradeSummary } from '@traibox/contracts';

import { AppShell } from '../../components/shell';
import { useOrgSelection } from '../../components/use-org';
import { WorkspaceGuard } from '../../components/workspace-guard';
import { Button, buttonClassName } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';

type IntTab = 'chat' | 'agents' | 'workflows' | 'pulse';
type ChatMode = 'copilot' | 'plan' | 'agent';
type ChatEntry =
  | { kind: 'user'; text: string }
  | {
      kind: 'agent';
      answer: string;
      followUps: string[];
      savedType: string | null;
      mode: ChatMode;
      traceId: string;
      streaming: boolean;
      error: boolean;
    };

const MODES: Array<{ id: ChatMode; nm: string; ds: string }> = [
  { id: 'agent', nm: 'Agent · Auto', ds: 'Picks the right specialist and runs the routine. Override with a prompt.' },
  { id: 'copilot', nm: 'Copilot', ds: 'Chat, generate, answer. Asks before anything that touches real data.' },
  { id: 'plan', nm: 'Plan', ds: 'Structured runs that create governed objects — you approve every protected step.' }
];

// Model presets. `model: null` = Auto (Trade Brain picks per the deployment profile).
const MODELS: Array<{ id: string; nm: string; badge: string; ds: string; model: string | null }> = [
  { id: 'auto', nm: 'Auto', badge: 'recommended', ds: 'Best fit per task', model: null },
  { id: 'reasoning', nm: 'Reasoning', badge: '', ds: 'Deepest analysis', model: 'claude-opus-4-8' },
  { id: 'fast', nm: 'Fast', badge: '', ds: 'Low-latency', model: 'claude-haiku-4-5' }
];

// Product framing for the specialist roster; run counts are computed live from
// agent tasks whose objective matches the keywords.
const AGENT_CLASSES: Array<{
  cls: string;
  desc: string;
  icon: React.ReactNode;
  agents: Array<{ nm: string; chip: 'auto' | 'ask'; ds: string; keywords: string[] }>;
}> = [
  {
    cls: 'Trade Operations',
    desc: 'Structuring trade work, planning logistics, drafting docs, managing customs',
    icon: <RouteIcon className="h-4 w-4" />,
    agents: [{ nm: 'Trade Operator', chip: 'ask', ds: 'Drafts contracts/invoices/customs, plans logistics, structures trades.', keywords: ['trade', 'draft', 'document', 'logistic', 'customs', 'plan'] }]
  },
  {
    cls: 'Compliance',
    desc: 'Screening, evidence tracking, regulatory monitoring, audit anchoring',
    icon: <ShieldCheck className="h-4 w-4" />,
    agents: [
      { nm: 'Compliance Officer', chip: 'auto', ds: 'Sanctions, KYC/KYB, clearance evidence, adverse media.', keywords: ['compliance', 'sanction', 'screen', 'kyb', 'kyc', 'clearance'] },
      { nm: 'Audit Sentinel', chip: 'auto', ds: 'Verifies append-only audit chain integrity.', keywords: ['audit', 'proof', 'verify', 'chain'] }
    ]
  },
  {
    cls: 'Finance',
    desc: 'Funding packets, payment routing, reconciliation, instrument prep',
    icon: <Layers className="h-4 w-4" />,
    agents: [{ nm: 'Capital Agent', chip: 'ask', ds: 'Builds packets, ranks financiers privately, prepares terms.', keywords: ['fund', 'financ', 'payment', 'offer', 'capital'] }]
  },
  {
    cls: 'Procurement & Growth',
    desc: 'Supplier matching, partner discovery, counterparty onboarding',
    icon: <Users className="h-4 w-4" />,
    agents: [
      { nm: 'Matchmaker', chip: 'auto', ds: 'Matches buyers/sellers by lane, sector, trust threshold.', keywords: ['match', 'buyer', 'supplier', 'counterparty', 'onboard'] },
      { nm: 'Concierge', chip: 'auto', ds: 'Triage, translate, draft replies across your threads.', keywords: ['message', 'inbox', 'reply', 'translate', 'concierge'] }
    ]
  },
  {
    cls: 'Monitoring & Intelligence',
    desc: 'Surveillance, anomaly flagging, signal ingestion, market analysis',
    icon: <Eye className="h-4 w-4" />,
    agents: [{ nm: 'Risk Analyst', chip: 'auto', ds: 'Exposure modelling, readiness scenarios, covenant watch.', keywords: ['risk', 'readiness', 'exposure', 'monitor', 'insight'] }]
  }
];

const RECIPES: Array<{ nm: string; ds: string; tone: string; icon: React.ReactNode; href: string; meta: string }> = [
  { nm: 'Plan a new export', ds: 'From plain-language intent to a clearance-ready trade plan.', tone: '', icon: <RouteIcon className="h-4 w-4" />, href: '/trades/new', meta: 'Trade Operator' },
  { nm: 'Build a financing packet', ds: 'Request offers — financiers price it privately, ranked for you.', tone: 'fin', icon: <Archive className="h-4 w-4" />, href: '/finance', meta: 'Capital Agent' },
  { nm: 'Onboard a counterparty', ds: 'KYB, screening, trust context — one governed packet.', tone: 'growth', icon: <UserPlus className="h-4 w-4" />, href: '/network/workspace', meta: 'Matchmaker' },
  { nm: 'Re-screen counterparties', ds: 'Sanctions and evidence checks across your network.', tone: 'compl', icon: <ShieldCheck className="h-4 w-4" />, href: '/clearance', meta: 'Compliance Officer' },
  { nm: 'Verify the audit chain', ds: 'Hash-by-hash integrity check against the ledger.', tone: 'intel', icon: <Link2 className="h-4 w-4" />, href: '/operations-center', meta: 'Audit Sentinel' },
  { nm: 'Export an evidence pack', ds: 'Signed proof bundle for auditors or regulators.', tone: 'compl', icon: <FileText className="h-4 w-4" />, href: '/trades', meta: 'Audit Sentinel' }
];

function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function greetingFor(hour: number) {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function IntelligencePage() {
  const router = useRouter();
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [tab, setTab] = useState<IntTab>('chat');
  const [objects, setObjects] = useState<AlphaObject[]>([]);
  const [trades, setTrades] = useState<TradeSummary[]>([]);
  const [insights, setInsights] = useState<MemoryInsight[]>([]);
  const [suites, setSuites] = useState<TradeBrainEvalSuiteSummary[]>([]);
  const [evalRuns, setEvalRuns] = useState<TradeBrainEvalRun[]>([]);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ChatMode>('agent');
  const [modeOpen, setModeOpen] = useState(false);
  const [modelId, setModelId] = useState<string>('auto');
  const [modelSubOpen, setModelSubOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachSub, setAttachSub] = useState<null | 'trade' | 'agent' | 'connectors' | 'more'>(null);
  const [focusTradeId, setFocusTradeId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeModel = MODELS.find((m) => m.id === modelId)?.model ?? null;
  const [stream, setStream] = useState<ChatEntry[]>([]);
  const [thinking, setThinking] = useState(false);
  const [runningEval, setRunningEval] = useState<string | null>(null);
  const streamEndRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    if (!orgId) return;
    setError(null);
    try {
      const [objectRes, tradeRes, insightRes, suiteRes, runRes] = await Promise.all([
        api.queryAlphaObjects(orgId, { limit: 200 }),
        api.listTrades(orgId),
        api.queryMemoryInsights(orgId, {}).catch(() => ({ insights: [], lenses: [], recommended_actions: [], source_events: 0, trace_id: '' })),
        api.listTradeBrainEvalSuites(orgId).catch(() => ({ suites: [], trace_id: '' })),
        api.listTradeBrainEvalRuns(orgId, { limit: 20 }).catch(() => ({ runs: [], trace_id: '' }))
      ]);
      setObjects(objectRes.objects ?? []);
      setTrades(tradeRes.trades ?? []);
      setInsights(insightRes.insights ?? []);
      setSuites(suiteRes.suites ?? []);
      setEvalRuns(runRes.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Intelligence');
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (auth.status !== 'authenticated' || !orgId) return;
    void refresh();
    const source = new EventSource(api.eventsUrl({ orgId }));
    source.onmessage = (event) => {
      try {
        setEvents((prev) => [JSON.parse(event.data) as SSEEvent, ...prev].slice(0, 60));
      } catch {
        // ignore malformed events
      }
    };
    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, orgId]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stream, thinking]);

  // Persist the chat transcript per org so it survives navigating away and back.
  useEffect(() => {
    if (!orgId) return;
    try {
      const raw = localStorage.getItem(`traibox.intel.stream.${orgId}`);
      setStream(raw ? (JSON.parse(raw) as ChatEntry[]) : []);
    } catch {
      setStream([]);
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId || stream.length === 0) return;
    try {
      localStorage.setItem(`traibox.intel.stream.${orgId}`, JSON.stringify(stream));
    } catch {
      // ignore storage errors (quota / serialization)
    }
  }, [stream, orgId]);

  const agentTasks = objects.filter((o) => o.type === 'agent_task');
  const workResults = objects.filter((o) => o.type === 'agent_work_result');
  const awaitingApproval = objects.filter((o) => o.status === 'approval_required');
  const blockedInsights = insights.filter((i) => i.severity === 'blocked');
  const watchInsights = insights.filter((i) => i.severity === 'watch');

  const runsFor = (keywords: string[]) =>
    agentTasks.filter((t) => {
      const text = `${t.title} ${String((t.payload_json as any)?.objective ?? '')}`.toLowerCase();
      return keywords.some((k) => text.includes(k));
    }).length;

  async function send(text: string) {
    if (!orgId || !text.trim() || thinking) return;
    const message = text.trim();
    setDraft('');
    // Prior turns give the model conversation context (most recent last).
    const history = stream
      .map((e) =>
        e.kind === 'user'
          ? { role: 'user' as const, content: e.text.slice(0, 6000) }
          : { role: 'assistant' as const, content: e.answer.slice(0, 6000) }
      )
      .slice(-12);
    // Append the user turn plus an empty agent turn that we stream into.
    setStream((s) => [
      ...s,
      { kind: 'user', text: message },
      { kind: 'agent', answer: '', followUps: [], savedType: null, mode, traceId: '', streaming: true, error: false }
    ]);
    setThinking(true);

    const patchAgent = (patch: (e: Extract<ChatEntry, { kind: 'agent' }>) => Extract<ChatEntry, { kind: 'agent' }>) => {
      setStream((s) => {
        const copy = [...s];
        for (let i = copy.length - 1; i >= 0; i--) {
          const e = copy[i];
          if (e && e.kind === 'agent') {
            copy[i] = patch(e);
            break;
          }
        }
        return copy;
      });
    };

    try {
      await api.streamAlphaIntelligence(
        orgId,
        {
          message,
          workspace: 'intelligence',
          mode,
          ...(activeModel ? { model: activeModel } : {}),
          ...(history.length ? { history } : {}),
          ...(focusTradeId ? { trade_id: focusTradeId } : {})
        },
        (event) => {
          const t = event.type;
          if (t === 'delta' && typeof event.text === 'string') {
            const chunk = event.text as string;
            patchAgent((e) => ({ ...e, answer: e.answer + chunk }));
          } else if (t === 'meta') {
            const followUps = Array.isArray(event.follow_ups)
              ? (event.follow_ups as unknown[]).filter((x): x is string => typeof x === 'string')
              : [];
            const savedType =
              typeof event.object_type === 'string' && event.saved_object_id
                ? (event.object_type as string).replace(/_/g, ' ')
                : null;
            const traceId = typeof event.trace_id === 'string' ? event.trace_id : '';
            patchAgent((e) => ({ ...e, followUps, savedType, traceId }));
          } else if (t === 'error') {
            const msg = typeof event.message === 'string' ? event.message : 'Something went wrong. Please try again.';
            patchAgent((e) => ({ ...e, answer: e.answer || msg, error: true, streaming: false }));
          }
        }
      );
    } catch (err) {
      patchAgent((e) => ({ ...e, answer: e.answer || 'Connection lost — please try again.', error: true }));
    } finally {
      patchAgent((e) => ({ ...e, streaming: false }));
      setThinking(false);
      void refresh();
    }
  }

  async function runSuite(suiteId: string) {
    if (!orgId || runningEval) return;
    setRunningEval(suiteId);
    try {
      await api.runTradeBrainEval(orgId, { suite_id: suiteId });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eval run failed');
    } finally {
      setRunningEval(null);
    }
  }

  const proactive = useMemo(() => {
    const cards: Array<{ tone: 'next' | 'anom'; icon: React.ReactNode; ttl: string; ds: string; go: () => void }> = [];
    for (const i of blockedInsights.slice(0, 1)) {
      cards.push({
        tone: 'anom',
        icon: <AlertTriangle className="h-3 w-3" />,
        ttl: i.title,
        ds: `${i.summary.slice(0, 70)} · ${i.next_action.slice(0, 40)}`,
        go: () => (i.trade_ids[0] ? router.push(`/trades/${i.trade_ids[0]}`) : setTab('pulse'))
      });
    }
    if (awaitingApproval.length > 0) {
      cards.push({
        tone: 'next',
        icon: <ShieldCheck className="h-3 w-3" />,
        ttl: `${awaitingApproval.length} protected action${awaitingApproval.length === 1 ? '' : 's'} awaiting your decision`,
        ds: awaitingApproval[0]!.title.slice(0, 70),
        go: () => router.push('/operations-center')
      });
    }
    for (const i of watchInsights.slice(0, 2 - Math.min(cards.length, 2))) {
      cards.push({
        tone: 'next',
        icon: <Newspaper className="h-3 w-3" />,
        ttl: i.title,
        ds: i.summary.slice(0, 80),
        go: () => setTab('pulse')
      });
    }
    return cards.slice(0, 2);
  }, [blockedInsights, watchInsights, awaitingApproval, router]);

  const shiftLine = loaded
    ? `${agentTasks.length} agent task${agentTasks.length === 1 ? '' : 's'} on record · ${
        blockedInsights.length > 0 ? `${blockedInsights.length} blocked signal${blockedInsights.length === 1 ? '' : 's'}` : 'trade book healthy'
      }`
    : 'connecting…';

  const signalTone = (sev: string) => (sev === 'blocked' ? 'bad' : sev === 'watch' ? 'warn' : 'good');
  const eventTone = (type: string) => (type.includes('fail') || type.includes('reject') ? 'bad' : type.includes('approval') || type.includes('attention') ? 'warn' : '');

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="sub-rail">
        <button type="button" className={cn('sub-tab', tab === 'chat' && 'on')} onClick={() => setTab('chat')}>
          <MessageCircle className="h-3.5 w-3.5" /> Chat
        </button>
        <button type="button" className={cn('sub-tab', tab === 'agents' && 'on')} onClick={() => setTab('agents')}>
          <Cpu className="h-3.5 w-3.5" /> Agents
          {agentTasks.length > 0 ? <span className="ct">{agentTasks.length}</span> : null}
        </button>
        <button type="button" className={cn('sub-tab', tab === 'workflows' && 'on')} onClick={() => setTab('workflows')}>
          <Layers className="h-3.5 w-3.5" /> Workflows
          <span className="ct">{RECIPES.length + suites.length}</span>
        </button>
        <button type="button" className={cn('sub-tab', tab === 'pulse' && 'on')} onClick={() => setTab('pulse')}>
          <Radar className="h-3.5 w-3.5" /> Pulse
          {insights.length + events.length > 0 ? <span className="ct">{insights.length + events.length}</span> : null}
        </button>
        <Link href="/intelligence/workspace" className="sub-tab">
          <ShieldCheck className="h-3.5 w-3.5" /> Governed workspace
        </Link>
        <div className="right">
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--cyan)',
              marginRight: 6,
              boxShadow: '0 0 6px var(--cyan)'
            }}
          />
          {shiftLine}
        </div>
      </div>

      <WorkspaceGuard authStatus={auth.status} orgId={orgId} loaded={loaded} error={error} onRetry={() => void refresh()} module="Intelligence">
        {tab === 'chat' ? (
          <div className={cn('chat-home', stream.length > 0 && 'streaming')}>
            <div className="home-variant active" style={{ display: stream.length > 0 ? 'none' : undefined }}>
              <div className="chat-eyebrow">
                <span className="live-dot" />
                <span>{shiftLine}</span>
              </div>
              <h1 className="chat-greeting">
                {greetingFor(new Date().getHours())}, <span className="soft">{selectedOrg?.name ?? 'trader'}.</span>
              </h1>
            </div>

            <div className="chat-stream">
              <div className="chat-stream-head">
                <span className="pip" />
                <span>Intelligence session · governed</span>
                <button
                  type="button"
                  className="reset"
                  onClick={() => {
                    setStream([]);
                    if (orgId) {
                      try {
                        localStorage.removeItem(`traibox.intel.stream.${orgId}`);
                      } catch {
                        // ignore
                      }
                    }
                  }}
                >
                  New session
                </button>
              </div>
              {stream.map((entry, i) =>
                entry.kind === 'user' ? (
                  <div key={i} className="cs-user">
                    <div className="bubble">{entry.text}</div>
                  </div>
                ) : (
                  <div key={i} className={cn('cs-card', entry.error && 'error')}>
                    <div className="head">
                      <span className="cic">
                        <Sparkles className="h-3 w-3" />
                      </span>
                      TRAIBOX
                      {entry.traceId ? <span className="trace">trace {entry.traceId.slice(0, 12)}</span> : null}
                    </div>
                    <div className="body">
                      {entry.answer ? (
                        <div className="answer-body">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.answer}</ReactMarkdown>
                          {entry.streaming ? <span className="stream-caret" /> : null}
                        </div>
                      ) : (
                        <span className="cs-typing">
                          <span />
                          <span />
                          <span />
                        </span>
                      )}
                      {!entry.streaming && !entry.error && entry.followUps.length > 0 ? (
                        <div className="cs-actions">
                          {entry.followUps.slice(0, 4).map((f, ai) => (
                            <button key={ai} type="button" className="cs-chip" onClick={() => void send(f)} disabled={thinking}>
                              {f}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {!entry.streaming && entry.savedType ? (
                        <div className="cs-saved">
                          <ShieldCheck className="h-3 w-3" /> Saved to your trade book as a {entry.savedType}
                        </div>
                      ) : null}
                    </div>
                  </div>
                )
              )}
              <div ref={streamEndRef} />
            </div>

            <div className="chat-pill-wrap">
              <div className="chat-pill">
                <textarea
                  rows={2}
                  value={draft}
                  placeholder="Ask anything about your trade book…"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void send(draft);
                    }
                  }}
                />
                <div className="chat-controls">
                  <button
                    type="button"
                    className={cn('plus-btn', attachOpen && 'open')}
                    onClick={() => {
                      setAttachOpen((v) => !v);
                      setAttachSub(null);
                    }}
                    title="Attach & connect"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <div className="spacer" />
                  <div
                    className="mode-chip"
                    role="button"
                    tabIndex={0}
                    onClick={() => setModeOpen((v) => !v)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setModeOpen((v) => !v);
                      }
                    }}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-text-3" />
                    <span className="mode-name">{MODES.find((m) => m.id === mode)?.nm}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-text-3" />
                    {modeOpen ? (
                      <div className="mode-menu glass-pop" onClick={(e) => e.stopPropagation()}>
                        {MODES.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={cn('mode-item', mode === m.id && 'active')}
                            onClick={() => {
                              setMode(m.id);
                              setModeOpen(false);
                            }}
                          >
                            <div className="mr" />
                            <div className="info">
                              <div className="nm">{m.nm}</div>
                              <div className="ds">{m.ds}</div>
                            </div>
                          </button>
                        ))}
                        <div className="cas-div" />
                        <button
                          type="button"
                          className="mode-item"
                          onClick={(e) => {
                            e.stopPropagation();
                            setModelSubOpen((v) => !v);
                          }}
                        >
                          <Bot className="mt-0.5 h-3.5 w-3.5 text-text-3" />
                          <div className="info">
                            <div className="nm" style={{ fontWeight: 400 }}>
                              Model
                            </div>
                            <div className="ds">
                              {MODELS.find((m) => m.id === modelId)?.nm} · {MODELS.find((m) => m.id === modelId)?.ds}
                            </div>
                          </div>
                          <ChevronDown className={cn('h-3.5 w-3.5 text-text-3 transition-transform', modelSubOpen && 'rotate-180')} />
                        </button>
                        {modelSubOpen ? (
                          <div className="model-list">
                            {MODELS.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className={cn('model-row', modelId === m.id && 'active')}
                                onClick={() => {
                                  setModelId(m.id);
                                  setModelSubOpen(false);
                                }}
                              >
                                <span className="model-nm">{m.nm}</span>
                                {m.badge ? <span className="model-badge">{m.badge}</span> : null}
                                <span className="model-ds">{m.ds}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button type="button" className="voice-orb" title="Send" disabled={thinking || !draft.trim()} onClick={() => void send(draft)}>
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  const names = Array.from(e.target.files ?? []).map((f) => f.name);
                  if (names.length) {
                    setDraft((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}[Attached: ${names.join(', ')}] `);
                  }
                  e.target.value = '';
                }}
              />
              {attachOpen ? (
                <div className="cascade glass-pop attach" style={{ display: 'block' }}>
                  <button
                    type="button"
                    className="cas-item"
                    onClick={() => {
                      setAttachOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <Paperclip className="h-4 w-4" />
                    <span className="flex-1 text-left">Add files or photos</span>
                  </button>

                  <button
                    type="button"
                    className={cn('cas-item', attachSub === 'trade' && 'expanded')}
                    onClick={() => setAttachSub((s) => (s === 'trade' ? null : 'trade'))}
                  >
                    <GitBranch className="h-4 w-4" />
                    <span className="flex-1 text-left">Add to a Trade</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 chev', attachSub === 'trade' && 'rotate-180')} />
                  </button>
                  {attachSub === 'trade' ? (
                    <div className="cas-sub">
                      <button
                        type="button"
                        className="cas-sub-item"
                        onClick={() => {
                          setFocusTradeId(null);
                          setAttachOpen(false);
                          setAttachSub(null);
                        }}
                      >
                        <Globe className="h-3.5 w-3.5" />
                        <span className="flex-1 truncate">Whole trade book{focusTradeId === null ? ' ✓' : ''}</span>
                      </button>
                      {trades.slice(0, 6).map((t) => (
                        <button
                          key={t.trade_id}
                          type="button"
                          className="cas-sub-item"
                          onClick={() => {
                            setFocusTradeId(t.trade_id);
                            setAttachOpen(false);
                            setAttachSub(null);
                          }}
                        >
                          <GitBranch className="h-3.5 w-3.5" />
                          <span className="flex-1 truncate">
                            {t.title ?? t.trade_id.slice(0, 8)}
                            {focusTradeId === t.trade_id ? ' ✓' : ''}
                          </span>
                        </button>
                      ))}
                      {trades.length === 0 ? <div className="cas-empty">No trades yet — the run stays book-wide.</div> : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className={cn('cas-item', attachSub === 'agent' && 'expanded')}
                    onClick={() => setAttachSub((s) => (s === 'agent' ? null : 'agent'))}
                  >
                    <Cpu className="h-4 w-4" />
                    <span className="flex-1 text-left">Call an Agent</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 chev', attachSub === 'agent' && 'rotate-180')} />
                  </button>
                  {attachSub === 'agent' ? (
                    <div className="cas-sub">
                      {AGENT_CLASSES.flatMap((c) => c.agents).map((a) => (
                        <button
                          key={a.nm}
                          type="button"
                          className="cas-sub-item"
                          onClick={() => {
                            setDraft((d) => `@${a.nm} ${d}`.trimStart());
                            setAttachOpen(false);
                            setAttachSub(null);
                          }}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          <span className="flex-1 truncate">{a.nm}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className={cn('cas-item', attachSub === 'connectors' && 'expanded')}
                    onClick={() => setAttachSub((s) => (s === 'connectors' ? null : 'connectors'))}
                  >
                    <Plug className="h-4 w-4" />
                    <span className="flex-1 text-left">Connectors</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 chev', attachSub === 'connectors' && 'rotate-180')} />
                  </button>
                  {attachSub === 'connectors' ? (
                    <div className="cas-sub">
                      <button
                        type="button"
                        className="cas-sub-item"
                        onClick={() => {
                          setAttachOpen(false);
                          router.push('/operations-center');
                        }}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        <span className="flex-1">Manage connectors</span>
                      </button>
                      {['Tools', 'Systems', 'Platforms', 'Marketplaces', 'Banks & Payments'].map((g) => (
                        <div key={g} className="cas-sub-item soon-row">
                          <Plug className="h-3.5 w-3.5" />
                          <span className="flex-1">{g}</span>
                          <span className="soon">SOON</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className={cn('cas-item', attachSub === 'more' && 'expanded')}
                    onClick={() => setAttachSub((s) => (s === 'more' ? null : 'more'))}
                  >
                    <Layers className="h-4 w-4" />
                    <span className="flex-1 text-left">More</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 chev', attachSub === 'more' && 'rotate-180')} />
                  </button>
                  {attachSub === 'more' ? (
                    <div className="cas-sub">
                      <button
                        type="button"
                        className="cas-sub-item"
                        onClick={() => {
                          setAttachOpen(false);
                          setTab('pulse');
                        }}
                      >
                        <Radar className="h-3.5 w-3.5" />
                        <span className="flex-1">Connect a Pulse</span>
                      </button>
                      {['Web search', 'Market research', 'Canvas — draft a doc', 'Routine — create a task'].map((m) => (
                        <div key={m} className="cas-sub-item soon-row">
                          <Sparkles className="h-3.5 w-3.5" />
                          <span className="flex-1">{m}</span>
                          <span className="soon">SOON</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {focusTradeId ? (
                <div className="mono mt-2 text-[10.5px] uppercase tracking-wider text-cyan-text">
                  Focused on TRX-{focusTradeId.slice(0, 8).toUpperCase()}
                </div>
              ) : null}
            </div>

            {proactive.length > 0 ? (
              <div className="chat-proactive">
                {proactive.map((c, i) => (
                  <button key={i} type="button" className="pro-card" onClick={c.go}>
                    <div className={cn('ic', c.tone)}>{c.icon}</div>
                    <div className="body">
                      <div className="ttl">{c.ttl}</div>
                      <div className="ds">{c.ds}</div>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="qa-row">
              <button type="button" className="qa" onClick={() => router.push('/trades/new')}>
                <RouteIcon className="h-3.5 w-3.5" />
                <span>Plan a trade</span>
              </button>
              <button type="button" className="qa" onClick={() => router.push('/finance')}>
                <Archive className="h-3.5 w-3.5" />
                <span>Build a financing packet</span>
              </button>
              <button type="button" className="qa" onClick={() => router.push('/network')}>
                <Users className="h-3.5 w-3.5" />
                <span>Verify a counterparty</span>
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'agents' ? (
          <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
            <div className="page-head">
              <div>
                <h1>Agents</h1>
                <div className="sub">Specialist agents across five canonical classes — each governed, ephemeral, auditable.</div>
              </div>
              <div className="actions">
                <Link href="/intelligence/workspace" className={buttonClassName()}>
                  <Play className="h-4 w-4" /> Deploy an agent
                </Link>
              </div>
            </div>

            <div className="ag-stat-row">
              <div className="ag-stat">
                <div className="v cyan">{agentTasks.length}</div>
                <div className="l">Agent tasks on record</div>
              </div>
              <div className="ag-stat">
                <div className="v">{workResults.length}</div>
                <div className="l">Work results delivered</div>
              </div>
              <div className="ag-stat">
                <div className={cn('v', awaitingApproval.length > 0 && 'warn')}>{awaitingApproval.length}</div>
                <div className="l">Awaiting approval</div>
              </div>
              <div className="ag-stat">
                <div className="v good">{objects.filter((o) => o.type === 'ai_eval_result').length}</div>
                <div className="l">Eval results</div>
              </div>
            </div>

            <div className="ag-gov">
              <div className="ic">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="info">
                <h4>Governed delegates · not free-roaming</h4>
                <p>
                  Every agent runs within a declared scope, with statically declared tools, mandatory confirmation gates for protected
                  actions, and a full audit trace. Agents draft and recommend. You decide.
                </p>
                <div className="links">
                  <Link href="/intelligence/runs">Agent runs →</Link>
                  <Link href="/operations-center">Audit chain →</Link>
                  <Link href="/settings">Protected actions →</Link>
                </div>
              </div>
            </div>

            {AGENT_CLASSES.map((cls) => (
              <div key={cls.cls} className="ag-class">
                <div className="ag-class-head">
                  <div className="cls-ic">{cls.icon}</div>
                  <div className="nm">
                    {cls.cls}
                    <div className="desc">{cls.desc}</div>
                  </div>
                  <span className="ct">
                    {cls.agents.length} agent{cls.agents.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="ag-list">
                  {cls.agents.map((agent) => {
                    const runs = runsFor(agent.keywords);
                    return (
                      <Link key={agent.nm} href="/intelligence/runs" className="ag-row">
                        <div className="ric">{cls.icon}</div>
                        <div className="info">
                          <div className="nm">
                            {agent.nm}
                            <span className={cn('chip', agent.chip)}>{agent.chip === 'auto' ? 'AUTO' : 'ASK FIRST'}</span>
                          </div>
                          <div className="ds">{agent.ds}</div>
                        </div>
                        <div className="runs">
                          <span className="v">{runs}</span>
                          <div className="stat">
                            <span className={cn('pip', runs === 0 && 'idle')} />
                            {runs > 0 ? 'ACTIVE' : 'IDLE'}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}

            <h3 className="mono mb-3 mt-2 px-0.5 text-[11px] uppercase tracking-wider text-text-3">Deployment environments</h3>
            <div className="ag-env">
              <div className="ag-env-card">
                <h5>
                  <Building2 className="h-3.5 w-3.5" />
                  Internal
                </h5>
                <div className="nm">Inside TRAIBOX</div>
                <div className="ds">Direct access to Trade Memory, modules, and tools. Default for canonical work.</div>
                <div className="ct">{agentTasks.length} tasks run internal</div>
              </div>
              <div className="ag-env-card">
                <h5>
                  <Plug className="h-3.5 w-3.5" />
                  Connected
                </h5>
                <div className="nm">Partner systems</div>
                <div className="ds">Agents reach into connected rails — banks, providers — with scoped tools only.</div>
                <div className="ct">Bank rails authorised</div>
              </div>
              <div className="ag-env-card preview">
                <h5>
                  <Globe className="h-3.5 w-3.5" />
                  Delegated
                </h5>
                <div className="nm">External environments · B2A</div>
                <div className="ds">Future: counterparty agents reach our gates with the same audit + confirmation rules a human gets.</div>
                <div className="ct">Preview · design pilot</div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'workflows' ? (
          <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
            <div className="page-head">
              <div>
                <h1>Workflows</h1>
                <div className="sub">Automations that compose your agents — recurring evals and on-demand recipes.</div>
              </div>
            </div>

            <div className="ag-stat-row">
              <div className="ag-stat">
                <div className="v cyan">{RECIPES.length}</div>
                <div className="l">On-demand recipes</div>
              </div>
              <div className="ag-stat">
                <div className="v">{suites.length}</div>
                <div className="l">Eval suites</div>
              </div>
              <div className="ag-stat">
                <div className="v good">{evalRuns.length}</div>
                <div className="l">Eval runs recorded</div>
              </div>
            </div>

            {suites.length > 0 ? (
              <div className="wf-sec">
                <div className="wf-sec-head">
                  <div className="sic">
                    <RefreshCw className="h-4 w-4" />
                  </div>
                  <div>
                    <h3>Recurring quality checks</h3>
                    <div className="nm-sub">Trade Brain eval suites — run on demand, tracked run over run.</div>
                  </div>
                  <span className="ct">{suites.length} suites</span>
                </div>
                <div className="wf-grid">
                  {suites.map((suite) => {
                    const lastRun = evalRuns.find((r) => r.suite_id === suite.suite_id);
                    return (
                      <div key={suite.suite_id} className="wf-card" onClick={() => void runSuite(suite.suite_id)}>
                        <div className="wf-head">
                          <div className="ib intel">
                            <Radar className="h-4 w-4" />
                          </div>
                          <div className="text">
                            <div className="name">{suite.suite_id.replace(/[-_]/g, ' ')}</div>
                            <div className="desc">
                              {suite.case_count} case{suite.case_count === 1 ? '' : 's'} · scored against the live Trade Brain
                            </div>
                          </div>
                        </div>
                        <div className="wf-foot">
                          <span>{lastRun ? `LAST ${ago(String((lastRun as any).created_at ?? new Date().toISOString()))} · ${lastRun.passed}/${lastRun.case_count} PASS` : 'NOT RUN YET'}</span>
                          <div className="actions">
                            <Button size="sm" disabled={runningEval !== null} onClick={(e) => { e.stopPropagation(); void runSuite(suite.suite_id); }}>
                              {runningEval === suite.suite_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="wf-sec">
              <div className="wf-sec-head">
                <div className="sic">
                  <Play className="h-4 w-4" />
                </div>
                <div>
                  <h3>On-demand recipes</h3>
                  <div className="nm-sub">Ready-to-run flows that land in the right governed workspace.</div>
                </div>
                <span className="ct">{RECIPES.length} recipes</span>
              </div>
              <div className="wf-grid">
                {RECIPES.map((recipe) => (
                  <div key={recipe.nm} className="wf-card" onClick={() => router.push(recipe.href)}>
                    <div className="wf-head">
                      <div className={cn('ib', recipe.tone)}>{recipe.icon}</div>
                      <div className="text">
                        <div className="name">{recipe.nm}</div>
                        <div className="desc">{recipe.ds}</div>
                      </div>
                    </div>
                    <div className="wf-foot">
                      <span>{recipe.meta}</span>
                      <div className="actions">
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(recipe.href);
                          }}
                        >
                          <Play className="h-3.5 w-3.5" /> Run
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ai-note">
              <div className="ib">
                <ShieldCheck className="h-3.5 w-3.5" />
              </div>
              <div>
                <b>Three automation classes</b> — drafting, background monitoring, and execution-support. Protected actions — payments,
                releases, overrides — always require your typed confirmation.
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'pulse' ? (
          <div className="mx-auto w-full max-w-6xl px-4 pb-16 md:px-8">
            <div className="page-head">
              <div>
                <h1>Pulse</h1>
                <div className="sub">Live signals from your trade memory and the governed event stream.</div>
              </div>
              <div className="actions">
                <Button variant="secondary" onClick={() => void refresh()}>
                  <RefreshCw className="h-4 w-4" /> Refresh
                </Button>
              </div>
            </div>

            {insights.length === 0 && events.length === 0 ? (
              <div className="pay-empty">
                <div className="ic">
                  <Radar className="h-6 w-6" />
                </div>
                <h2>No signals yet</h2>
                <p>Trade memory insights and live governed events appear here as your book moves.</p>
              </div>
            ) : (
              <>
                {insights.length > 0 ? (
                  <>
                    <div className="pay-sec">
                      Trade memory insights <span className="ct">{insights.length} · from your governed history</span>
                    </div>
                    {insights.slice(0, 8).map((insight) => (
                      <div
                        key={insight.insight_id}
                        className={cn('signal', signalTone(insight.severity))}
                        onClick={() => (insight.trade_ids[0] ? router.push(`/trades/${insight.trade_ids[0]}`) : undefined)}
                      >
                        <div className="ts">{ago(insight.latest_at)}</div>
                        <div className="sev">
                          <span className="pip" />
                        </div>
                        <div>
                          <div className="ttl">
                            <span className="source">{insight.category.replace(/_/g, ' ').slice(0, 12)}</span>
                            {insight.title}
                          </div>
                          <div className="affects">
                            {insight.summary.slice(0, 110)}
                            {insight.next_action ? ` · next: ${insight.next_action.slice(0, 60)}` : ''}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}

                {events.length > 0 ? (
                  <>
                    <div className="pay-sec" style={{ marginTop: 36 }}>
                      Live events <span className="ct">streaming · {events.length} received</span>
                    </div>
                    {events.slice(0, 12).map((event) => (
                      <div
                        key={event.event_id}
                        className={cn('signal', eventTone(event.type))}
                        onClick={() => (event.trade_id ? router.push(`/trades/${event.trade_id}`) : undefined)}
                      >
                        <div className="ts">{ago(event.ts)}</div>
                        <div className="sev">
                          <span className="pip" />
                        </div>
                        <div>
                          <div className="ttl">
                            <span className="source">{event.type.split('.')[0]}</span>
                            {event.type.replace(/[._]/g, ' ')}
                          </div>
                          {event.trade_id ? <div className="affects">TRX-{event.trade_id.slice(0, 8).toUpperCase()}</div> : null}
                        </div>
                      </div>
                    ))}
                  </>
                ) : null}

                <div className="ai-note" style={{ marginTop: 32 }}>
                  <div className="ib">
                    <Mail className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <b>Signals come from your rails, not a feed.</b> Insights are computed from governed trade memory; events stream live
                    over SSE as objects move. External market signals arrive with the Pulse connectors on the roadmap.
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}
      </WorkspaceGuard>
    </AppShell>
  );
}
