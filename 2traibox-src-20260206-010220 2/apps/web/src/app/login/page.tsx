'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '../../components/providers';
import { isSupabaseEnabled } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { Surface } from '../../components/ui/surface';
import { buttonClassName } from '../../components/ui/button';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auth.status === 'authenticated') router.replace('/');
  }, [auth.status, router]);

  const enabled = isSupabaseEnabled() && Boolean(supabase);

  return (
    <div className="min-h-dvh bg-paper text-ink p-6">
      <Surface className="max-w-md mx-auto p-6">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted mt-2">For the pilot, TRAIBOX uses Supabase Auth (magic link).</p>

        {!enabled ? (
          <div className="mt-4 rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm">
            <div className="font-medium">Supabase Auth is not configured</div>
            <div className="text-muted mt-1">
              Set <span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span> and <span className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> in your web
              env vars.
            </div>
            <div className="mt-3">
              <Link className="text-accent font-medium" href="/">
                Back to app
              </Link>
            </div>
          </div>
        ) : (
          <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!supabase) return;
              setBusy(true);
              try {
                setError(null);
                setSent(false);
                const { error } = await supabase.auth.signInWithOtp({
                  email: email.trim(),
                  options: { emailRedirectTo: `${window.location.origin}/` }
                });
                if (error) throw error;
                setSent(true);
              } catch (err: any) {
                setError(err?.message ?? 'Failed to send magic link');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="block text-sm">
              <div className="text-muted mb-1">Email</div>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full rounded-xl border border-border/10 bg-surface2 px-3 py-2"
                autoComplete="email"
                required
              />
            </label>

            <button disabled={busy} className={buttonClassName({}) + ' w-full'} type="submit">
              {busy ? 'Sending…' : 'Send magic link'}
            </button>

            {sent ? <div className="text-sm text-success">Check your email for the sign-in link.</div> : null}
            {error ? <div className="text-sm text-error">{error}</div> : null}

            <div className="text-xs text-muted pt-2">
              If you’re already signed in, go to <Link className="text-accent" href="/">My Space</Link>.
            </div>
          </form>
        )}
      </Surface>
    </div>
  );
}
