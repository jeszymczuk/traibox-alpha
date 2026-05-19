'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  CircleDot,
  FileDown,
  FileText,
  HandCoins,
  Landmark,
  Loader2,
  MessagesSquare,
  Receipt,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from 'lucide-react';

type StatusTone = 'neutral' | 'success' | 'warn' | 'error' | 'loading';

type CardStatus = 'idle' | 'loading' | 'ready' | 'warnings' | 'error';

type DemoEvent = {
  event_id: string;
  type: string;
  ts: string;
  trace_id: string;
  data: any;
};

type PlanState = {
  status: CardStatus;
  trace_id?: string;
  confidence?: number;
  items?: Array<{ name: string; qty: number; unit: string; hs_code: string }>;
  parties?: Array<{ role: string; country: string }>;
  terms?: { incoterm: string; payment_terms: string };
  reasons?: string[];
};

type ComplianceState = {
  status: 'idle' | 'running' | 'passed' | 'warnings' | 'failed' | 'error';
  trace_id?: string;
  checks?: Array<{ type: string; status: 'pass' | 'warn' | 'fail'; provider?: string }>;
  report_url?: string;
  reasons?: string[];
};

type Offer = {
  offer_id: string;
  financier: string;
  apr_bps: number;
  fees: number;
  tenor_days: number;
  sustainability_grade: 'aligned' | 'eligible' | 'not_sustainable' | 'insufficient_data';
  sustainability_tag: 'green_uop' | 'sustainability_linked' | 'none';
  explanations: string[];
};

type FinanceState = {
  status: 'idle' | 'requesting' | 'offers_ready' | 'accepted' | 'error';
  trace_id?: string;
  offers?: Offer[];
  recommended_offer_id?: string | null;
  reservation?: { offer_id: string; expires_at: string };
  reasons?: string[];
};

type PaymentsState = {
  bank_linked: boolean;
  status: 'idle' | 'routing' | 'routes_ready' | 'pending_sca' | 'executing' | 'executed' | 'failed' | 'error';
  trace_id?: string;
  routes?: Array<{ route_id: string; scheme: 'SEPA_INSTANT' | 'SEPA'; fee: number; eta_minutes: number; recommended?: boolean }>;
  selected_route_id?: string;
  payment?: { payment_id: string; status: string; redirect_url?: string; iso_status?: string };
};

type ProofsState = {
  status: 'idle' | 'building' | 'ready' | 'error';
  trace_id?: string;
  bundle_url?: string;
  root?: string;
  artifacts?: Array<{ type: string; hash: string }>;
  anchor?: { status: 'off' | 'pending' | 'anchored' | 'failed'; network?: string; tx_hash?: string; block_number?: number };
};

