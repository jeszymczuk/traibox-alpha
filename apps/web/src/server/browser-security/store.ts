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

type SqlPool = {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
  end(): Promise<void>;
};

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
  private principalCheck?: Promise<void>;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 10_000),
      max: 10,
      statement_timeout: 30_000,
      query_timeout: 30_000
    }) as unknown as SqlPool;
  }

  private async ensureRestrictedPrincipal(): Promise<void> {
    this.principalCheck ??= (async () => {
      const result = await this.pool.query(
        `SELECT
           current_user AS role_name,
           role.rolcanlogin,
           role.rolsuper,
           role.rolcreatedb,
           role.rolcreaterole,
           role.rolinherit,
           role.rolreplication,
           role.rolbypassrls,
           NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership WHERE membership.member=role.oid) AS has_no_memberships
         FROM pg_catalog.pg_roles AS role
         WHERE role.rolname=current_user`
      );
      const identity = result.rows[0];
      if (
        identity?.role_name !== 'traibox_browser_session' ||
        identity.rolcanlogin !== true ||
        identity.rolsuper !== false ||
        identity.rolcreatedb !== false ||
        identity.rolcreaterole !== false ||
        identity.rolinherit !== false ||
        identity.rolreplication !== false ||
        identity.rolbypassrls !== false ||
        identity.has_no_memberships !== true
      ) {
        throw new Error('BROWSER_SESSION_DATABASE_URL did not resolve to the restricted traibox_browser_session database role');
      }
    })();
    return this.principalCheck;
  }

  private async query(sql: string, values?: unknown[]) {
    await this.ensureRestrictedPrincipal();
    return this.pool.query(sql, values);
  }

  async persistSession(row: StoredBrowserSession, replacement?: { previousHash: string; required: boolean }): Promise<boolean> {
    const result = await this.query(
      `SELECT browser_security.persist_session(
         $1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
       ) AS persisted`,
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
        row.replacedByHash,
        replacement?.previousHash ?? null,
        replacement?.required ?? false
      ]
    );
    return result.rows[0]?.persisted === true;
  }

  async findSession(sessionIdHash: string): Promise<StoredBrowserSession | null> {
    const result = await this.query('SELECT * FROM browser_security.find_session($1)', [sessionIdHash]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async touchSession(sessionIdHash: string, idleExpiresAt: Date, lastSeenAt: Date): Promise<void> {
    await this.query('SELECT browser_security.touch_session($1,$2,$3)', [sessionIdHash, idleExpiresAt, lastSeenAt]);
  }

  async revokeSession(sessionIdHash: string, at: Date): Promise<void> {
    await this.query('SELECT browser_security.revoke_session($1,$2)', [sessionIdHash, at]);
  }

  async saveAuthFlow(flow: StoredAuthFlow): Promise<void> {
    await this.query('SELECT browser_security.save_auth_flow($1,$2,$3,$4)', [flow.stateHash, flow.pkceCiphertext, flow.returnPath, flow.expiresAt]);
  }

  async consumeAuthFlow(stateHash: string, now: Date): Promise<StoredAuthFlow | null> {
    const result = await this.query('SELECT * FROM browser_security.consume_auth_flow($1,$2)', [stateHash, now]);
    const row = result.rows[0];
    return row
      ? { stateHash: String(row.state_hash), pkceCiphertext: String(row.pkce_ciphertext), returnPath: String(row.return_path), expiresAt: date(row.expires_at) }
      : null;
  }

  async consumeExternalExchange(exchangeTokenHash: string, expiresAt: Date): Promise<boolean> {
    const result = await this.query('SELECT browser_security.consume_external_exchange($1,$2) AS consumed', [exchangeTokenHash, expiresAt]);
    return result.rows[0]?.consumed === true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
