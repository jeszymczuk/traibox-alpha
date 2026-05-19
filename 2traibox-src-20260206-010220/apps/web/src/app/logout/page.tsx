'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { clearAuthToken } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export default function LogoutPage() {
  const router = useRouter();
  useEffect(() => {
    void (async () => {
      try {
        await supabase?.auth.signOut();
      } finally {
        clearAuthToken();
        router.replace('/login');
      }
    })();
  }, [router]);

  return <div className="min-h-dvh bg-paper text-ink p-6">Signing out…</div>;
}

