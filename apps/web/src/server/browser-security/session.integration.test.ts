import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BrowserSecurityConfig } from './config';
import { parseKeyring } from './crypto';
import { BrowserSessionManager } from './session';
import { PostgresBrowserSessionStore } from './store';

const adminDatabaseUrl = process.env.BROWSER_SESSION_INTEGRATION_DATABASE_URL;
const run = adminDatabaseUrl ? describe : describe.skip;

run('durable Postgres browser sessions', () => {
  let restrictedDatabaseUrl: string;
  let firstStore: PostgresBrowserSessionStore;
  let secondStore: PostgresBrowserSessionStore;

  beforeAll(async () => {
    const password = `integration_${randomBytes(24).toString('hex')}`;
    const admin = new pg.Client({ connectionString: adminDatabaseUrl! });
    await admin.connect();
    try {
      await admin.query(`ALTER ROLE traibox_browser_session PASSWORD '${password}'`);
    } finally {
      await admin.end();
    }
    const restricted = new URL(adminDatabaseUrl!);
    restricted.username = 'traibox_browser_session';
    restricted.password = password;
    restrictedDatabaseUrl = restricted.toString();
  });

  afterAll(async () => {
    await firstStore?.close();
    await secondStore?.close();
    const admin = new pg.Client({ connectionString: adminDatabaseUrl! });
    await admin.connect();
    try {
      await admin.query('ALTER ROLE traibox_browser_session PASSWORD NULL');
    } finally {
      await admin.end();
    }
  });

  it('shares create, rotation, replay rejection, external exchange, and revocation state', async () => {
    const config: BrowserSecurityConfig = {
      apiBaseUrl: new URL('http://localhost:3001'),
      allowedOrigins: new Set(['http://localhost:3000']),
      authMode: 'dev',
      sessionDatabaseUrl: restrictedDatabaseUrl,
      devAuthEnabled: true,
      idleTtlMs: 30 * 60_000,
      absoluteTtlMs: 12 * 60 * 60_000,
      keyring: parseKeyring(`integration:${Buffer.alloc(32, 9).toString('base64')}`),
      production: false,
      requestTimeoutMs: 30_000,
      maxRequestBytes: 1024
    };
    firstStore = new PostgresBrowserSessionStore(restrictedDatabaseUrl);
    secondStore = new PostgresBrowserSessionStore(restrictedDatabaseUrl);
    const firstInstance = new BrowserSessionManager(firstStore, config);
    const secondInstance = new BrowserSessionManager(secondStore, config);
    const created = await firstInstance.create({ kind: 'user', principalId: 'integration-user', credential: 'access', refreshCredential: 'refresh' });
    await expect(secondInstance.authenticate(created.rawSessionId)).resolves.toMatchObject({ principalId: 'integration-user', credential: 'access' });
    const rotated = await secondInstance.rotate(await secondInstance.authenticate(created.rawSessionId), { credential: 'access-2' });
    await expect(firstInstance.authenticate(created.rawSessionId)).rejects.toMatchObject({ code: 'invalid_session' });
    await expect(firstInstance.authenticate(rotated.rawSessionId)).resolves.toMatchObject({ credential: 'access-2' });
    const exchange = `txp_integration_${crypto.randomUUID()}`;
    await firstInstance.consumeExternalExchange(exchange, new Date(Date.now() + 60_000));
    await expect(secondInstance.consumeExternalExchange(exchange, new Date(Date.now() + 60_000))).rejects.toMatchObject({ code: 'replayed_exchange' });
    await firstInstance.revoke(rotated.rawSessionId);
    await expect(secondInstance.authenticate(rotated.rawSessionId)).rejects.toMatchObject({ code: 'invalid_session' });
  });

  it('denies direct canonical table reads and writes to the BFF session principal', async () => {
    const restricted = new pg.Client({ connectionString: restrictedDatabaseUrl });
    await restricted.connect();
    try {
      const identity = await restricted.query<{ current_user: string }>('SELECT current_user');
      expect(identity.rows[0]?.current_user).toBe('traibox_browser_session');
      const forbiddenOperations = [
        ['trades SELECT', 'SELECT * FROM public.trades LIMIT 1'],
        ['trades INSERT', 'INSERT INTO public.trades DEFAULT VALUES'],
        ['trades UPDATE', 'UPDATE public.trades SET status=status WHERE false'],
        ['trades DELETE', 'DELETE FROM public.trades WHERE false'],
        ['alpha_objects SELECT', 'SELECT * FROM public.alpha_objects LIMIT 1'],
        ['alpha_objects INSERT', 'INSERT INTO public.alpha_objects DEFAULT VALUES'],
        ['alpha_objects UPDATE', 'UPDATE public.alpha_objects SET status=status WHERE false'],
        ['alpha_objects DELETE', 'DELETE FROM public.alpha_objects WHERE false'],
        ['payments SELECT', 'SELECT * FROM public.payments LIMIT 1'],
        ['payments INSERT', 'INSERT INTO public.payments DEFAULT VALUES'],
        ['payments UPDATE', 'UPDATE public.payments SET status=status WHERE false'],
        ['payments DELETE', 'DELETE FROM public.payments WHERE false'],
        ['approval objects SELECT', "SELECT * FROM public.alpha_objects WHERE type='approval' LIMIT 1"],
        ['approval objects INSERT', "INSERT INTO public.alpha_objects(type) VALUES('approval')"],
        ['approval objects UPDATE', "UPDATE public.alpha_objects SET status=status WHERE type='approval'"],
        ['approval objects DELETE', "DELETE FROM public.alpha_objects WHERE type='approval'"]
      ] as const;
      for (const [operation, sql] of forbiddenOperations) {
        await expect(restricted.query(sql), operation).rejects.toMatchObject({ code: '42501' });
      }
    } finally {
      await restricted.end();
    }
  });
});
