'use client';

import { useEffect } from 'react';

import { clearClientSessionState, csrfTokenForRequest } from '../../lib/client-session';

export default function LogoutPage() {
  useEffect(() => {
    void (async () => {
      try {
        const csrf = await csrfTokenForRequest();
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf } });
      } finally {
        clearClientSessionState();
        window.location.replace('/login');
      }
    })();
  }, []);

  return <div className="min-h-dvh bg-paper text-ink p-6">Signing out…</div>;
}
