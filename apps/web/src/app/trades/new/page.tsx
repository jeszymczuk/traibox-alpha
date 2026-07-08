'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowUp, Briefcase, Check, CheckCircle2, Database, Loader2, Lock, Package, Route as RouteIcon } from 'lucide-react';
import type { TradePlanResponse } from '@traibox/contracts';

import { AppShell } from '../../../components/shell';
import { useOrgSelection } from '../../../components/use-org';
import { Button, buttonClassName } from '../../../components/ui/button';
import { api } from '../../../lib/api';
import { cn } from '../../../lib/cn';

type Msg = { role: 'agent' | 'user'; text: string; at: Date; questions?: string[] };

const KICKOFF =
  "What are we moving today? A short description works — goods, services, terms, parties. I'll structure it into a governed trade plan you can open as a Trade Room.";

const QUICK_STARTS: Array<{ icon: React.ReactNode; label: string; text: string }> = [
  {
    icon: <Package className="h-3.5 w-3.5" />,
    label: 'Goods export',
    text: 'Sell 18 tonnes of hot-rolled steel coil from Portugal to a buyer in Hamburg; DAP terms; Net 60; CBAM in scope.'
  },
  {
    icon: <Briefcase className="h-3.5 w-3.5" />,
    label: 'Services contract',
    text: 'Marine engineering consulting from Lisbon for a Singapore shipyard; three milestones; 40% advance.'
  },
  {
    icon: <Database className="h-3.5 w-3.5" />,
    label: 'Digital deliverable',
    text: 'License a carbon-credit verification dataset to a German climate insurer; annual renewal; delivery on signature.'
  }
];

