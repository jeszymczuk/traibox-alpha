'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { clearAuthToken, isSupabaseEnabled, setAuthToken } from '../lib/auth';
import { supabase } from '../lib/supabase';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';
const AuthContext = createContext<{ status: AuthStatus }>({ status: 'loading' });

export function useAuth() {
  return useContext(AuthContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient());
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    if (!isSupabaseEnabled() || !supabase) {
      setStatus('authenticated');
      return;
    }

    let unsub: (() => void) | null = null;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        setAuthToken(token);
        setStatus('authenticated');
      } else {
        clearAuthToken();
        setStatus('unauthenticated');
      }

      const sub = supabase.auth.onAuthStateChange((_event, session) => {
        const next = session?.access_token;
        if (next) {
          setAuthToken(next);
          setStatus('authenticated');
        } else {
          clearAuthToken();
          setStatus('unauthenticated');
        }
      });
      unsub = () => sub.data.subscription.unsubscribe();
    })();

    return () => {
      try {
        unsub?.();
      } catch {
        // ignore
      }
    };
  }, []);

  const ctx = useMemo(() => ({ status }), [status]);

  return (
    <AuthContext.Provider value={ctx}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
}
