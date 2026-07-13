'use client';

import React, { useState } from 'react';

import { clearClientSessionState, csrfTokenForRequest } from '../../lib/client-session';
import { submitExplicitLogout } from './logout-action';

export default function LogoutPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="min-h-dvh bg-paper p-6 text-ink">
      <div className="mx-auto mt-16 max-w-md rounded-3xl border border-border/10 bg-surface1 p-6 shadow-soft dark:shadow-softDark">
        <h1 className="text-xl font-semibold">Sign out of TRAIBOX?</h1>
        <p className="mt-2 text-sm text-muted">Your session remains active until you explicitly confirm.</p>
        {error ? <p role="alert" className="mt-4 text-sm text-error">{error}</p> : null}
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            disabled={busy}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            onClick={() => {
              setBusy(true);
              setError(null);
              void (async () => {
                try {
                  await submitExplicitLogout({
                    csrfToken: await csrfTokenForRequest(),
                    transport: globalThis.fetch,
                    clearClientState: clearClientSessionState,
                    navigate: () => window.location.replace('/login')
                  });
                } catch (logoutError) {
                  setError(logoutError instanceof Error ? logoutError.message : 'Logout could not be completed securely');
                  setBusy(false);
                }
              })();
            }}
          >
            {busy ? 'Signing out…' : 'Confirm sign out'}
          </button>
          <button type="button" className="rounded-xl border border-border/10 px-4 py-2 text-sm" onClick={() => window.history.back()}>
            Cancel
          </button>
        </div>
      </div>
    </main>
  );
}
