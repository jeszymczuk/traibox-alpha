'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useAuth } from '../../components/providers';
import { loadBrowserSession } from '../../lib/client-session';
import { Surface } from '../../components/ui/surface';
import { buttonClassName } from '../../components/ui/button';

export default function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [devAuthAvailable, setDevAuthAvailable] = useState(false);

  useEffect(() => {
    if (auth.status === 'authenticated') router.replace('/');
  }, [auth.status, router]);

  useEffect(() => {
    void loadBrowserSession().then((session) => setDevAuthAvailable(!session.authenticated && Boolean(session.dev_auth_available))).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-dvh bg-paper text-ink p-6">
      <Surface className="max-w-md mx-auto p-6">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted mt-2">For the pilot, TRAIBOX uses Supabase Auth (magic link).</p>

        <form
            className="mt-4 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                setError(null);
                setSent(false);
                const response = await fetch('/api/auth/sign-in', {
                  method: 'POST',
                  credentials: 'same-origin',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: email.trim(), return_to: '/' })
                });
                if (!response.ok) throw new Error('Failed to send magic link');
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

        {devAuthAvailable ? (
          <button
            className={buttonClassName({ variant: 'secondary' }) + ' mt-3 w-full'}
            type="button"
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch('/api/auth/dev', { method: 'POST', credentials: 'same-origin' });
                if (!response.ok) throw new Error('Development sign-in failed');
                window.location.replace('/');
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Development sign-in failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Continue with explicit local development access
          </button>
        ) : null}
      </Surface>
    </div>
  );
}
