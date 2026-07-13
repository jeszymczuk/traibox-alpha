import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import LogoutPage from './page';
import { submitExplicitLogout } from './logout-action';

describe('explicit logout', () => {
  it('does not mutate the session when the logout page is rendered or reached by GET navigation', () => {
    const transport = vi.fn();
    vi.stubGlobal('fetch', transport);
    try {
      const html = renderToStaticMarkup(<LogoutPage />);
      expect(html).toContain('Confirm sign out');
      expect(transport).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('submits the protected POST and clears client state only after explicit confirmation succeeds', async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const clearClientState = vi.fn();
    const navigate = vi.fn();
    await submitExplicitLogout({
      csrfToken: 'session-bound-csrf',
      transport: transport as typeof fetch,
      clearClientState,
      navigate
    });
    expect(transport).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': 'session-bound-csrf' } })
    );
    expect(clearClientState).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
  });
});
