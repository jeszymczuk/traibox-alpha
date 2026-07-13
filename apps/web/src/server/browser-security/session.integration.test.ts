import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { BrowserSecurityConfig } from './config';
import { digestOpaqueToken, parseKeyring } from './crypto';
import { BrowserSessionManager } from './session';
import { PostgresBrowserSessionStore } from './store';

const adminDatabaseUrl = process.env.BROWSER_SESSION_INTEGRATION_DATABASE_URL;
const run = adminDatabaseUrl ? describe : describe.skip;

type AuthenticationRow = {
  credential_ciphertext: string;
  last_seen_at: Date;
  idle_expires_at: Date;
  absolute_expires_at: Date;
};

run('durable Postgres browser sessions', () => {
  let restrictedDatabaseUrl: string;
  let firstStore: PostgresBrowserSessionStore;
  let secondStore: PostgresBrowserSessionStore;
  let firstInstance: BrowserSessionManager;
  let secondInstance: BrowserSessionManager;
  let config: BrowserSecurityConfig;

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
    config = {
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
    firstInstance = new BrowserSessionManager(firstStore, config);
    secondInstance = new BrowserSessionManager(secondStore, config);
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

  async function connected(connectionString = restrictedDatabaseUrl): Promise<pg.Client> {
    const client = new pg.Client({ connectionString });
    await client.connect();
    return client;
  }

  async function closeClients(...clients: pg.Client[]): Promise<void> {
    for (const client of clients) {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  }

  async function backendPid(client: pg.Client): Promise<number> {
    const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    return result.rows[0]!.pid;
  }

  async function waitForRowLock(observer: pg.Client, blockedPid: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const result = await observer.query<{ wait_event_type: string | null }>(
        'SELECT wait_event_type FROM pg_catalog.pg_stat_activity WHERE pid=$1',
        [blockedPid]
      );
      if (result.rows[0]?.wait_event_type === 'Lock') return;
      await delay(10);
    }
    throw new Error(`PostgreSQL backend ${blockedPid} did not reach a row-lock barrier`);
  }

  function authenticate(client: pg.Client, sessionIdHash: string) {
    return client.query<AuthenticationRow>('SELECT * FROM browser_security.authenticate_session($1,$2)', [sessionIdHash, config.idleTtlMs]);
  }

  function revoke(client: pg.Client, sessionIdHash: string) {
    return client.query('SELECT browser_security.revoke_session($1,clock_timestamp())', [sessionIdHash]);
  }

  function requiredRotation(client: pg.Client, previousHash: string) {
    const createdAt = new Date();
    return client.query<{ persisted: boolean }>(
      `SELECT browser_security.persist_session(
         $1,'user','race-user','{}'::jsonb,'{}'::jsonb,$2,NULL,NULL,$3,$4,
         $5,$5,$6,$7,NULL,NULL,$8,true
       ) AS persisted`,
      [
        randomBytes(32).toString('hex'),
        'replacement-credential-ciphertext',
        randomBytes(32).toString('hex'),
        'replacement-csrf-ciphertext',
        createdAt,
        new Date(createdAt.getTime() + config.idleTtlMs),
        new Date(createdAt.getTime() + config.absoluteTtlMs),
        previousHash
      ]
    );
  }

  async function createRaceSession(credential: string) {
    return firstInstance.create({ kind: 'user', principalId: 'race-user', credential });
  }

  it('shares create, rotation, replay rejection, external exchange, and revocation state', async () => {
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

  it('allows authentication that linearizes before logout revocation, then fails closed', async () => {
    const created = await createRaceSession('logout-race-credential');
    const sessionIdHash = digestOpaqueToken(created.rawSessionId);
    const authenticating = await connected();
    const revoking = await connected();
    const observer = await connected(adminDatabaseUrl!);
    try {
      await authenticating.query('BEGIN');
      const authenticated = await authenticate(authenticating, sessionIdHash);
      expect(authenticated.rows[0]?.credential_ciphertext).toBeTruthy();

      await revoking.query('BEGIN');
      const revokingPid = await backendPid(revoking);
      const revocationPending = revoke(revoking, sessionIdHash);
      await waitForRowLock(observer, revokingPid);

      await authenticating.query('COMMIT');
      await revocationPending;
      await revoking.query('COMMIT');

      expect((await authenticate(revoking, sessionIdHash)).rows).toHaveLength(0);
    } finally {
      await closeClients(authenticating, revoking, observer);
    }
  });

  it('returns no credential when logout revocation commits before blocked authentication', async () => {
    const created = await createRaceSession('revocation-first-credential');
    const sessionIdHash = digestOpaqueToken(created.rawSessionId);
    const revoking = await connected();
    const authenticating = await connected();
    const observer = await connected(adminDatabaseUrl!);
    try {
      await revoking.query('BEGIN');
      await revoke(revoking, sessionIdHash);

      await authenticating.query('BEGIN');
      const authenticatingPid = await backendPid(authenticating);
      const authenticationPending = authenticate(authenticating, sessionIdHash);
      await waitForRowLock(observer, authenticatingPid);

      await revoking.query('COMMIT');
      const authenticated = await authenticationPending;
      await authenticating.query('COMMIT');

      expect(authenticated.rows).toHaveLength(0);
    } finally {
      await closeClients(revoking, authenticating, observer);
    }
  });

  it('allows authentication that linearizes before required rotation, then fails closed', async () => {
    const created = await createRaceSession('rotation-race-credential');
    const sessionIdHash = digestOpaqueToken(created.rawSessionId);
    const authenticating = await connected();
    const rotating = await connected();
    const observer = await connected(adminDatabaseUrl!);
    try {
      await authenticating.query('BEGIN');
      const authenticated = await authenticate(authenticating, sessionIdHash);
      expect(authenticated.rows[0]?.credential_ciphertext).toBeTruthy();

      await rotating.query('BEGIN');
      const rotatingPid = await backendPid(rotating);
      const rotationPending = requiredRotation(rotating, sessionIdHash);
      await waitForRowLock(observer, rotatingPid);

      await authenticating.query('COMMIT');
      expect((await rotationPending).rows[0]?.persisted).toBe(true);
      await rotating.query('COMMIT');

      expect((await authenticate(rotating, sessionIdHash)).rows).toHaveLength(0);
    } finally {
      await closeClients(authenticating, rotating, observer);
    }
  });

  it('returns no credential when required rotation commits before blocked authentication', async () => {
    const created = await createRaceSession('rotation-first-credential');
    const sessionIdHash = digestOpaqueToken(created.rawSessionId);
    const rotating = await connected();
    const authenticating = await connected();
    const observer = await connected(adminDatabaseUrl!);
    try {
      await rotating.query('BEGIN');
      expect((await requiredRotation(rotating, sessionIdHash)).rows[0]?.persisted).toBe(true);

      await authenticating.query('BEGIN');
      const authenticatingPid = await backendPid(authenticating);
      const authenticationPending = authenticate(authenticating, sessionIdHash);
      await waitForRowLock(observer, authenticatingPid);

      await rotating.query('COMMIT');
      const authenticated = await authenticationPending;
      await authenticating.query('COMMIT');

      expect(authenticated.rows).toHaveLength(0);
    } finally {
      await closeClients(rotating, authenticating, observer);
    }
  });

  it('returns no credential after the idle lifetime expires according to database time', async () => {
    const created = await createRaceSession('idle-expired-credential');
    const sessionIdHash = digestOpaqueToken(created.rawSessionId);
    const admin = await connected(adminDatabaseUrl!);
    const restricted = await connected();
    try {
      await admin.query(
        "UPDATE public.browser_sessions SET idle_expires_at=clock_timestamp()-interval '1 second' WHERE session_id_hash=$1",
        [sessionIdHash]
      );
      expect((await authenticate(restricted, sessionIdHash)).rows).toHaveLength(0);
    } finally {
      await closeClients(admin, restricted);
    }
  });

  it('returns no credential after the absolute lifetime expires according to database time', async () => {
    const created = await createRaceSession('absolute-expired-credential');
    const sessionIdHash = digestOpaqueToken(created.rawSessionId);
    const admin = await connected(adminDatabaseUrl!);
    const restricted = await connected();
    try {
      await admin.query(
        `UPDATE public.browser_sessions
         SET idle_expires_at=clock_timestamp()-interval '2 seconds',
             absolute_expires_at=clock_timestamp()-interval '1 second'
         WHERE session_id_hash=$1`,
        [sessionIdHash]
      );
      expect((await authenticate(restricted, sessionIdHash)).rows).toHaveLength(0);
    } finally {
      await closeClients(admin, restricted);
    }
  });

  it('atomically extends idle expiry without exceeding absolute expiry', async () => {
    const created = await createRaceSession('idle-extension-credential');
    const sessionIdHash = digestOpaqueToken(created.rawSessionId);
    const admin = await connected(adminDatabaseUrl!);
    const restricted = await connected();
    try {
      const before = await admin.query<{ last_seen_at: Date; idle_expires_at: Date; absolute_expires_at: Date }>(
        `UPDATE public.browser_sessions
         SET last_seen_at=clock_timestamp()-interval '10 minutes',
             idle_expires_at=clock_timestamp()+interval '5 seconds'
         WHERE session_id_hash=$1
         RETURNING last_seen_at,idle_expires_at,absolute_expires_at`,
        [sessionIdHash]
      );

      const authenticated = await authenticate(restricted, sessionIdHash);
      expect(authenticated.rows).toHaveLength(1);
      expect(authenticated.rows[0]?.credential_ciphertext).toBeTruthy();
      expect(authenticated.rows[0]!.last_seen_at.getTime()).toBeGreaterThan(before.rows[0]!.last_seen_at.getTime());
      expect(authenticated.rows[0]!.idle_expires_at.getTime()).toBeGreaterThan(before.rows[0]!.idle_expires_at.getTime());
      expect(authenticated.rows[0]!.idle_expires_at.getTime()).toBeLessThanOrEqual(authenticated.rows[0]!.absolute_expires_at.getTime());
    } finally {
      await closeClients(admin, restricted);
    }
  });

  it('exposes only the atomic lifecycle function and denies direct browser-session table access', async () => {
    const restricted = await connected();
    try {
      const privileges = await restricted.query<{
        has_atomic_execute: boolean;
        find_removed: boolean;
        touch_removed: boolean;
        has_table_access: boolean;
      }>(
        `SELECT
           pg_catalog.has_function_privilege(current_user,'browser_security.authenticate_session(text,bigint)','EXECUTE') AS has_atomic_execute,
           pg_catalog.to_regprocedure('browser_security.find_session(text)') IS NULL AS find_removed,
           pg_catalog.to_regprocedure('browser_security.touch_session(text,timestamptz,timestamptz)') IS NULL AS touch_removed,
           pg_catalog.has_table_privilege(current_user,'public.browser_sessions','SELECT,INSERT,UPDATE,DELETE') AS has_table_access`
      );
      expect(privileges.rows[0]).toEqual({ has_atomic_execute: true, find_removed: true, touch_removed: true, has_table_access: false });
    } finally {
      await restricted.end();
    }
  });

  it('denies direct canonical table reads and writes to the BFF session principal', async () => {
    const restricted = await connected();
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
