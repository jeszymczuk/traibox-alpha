import { browserSecurityConfig, type BrowserSecurityConfig } from './config';
import { digestOpaqueToken, open, randomOpaqueToken, seal, tokenMatchesDigest } from './crypto';
import { BrowserSecurityError } from './origin';
import { PostgresBrowserSessionStore, type BrowserSessionStore, type SessionKind, type StoredBrowserSession } from './store';

export type ActiveBrowserSession = StoredBrowserSession & {
  rawSessionId: string;
  credential: string;
  refreshCredential: string | null;
  csrfToken: string;
};

export type CreatedBrowserSession = ActiveBrowserSession;

export type CreateSessionInput = {
  kind: SessionKind;
  principalId: string;
  display?: Record<string, unknown>;
  scope?: Record<string, unknown>;
  credential: string;
  refreshCredential?: string | null;
  credentialExpiresAt?: Date | null;
  absoluteExpiresAt?: Date;
};

export class BrowserSessionManager {
  constructor(
    private readonly store: BrowserSessionStore,
    private readonly config: BrowserSecurityConfig,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async create(input: CreateSessionInput, previousRawSessionId?: string | null): Promise<CreatedBrowserSession> {
    return this.persistNew(input, previousRawSessionId ? { raw: previousRawSessionId, required: false } : undefined);
  }

  async rotate(current: ActiveBrowserSession, updates: Partial<Pick<CreateSessionInput, 'credential' | 'refreshCredential' | 'credentialExpiresAt' | 'display' | 'scope'>> = {}): Promise<CreatedBrowserSession> {
    return this.persistNew(
      {
        kind: current.kind,
        principalId: current.principalId,
        display: updates.display ?? current.display,
        scope: updates.scope ?? current.scope,
        credential: updates.credential ?? current.credential,
        refreshCredential: updates.refreshCredential === undefined ? current.refreshCredential : updates.refreshCredential,
        credentialExpiresAt: updates.credentialExpiresAt === undefined ? current.credentialExpiresAt : updates.credentialExpiresAt,
        absoluteExpiresAt: current.absoluteExpiresAt
      },
      { raw: current.rawSessionId, required: true }
    );
  }

  private async persistNew(input: CreateSessionInput, replacement?: { raw: string; required: boolean }): Promise<CreatedBrowserSession> {
    const now = this.clock();
    const rawSessionId = randomOpaqueToken();
    const sessionIdHash = digestOpaqueToken(rawSessionId);
    const csrfToken = randomOpaqueToken();
    const absoluteExpiresAt = input.absoluteExpiresAt ?? new Date(now.getTime() + this.config.absoluteTtlMs);
    if (absoluteExpiresAt.getTime() <= now.getTime()) throw new BrowserSecurityError(401, 'expired_session', 'Session lifetime is already expired');
    const row: StoredBrowserSession = {
      sessionIdHash,
      kind: input.kind,
      principalId: input.principalId,
      display: input.display ?? {},
      scope: input.scope ?? {},
      credentialCiphertext: seal(input.credential, this.config.keyring, `session:${sessionIdHash}:credential`),
      refreshCiphertext: input.refreshCredential ? seal(input.refreshCredential, this.config.keyring, `session:${sessionIdHash}:refresh`) : null,
      credentialExpiresAt: input.credentialExpiresAt ?? null,
      csrfTokenHash: digestOpaqueToken(csrfToken),
      csrfCiphertext: seal(csrfToken, this.config.keyring, `session:${sessionIdHash}:csrf`),
      createdAt: now,
      lastSeenAt: now,
      idleExpiresAt: new Date(Math.min(absoluteExpiresAt.getTime(), now.getTime() + this.config.idleTtlMs)),
      absoluteExpiresAt,
      revokedAt: null,
      replacedByHash: null
    };
    const persisted = await this.store.persistSession(
      row,
      replacement ? { previousHash: digestOpaqueToken(replacement.raw), required: replacement.required } : undefined
    );
    if (!persisted) throw new BrowserSecurityError(401, 'replayed_session', 'Session rotation was rejected');
    return { ...row, rawSessionId, credential: input.credential, refreshCredential: input.refreshCredential ?? null, csrfToken };
  }

  async authenticate(rawSessionId: string | null | undefined): Promise<ActiveBrowserSession> {
    if (!rawSessionId || rawSessionId.length < 32 || rawSessionId.length > 256) throw new BrowserSecurityError(401, 'missing_session', 'Authentication required');
    const sessionIdHash = digestOpaqueToken(rawSessionId);
    const row = await this.store.findSession(sessionIdHash);
    const now = this.clock();
    if (!row || row.revokedAt) throw new BrowserSecurityError(401, 'invalid_session', 'Authentication required');
    if (row.idleExpiresAt.getTime() <= now.getTime() || row.absoluteExpiresAt.getTime() <= now.getTime()) {
      await this.store.revokeSession(sessionIdHash, now);
      throw new BrowserSecurityError(401, 'expired_session', 'Session expired');
    }
    try {
      const credential = open(row.credentialCiphertext, this.config.keyring, `session:${sessionIdHash}:credential`);
      const refreshCredential = row.refreshCiphertext ? open(row.refreshCiphertext, this.config.keyring, `session:${sessionIdHash}:refresh`) : null;
      const csrfToken = open(row.csrfCiphertext, this.config.keyring, `session:${sessionIdHash}:csrf`);
      await this.store.touchSession(sessionIdHash, new Date(now.getTime() + this.config.idleTtlMs), now);
      return { ...row, rawSessionId, credential, refreshCredential, csrfToken };
    } catch {
      await this.store.revokeSession(sessionIdHash, now);
      throw new BrowserSecurityError(401, 'invalid_session', 'Authentication required');
    }
  }

  validateCsrf(session: ActiveBrowserSession, supplied: string | null): void {
    if (!supplied) throw new BrowserSecurityError(403, 'missing_csrf', 'CSRF token is required');
    if (!tokenMatchesDigest(supplied, session.csrfTokenHash)) throw new BrowserSecurityError(403, 'invalid_csrf', 'CSRF token is invalid or stale');
  }

  async revoke(rawSessionId: string | null | undefined): Promise<void> {
    if (!rawSessionId) return;
    await this.store.revokeSession(digestOpaqueToken(rawSessionId), this.clock());
  }

  async saveAuthFlow(state: string, pkceStorage: Record<string, string>, returnPath: string): Promise<void> {
    const stateHash = digestOpaqueToken(state);
    await this.store.saveAuthFlow({
      stateHash,
      pkceCiphertext: seal(JSON.stringify(pkceStorage), this.config.keyring, `auth-flow:${stateHash}`),
      returnPath,
      expiresAt: new Date(this.clock().getTime() + 10 * 60_000)
    });
  }

  async consumeAuthFlow(state: string): Promise<{ pkceStorage: Record<string, string>; returnPath: string }> {
    if (!state || state.length < 32 || state.length > 256) throw new BrowserSecurityError(400, 'invalid_callback_state', 'Sign-in state is invalid');
    const stateHash = digestOpaqueToken(state);
    const flow = await this.store.consumeAuthFlow(stateHash, this.clock());
    if (!flow) throw new BrowserSecurityError(400, 'invalid_callback_state', 'Sign-in state is invalid or expired');
    try {
      const parsed = JSON.parse(open(flow.pkceCiphertext, this.config.keyring, `auth-flow:${stateHash}`)) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== 'string')) throw new Error('invalid PKCE storage');
      return { pkceStorage: parsed as Record<string, string>, returnPath: flow.returnPath };
    } catch {
      throw new BrowserSecurityError(400, 'invalid_callback_state', 'Sign-in state is invalid or expired');
    }
  }

  async consumeExternalExchange(rawToken: string, expiresAt: Date): Promise<void> {
    if (!rawToken || rawToken.length < 20 || rawToken.length > 512) throw new BrowserSecurityError(401, 'invalid_exchange', 'External access exchange is invalid');
    const consumed = await this.store.consumeExternalExchange(digestOpaqueToken(rawToken), expiresAt);
    if (!consumed) throw new BrowserSecurityError(401, 'replayed_exchange', 'External access exchange has already been used');
  }
}

let manager: BrowserSessionManager | undefined;

export function browserSessionManager(): BrowserSessionManager {
  const config = browserSecurityConfig();
  manager ??= new BrowserSessionManager(new PostgresBrowserSessionStore(config.databaseUrl), config);
  return manager;
}

export function resetBrowserSessionManagerForTests(): void {
  manager = undefined;
}
