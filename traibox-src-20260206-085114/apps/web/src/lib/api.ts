import { z } from 'zod';
import { getAuthToken } from './auth';
import type {
  AcceptResponse,
  ComplianceRequest,
  ComplianceResponse,
  CreateOrgResponse,
  CreateTradeMessageResponse,
  ExecutePaymentRequest,
  LedgerProofsResponse,
  ListBankAccountsResponse,
  ListOrgsResponse,
  ListTradeMessagesResponse,
  ListTradesResponse,
  OfferRequest,
  OfferResponse,
  ParseTradeRequest,
  Payment,
  RoutesRequest,
  RoutesResponse,
  TradePlanResponse,
  TradeWorkspaceResponse,
  UTGPartnerFeaturesRequest,
  UTGPartnerFeaturesResponse,
  UTGRecallRequest,
  UTGRecallResponse
} from '@traibox/contracts';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

function headers(orgId?: string) {
  const h: Record<string, string> = { Authorization: `Bearer ${getAuthToken()}`, 'Content-Type': 'application/json' };
  if (orgId) h['X-Org-Id'] = orgId;
  return h;
}

function partnerHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } as const;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  async listOrgs() {
    const res = await fetch(`${API_BASE}/v1/orgs`, { headers: headers() });
    return json<ListOrgsResponse>(res);
  },
  async createOrg(name: string) {
    const res = await fetch(`${API_BASE}/v1/orgs`, { method: 'POST', headers: headers(), body: JSON.stringify({ name }) });
    return json<CreateOrgResponse>(res);
  },
  async listTrades(orgId: string) {
    const res = await fetch(`${API_BASE}/v1/trades`, { headers: headers(orgId) });
    return json<ListTradesResponse>(res);
  },
  async getTrade(orgId: string, tradeId: string) {
    const res = await fetch(`${API_BASE}/v1/trades/${tradeId}`, { headers: headers(orgId) });
    return json<TradeWorkspaceResponse>(res);
  },
  async listTradeMessages(orgId: string, tradeId: string, limit = 200) {
    const url = new URL(`${API_BASE}/v1/trades/${tradeId}/messages`);
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), { headers: headers(orgId) });
    return json<ListTradeMessagesResponse>(res);
  },
  async postTradeMessage(orgId: string, tradeId: string, text: string) {
    const res = await fetch(`${API_BASE}/v1/trades/${tradeId}/messages`, {
      method: 'POST',
      headers: headers(orgId),
      body: JSON.stringify({ text })
    });
    return json<CreateTradeMessageResponse>(res);
  },
  async parseTrade(orgId: string, body: ParseTradeRequest) {
    const res = await fetch(`${API_BASE}/v1/trade/parse`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<TradePlanResponse>(res);
  },
  async runCompliance(orgId: string, body: ComplianceRequest) {
    const res = await fetch(`${API_BASE}/v1/compliance/check`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<ComplianceResponse>(res);
  },
  async requestOffers(orgId: string, body: OfferRequest) {
    const res = await fetch(`${API_BASE}/v1/finance/offers`, {
      method: 'POST',
      headers: { ...headers(orgId), 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body)
    });
    return json<OfferResponse>(res);
  },
  async acceptOffer(orgId: string, offerId: string) {
    const res = await fetch(`${API_BASE}/v1/finance/offers/${offerId}/accept`, {
      method: 'POST',
      headers: { ...headers(orgId), 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({})
    });
    return json<AcceptResponse>(res);
  },
  async linkBank(orgId: string, body: any) {
    const res = await fetch(`${API_BASE}/v1/banks/link`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async exchangeBankConsent(orgId: string, body: { consent_id: string; code: string; state?: string }) {
    const res = await fetch(`${API_BASE}/v1/banks/exchange`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async listAccounts(orgId: string) {
    const res = await fetch(`${API_BASE}/v1/banks/accounts`, { headers: headers(orgId) });
    return json<ListBankAccountsResponse>(res);
  },
  async createManualAccount(orgId: string, body: { iban: string; currency?: string; name?: string; bank_name?: string; type?: string }) {
    const res = await fetch(`${API_BASE}/v1/banks/manual/accounts`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async routes(orgId: string, body: RoutesRequest) {
    const res = await fetch(`${API_BASE}/v1/payments/routes`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<RoutesResponse>(res);
  },
  async executePayment(orgId: string, body: ExecutePaymentRequest) {
    const res = await fetch(`${API_BASE}/v1/payments/execute`, {
      method: 'POST',
      headers: { ...headers(orgId), 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body)
    });
    return json<Payment>(res);
  },
  async mockScaComplete(orgId: string, paymentId: string, status: 'executed' | 'failed' = 'executed') {
    const res = await fetch(`${API_BASE}/v1/payments/mock/sca-complete`, {
      method: 'POST',
      headers: headers(orgId),
      body: JSON.stringify({ payment_id: paymentId, status })
    });
    return json<any>(res);
  },
  async getPaymentDetails(orgId: string, paymentId: string) {
    const res = await fetch(`${API_BASE}/v1/payments/${paymentId}`, { headers: headers(orgId) });
    return json<any>(res);
  },
  async completeManualPayment(orgId: string, paymentId: string, status: 'executed' | 'failed' = 'executed') {
    const res = await fetch(`${API_BASE}/v1/payments/manual/complete`, {
      method: 'POST',
      headers: headers(orgId),
      body: JSON.stringify({ payment_id: paymentId, status })
    });
    return json<any>(res);
  },
  async getProofs(orgId: string, tradeId: string) {
    const res = await fetch(`${API_BASE}/v1/ledger/proofs?trade_id=${encodeURIComponent(tradeId)}`, { headers: headers(orgId) });
    return json<LedgerProofsResponse>(res);
  },
  async utgRecall(orgId: string, body: UTGRecallRequest) {
    const res = await fetch(`${API_BASE}/v1/utg/recall`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<UTGRecallResponse>(res);
  },
  async utgPartnerFeatures(orgId: string, body: UTGPartnerFeaturesRequest) {
    const res = await fetch(`${API_BASE}/v1/utg/partner/features`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<UTGPartnerFeaturesResponse>(res);
  },
  downloadUrl(orgId: string, url: string) {
    const u = new URL(`${API_BASE}/v1/files`);
    u.searchParams.set('org_id', orgId);
    u.searchParams.set('url', url);
    u.searchParams.set('token', getAuthToken());
    return u.toString();
  },
  eventsUrl(input: { orgId: string; tradeId: string }) {
    const u = new URL(`${API_BASE}/v1/events`);
    u.searchParams.set('org_id', input.orgId);
    u.searchParams.set('trade_id', input.tradeId);
    u.searchParams.set('token', getAuthToken());
    return u.toString();
  },

  // ---- Partner API (MVP) ----
  async partnerAuthToken(apiKey: string) {
    const res = await fetch(`${API_BASE}/v1/partners/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: apiKey }) });
    return json<{ access_token: string; partner_id: string }>(res);
  },
  async partnerGetProfile(token: string) {
    const res = await fetch(`${API_BASE}/v1/partners/profile`, { headers: partnerHeaders(token) });
    return json<any>(res);
  },
  async partnerListOfferRequests(token: string, status: 'pending' | 'ready' | string = 'pending') {
    const url = new URL(`${API_BASE}/v1/partners/offer-requests`);
    url.searchParams.set('status', status);
    const res = await fetch(url.toString(), { headers: partnerHeaders(token) });
    return json<{ items: any[] }>(res);
  },
  async partnerSubmitOffers(token: string, requestId: string, body: any) {
    const res = await fetch(`${API_BASE}/v1/partners/offer-requests/${requestId}/offers`, { method: 'POST', headers: partnerHeaders(token), body: JSON.stringify(body ?? {}) });
    return json<any>(res);
  }
};
