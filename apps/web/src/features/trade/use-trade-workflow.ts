'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BankAccount,
  LedgerProofsResponse,
  Payment,
  PaymentRoute,
  SSEEvent,
  TradeMessage,
  TradeWorkspaceResponse
} from '@traibox/contracts';

import { api } from '../../lib/api';
import { paymentExecutionFromIntent } from '../../lib/protected-payment';
import type { StatusTone } from '../../components/ui/status';

export type TradeWorkflowMode = 'live' | 'demo';

type NextCtaAction =
  | 'plan'
  | 'compliance'
  | 'offers'
  | 'accept'
  | 'bank'
  | 'routes'
  | 'execute'
  | 'sca'
  | 'proofs'
  | 'reset'
  | 'none';

export type TradeWorkflowCardStatus = { label: string; tone: StatusTone };

export type TradeWorkflowVM = {
  mode: TradeWorkflowMode;
  tradeId: string;
  title: string;
  subtitle: string;
  snapshot: TradeWorkspaceResponse | null;
  messages: TradeMessage[];
  events: SSEEvent[];

  accounts: BankAccount[];
  selectedAccountId: string;
  setSelectedAccountId: (id: string) => void;

  routes: PaymentRoute[];
  selectedRouteId: string;
  setSelectedRouteId: (id: string) => void;

  lastPayment: Payment | null;
  lastProofs: LedgerProofsResponse | null;

  cards: {
    plan: { status: TradeWorkflowCardStatus; reasons: string[] };
    compliance: { status: TradeWorkflowCardStatus };
    finance: { status: TradeWorkflowCardStatus; recommendedOfferId: string | null; recommendedReasons: string[] };
    payments: { status: TradeWorkflowCardStatus; latestStatusRaw: string; latestPaymentId: string | null };
    proofs: { status: TradeWorkflowCardStatus };
  };

  demo?: {
    intentText: string;
    setIntentText: (v: string) => void;
    nextCta: { label: string; action: NextCtaAction; disabled?: boolean };
  };

  actions: {
    refresh: () => Promise<void>;
    sendChat: (text: string) => Promise<void>;
    runCompliance: () => Promise<void>;
    requestOffers: () => Promise<void>;
    acceptRecommended: () => Promise<void>;
    connectBank: () => Promise<void>;
    computeRoutes: () => Promise<void>;
    executePayment: () => Promise<void>;
    completeSca: () => Promise<void>;
    buildProofPack: () => Promise<void>;
    resetDemo: () => void;
    runNextCta: () => void;
  };
};

export function useTradeWorkflow(input: {
  mode: TradeWorkflowMode;
  enabled?: boolean;
  orgId?: string | null;
  tradeId?: string | null;
}): TradeWorkflowVM {
  if (input.mode === 'demo') return useTradeWorkflowDemo();
  return useTradeWorkflowLive({ enabled: input.enabled, orgId: input.orgId ?? null, tradeId: input.tradeId ?? null });
}