function timeLabel(d: Date) {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export default function NewTradePage() {
  const router = useRouter();
  const { auth, orgs, orgId, setOrgId, selectedOrg } = useOrgSelection();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [plan, setPlan] = useState<TradePlanResponse | null>(null);
  const [parsing, setParsing] = useState(false);
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessages([{ role: 'agent', text: KICKOFF, at: new Date() }]);
  }, []);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send(text: string) {
    if (!orgId || !text.trim() || parsing) return;
    const intent = text.trim();
    setDraft('');
    setMessages((m) => [...m, { role: 'user', text: intent, at: new Date() }]);
    setParsing(true);
    try {
      const res = await api.parseTrade(orgId, { intent_text: intent });
      setPlan(res);
      const itemCount = res.plan.items?.length ?? 0;
      const partyCount = res.plan.parties?.length ?? 0;
      const pending = (res.pending_questions ?? []).map((q: any) => String(q?.question ?? q));
      setMessages((m) => [
        ...m,
        {
          role: 'agent',
          at: new Date(),
          text:
            `Structured it: ${itemCount} item${itemCount === 1 ? '' : 's'}, ${partyCount} part${partyCount === 1 ? 'y' : 'ies'}, ` +
            `${res.plan.terms?.incoterm ?? 'incoterm pending'} · ${res.plan.terms?.payment_terms ?? 'payment terms pending'}. ` +
            `Confidence ${Math.round(res.confidence * 100)}%.` +
            (res.status === 'needs_input' ? ' A few details would sharpen the plan:' : ' The draft Trade Room is ready to open.'),
          questions: pending.slice(0, 3)
        }
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'agent', at: new Date(), text: err instanceof Error ? `I couldn't parse that: ${err.message}` : 'Parsing failed — try rephrasing.' }
      ]);
    } finally {
      setParsing(false);
    }
  }

  const checklist = plan?.plan.checklist ?? [];
  const filledPct = plan
    ? Math.round(
        (([plan.plan.items?.length, plan.plan.parties?.length, plan.plan.terms?.incoterm, plan.plan.terms?.payment_terms].filter(Boolean).length / 4) * 100)
      )
    : 0;

  return (
    <AppShell orgId={orgId} orgs={orgs} onOrgChange={setOrgId}>
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 md:px-8">
        <Link href="/trades" className="uw-back">
          <ArrowLeft className="h-3.5 w-3.5" />
          All trades
        </Link>

        <div className="page-head" style={{ paddingTop: 0, marginBottom: 18 }}>
          <div>
            <div className="mono mb-1.5 text-[11px] uppercase tracking-wider text-text-3">
              {plan ? `TRX-${plan.trade_id.slice(0, 8).toUpperCase()} · draft` : 'Trade Operator drafting'}
            </div>
            <h1>Compose a trade</h1>
            <div className="sub">Tell the Trade Operator what you&rsquo;re moving. It structures the plan as you go — you open the room.</div>
          </div>
        </div>

        {auth.status !== 'authenticated' ? (
          <div className="pay-empty">
            <div className="ic">
              <Lock className="h-6 w-6" />
            </div>
            <h2>Sign in to compose a trade</h2>
            <p>Drafting needs an authenticated session and an organization.</p>
            <div className="pe-cta">
              <Link href="/login" className={buttonClassName()}>
                Go to login
              </Link>
            </div>
          </div>
        ) : !orgId ? (
          <div className="pay-empty">
            <div className="ic">
              <RouteIcon className="h-6 w-6" />
            </div>
            <h2>Select an organization</h2>
            <p>Pick an org in the sidebar to start drafting.</p>
          </div>
        ) : (
          <div className="nt-wrap">
            <div className="nt-comp">
              <div className="nt-head">
                <div className="badge">
                  <RouteIcon className="h-4 w-4" />
                </div>
                <div className="info">
                  <div className="ttl">Trade Operator</div>
                  <div className="nm-sub">Drafting your trade · plain language in, governed plan out</div>
                </div>
                <div className="pip-row">
                  <span className="pip" />
                  LIVE
                </div>
              </div>

              <div className="nt-stream scroll-thin" ref={streamRef}>
                {messages.map((m, i) => (
                  <div key={i} className={cn('nt-msg', m.role)}>
                    <div className="nt-av">{m.role === 'agent' ? <RouteIcon className="h-3.5 w-3.5" /> : (selectedOrg?.name ?? 'You')[0]?.toUpperCase()}</div>
                    <div className="body">
                      <div className="who">
                        <span>{m.role === 'agent' ? 'Trade Operator' : 'You'}</span>
                        <span>· {timeLabel(m.at)}</span>
                      </div>
                      <div className="text">{m.text}</div>
                      {m.questions && m.questions.length > 0 ? (
                        <div className="nt-quick">
                          {m.questions.map((q) => (
                            <button key={q} type="button" onClick={() => setDraft((d) => (d ? `${d} ${q}` : q))}>
                              {q}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {i === 0 ? (
                        <div className="nt-quick">
                          {QUICK_STARTS.map((qs) => (
                            <button key={qs.label} type="button" onClick={() => setDraft(qs.text)}>
                              {qs.icon}
                              {qs.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {parsing ? (
                  <div className="nt-msg agent">
                    <div className="nt-av">
                      <RouteIcon className="h-3.5 w-3.5" />
                    </div>
                    <div className="body">
                      <div className="who">
                        <span>Trade Operator</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-text-3">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> structuring…
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="nt-pill">
                <div className="nt-pill-inner">
                  <textarea
                    rows={2}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send(draft);
                      }
                    }}
                    placeholder="Describe the trade — parties, goods or services, terms…"
                  />
                  <div className="controls">
                    <button type="button" className="send" title="Send" disabled={parsing || !draft.trim()} onClick={() => void send(draft)}>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="nt-plan">
              <div className="nt-plan-head">
                <div className="eyebrow">
                  <span className="pip" />
                  Live trade plan
                </div>
                <h3>{plan ? (plan.plan.items?.[0]?.name ?? 'Draft trade') : 'Waiting for your first message'}</h3>
                <div className="progress">
                  <div className="bar">
                    <div className="fill" style={{ width: `${filledPct}%` }} />
                  </div>
                  <span className="pct">{filledPct}%</span>
                </div>
              </div>

              <div className="nt-plan-body scroll-thin">
                <div className="nt-sec">
                  <div className="nt-sec-head">
                    <h4>Subject of trade</h4>
                    <span className={cn('nt-badge', plan?.plan.items?.length ? 'filled' : undefined)}>
                      {plan?.plan.items?.length ? `${plan.plan.items.length} item${plan.plan.items.length === 1 ? '' : 's'}` : 'empty'}
                    </span>
                  </div>
                  {(plan?.plan.items ?? []).slice(0, 4).map((item, i) => (
                    <div key={i} className="nt-row">
                      <span className="lbl">Item {i + 1}</span>
                      <span className="v">
                        {item.name} · {item.qty} {item.unit}
                      </span>
                      <span className={cn('conf', !item.hs_code && 'empty')} title={item.hs_code ?? 'HS code pending'} />
                    </div>
                  ))}
                  {!plan?.plan.items?.length ? (
                    <div className="nt-row">
                      <span className="lbl">Item</span>
                      <span className="v empty">described in your message</span>
                      <span className="conf empty" />
                    </div>
                  ) : null}
                </div>

                <div className="nt-sec">
                  <div className="nt-sec-head">
                    <h4>Parties</h4>
                    <span className={cn('nt-badge', plan?.plan.parties?.length ? 'filled' : undefined)}>
                      {plan?.plan.parties?.length ? `${plan.plan.parties.length} found` : 'empty'}
                    </span>
                  </div>
                  {(plan?.plan.parties ?? []).map((party, i) => (
                    <div key={i} className="nt-party">
                      <div className={cn('nt-pav', String(party.role).toLowerCase().includes('buy') && 'violet')}>
                        {(party.name ?? party.role ?? '?').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="info">
                        <div className="nm">{party.name ?? '—'}</div>
                        <div className="role">
                          {party.role}
                          {party.country ? ` · ${party.country}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                  {!plan?.plan.parties?.length ? <div className="text-xs italic text-text-4">buyer and seller appear here</div> : null}
                </div>

                <div className="nt-sec">
                  <div className="nt-sec-head">
                    <h4>Terms</h4>
                    <span className={cn('nt-badge', plan?.plan.terms?.incoterm && plan?.plan.terms?.payment_terms ? 'filled' : plan ? 'partial' : undefined)}>
                      {plan?.plan.terms?.incoterm && plan?.plan.terms?.payment_terms ? 'complete' : plan ? 'partial' : 'empty'}
                    </span>
                  </div>
                  <div className="nt-row">
                    <span className="lbl">Incoterm</span>
                    <span className={cn('v', !plan?.plan.terms?.incoterm && 'empty')}>{plan?.plan.terms?.incoterm ?? 'pending'}</span>
                    <span className={cn('conf', !plan?.plan.terms?.incoterm && 'empty')} />
                  </div>
                  <div className="nt-row">
                    <span className="lbl">Payment</span>
                    <span className={cn('v', !plan?.plan.terms?.payment_terms && 'empty')}>{plan?.plan.terms?.payment_terms ?? 'pending'}</span>
                    <span className={cn('conf', !plan?.plan.terms?.payment_terms && 'empty')} />
                  </div>
                  <div className="nt-row">
                    <span className="lbl">Confidence</span>
                    <span className="v">{plan ? `${Math.round(plan.confidence * 100)}%` : '—'}</span>
                    <span className={cn('conf', !plan && 'empty')} />
                  </div>
                </div>

                {checklist.length > 0 ? (
                  <div className="nt-sec">
                    <div className="nt-sec-head">
                      <h4>Checklist</h4>
                      <span className="nt-badge">{checklist.length}</span>
                    </div>
                    {checklist.slice(0, 6).map((item) => (
                      <div key={item} className="nt-check done">
                        <span className="box">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                        <span className="nm">{item}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {plan && plan.status === 'needs_input' ? (
                  <div className="nt-sec">
                    <div className="nt-flag">
                      <AlertTriangle className="h-4 w-4" />
                      <div>
                        <b>Needs input.</b> Answer the Operator&rsquo;s follow-ups (or just add detail) and send again — each pass sharpens
                        the draft.
                      </div>
                    </div>
                  </div>
                ) : plan ? (
                  <div className="nt-sec">
                    <div className="nt-flag good">
                      <CheckCircle2 className="h-4 w-4" />
                      <div>
                        <b>Ready.</b> The draft Trade Room exists with this plan — open it to run readiness, clearance and financing.
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="nt-plan-foot">
                <Button className="flex-1 justify-center" disabled={!plan} onClick={() => plan && router.push(`/trades/${plan.trade_id}`)}>
                  Open Trade Room
                </Button>
                <Link href="/trades" className={cn(buttonClassName({ variant: 'secondary' }), 'flex-1 justify-center')}>
                  All trades
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
