'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { clearLegacySensitiveBrowserState, loadBrowserSession } from '../lib/client-session';
import { ThemeProvider } from './theme';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
const AuthContext = createContext<{ status: AuthStatus }>({ status: 'loading' });

export function useAuth() {
  return useContext(AuthContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    void (async () => {
      clearLegacySensitiveBrowserState();
      try {
        const session = await loadBrowserSession();
        setStatus(session.authenticated ? 'authenticated' : 'unauthenticated');
      } catch {
        setStatus('unauthenticated');
      }
    })();
  }, []);

  const ctx = useMemo(() => ({ status }), [status]);

  return (
    <ThemeProvider>
      <AuthContext.Provider value={ctx}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </AuthContext.Provider>
    </ThemeProvider>
  );
}