function useTradeWorkflowLive(input: { enabled?: boolean; orgId: string | null; tradeId: string | null }): TradeWorkflowVM {
  const enabled = Boolean(input.enabled ?? true);
  const orgId = input.orgId;
  const tradeId = input.tradeId;

  const [snapshot, setSnapshot] = useState<TradeWorkspaceResponse | null>(null);
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [messages, setMessages] = useState<TradeMessage[]>([]);

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [routes, setRoutes] = useState<PaymentRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [lastPayment, setLastPayment] = useState<Payment | null>(null);
  const [lastProofs, setLastProofs] = useState<LedgerProofsResponse | null>(null);

  const refreshTrade = useCallback(async () => {
    if (!enabled || !orgId || !tradeId) return;
    const r = await api.getTrade(orgId, tradeId);
    setSnapshot(r);
  }, [enabled, orgId, tradeId]);

  const refreshMessages = useCallback(async () => {
    if (!enabled || !orgId || !tradeId) return;
    const r = await api.listTradeMessages(orgId, tradeId, 200);
    setMessages(r.messages ?? []);
  }, [enabled, orgId, tradeId]);

  const refreshAccounts = useCallback(async () => {
    if (!enabled || !orgId) return;
    try {
      const r = await api.listAccounts(orgId);
      setAccounts(r.accounts ?? []);
    } catch {
      // Bank/account access is optional in alpha; the Trade Room should still render if finance scopes are unavailable.
      setAccounts([]);
      setSelectedAccountId('');
    }
  }, [enabled, orgId]);

  const refresh = useCallback(async () => {
    await Promise.all([refreshTrade(), refreshMessages(), refreshAccounts()]);
  }, [refreshTrade, refreshMessages, refreshAccounts]);

  useEffect(() => {
    if (!enabled) return;
    if (!orgId || !tradeId) return;
    void refresh();
  }, [enabled, orgId, tradeId, refresh]);

  useEffect(() => {
    if (!enabled) return;
    if (!orgId || !tradeId) return;
    const url = api.eventsUrl({ orgId, tradeId });
    const es = new EventSource(url);
    es.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as SSEEvent;
        setEvents((prev) => [ev, ...prev].slice(0, 200));
        const type = String(ev?.type ?? '');
        if (
          type === 'plan.generated' ||
          type.startsWith('compliance.') ||
          type === 'offers.ready' ||
          type.startsWith('payment.') ||
          type.startsWith('ledger.') ||
          type.startsWith('banks.consent.')
        ) {
          void refreshTrade();
          void refreshAccounts();
        }
        if (type === 'trade.message.created') {
          void refreshMessages();
        }
      } catch {
        // ignore
      }
    };
    return () => es.close();
  }, [enabled, orgId, tradeId, refreshTrade, refreshAccounts, refreshMessages]);

  const planReasons = (snapshot?.plan?.glass_box?.reasons as string[] | undefined) ?? [];

  const complianceOverall = String(snapshot?.compliance?.overall ?? '');
  const complianceStatus =
    complianceOverall === 'passed'
      ? { label: 'Passed', tone: 'success' as const }
      : complianceOverall === 'warnings'
        ? { label: 'Warnings', tone: 'warn' as const }
        : complianceOverall === 'failed'
          ? { label: 'Failed', tone: 'error' as const }
          : { label: snapshot?.compliance ? 'Unknown' : 'Idle', tone: 'neutral' as const };

  const offerRequestStatus = String(snapshot?.offer_request?.status ?? '');
  const offersCount = Array.isArray(snapshot?.offers) ? snapshot.offers.length : 0;
  const allocationRanking = Array.isArray(snapshot?.allocation?.ranking_json) ? snapshot?.allocation?.ranking_json ?? [] : [];
  const recommendedOfferId = allocationRanking?.[0]?.offer_id ?? null;
  const recommendedReasons = Array.isArray(allocationRanking?.[0]?.reasons) ? allocationRanking[0].reasons : [];

  const financeStatus =
    snapshot?.reservation
      ? { label: 'Accepted', tone: 'success' as const }
      : offersCount > 0
        ? { label: 'Offers ready', tone: 'success' as const }
        : offerRequestStatus === 'pending'
          ? { label: 'Requesting', tone: 'loading' as const }
          : { label: 'Idle', tone: 'neutral' as const };

  const latestPayment = Array.isArray(snapshot?.payments) && snapshot.payments.length > 0 ? snapshot.payments[0] : null;
  const latestPaymentId = latestPayment?.payment_id ?? null;
  const paymentStatusRaw = String(latestPayment?.status ?? '');
  const paymentsStatus =
    paymentStatusRaw === 'executed'
      ? { label: 'Executed', tone: 'success' as const }
      : paymentStatusRaw === 'pending_sca' || paymentStatusRaw === 'executing' || paymentStatusRaw === 'authorized'
        ? { label: paymentStatusRaw.replaceAll('_', ' '), tone: 'loading' as const }
        : paymentStatusRaw === 'failed' || paymentStatusRaw === 'returned'
          ? { label: paymentStatusRaw, tone: 'error' as const }
          : { label: latestPayment ? paymentStatusRaw : 'Idle', tone: 'neutral' as const };

  const proofsStatus = snapshot?.proofs?.bundle_url ? { label: 'Ready', tone: 'success' as const } : { label: 'Idle', tone: 'neutral' as const };

  const title = snapshot?.trade?.title ?? 'Trade workspace';
  const subtitle = snapshot?.trade?.corridor ? `Corridor ${snapshot.trade.corridor}` : 'Chat-first workspace';

  const actions = useMemo<TradeWorkflowVM['actions']>(() => {
    return {
      refresh,
      sendChat: async (text) => {
        if (!orgId || !tradeId) return;
        await api.postTradeMessage(orgId, tradeId, text);
        await refreshMessages();
      },
      runCompliance: async () => {
        if (!orgId || !tradeId) return;
        await api.runCompliance(orgId, { trade_id: tradeId });
        await refreshTrade();
      },
      requestOffers: async () => {
        if (!orgId || !tradeId) return;
        await api.requestOffers(orgId, {
          trade_id: tradeId,
          amount: 12000,
          tenor_days: 30,
          sustainable: { enabled: true, path: 'uop', minimum_grade: 'eligible' }
        });
        await refreshTrade();
      },
      acceptRecommended: async () => {
        if (!orgId || !tradeId) return;
        if (!recommendedOfferId) return;
        await api.acceptOffer(orgId, recommendedOfferId);
        await refreshTrade();
      },
      connectBank: async () => {
        if (!orgId || !tradeId) return;
        const r = await api.linkBank(orgId, { type: 'PIS', trade_id: tradeId });
        const authUrl = typeof (r as any)?.auth_url === 'string' ? String((r as any).auth_url) : '';
        if (authUrl) {
          try {
            const u = new URL(authUrl, window.location.origin);
            const sameOrigin = u.origin === window.location.origin;
            const looksLikeOAuth = u.searchParams.has('client_id') || u.searchParams.has('scope') || u.pathname.includes('oauth') || u.href.includes('truelayer');
            if (!sameOrigin || looksLikeOAuth) {
              window.location.href = u.href;
              return;
            }
          } catch {
            // ignore parse errors and just refresh accounts
          }
        }
        await refreshAccounts();
      },
      computeRoutes: async () => {
        if (!orgId || !tradeId) return;
        if (!selectedAccountId) return;
        const execution = await loadSoleCompletePaymentIntent(orgId, tradeId);
        if (execution.from_account_id !== selectedAccountId) {
          throw new Error('The selected debtor account differs from the payment intent. Update and re-confirm the intent before computing routes.');
        }
        const r = await api.routes(orgId, {
          trade_id: tradeId,
          from_account_id: selectedAccountId,
          to_iban: execution.creditor_iban,
          amount: execution.amount,
          currency: execution.currency,
          urgency: 'instant'
        });
        setRoutes(r.routes ?? []);
        const exactApprovedRoute = (r.routes ?? []).filter((route) => route.route_id === execution.route_id);
        if (exactApprovedRoute.length !== 1) {
          throw new Error('The payment intent route is not uniquely executable under the current provider policy. Obtain a new policy and approval.');
        }
        setSelectedRouteId(exactApprovedRoute[0]!.route_id);
      },
      executePayment: async () => {
        if (!orgId || !tradeId) return;
        if (!selectedAccountId || !selectedRouteId) return;
        const execution = await loadSoleCompletePaymentIntent(orgId, tradeId);
        if (execution.from_account_id !== selectedAccountId || execution.route_id !== selectedRouteId) {
          throw new Error('The selected account or route differs from the approved payment intent. Update the intent and obtain a new approval.');
        }
        const p = await api.executePayment(orgId, execution);
        setLastPayment(p);
        await refreshTrade();
      },
      completeSca: async () => {
        // Live SCA is completed at the bank; status updates via webhooks.
      },
      buildProofPack: async () => {
        if (!orgId || !tradeId) return;
        const r = await api.getProofs(orgId, tradeId);
        setLastProofs(r);
        await refreshTrade();
      },
      resetDemo: () => {},
      runNextCta: () => {}
    };
  }, [
    orgId,
    tradeId,
    refresh,
    refreshMessages,
    refreshTrade,
    recommendedOfferId,
    selectedAccountId,
    selectedRouteId
  ]);

  return {
    mode: 'live',
    tradeId: tradeId ?? 'unknown',
    title,
    subtitle,
    snapshot,
    messages,
    events,
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    routes,
    selectedRouteId,
    setSelectedRouteId,
    lastPayment,
    lastProofs,
    cards: {
      plan: { status: snapshot?.plan ? { label: 'Ready', tone: 'success' } : { label: 'Idle', tone: 'neutral' }, reasons: planReasons },
      compliance: { status: complianceStatus },
      finance: { status: financeStatus, recommendedOfferId, recommendedReasons },
      payments: { status: paymentsStatus, latestStatusRaw: paymentStatusRaw, latestPaymentId },
      proofs: { status: proofsStatus }
    },
    actions
  };
}

