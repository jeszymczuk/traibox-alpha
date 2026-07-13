import { describe, expect, it } from 'vitest';

import type { BrowserSecurityConfig } from './config';
import { parseKeyring } from './crypto';
import { BrowserSessionManager } from './session';
import { PostgresBrowserSessionStore } from './store';

const databaseUrl = process.env.BROWSER_SESSION_INTEGRATION_DATABASE_URL;
const run = databaseUrl ? describe : describe.skip;

run('durable Postgres browser sessions', () => {
  it('shares create, rotation, replay rejection, external exchange, and revocation state', async () => {
    const config: BrowserSecurityConfig = {
      apiBaseUrl: new URL('http://localhost:3001'),
      allowedOrigins: new Set(['http://localhost:3000']),
      authMode: 'dev',
      databaseUrl: databaseUrl!,
      devAuthEnabled: true,
      idleTtlMs: 30 * 60_000,
      absoluteTtlMs: 12 * 60 * 60_000,
      keyring: parseKeyring(`integration:${Buffer.alloc(32, 9).toString('base64')}`),
      production: false,
      requestTimeoutMs: 30_000,
      maxRequestBytes: 1024
    };
    const firstInstance = new BrowserSessionManager(new PostgresBrowserSessionStore(databaseUrl!), config);
    const secondInstance = new BrowserSessionManager(new PostgresBrowserSessionStore(databaseUrl!), config);
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
});
