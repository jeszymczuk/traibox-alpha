import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

import { verifyUser } from './auth.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('verifyUser', () => {
  it('prefers authoritative Supabase user verification for modern projects', async () => {
    vi.stubEnv('AUTH_MODE', 'supabase');
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co/');
    vi.stubEnv('SUPABASE_ANON_KEY', 'publishable-key');
    vi.stubEnv('SUPABASE_JWT_SECRET', 'legacy-secret-that-must-not-be-used');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: '00000000-0000-0000-0000-0000000000aa', email: 'operator@traibox.test' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyUser('supabase-access-token')).resolves.toEqual({
      user_id: '00000000-0000-0000-0000-0000000000aa',
      email: 'operator@traibox.test'
    });
    expect(fetchMock).toHaveBeenCalledWith('https://project.supabase.co/auth/v1/user', {
      headers: { Authorization: 'Bearer supabase-access-token', apikey: 'publishable-key' }
    });
  });

  it('does not fall back to a legacy secret when authoritative verification rejects a token', async () => {
    vi.stubEnv('AUTH_MODE', 'supabase');
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_ANON_KEY', 'publishable-key');
    vi.stubEnv('SUPABASE_JWT_SECRET', 'legacy-secret');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    await expect(verifyUser('rejected-token')).rejects.toThrow('invalid token');
  });

  it('supports legacy shared-secret projects when remote auth is not configured', async () => {
    vi.stubEnv('AUTH_MODE', 'supabase');
    vi.stubEnv('SUPABASE_URL', '');
    vi.stubEnv('SUPABASE_ANON_KEY', '');
    vi.stubEnv('SUPABASE_JWT_SECRET', 'legacy-shared-secret');
    const token = await new SignJWT({ email: 'legacy@traibox.test' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('00000000-0000-0000-0000-0000000000bb')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('legacy-shared-secret'));

    await expect(verifyUser(token)).resolves.toEqual({
      user_id: '00000000-0000-0000-0000-0000000000bb',
      email: 'legacy@traibox.test'
    });
  });
});