async function loadSoleCompletePaymentIntent(orgId: string, tradeId: string) {
  const result = await api.queryAlphaObjects(orgId, { type: 'payment_intent', trade_id: tradeId, limit: 20 });
  const candidates = result.objects.filter((object) => !['rejected', 'cancelled', 'archived'].includes(object.status));
  if (candidates.length !== 1) {
    throw new Error('Select one complete payment intent in the governed payment-intent flow before computing or executing payment routes.');
  }
  return paymentExecutionFromIntent(candidates[0]!);
}

function useTradeWorkflowDemo(): TradeWorkflowVM {
  const timeouts = useRef<number[]>([]);
  useEffect(() => {
    return () => {
      for (const t of timeouts.current) window.clearTimeout(t);
      timeouts.current = [];
    };
  }, []);

  const demoOrgId = 'demo-org';
  const demoTradeId = '00000000-0000-0000-0000-00000000DEMO';

  const [intentText, setIntentText] = useState('Sell 100 cases of wine to Madrid; 50% advance; ship next week');
  const [snapshot, setSnapshot] = useState<TradeWorkspaceResponse>(() => createDemoSnapshot(demoTradeId));
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [messages, setMessages] = useState<TradeMessage[]>([
    {
      message_id: crypto.randomUUID(),
      role: 'assistant',
      text: 'Describe a trade and I’ll turn it into a plan.',
      created_at: new Date().toISOString()
    }
  ]);

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [routes, setRoutes] = useState<PaymentRoute[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string>('');
  const [lastPayment, setLastPayment] = useState<Payment | null>(null);
  const [lastProofs, setLastProofs] = useState<LedgerProofsResponse | null>(null);

  const schedule = (ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timeouts.current.push(id);
  };

  const emit = (type: string, data: any, trace_id?: string) => {
    const ev: SSEEvent = {
      event_id: crypto.randomUUID(),
      type,
      ts: new Date().toISOString(),
      org_id: demoOrgId,
      trade_id: demoTradeId,
      trace_id: trace_id ?? `trc_demo_${crypto.randomUUID().slice(0, 8)}`,
      actor: 'system:demo',
      data
    };
    setEvents((prev) => [ev, ...prev].slice(0, 200));
    return ev;
  };

  const resetDemo = () => {
    setSnapshot(createDemoSnapshot(demoTradeId));
    setEvents([]);
    setMessages([
      {
        message_id: crypto.randomUUID(),
        role: 'assistant',
        text: 'Describe a trade and I’ll turn it into a plan.',
        created_at: new Date().toISOString()
      }
    ]);
    setAccounts([]);
    setSelectedAccountId('');
    setRoutes([]);
    setSelectedRouteId('');
    setLastPayment(null);
    setLastProofs(null);
  };

  const generatePlan = (nextIntent?: string) => {
    const trace = `trc_plan_${crypto.randomUUID().slice(0, 8)}`;
    const text = (nextIntent ?? intentText).trim();
    setMessages((m) => [
      ...m,
      { message_id: crypto.randomUUID(), role: 'user', text, created_at: new Date().toISOString() },
      { message_id: crypto.randomUUID(), role: 'assistant', text: 'Working on a Trade Plan…', created_at: new Date().toISOString() }
    ]);
    schedule(650, () => {
      setSnapshot((prev) => ({
        ...prev,
        trade: {
          ...(prev.trade ?? {
            trade_id: demoTradeId,
            title: 'Wine to Madrid',
            corridor: 'PT-ES',
            amount: 12000,
            currency: 'EUR',
            status: 'active',
            created_at: new Date().toISOString()
          }),
          title: 'Wine to Madrid',
          corridor: 'PT-ES'
        },
        plan: {
          items: [{ name: 'Wine (cases)', qty: 100, unit: 'case', hs_code: '2204.21' }],
          parties: [
            { role: 'seller', country: 'PT' },
            { role: 'buyer', country: 'ES' }
          ],
          terms: { incoterm: 'DAP', payment_terms: '50% advance' },
          checklist: ['Run compliance', 'Request financing', 'Get payment routes'],
          confidence: 0.86,
          glass_box: { reasons: ['HS 2204.21 detected', 'Corridor PT→ES', 'Payment term recognized'] },
          created_at: new Date().toISOString()
        }
      }));
      emit('plan.generated', { confidence: 0.86 }, trace);
      setMessages((m) => [...m, { message_id: crypto.randomUUID(), role: 'assistant', text: 'Plan ready. Next: run compliance.', created_at: new Date().toISOString() }]);
    });
  };

  const runCompliance = () => {
    if (!snapshot.plan) return;
    const trace = `trc_cmp_${crypto.randomUUID().slice(0, 8)}`;
    emit('compliance.running', { started_at: new Date().toISOString() }, trace);
    schedule(900, () => {
      setSnapshot((prev) => ({
        ...prev,
        compliance: {
          overall: 'warnings',
          risk_level: 'medium',
          report_id: crypto.randomUUID(),
          pdf_url: '/reports/compliance/demo.pdf',
          created_at: new Date().toISOString()
        }
      }));
      emit('compliance.warnings', { report_url: '/reports/compliance/demo.pdf', highlights: ['EXPORT: warn'] }, trace);
    });
  };

  const requestOffers = () => {
    if (!snapshot.compliance) return;
    const trace = `trc_off_${crypto.randomUUID().slice(0, 8)}`;
    setSnapshot((prev) => ({
      ...prev,
      offer_request: {
        request_id: crypto.randomUUID(),
        status: 'pending',
        created_at: new Date().toISOString()
      }
    }));
    emit('offers.requested', {}, trace);
    schedule(900, () => {
      const offer1 = crypto.randomUUID();
      const offer2 = crypto.randomUUID();
      setSnapshot((prev) => ({
        ...prev,
        offer_request: prev.offer_request ? { ...prev.offer_request, status: 'ready' } : prev.offer_request,
        offers: [
          {
            offer_id: offer1,
            financier_id: 'bank-alpha',
            financier_name: 'Bank Alpha',
            apr_bps: 450,
            fees: 25,
            tenor_days: 30,
            currency: 'EUR',
            sustainability_tag: 'green_uop',
            sustainability_grade: 'eligible',
            explanations: ['Eligible activity match', 'Evidence valid', 'Recommended by policy'],
            allocation_json: { score: 0.84, policy_id: 'fin_v1', reasons: ['Lower APR', 'STF eligible'] },
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
          },
          {
            offer_id: offer2,
            financier_id: 'bank-beta',
            financier_name: 'Bank Beta',
            apr_bps: 480,
            fees: 0,
            tenor_days: 30,
            currency: 'EUR',
            sustainability_tag: 'none',
            sustainability_grade: 'not_sustainable',
            explanations: ['No UoP evidence'],
            allocation_json: { score: 0.61, policy_id: 'fin_v1', reasons: ['Higher APR'] },
            expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
            created_at: new Date().toISOString()
          }
        ],
        allocation: {
          decision_id: crypto.randomUUID(),
          market: 'finance',
          policy_id: 'fin_v1',
          winner: 'bank-alpha',
          reasons_json: ['Lower APR', 'STF eligible'],
          ranking_json: [
            { offer_id: offer1, financier_id: 'bank-alpha', score: 0.84, reasons: ['Lower APR', 'STF eligible'] },
            { offer_id: offer2, financier_id: 'bank-beta', score: 0.61, reasons: ['Higher APR'] }
          ],
          timestamp: new Date().toISOString()
        }
      }));
      emit('offers.ready', { count: 2, recommended_offer_id: offer1 }, trace);
    });
  };

  const acceptRecommended = () => {
    const rec = snapshot.allocation?.ranking_json?.[0]?.offer_id ?? null;
    if (!rec) return;
    const trace = `trc_acc_${crypto.randomUUID().slice(0, 8)}`;
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    setSnapshot((prev) => ({
      ...prev,
      reservation: {
        reservation_id: crypto.randomUUID(),
        offer_id: rec,
        expires_at: expires,
        status: 'active',
        created_at: new Date().toISOString()
      }
    }));
    emit('offer.accepted', { offer_id: rec, expires_at: expires }, trace);
  };

  const connectBank = () => {
    const trace = `trc_bank_${crypto.randomUUID().slice(0, 8)}`;
    const accountId = crypto.randomUUID();
    setAccounts([
      {
        account_id: accountId,
        provider_id: 'truelayer',
        iban: 'PT50000000000000000000000',
        currency: 'EUR',
        name: 'Demo EUR Account',
        type: 'checking',
        status: 'active',
        bank_name: 'Demo Bank'
      }
    ]);
    setSelectedAccountId(accountId);
    emit('banks.consent.updated', { status: 'granted' }, trace);
  };

  const computeRoutes = () => {
    if (!accounts.length) return;
    const trace = `trc_routes_${crypto.randomUUID().slice(0, 8)}`;
    schedule(450, () => {
      const rs: PaymentRoute[] = [
        { route_id: 'r1', scheme: 'SEPA_INSTANT', fee: 1.2, eta_minutes: 2, recommended: true },
        { route_id: 'r2', scheme: 'SEPA', fee: 0.2, eta_minutes: 1440 }
      ];
      setRoutes(rs);
      setSelectedRouteId('r1');
      emit('payments.routes_ready', { count: rs.length }, trace);
    });
  };

  const executePayment = () => {
    if (!selectedRouteId || !selectedAccountId) return;
    const trace = `trc_pis_${crypto.randomUUID().slice(0, 8)}`;
    emit('payment.executing', {}, trace);
    schedule(650, () => {
      const paymentId = crypto.randomUUID();
      const p: Payment = {
        payment_id: paymentId,
        scheme: 'SEPA_INSTANT',
        status: 'pending_sca',
        redirect_url: 'https://bank.example/sca',
        trace_id: trace
      };
      setLastPayment(p);
      setSnapshot((prev) => ({
        ...prev,
        payments: [
          { payment_id: paymentId, scheme: 'SEPA_INSTANT', status: 'pending_sca', iso_status: null, created_at: new Date().toISOString() }
        ]
      }));
    });
  };

  const completeSca = () => {
    if (!lastPayment) return;
    const trace = lastPayment.trace_id ?? `trc_pis_${crypto.randomUUID().slice(0, 8)}`;
    const next: Payment = { ...lastPayment, status: 'executed', iso_status: 'ACSC' };
    setLastPayment(next);
    setSnapshot((prev) => ({
      ...prev,
      payments: [
        { payment_id: lastPayment.payment_id, scheme: 'SEPA_INSTANT', status: 'executed', iso_status: 'ACSC', created_at: new Date().toISOString() }
      ]
    }));
    emit('payment.completed', { iso_status: 'ACSC' }, trace);
  };

  const buildProofPack = () => {
    if (!snapshot.payments?.[0] || snapshot.payments[0].status !== 'executed') return;
    const trace = `trc_pf_${crypto.randomUUID().slice(0, 8)}`;
    schedule(700, () => {
      const root = pseudoHash(`root:${Date.now()}`);
      const resp: LedgerProofsResponse = {
        bundle_url: '/bundles/demo.zip',
        manifest_sha256: `sha256:${pseudoHash('manifest')}`,
        root,
        anchor: { status: 'pending', network: 'xdc' },
        trace_id: trace
      };
      setLastProofs(resp);
      setSnapshot((prev) => ({
        ...prev,
        proofs: {
          bundle_url: resp.bundle_url,
          root: resp.root,
          manifest_sha256: resp.manifest_sha256,
          created_at: new Date().toISOString()
        }
      }));
      emit('ledger.bundle.ready', { root }, trace);
      emit('ledger.anchor.started', { root, network: 'xdc' }, trace);
      schedule(1100, () => {
        setLastProofs((p) =>
          p
            ? { ...p, anchor: { status: 'anchored', network: 'xdc', tx_hash: `0x${pseudoHash('tx').slice(0, 64)}`, block_number: 123456 } }
            : p
        );
        emit('ledger.anchor.completed', { root, network: 'xdc' }, trace);
      });
    });
  };

  const sendChat = async (text: string) => {
    if (!snapshot.plan) {
      generatePlan(text);
      return;
    }
    setMessages((m) => [...m, { message_id: crypto.randomUUID(), role: 'user', text, created_at: new Date().toISOString() }]);
  };

  const refresh = async () => {};

  const title = snapshot.trade?.title ?? 'Demo workspace';
  const subtitle = 'UI Demo Mode';

  const planReasons = (snapshot.plan?.glass_box?.reasons as string[] | undefined) ?? [];
  const planStatus = snapshot.plan ? { label: 'Ready', tone: 'success' as const } : { label: 'Idle', tone: 'neutral' as const };

  const complianceOverall = String(snapshot.compliance?.overall ?? '');
  const complianceStatus =
    complianceOverall === 'passed'
      ? { label: 'Passed', tone: 'success' as const }
      : complianceOverall === 'warnings'
        ? { label: 'Warnings', tone: 'warn' as const }
        : complianceOverall === 'failed'
          ? { label: 'Failed', tone: 'error' as const }
          : { label: snapshot.compliance ? 'Unknown' : 'Idle', tone: 'neutral' as const };

  const offerRequestStatus = String(snapshot.offer_request?.status ?? '');
  const offersCount = Array.isArray(snapshot.offers) ? snapshot.offers.length : 0;
  const allocationRanking = Array.isArray(snapshot.allocation?.ranking_json) ? snapshot?.allocation?.ranking_json ?? [] : [];
  const recommendedOfferId = allocationRanking?.[0]?.offer_id ?? null;
  const recommendedReasons = Array.isArray(allocationRanking?.[0]?.reasons) ? allocationRanking[0].reasons : [];
  const financeStatus =
    snapshot.reservation
      ? { label: 'Accepted', tone: 'success' as const }
      : offersCount > 0
        ? { label: 'Offers ready', tone: 'success' as const }
        : offerRequestStatus === 'pending'
          ? { label: 'Requesting', tone: 'loading' as const }
          : { label: 'Idle', tone: 'neutral' as const };

  const latestPayment = Array.isArray(snapshot.payments) && snapshot.payments.length > 0 ? snapshot.payments[0] : null;
  const latestPaymentId = latestPayment?.payment_id ?? null;
  const paymentStatusRaw = String(latestPayment?.status ?? '');
  const paymentsStatus =
    paymentStatusRaw === 'executed'
      ? { label: 'Executed', tone: 'success' as const }
      : paymentStatusRaw === 'pending_sca' || paymentStatusRaw === 'executing' || paymentStatusRaw === 'authorized'
        ? { label: paymentStatusRaw.replaceAll('_', ' '), tone: 'loading' as const }
        : paymentStatusRaw === 'failed' || paymentStatusRaw === 'returned'
          ? { label: paymentStatusRaw, tone: 'error' as const }
          : { label: latestPayment ? paymentStatusRaw : 'Idle', tone: 'neutral' as const };

  const proofsStatus = snapshot.proofs?.bundle_url ? { label: 'Ready', tone: 'success' as const } : { label: 'Idle', tone: 'neutral' as const };

  const nextCta = useMemo(() => {
    if (!snapshot.plan) return { label: 'Generate plan', action: 'plan' as const };
    if (!snapshot.compliance) return { label: 'Run compliance', action: 'compliance' as const };
    if (!snapshot.offer_request) return { label: 'Request offers', action: 'offers' as const };
    if (!snapshot.reservation) return { label: 'Accept recommended', action: 'accept' as const, disabled: !recommendedOfferId };
    if (accounts.length === 0) return { label: 'Connect bank', action: 'bank' as const };
    if (routes.length === 0) return { label: 'Compute routes', action: 'routes' as const };
    if (!latestPayment) return { label: 'Execute payment', action: 'execute' as const };
    if (latestPayment.status === 'pending_sca') return { label: 'Complete SCA', action: 'sca' as const };
    if (latestPayment.status !== 'executed') return { label: 'Executing…', action: 'none' as const };
    if (!snapshot.proofs) return { label: 'Build proof pack', action: 'proofs' as const };
    return { label: 'Reset demo', action: 'reset' as const };
  }, [snapshot, recommendedOfferId, accounts.length, routes.length, latestPayment]);

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
    if (nextCta.action === 'reset') return resetDemo();
  };

  return {
    mode: 'demo',
    tradeId: demoTradeId,
    title,
    subtitle,
    snapshot,
    messages,
    events,
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    routes,
    selectedRouteId,
    setSelectedRouteId,
    lastPayment,
    lastProofs,
    cards: {
      plan: { status: planStatus, reasons: planReasons },
      compliance: { status: complianceStatus },
      finance: { status: financeStatus, recommendedOfferId, recommendedReasons },
      payments: { status: paymentsStatus, latestStatusRaw: paymentStatusRaw, latestPaymentId },
      proofs: { status: proofsStatus }
    },
    demo: {
      intentText,
      setIntentText,
      nextCta
    },
    actions: {
      refresh,
      sendChat,
      runCompliance: async () => runCompliance(),
      requestOffers: async () => requestOffers(),
      acceptRecommended: async () => acceptRecommended(),
      connectBank: async () => connectBank(),
      computeRoutes: async () => computeRoutes(),
      executePayment: async () => executePayment(),
      completeSca: async () => completeSca(),
      buildProofPack: async () => buildProofPack(),
      resetDemo,
      runNextCta
    }
  };
}

function createDemoSnapshot(tradeId: string): TradeWorkspaceResponse {
  return {
    trade: {
      trade_id: tradeId,
      title: 'Demo trade',
      corridor: 'PT-ES',
      amount: 12000,
      currency: 'EUR',
      status: 'active',
      created_at: new Date().toISOString()
    },
    plan: null,
    compliance: null,
    offer_request: null,
    offers: [],
    allocation: null,
    reservation: null,
    payments: [],
    proofs: null,
    trace_id: `trc_demo_${crypto.randomUUID().slice(0, 8)}`
  };
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
