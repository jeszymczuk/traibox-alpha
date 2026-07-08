import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  BuildNetworkTrustResponse,
  FinanceFundingResponse,
  ListOrgMessagesResponse,
  ListPaymentsResponse,
  OfferResponse,
  Payment,
  RoutesResponse
} from '@traibox/contracts';

import { buildServer } from '../server.js';

// Money-moving rails end-to-end: payments (routes → execute → complete → list),
// funding (request → ranked offers → accept → reservation), network trust
// (evidence → trust context), and the org-wide message inbox. Same gating as
// alpha.scenario.test.ts: runs only when ALPHA_INTEGRATION_DATABASE_URL is set.
const TEST_DB_URL = process.env.ALPHA_INTEGRATION_DATABASE_URL;
const DEV_USER_ID = '00000000-0000-0000-0000-0000000000aa';

const run = TEST_DB_URL ? describe : describe.skip;

run('TRAIBOX money rails against Postgres', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let orgId: string;
  let tradeId: string;
  let accountId: string;

  beforeAll(async () => {
    if (!TEST_DB_URL) return;
    assertLocalTestDatabase(TEST_DB_URL);
    await resetDatabase(TEST_DB_URL);
    await applyMigrations(TEST_DB_URL);
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.AUTH_MODE = 'dev';
    process.env.DEV_USER_ID = DEV_USER_ID;
    process.env.DEPLOYMENT_PROFILE_PATH =
      process.env.DEPLOYMENT_PROFILE_PATH ?? path.join(findRepoRoot(), 'packages/profiles/profiles/dev.yaml');

    app = await buildServer();

    const created = await app.inject({
      method: 'POST',
      url: '/v1/orgs',
      headers: authHeaders(),
      payload: { name: 'TRAIBOX Rails Test Org', country: 'PT' }
    });
    expect(created.statusCode).toBe(200);
    orgId = created.json<{ org_id: string }>().org_id;

    const demo = await app.inject({
      method: 'POST',
      url: '/v1/demo/internal-alpha',
      headers: authHeaders(orgId),
      payload: { messy_input: 'Sell industrial sensors from Portugal to a Spanish buyer; 40% advance; buyer acceptance proof required.' }
    });
    expect(demo.statusCode).toBe(200);
    tradeId = demo.json<{ trade_id: string }>().trade_id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('connects a manual account, routes, executes, completes, and lists the payment', async () => {
    const account = await app.inject({
      method: 'POST',
      url: '/v1/banks/manual/accounts',
      headers: authHeaders(orgId),
      payload: { iban: 'PT50001000001234567890144', currency: 'EUR', name: 'Operating', bank_name: 'Banco Teste' }
    });
    expect(account.statusCode).toBe(200);
    accountId = account.json<{ account_id: string }>().account_id;

    const routes = await app.inject({
      method: 'POST',
      url: '/v1/payments/routes',
      headers: authHeaders(orgId),
      payload: { from_account_id: accountId, to_iban: 'PT50003300004555698522119', amount: 18420, currency: 'EUR', urgency: 'standard' }
    });
    expect(routes.statusCode).toBe(200);
    const routesBody = routes.json<RoutesResponse>();
    expect(routesBody.routes.length).toBeGreaterThan(0);
    const manualRoute = routesBody.routes.find((route) => route.route_id === 'r_manual');
    expect(manualRoute, 'dev profile exposes the manual rail for manual accounts').toBeDefined();
    expect(manualRoute!.recommended).toBe(true);

    const idemKey = randomUUID();
    const executeBody = {
      trade_id: tradeId,
      route_id: manualRoute!.route_id,
      from_account_id: accountId,
      creditor_name: 'Adega Atlantica',
      creditor_iban: 'PT50003300004555698522119',
      amount: 18420,
      currency: 'EUR',
      remittance: 'INV-TEST-0001',
      e2e_id: randomUUID()
    };
    const execute = await app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': idemKey },
      payload: executeBody
    });
    expect(execute.statusCode).toBe(200);
    const payment = execute.json<Payment>();
    expect(payment.payment_id).toBeTruthy();
    expect(payment.scheme).toBe('MANUAL_TRANSFER');

    // Same key + same body → the stored response replays; no duplicate payment.
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/payments/execute',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': idemKey },
      payload: executeBody
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json<Payment>().payment_id).toBe(payment.payment_id);

    const list = await app.inject({ method: 'GET', url: '/v1/payments?limit=50', headers: authHeaders(orgId) });
    expect(list.statusCode).toBe(200);
    const listBody = list.json<ListPaymentsResponse>();
    const occurrences = listBody.payments.filter((p) => p.creditor_iban === executeBody.creditor_iban);
    expect(occurrences).toHaveLength(1);
    const listed = occurrences[0]!;
    expect(listed.payment_id).toBe(payment.payment_id);
    expect(listed.creditor_name).toBe('Adega Atlantica');
    expect(listed.amount).toBe(18420);
    expect(listed.trade_id).toBe(tradeId);
    expect(['created', 'pending_sca']).toContain(listed.status);

    const complete = await app.inject({
      method: 'POST',
      url: '/v1/payments/manual/complete',
      headers: authHeaders(orgId),
      payload: { payment_id: payment.payment_id, status: 'executed' }
    });
    expect(complete.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/v1/payments?limit=50', headers: authHeaders(orgId) });
    const executed = after.json<ListPaymentsResponse>().payments.find((p) => p.payment_id === payment.payment_id);
    expect(executed!.status).toBe('executed');

    const detail = await app.inject({ method: 'GET', url: `/v1/payments/${payment.payment_id}`, headers: authHeaders(orgId) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ status: string }>().status).toBe('executed');
  }, 60_000);

  it('requests funding, ranks offers, accepts one, and shows the reservation', async () => {
    const request = await app.inject({
      method: 'POST',
      url: '/v1/finance/offers',
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: { trade_id: tradeId, amount: 312400, tenor_days: 60, sustainable: { enabled: true } }
    });
    expect(request.statusCode).toBe(200);
    const offerBody = request.json<OfferResponse>();
    expect(offerBody.offers.length).toBeGreaterThan(0);

    const funding = await app.inject({ method: 'GET', url: '/v1/finance/funding', headers: authHeaders(orgId) });
    expect(funding.statusCode).toBe(200);
    const fundingBody = funding.json<FinanceFundingResponse>();
    const req = fundingBody.requests.find((r) => r.trade_id === tradeId && r.amount === 312400);
    expect(req).toBeDefined();
    expect(req!.offers.length).toBeGreaterThan(0);
    // Ranked ascending by all-in APR.
    const aprs = req!.offers.map((offer) => offer.apr_bps);
    expect([...aprs].sort((a, b) => a - b)).toEqual(aprs);

    const best = req!.offers[0]!;
    const accept = await app.inject({
      method: 'POST',
      url: `/v1/finance/offers/${best.offer_id}/accept`,
      headers: { ...authHeaders(orgId), 'x-idempotency-key': randomUUID() },
      payload: {}
    });
    expect(accept.statusCode).toBe(200);
    expect(accept.json<{ reservation: { offer_id: string } }>().reservation.offer_id).toBe(best.offer_id);

    const after = await app.inject({ method: 'GET', url: '/v1/finance/funding', headers: authHeaders(orgId) });
    const reservation = after.json<FinanceFundingResponse>().reservations.find((r) => r.offer_id === best.offer_id);
    expect(reservation).toBeDefined();
    expect(reservation!.status).toBe('active');
    expect(reservation!.financier_name).toBe(best.financier_name);
    expect(reservation!.amount).toBe(312400);
  }, 60_000);

  it('builds a network trust context from counterparty evidence', async () => {
    const counterparty = await app.inject({
      method: 'POST',
      url: '/v1/objects/counterparty',
      headers: authHeaders(orgId),
      payload: {
        title: 'Bauwerk Test GmbH',
        summary: 'German construction buyer',
        origin_workspace: 'network',
        payload: { role: 'Buyer', country: 'Germany' }
      }
    });
    expect(counterparty.statusCode).toBe(200);
    const counterpartyId = counterparty.json<{ object: { object_id: string } }>().object.object_id;

    const screening = await app.inject({
      method: 'POST',
      url: '/v1/objects/screening_result',
      headers: authHeaders(orgId),
      payload: {
        title: 'Sanctions screen — Bauwerk Test',
        origin_workspace: 'network',
        status: 'completed',
        payload: { counterparty_id: counterpartyId, sanctions: 'clear', pep: 'clear', adverse_media: 'clear' }
      }
    });
    expect(screening.statusCode).toBe(200);
    const screeningId = screening.json<{ object: { object_id: string } }>().object.object_id;

    const trust = await app.inject({
      method: 'POST',
      url: `/v1/network/counterparties/${counterpartyId}/trust-context`,
      headers: authHeaders(orgId),
      payload: { screening_result_id: screeningId, passport_visibility: 'internal' }
    });
    expect(trust.statusCode).toBe(200);
    const trustBody = trust.json<BuildNetworkTrustResponse>();
    expect(trustBody.trust_context.score).toBeGreaterThan(0);
    expect(['pending_evidence', 'ready_for_review', 'blocked']).toContain(trustBody.trust_context.status);
    expect(trustBody.trade_passport.type).toBe('trade_passport');
    expect((trustBody.counterparty.payload_json as { trust_score?: number }).trust_score).toBe(trustBody.trust_context.score);

    // Recompute is allowed and stays consistent.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/network/counterparties/${counterpartyId}/trust-context`,
      headers: authHeaders(orgId),
      payload: { screening_result_id: screeningId }
    });
    expect(again.statusCode).toBe(200);
  }, 60_000);

  it('threads trade messages into the org-wide inbox with trade titles', async () => {
    const post = await app.inject({
      method: 'POST',
      url: `/v1/trades/${tradeId}/messages`,
      headers: authHeaders(orgId),
      payload: { text: 'Buyer confirmed the acceptance window.' }
    });
    expect(post.statusCode).toBe(200);

    const inbox = await app.inject({ method: 'GET', url: '/v1/messages?limit=50', headers: authHeaders(orgId) });
    expect(inbox.statusCode).toBe(200);
    const inboxBody = inbox.json<ListOrgMessagesResponse>();
    const message = inboxBody.messages.find((m) => m.text === 'Buyer confirmed the acceptance window.');
    expect(message).toBeDefined();
    expect(message!.trade_id).toBe(tradeId);
    expect(message!.trade_title).toBeTruthy();
    expect(message!.role).toBe('user');
  }, 30_000);
});

function authHeaders(orgId?: string) {
  return {
    Authorization: 'Bearer dev',
    ...(orgId ? { 'X-Org-Id': orgId } : {})
  };
}

function assertLocalTestDatabase(connectionString: string) {
  const url = new URL(connectionString);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`Refusing to reset non-local integration database: ${url.hostname}`);
  }
  if (!/test|traibox/i.test(url.pathname)) {
    throw new Error(`Refusing to reset database without test/traibox in name: ${url.pathname}`);
  }
}

async function resetDatabase(connectionString: string) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      DO $$ DECLARE r RECORD;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

async function applyMigrations(connectionString: string) {
  const client = new pg.Client({ connectionString });
  const migrationsDir = path.join(findRepoRoot(), 'packages/db/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, sql: readFileSync(path.join(migrationsDir, name), 'utf8') }));

  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES($1)', [migration.name]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.end();
  }
}

function findRepoRoot(): string {
  let current = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    const candidate = path.join(current, 'packages/db/migrations');
    try {
      if (readdirSync(candidate).some((file) => file.endsWith('.sql'))) return current;
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Unable to locate repo root from ${process.cwd()}`);
}
