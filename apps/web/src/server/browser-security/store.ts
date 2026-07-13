import pg from 'pg';

export type SessionKind = 'user' | 'dev' | 'partner' | 'external';

export type StoredBrowserSession = {
  sessionIdHash: string;
  kind: SessionKind;
  principalId: string;
  display: Record<string, unknown>;
  scope: Record<string, unknown>;
  credentialCiphertext: string;
  refreshCiphertext: string | null;
  credentialExpiresAt: Date | null;
  csrfTokenHash: string;
  csrfCiphertext: string;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
  replacedByHash: string | null;
};

export type StoredAuthFlow = {
  stateHash: string;
  pkceCiphertext: string;
  returnPath: string;
  expiresAt: Date;
};

export interface BrowserSessionStore {
  persistSession(row: StoredBrowserSession, replacement?: { previousHash: string; required: boolean }): Promise<boolean>;
  findSession(sessionIdHash: string): Promise<StoredBrowserSession | null>;
  touchSession(sessionIdHash: string, idleExpiresAt: Date, lastSeenAt: Date): Promise<void>;
  revokeSession(sessionIdHash: string, at: Date): Promise<void>;
  saveAuthFlow(flow: StoredAuthFlow): Promise<void>;
  consumeAuthFlow(stateHash: string, now: Date): Promise<StoredAuthFlow | null>;
  consumeExternalExchange(exchangeTokenHash: string, expiresAt: Date): Promise<boolean>;
}

type SqlClient = {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
  release(): void;
};

type SqlPool = { connect(): Promise<SqlClient> };

const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

async function transaction<T>(pool: SqlPool, fn: (client: SqlClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true), set_config('app.current_org', '', true)`, [SYSTEM_USER_ID]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function mapSession(row: Record<string, unknown>): StoredBrowserSession {
  return {
    sessionIdHash: String(row.session_id_hash),
    kind: row.auth_kind as SessionKind,
    principalId: String(row.principal_id),
    display: (row.display_json ?? {}) as Record<string, unknown>,
    scope: (row.scope_json ?? {}) as Record<string, unknown>,
    credentialCiphertext: String(row.credential_ciphertext),
    refreshCiphertext: row.refresh_ciphertext ? String(row.refresh_ciphertext) : null,
    credentialExpiresAt: row.credential_expires_at ? date(row.credential_expires_at) : null,
    csrfTokenHash: String(row.csrf_token_hash),
    csrfCiphertext: String(row.csrf_ciphertext),
    createdAt: date(row.created_at),
    lastSeenAt: date(row.last_seen_at),
    idleExpiresAt: date(row.idle_expires_at),
    absoluteExpiresAt: date(row.absolute_expires_at),
    revokedAt: row.revoked_at ? date(row.revoked_at) : null,
    replacedByHash: row.replaced_by_hash ? String(row.replaced_by_hash) : null
  };
}

export class PostgresBrowserSessionStore implements BrowserSessionStore {
  private readonly pool: SqlPool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
      max: 10,
      statement_timeout: 30_000,
      query_timeout: 30_000
    }) as unknown as SqlPool;
  }

  async persistSession(row: StoredBrowserSession, replacement?: { previousHash: string; required: boolean }): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      if (replacement) {
        const prior = await client.query(
          `UPDATE browser_sessions
           SET revoked_at=$2, replaced_by_hash=$3
           WHERE session_id_hash=$1 AND revoked_at IS NULL AND idle_expires_at>$2 AND absolute_expires_at>$2
           RETURNING session_id_hash`,
          [replacement.previousHash, row.createdAt, row.sessionIdHash]
        );
        if (replacement.required && prior.rows.length !== 1) return false;
      }
      await client.query(
        `INSERT INTO browser_sessions(
           session_id_hash, auth_kind, principal_id, display_json, scope_json,
           credential_ciphertext, refresh_ciphertext, credential_expires_at, csrf_token_hash, csrf_ciphertext,
           created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at, replaced_by_hash
         ) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          row.sessionIdHash,
          row.kind,
          row.principalId,
          JSON.stringify(row.display),
          JSON.stringify(row.scope),
          row.credentialCiphertext,
          row.refreshCiphertext,
          row.credentialExpiresAt,
          row.csrfTokenHash,
          row.csrfCiphertext,
          row.createdAt,
          row.lastSeenAt,
          row.idleExpiresAt,
          row.absoluteExpiresAt,
          row.revokedAt,
          row.replacedByHash
        ]
      );
      return true;
    });
  }

  async findSession(sessionIdHash: string): Promise<StoredBrowserSession | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query('SELECT * FROM browser_sessions WHERE session_id_hash=$1 LIMIT 1', [sessionIdHash]);
      return result.rows[0] ? mapSession(result.rows[0]) : null;
    });
  }

  async touchSession(sessionIdHash: string, idleExpiresAt: Date, lastSeenAt: Date): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `UPDATE browser_sessions SET last_seen_at=$2, idle_expires_at=LEAST($3, absolute_expires_at)
         WHERE session_id_hash=$1 AND revoked_at IS NULL`,
        [sessionIdHash, lastSeenAt, idleExpiresAt]
      );
    });
  }

  async revokeSession(sessionIdHash: string, at: Date): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query('UPDATE browser_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE session_id_hash=$1', [sessionIdHash, at]);
    });
  }

  async saveAuthFlow(flow: StoredAuthFlow): Promise<void> {
    await transaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO browser_auth_flows(state_hash, pkce_ciphertext, return_path, expires_at)
         VALUES($1,$2,$3,$4)`,
        [flow.stateHash, flow.pkceCiphertext, flow.returnPath, flow.expiresAt]
      );
    });
  }

  async consumeAuthFlow(stateHash: string, now: Date): Promise<StoredAuthFlow | null> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE browser_auth_flows SET consumed_at=$2
         WHERE state_hash=$1 AND consumed_at IS NULL AND expires_at>$2
         RETURNING state_hash, pkce_ciphertext, return_path, expires_at`,
        [stateHash, now]
      );
      const row = result.rows[0];
      return row
        ? { stateHash: String(row.state_hash), pkceCiphertext: String(row.pkce_ciphertext), returnPath: String(row.return_path), expiresAt: date(row.expires_at) }
        : null;
    });
  }

  async consumeExternalExchange(exchangeTokenHash: string, expiresAt: Date): Promise<boolean> {
    return transaction(this.pool, async (client) => {
      const result = await client.query(
        `INSERT INTO browser_external_exchanges(exchange_token_hash, expires_at) VALUES($1,$2)
         ON CONFLICT (exchange_token_hash) DO NOTHING
         RETURNING exchange_token_hash`,
        [exchangeTokenHash, expiresAt]
      );
      return result.rows.length === 1;
    });
  }
}