export default function DemoPage() {
  const timeouts = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      for (const t of timeouts.current) window.clearTimeout(t);
      timeouts.current = [];
    };
  }, []);

  const [intent, setIntent] = useState('Sell 100 cases of wine to Madrid; 50% advance; ship next week');
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([
    { role: 'assistant', text: 'Describe a trade and I’ll turn it into a plan.' }
  ]);
  const [events, setEvents] = useState<DemoEvent[]>([]);

  const [plan, setPlan] = useState<PlanState>({ status: 'idle' });
  const [compliance, setCompliance] = useState<ComplianceState>({ status: 'idle' });
  const [finance, setFinance] = useState<FinanceState>({ status: 'idle' });
  const [payments, setPayments] = useState<PaymentsState>({ bank_linked: false, status: 'idle' });
  const [proofs, setProofs] = useState<ProofsState>({ status: 'idle' });

  const nextCta = useMemo(() => {
    if (plan.status !== 'ready') return { label: 'Generate plan', action: 'plan' as const };
    if (compliance.status === 'idle') return { label: 'Run compliance', action: 'compliance' as const };
    if (compliance.status === 'running') return { label: 'Compliance running…', action: 'none' as const };
    if (finance.status === 'idle') return { label: 'Request offers', action: 'offers' as const };
    if (finance.status === 'requesting') return { label: 'Fetching offers…', action: 'none' as const };
    if (finance.status === 'offers_ready') return { label: 'Accept recommended', action: 'accept' as const };
    if (finance.status !== 'accepted') return { label: 'Continue', action: 'none' as const };
    if (!payments.bank_linked) return { label: 'Connect bank', action: 'bank' as const };
    if (payments.status === 'idle') return { label: 'Compute routes', action: 'routes' as const };
    if (payments.status === 'routes_ready') return { label: 'Execute payment', action: 'execute' as const };
    if (payments.status === 'pending_sca') return { label: 'Complete SCA', action: 'sca' as const };
    if (payments.status === 'executing') return { label: 'Executing…', action: 'none' as const };
    if (payments.status === 'executed') return { label: 'Build proof pack', action: 'proofs' as const };
    if (proofs.status !== 'ready') return { label: 'Build proof pack', action: 'proofs' as const };
    return { label: 'Reset demo', action: 'reset' as const };
  }, [plan.status, compliance.status, finance.status, payments, proofs.status]);

  const emit = (type: string, data: any, trace_id?: string) => {
    const ev: DemoEvent = {
      event_id: crypto.randomUUID(),
      type,
      ts: new Date().toISOString(),
      trace_id: trace_id ?? `trc_demo_${crypto.randomUUID().slice(0, 8)}`,
      data
    };
    setEvents((prev) => [ev, ...prev].slice(0, 200));
    return ev;
  };

  const schedule = (ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timeouts.current.push(id);
  };

  const reset = () => {
    setMessages([{ role: 'assistant', text: 'Describe a trade and I’ll turn it into a plan.' }]);
    setEvents([]);
    setPlan({ status: 'idle' });
    setCompliance({ status: 'idle' });
    setFinance({ status: 'idle' });
    setPayments({ bank_linked: false, status: 'idle' });
    setProofs({ status: 'idle' });
  };

  const generatePlan = () => {
    const trace = `trc_plan_${crypto.randomUUID().slice(0, 8)}`;
    setMessages((m) => [...m, { role: 'user', text: intent }, { role: 'assistant', text: 'Working on a Trade Plan…' }]);
    setPlan({ status: 'loading', trace_id: trace });
    schedule(650, () => {
      const p: PlanState = {
        status: 'ready',
        trace_id: trace,
        confidence: 0.86,
        items: [{ name: 'Wine (cases)', qty: 100, unit: 'case', hs_code: '2204.21' }],
        parties: [
          { role: 'seller', country: 'PT' },
          { role: 'buyer', country: 'ES' }
        ],
        terms: { incoterm: 'DAP', payment_terms: '50% advance' },
        reasons: ['HS 2204.21 detected', 'Corridor PT→ES', 'Payment term recognized']
      };
      setPlan(p);
      emit('plan.generated', { confidence: p.confidence }, trace);
      setMessages((m) => [...m, { role: 'assistant', text: 'Plan ready. Next: run compliance.' }]);
    });
  };

  const runCompliance = () => {
    if (plan.status !== 'ready') return;
    const trace = `trc_cmp_${crypto.randomUUID().slice(0, 8)}`;
    setCompliance({ status: 'running', trace_id: trace });
    emit('compliance.running', { started_at: new Date().toISOString() }, trace);
    schedule(900, () => {
      const checks: ComplianceState['checks'] = [
        { type: 'KYB', status: 'pass', provider: 'sumsub' },
        { type: 'SANCTIONS', status: 'pass', provider: 'complyadvantage' },
        { type: 'EXPORT', status: 'warn', provider: 'rules' }
      ];
      const report = '/reports/compliance/demo.pdf';
      setCompliance({
        status: 'warnings',
        trace_id: trace,
        checks,
        report_url: report,
        reasons: ['Export classification ambiguous']
      });
      emit('compliance.warnings', { report_url: report, highlights: ['EXPORT: warn'] }, trace);
    });
  };

  const requestOffers = () => {
    if (compliance.status !== 'passed' && compliance.status !== 'warnings') return;
    const trace = `trc_off_${crypto.randomUUID().slice(0, 8)}`;
    setFinance({ status: 'requesting', trace_id: trace });
    emit('offers.requested', {}, trace);
    schedule(900, () => {
      const offers: Offer[] = [
        {
          offer_id: crypto.randomUUID(),
          financier: 'Bank Alpha',
          apr_bps: 450,
          fees: 25,
          tenor_days: 30,
          sustainability_tag: 'green_uop',
          sustainability_grade: 'eligible',
          explanations: ['Eligible activity match', 'Evidence valid', 'Recommended by policy']
        },
        {
          offer_id: crypto.randomUUID(),
          financier: 'Bank Beta',
          apr_bps: 480,
          fees: 0,
          tenor_days: 30,
          sustainability_tag: 'none',
          sustainability_grade: 'not_sustainable',
          explanations: ['No UoP evidence']
        }
      ];
      setFinance({
        status: 'offers_ready',
        trace_id: trace,
        offers,
        recommended_offer_id: offers[0]!.offer_id,
        reasons: ['Lower APR', 'STF eligible']
      });
      emit('offers.ready', { count: offers.length, recommended_offer_id: offers[0]!.offer_id }, trace);
    });
  };

  const acceptRecommended = () => {
    if (finance.status !== 'offers_ready' || !finance.recommended_offer_id) return;
    const trace = `trc_acc_${crypto.randomUUID().slice(0, 8)}`;
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    setFinance((f) => ({
      ...f,
      status: 'accepted',
      trace_id: trace,
      reservation: { offer_id: finance.recommended_offer_id!, expires_at: expires }
    }));
    emit('offer.accepted', { offer_id: finance.recommended_offer_id, expires_at: expires }, trace);
  };

  const connectBank = () => {
    const trace = `trc_bank_${crypto.randomUUID().slice(0, 8)}`;
    setPayments((p) => ({ ...p, bank_linked: true, trace_id: trace }));
    emit('banks.consent.updated', { status: 'granted' }, trace);
  };

  const computeRoutes = () => {
    if (!payments.bank_linked) return;
    const trace = `trc_routes_${crypto.randomUUID().slice(0, 8)}`;
    setPayments((p) => ({ ...p, status: 'routing', trace_id: trace }));
    schedule(450, () => {
      const routes = [
        { route_id: 'r1', scheme: 'SEPA_INSTANT' as const, fee: 1.2, eta_minutes: 2, recommended: true },
        { route_id: 'r2', scheme: 'SEPA' as const, fee: 0.2, eta_minutes: 1440 }
      ];
      setPayments((p) => ({ ...p, status: 'routes_ready', trace_id: trace, routes, selected_route_id: 'r1' }));
      emit('payments.routes_ready', { count: routes.length }, trace);
    });
  };

  const executePayment = () => {
    if (payments.status !== 'routes_ready') return;
    const trace = `trc_pis_${crypto.randomUUID().slice(0, 8)}`;
    setPayments((p) => ({ ...p, status: 'executing', trace_id: trace }));
    emit('payment.executing', {}, trace);
    schedule(650, () => {
      setPayments((p) => ({
        ...p,
        status: 'pending_sca',
        trace_id: trace,
        payment: { payment_id: crypto.randomUUID(), status: 'pending_sca', redirect_url: 'https://bank.example/sca' }
      }));
    });
  };

  const completeSca = () => {
    if (payments.status !== 'pending_sca' || !payments.payment) return;
    const trace = payments.trace_id ?? `trc_pis_${crypto.randomUUID().slice(0, 8)}`;
    setPayments((p) => ({ ...p, status: 'executed', trace_id: trace, payment: { ...p.payment!, status: 'executed', iso_status: 'ACSC' } }));
    emit('payment.completed', { iso_status: 'ACSC' }, trace);
  };

  const buildProofPack = () => {
    if (payments.status !== 'executed') return;
    const trace = `trc_pf_${crypto.randomUUID().slice(0, 8)}`;
    setProofs({ status: 'building', trace_id: trace });
    schedule(700, () => {
      const root = pseudoHash(`root:${Date.now()}`);
      setProofs({
        status: 'ready',
        trace_id: trace,
        bundle_url: '/bundles/demo.zip',
        root,
        artifacts: [
          { type: 'compliance_report', hash: pseudoHash('cmp') },
          { type: 'finance_offers', hash: pseudoHash('off') },
          { type: 'payment_receipt', hash: pseudoHash('pay') }
        ],
        anchor: { status: 'pending', network: 'xdc' }
      });
      emit('ledger.bundle.ready', { root }, trace);
      emit('ledger.anchor.started', { root, network: 'xdc' }, trace);
      schedule(1100, () => {
        setProofs((p) => ({ ...p, anchor: { status: 'anchored', network: 'xdc', tx_hash: `0x${pseudoHash('tx').slice(0, 64)}`, block_number: 123456 } }));
        emit('ledger.anchor.completed', { root, network: 'xdc' }, trace);
      });
    });
  };

  const runNextCta = () => {
    if (nextCta.action === 'plan') return generatePlan();
    if (nextCta.action === 'compliance') return runCompliance();
    if (nextCta.action === 'offers') return requestOffers();
    if (nextCta.action === 'accept') return acceptRecommended();
    if (nextCta.action === 'bank') return connectBank();
    if (nextCta.action === 'routes') return computeRoutes();
    if (nextCta.action === 'execute') return executePayment();
    if (nextCta.action === 'sca') return completeSca();
    if (nextCta.action === 'proofs') return buildProofPack();
    if (nextCta.action === 'reset') return reset();
  };

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <div className="min-h-dvh grid grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_380px]">
        <aside className="border-r border-black/10 bg-paper/50 p-4">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-ink text-paper grid place-items-center">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold leading-tight">TRAIBOX</div>
              <div className="text-xs text-muted leading-tight">UI Demo Mode</div>
            </div>
          </div>

          <button
            className="mt-4 w-full rounded-xl bg-accent text-white px-3 py-2 text-sm font-medium flex items-center justify-center gap-2"
            onClick={runNextCta}
          >
            {nextCta.label} <ArrowRight className="h-4 w-4" />
          </button>

          <div className="mt-6 space-y-1 text-sm">
            <NavItem icon={<MessagesSquare className="h-4 w-4" />} label="Home / My Space" active />
            <NavItem icon={<Sparkles className="h-4 w-4" />} label="Trade Assistant" />
            <NavItem icon={<ShieldCheck className="h-4 w-4" />} label="Compliance" />
            <NavItem icon={<HandCoins className="h-4 w-4" />} label="Finance" />
            <NavItem icon={<WalletCards className="h-4 w-4" />} label="Payments" />
            <NavItem icon={<Receipt className="h-4 w-4" />} label="Proofs" />
            <NavItem icon={<Landmark className="h-4 w-4" />} label="Network" />
            <NavItem icon={<CircleDot className="h-4 w-4" />} label="Settings" />
          </div>

          <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
            <div className="text-xs text-muted">Deployment profile</div>
            <div className="mt-1 font-medium text-sm">iberia-pilot (demo)</div>
            <div className="mt-2 text-xs text-muted">
              Anchoring: <span className="text-ink font-medium">ON</span> • STF: <span className="text-ink font-medium">ON</span>
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex flex-col">
          <header className="h-14 border-b border-black/10 bg-paper/70 backdrop-blur flex items-center justify-between px-5">
            <div className="text-sm text-muted">Chat + Cards</div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="px-2 py-1 rounded-lg border border-black/10 bg-white">Org: Demo Exporters</span>
              <span className="px-2 py-1 rounded-lg border border-black/10 bg-white">Trade: PT→ES</span>
            </div>
          </header>

          <div className="min-w-0 flex-1 grid grid-rows-[1fr_auto]">
            <div className="min-w-0 overflow-y-auto p-5 space-y-4">
              {messages.map((m, idx) => (
                <Message key={idx} role={m.role} text={m.text} />
              ))}

              <DemoCard
                icon={<FileText className="h-4 w-4" />}
                title="Trade Plan"
                status={plan.status === 'ready' ? { label: 'Ready', tone: 'success' } : plan.status === 'loading' ? { label: 'Loading', tone: 'loading' } : { label: 'Idle', tone: 'neutral' }}
                traceId={plan.trace_id}
                primary={{
                  label: plan.status === 'ready' ? 'Regenerate plan' : 'Generate plan',
                  onClick: generatePlan
                }}
                glassBox={plan.reasons}
              >
                {plan.status === 'ready' ? (
                  <div className="text-sm space-y-2">
                    <Field label="Items" value={`${plan.items?.[0]?.qty} ${plan.items?.[0]?.unit} — ${plan.items?.[0]?.name} (HS ${plan.items?.[0]?.hs_code})`} />
                    <Field label="Parties" value={`Seller ${plan.parties?.[0]?.country} • Buyer ${plan.parties?.[1]?.country}`} />
                    <Field label="Terms" value={`${plan.terms?.incoterm} • ${plan.terms?.payment_terms}`} />
                    <Field label="Confidence" value={`${Math.round((plan.confidence ?? 0) * 100)}%`} />
                  </div>
                ) : (
                  <p className="text-sm text-muted">Describe a trade in chat to generate a plan.</p>
                )}
              </DemoCard>

              <DemoCard
                icon={<ShieldCheck className="h-4 w-4" />}
                title="Compliance"
                status={complianceStatusChip(compliance.status)}
                traceId={compliance.trace_id}
                primary={{
                  label: compliance.status === 'running' ? 'Running…' : 'Run compliance',
                  onClick: runCompliance,
                  disabled: plan.status !== 'ready' || compliance.status === 'running'
                }}
                secondary={
                  compliance.report_url
                    ? {
                        label: 'Download report',
                        icon: <FileDown className="h-4 w-4" />,
                        onClick: () => window.alert('Demo mode: report download is a placeholder.')
                      }
                    : undefined
                }
                glassBox={compliance.reasons}
              >
                {compliance.checks ? (
                  <div className="text-sm space-y-2">
                    <div className="grid grid-cols-3 gap-2 text-xs text-muted">
                      <div>Check</div>
                      <div>Status</div>
                      <div>Provider</div>
                    </div>
                    {compliance.checks.map((c) => (
                      <div key={c.type} className="grid grid-cols-3 gap-2 text-sm">
                        <div>{c.type}</div>
                        <div className="flex items-center gap-2">
                          <StatusDot tone={c.status === 'pass' ? 'success' : c.status === 'warn' ? 'warn' : 'error'} />
                          <span className="text-xs">{c.status}</span>
                        </div>
                        <div className="text-xs text-muted">{c.provider ?? '—'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Run checks to get a clear answer with evidence.</p>
                )}
              </DemoCard>

              <DemoCard
                icon={<HandCoins className="h-4 w-4" />}
                title="Finance (STF)"
                status={
                  finance.status === 'offers_ready'
                    ? { label: 'Offers ready', tone: 'success' }
                    : finance.status === 'requesting'
                      ? { label: 'Requesting', tone: 'loading' }
                      : finance.status === 'accepted'
                        ? { label: 'Accepted', tone: 'success' }
                        : { label: 'Idle', tone: 'neutral' }
                }
                traceId={finance.trace_id}
                primary={{
                  label: finance.status === 'idle' ? 'Request offers' : finance.status === 'offers_ready' ? 'Accept recommended' : finance.status === 'accepted' ? 'Accepted' : 'Request offers',
                  onClick: finance.status === 'offers_ready' ? acceptRecommended : requestOffers,
                  disabled: !(compliance.status === 'passed' || compliance.status === 'warnings') || finance.status === 'requesting' || finance.status === 'accepted'
                }}
                glassBox={finance.reasons}
              >
                {finance.offers ? (
                  <div className="space-y-2">
                    {finance.offers.map((o) => (
                      <div key={o.offer_id} className="rounded-xl border border-black/10 p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-sm">{o.financier}</div>
                          <span className="text-xs text-muted">{o.sustainability_grade}</span>
                        </div>
                        <div className="text-xs text-muted mt-1">
                          APR {o.apr_bps} bps • Fees {o.fees} • Tenor {o.tenor_days}d
                        </div>
                        <ul className="mt-2 text-xs text-muted list-disc pl-4">
                          {o.explanations.slice(0, 3).map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                        {finance.recommended_offer_id === o.offer_id ? (
                          <div className="mt-2 inline-flex items-center gap-1 text-xs text-accent font-medium">
                            <BadgeCheck className="h-4 w-4" /> Recommended
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {finance.reservation ? (
                      <div className="text-xs text-muted">
                        Reservation: {finance.reservation.offer_id} • expires {new Date(finance.reservation.expires_at).toLocaleTimeString()}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Request offers and compare terms with “why recommended”.</p>
                )}
              </DemoCard>

              <DemoCard
                icon={<Banknote className="h-4 w-4" />}
                title="Payments"
                status={paymentsStatusChip(payments.status)}
                traceId={payments.trace_id}
                primary={{
                  label: !payments.bank_linked ? 'Connect bank' : payments.status === 'idle' ? 'Compute routes' : payments.status === 'routes_ready' ? 'Execute payment' : payments.status === 'pending_sca' ? 'Complete SCA' : payments.status === 'executed' ? 'Executed' : 'Continue',
                  onClick: !payments.bank_linked ? connectBank : payments.status === 'idle' ? computeRoutes : payments.status === 'routes_ready' ? executePayment : payments.status === 'pending_sca' ? completeSca : () => {},
                  disabled: finance.status !== 'accepted' || payments.status === 'routing' || payments.status === 'executing' || payments.status === 'executed'
                }}
                secondary={
                  payments.payment?.redirect_url
                    ? {
                        label: 'Continue SCA',
                        icon: <ArrowRight className="h-4 w-4" />,
                        onClick: () => window.open(payments.payment?.redirect_url, '_blank', 'noreferrer')
                      }
                    : undefined
                }
                glassBox={
                  payments.status === 'executed'
                    ? ['Webhook updated status', 'Idempotency enforced', 'Reconciliation available via AIS']
                    : payments.status === 'pending_sca'
                      ? ['SCA required by bank', 'Redirect link returned', 'Webhook will finalize status']
                      : undefined
                }
              >
                {!payments.bank_linked ? (
                  <p className="text-sm text-muted">Connect a bank account (AIS/PIS) to compute routes and execute payments.</p>
                ) : payments.routes ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted">Routes</div>
                    {payments.routes.map((r) => (
                      <div key={r.route_id} className="flex items-center justify-between rounded-xl border border-black/10 p-3 text-sm">
                        <div>
                          <div className="font-medium">{r.scheme}</div>
                          <div className="text-xs text-muted">
                            Fee {r.fee} • ETA {r.eta_minutes} min
                          </div>
                        </div>
                        {r.recommended ? <span className="text-xs text-accent font-medium">Recommended</span> : null}
                      </div>
                    ))}
                    {payments.payment ? (
                      <div className="text-xs text-muted break-all">
                        Payment: {payments.payment.payment_id} • {payments.payment.status} {payments.payment.iso_status ? `(${payments.payment.iso_status})` : ''}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Compute routes (SEPA / SEPA Instant) and execute with SCA tracking.</p>
                )}
              </DemoCard>

              <DemoCard
                icon={<Receipt className="h-4 w-4" />}
                title="Proofs (Bundle + Anchoring)"
                status={
                  proofs.status === 'ready'
                    ? { label: proofs.anchor?.status === 'anchored' ? 'Anchored' : 'Ready', tone: proofs.anchor?.status === 'anchored' ? 'success' : 'neutral' }
                    : proofs.status === 'building'
                      ? { label: 'Building', tone: 'loading' }
                      : { label: 'Idle', tone: 'neutral' }
                }
                traceId={proofs.trace_id}
                primary={{
                  label: proofs.status === 'ready' ? 'Rebuild bundle' : 'Build proof pack',
                  onClick: buildProofPack,
                  disabled: payments.status !== 'executed' || proofs.status === 'building'
                }}
                secondary={
                  proofs.bundle_url
                    ? {
                        label: 'Download ZIP',
                        icon: <FileDown className="h-4 w-4" />,
                        onClick: () => window.alert('Demo mode: bundle download is a placeholder.')
                      }
                    : undefined
                }
                glassBox={['Deterministic hashing (JSON JCS)', 'Merkle root anchored (hashes only)', 'No PII on-chain']}
              >
                {proofs.status === 'ready' ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted break-all">Root: {proofs.root}</div>
                    {proofs.anchor ? (
                      <div className="text-xs text-muted break-all">
                        Anchor: {proofs.anchor.status} {proofs.anchor.tx_hash ? `• ${proofs.anchor.tx_hash}` : ''}{' '}
                        {proofs.anchor.block_number ? `• block ${proofs.anchor.block_number}` : ''}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted">Artifacts</div>
                    <ul className="space-y-1">
                      {(proofs.artifacts ?? []).map((a) => (
                        <li key={a.type} className="text-xs text-muted break-all">
                          {a.type}: {a.hash}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-sm text-muted">Generate an exportable, verifiable proof bundle and optional chain receipt.</p>
                )}
              </DemoCard>
            </div>

            <div className="border-t border-black/10 bg-paper/70 backdrop-blur p-4">
              <div className="max-w-4xl mx-auto flex gap-2">
                <input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  className="flex-1 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
                  placeholder="Describe your trade…"
                />
                <button className="rounded-xl bg-ink text-paper px-4 py-2 text-sm font-medium" onClick={generatePlan}>
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>

        <aside className="hidden xl:block border-l border-black/10 bg-paper/50 p-4 overflow-y-auto">
          <div className="font-semibold">Action Drawer</div>
          <div className="mt-3 space-y-3">
            <DrawerItem label="Plan" tone={plan.status === 'ready' ? 'success' : plan.status === 'loading' ? 'loading' : 'neutral'} />
            <DrawerItem label="Compliance" tone={compliance.status === 'warnings' ? 'warn' : compliance.status === 'passed' ? 'success' : compliance.status === 'running' ? 'loading' : 'neutral'} />
            <DrawerItem label="Finance" tone={finance.status === 'offers_ready' || finance.status === 'accepted' ? 'success' : finance.status === 'requesting' ? 'loading' : 'neutral'} />
            <DrawerItem label="Payments" tone={payments.status === 'executed' ? 'success' : payments.status === 'pending_sca' ? 'warn' : payments.status === 'routing' || payments.status === 'executing' ? 'loading' : 'neutral'} />
            <DrawerItem label="Proofs" tone={proofs.anchor?.status === 'anchored' ? 'success' : proofs.status === 'building' ? 'loading' : proofs.status === 'ready' ? 'neutral' : 'neutral'} />
          </div>

          <div className="mt-6 rounded-2xl border border-black/10 bg-white p-4">
            <div className="text-xs text-muted">Recent events</div>
            <ul className="mt-2 space-y-2">
              {events.slice(0, 12).map((e) => (
                <li key={e.event_id} className="rounded-xl border border-black/10 p-3 text-xs">
                  <div className="font-medium">{e.type}</div>
                  <div className="text-muted mt-1 break-all">trace: {e.trace_id}</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Message({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm border ${isUser ? 'bg-ink text-paper border-black/10' : 'bg-white border-black/10'}`}>
        {text}
      </div>
    </div>
  );
}

function NavItem({ icon, label, active }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${active ? 'bg-black/5 font-medium' : 'text-ink/90 hover:bg-black/5'} cursor-default`}>
      <div className="text-muted">{icon}</div>
      <div>{label}</div>
    </div>
  );
}

function DemoCard({
  icon,
  title,
  status,
  traceId,
  primary,
  secondary,
  glassBox,
  children
}: {
  icon: React.ReactNode;
  title: string;
  status: { label: string; tone: StatusTone };
  traceId?: string;
  primary: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; icon?: React.ReactNode };
  glassBox?: string[];
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white shadow-sm border border-black/5">
      <div className="px-5 py-4 border-b border-black/5 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-muted">{icon}</div>
          <div>
            <div className="font-semibold leading-tight">{title}</div>
            <div className="mt-1 flex items-center gap-2">
              <StatusChip tone={status.tone} label={status.label} />
              {traceId ? <span className="text-xs text-muted">#{traceId}</span> : null}
            </div>
          </div>
        </div>
        <div className="text-xs text-muted">{new Date().toLocaleTimeString()}</div>
      </div>

      <div className="px-5 py-4">{children}</div>

      {glassBox && glassBox.length > 0 ? (
        <details className="px-5 pb-4">
          <summary className="text-xs text-muted cursor-pointer select-none">Why</summary>
          <ul className="mt-2 text-xs text-muted list-disc pl-4">
            {glassBox.slice(0, 6).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="px-5 py-4 border-t border-black/5 flex items-center gap-2">
        <button
          onClick={primary.onClick}
          disabled={primary.disabled}
          className="rounded-xl bg-ink text-paper px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          {primary.label}
        </button>
        {secondary ? (
          <button onClick={secondary.onClick} className="rounded-xl border border-black/10 px-3 py-2 text-sm inline-flex items-center gap-2">
            {secondary.icon}
            {secondary.label}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-sm font-medium text-right">{value}</div>
    </div>
  );
}

function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  const cls =
    tone === 'success'
      ? 'bg-success/10 text-success border-success/20'
      : tone === 'warn'
        ? 'bg-warn/10 text-warn border-warn/20'
        : tone === 'error'
          ? 'bg-error/10 text-error border-error/20'
          : tone === 'loading'
            ? 'bg-accent/10 text-accent border-accent/20'
            : 'bg-black/5 text-ink/70 border-black/10';
  return <span className={`inline-flex items-center gap-2 text-xs px-2 py-1 rounded-lg border ${cls}`}>{tone === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{label}</span>;
}

function StatusDot({ tone }: { tone: StatusTone }) {
  const cls =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'error'
          ? 'bg-error'
          : tone === 'loading'
            ? 'bg-accent'
            : 'bg-black/20';
  return <span className={`inline-block h-2 w-2 rounded-full ${cls}`} />;
}

function DrawerItem({ label, tone }: { label: string; tone: StatusTone }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4 flex items-center justify-between">
      <div className="font-medium text-sm">{label}</div>
      <div className="flex items-center gap-2">
        <StatusDot tone={tone} />
        <span className="text-xs text-muted">{tone}</span>
      </div>
    </div>
  );
}

function complianceStatusChip(status: ComplianceState['status']): { label: string; tone: StatusTone } {
  if (status === 'running') return { label: 'Running', tone: 'loading' };
  if (status === 'passed') return { label: 'Passed', tone: 'success' };
  if (status === 'warnings') return { label: 'Warnings', tone: 'warn' };
  if (status === 'failed') return { label: 'Failed', tone: 'error' };
  if (status === 'error') return { label: 'Error', tone: 'error' };
  return { label: 'Idle', tone: 'neutral' };
}

function paymentsStatusChip(status: PaymentsState['status']): { label: string; tone: StatusTone } {
  if (status === 'routing') return { label: 'Routing', tone: 'loading' };
  if (status === 'routes_ready') return { label: 'Routes ready', tone: 'success' };
  if (status === 'executing') return { label: 'Executing', tone: 'loading' };
  if (status === 'pending_sca') return { label: 'SCA required', tone: 'warn' };
  if (status === 'executed') return { label: 'Executed', tone: 'success' };
  if (status === 'failed') return { label: 'Failed', tone: 'error' };
  if (status === 'error') return { label: 'Error', tone: 'error' };
  return { label: 'Idle', tone: 'neutral' };
}

function pseudoHash(seed: string): string {
  // Fast + deterministic-ish for demo UI (NOT cryptographic).
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h.toString(16).padStart(8, '0').repeat(8);
}
