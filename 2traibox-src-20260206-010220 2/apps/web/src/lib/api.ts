import { z } from 'zod';
import { getAuthToken } from './auth';

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
    return json<{ orgs: any[] }>(res);
  },
  async createOrg(name: string) {
    const res = await fetch(`${API_BASE}/v1/orgs`, { method: 'POST', headers: headers(), body: JSON.stringify({ name }) });
    return json<{ org_id: string }>(res);
  },
  async listTrades(orgId: string) {
    const res = await fetch(`${API_BASE}/v1/trades`, { headers: headers(orgId) });
    return json<{ trades: any[] }>(res);
  },
  async getTrade(orgId: string, tradeId: string) {
    const res = await fetch(`${API_BASE}/v1/trades/${tradeId}`, { headers: headers(orgId) });
    return json<any>(res);
  },
  async listTradeMessages(orgId: string, tradeId: string, limit = 200) {
    const url = new URL(`${API_BASE}/v1/trades/${tradeId}/messages`);
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url.toString(), { headers: headers(orgId) });
    return json<any>(res);
  },
  async postTradeMessage(orgId: string, tradeId: string, text: string) {
    const res = await fetch(`${API_BASE}/v1/trades/${tradeId}/messages`, {
      method: 'POST',
      headers: headers(orgId),
      body: JSON.stringify({ text })
    });
    return json<any>(res);
  },
  async parseTrade(orgId: string, body: any) {
    const res = await fetch(`${API_BASE}/v1/trade/parse`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async runCompliance(orgId: string, body: any) {
    const res = await fetch(`${API_BASE}/v1/compliance/check`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async requestOffers(orgId: string, body: any) {
    const res = await fetch(`${API_BASE}/v1/finance/offers`, {
      method: 'POST',
      headers: { ...headers(orgId), 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body)
    });
    return json<any>(res);
  },
  async acceptOffer(orgId: string, offerId: string) {
    const res = await fetch(`${API_BASE}/v1/finance/offers/${offerId}/accept`, {
      method: 'POST',
      headers: { ...headers(orgId), 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({})
    });
    return json<any>(res);
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
    return json<any>(res);
  },
  async createManualAccount(orgId: string, body: { iban: string; currency?: string; name?: string; bank_name?: string; type?: string }) {
    const res = await fetch(`${API_BASE}/v1/banks/manual/accounts`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async routes(orgId: string, body: any) {
    const res = await fetch(`${API_BASE}/v1/payments/routes`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async executePayment(orgId: string, body: any) {
    const res = await fetch(`${API_BASE}/v1/payments/execute`, {
      method: 'POST',
      headers: { ...headers(orgId), 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body)
    });
    return json<any>(res);
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
    return json<any>(res);
  },
  async utgRecall(orgId: string, body: { trade_id: string; hops?: number; include?: string[]; limit_nodes?: number }) {
    const res = await fetch(`${API_BASE}/v1/utg/recall`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
  },
  async utgPartnerFeatures(orgId: string, body: { trade_id: string; domain: string; partner_ids: string[] }) {
    const res = await fetch(`${API_BASE}/v1/utg/partner/features`, { method: 'POST', headers: headers(orgId), body: JSON.stringify(body) });
    return json<any>(res);
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
