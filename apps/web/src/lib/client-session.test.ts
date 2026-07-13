import { afterEach, describe, expect, it } from 'vitest';

import { clearLegacySensitiveBrowserState } from './client-session';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

describe('legacy browser state cleanup', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'localStorage');
    Reflect.deleteProperty(globalThis, 'sessionStorage');
  });

  it('removes auth, partner, Supabase, and transcript keys but preserves safe preferences', () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
    local.setItem('traibox_auth_token', 'secret');
    local.setItem('traibox_partner_token', 'secret');
    local.setItem('traibox.intel.stream.org', 'private transcript');
    local.setItem('sb-project-auth-token', 'provider session');
    local.setItem('traibox_org_id', 'safe-ui-preference');
    session.setItem('refresh_token', 'secret');
    clearLegacySensitiveBrowserState();
    expect(local.getItem('traibox_auth_token')).toBeNull();
    expect(local.getItem('traibox_partner_token')).toBeNull();
    expect(local.getItem('traibox.intel.stream.org')).toBeNull();
    expect(local.getItem('sb-project-auth-token')).toBeNull();
    expect(session.getItem('refresh_token')).toBeNull();
    expect(local.getItem('traibox_org_id')).toBe('safe-ui-preference');
  });
});
