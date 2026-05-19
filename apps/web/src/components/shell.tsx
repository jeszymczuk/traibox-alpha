'use client';

import Link from 'next/link';
import { useAuth } from './providers';
import { isSupabaseEnabled } from '../lib/auth';
import { Moon, Sparkles, Sun, LayoutGrid, HandCoins, ShieldCheck, Receipt, Landmark, Settings, Users } from 'lucide-react';
import { useTheme } from './theme';

export function AppShell({
  children,
  orgId,
  orgs,
  onOrgChange,
  headerRight
}: {
  children: React.ReactNode;
  orgId: string | null;
  orgs: Array<any>;
  onOrgChange: (id: string | null) => void;
  headerRight?: React.ReactNode;
}) {
  const auth = useAuth();
  const showAuth = isSupabaseEnabled();
  const authHref = auth.status === 'authenticated' ? '/logout' : '/login';
  const authLabel = auth.status === 'authenticated' ? 'Logout' : 'Login';
  const theme = useTheme();

  return (
    <div className="min-h-dvh grid grid-cols-[260px_1fr]">
      <aside className="border-r border-border/10 bg-surface1/60 backdrop-blur p-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-ink text-paper grid place-items-center">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold leading-tight">TRAIBOX</div>
            <div className="text-xs text-muted leading-tight">Iberia pilot</div>
          </div>
        </div>
        <div className="mt-4 space-y-1 text-sm">
          <NavLink href="/" icon={<LayoutGrid className="h-4 w-4" />}>My Space</NavLink>
          <NavLink href="/alpha" icon={<Sparkles className="h-4 w-4" />}>Internal Alpha</NavLink>
          <NavLink href="/demo" icon={<Users className="h-4 w-4" />}>UI Demo</NavLink>
          <NavLink href="/partner" icon={<HandCoins className="h-4 w-4" />}>Partner Portal</NavLink>
          <div className="pt-2">
            <div className="text-xs text-muted mb-1">Workspaces</div>
            <NavLink href="/intelligence" icon={<Sparkles className="h-4 w-4" />}>Intelligence</NavLink>
            <NavLink href="/trades" icon={<LayoutGrid className="h-4 w-4" />}>Trades</NavLink>
            <NavLink href="/finance" icon={<HandCoins className="h-4 w-4" />}>Finance</NavLink>
            <NavLink href="/network" icon={<Landmark className="h-4 w-4" />}>Network</NavLink>
            <NavLink href="/clearance" icon={<ShieldCheck className="h-4 w-4" />}>Clearance</NavLink>
            <NavLink href="/operations" icon={<Receipt className="h-4 w-4" />}>Operations Center</NavLink>
            <NavLink href="/settings" icon={<Settings className="h-4 w-4" />}>Settings</NavLink>
          </div>
          {showAuth ? <NavLink href={authHref}>{authLabel}</NavLink> : null}
          <div className="mt-3">
            <div className="text-xs text-muted mb-1">Org</div>
            <select
              value={orgId ?? ''}
              onChange={(e) => onOrgChange(e.target.value || null)}
              className="w-full rounded-xl border border-border/10 bg-surface2 px-2 py-2 text-sm"
            >
              <option value="">Select…</option>
              {orgs.map((o) => (
                <option key={o.org_id} value={o.org_id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="h-14 border-b border-border/10 bg-paper/70 backdrop-blur flex items-center justify-between px-5">
          <div className="text-sm text-muted">Chat + Cards</div>
          <div className="flex items-center gap-2">
            {headerRight}
            <button
              type="button"
              onClick={theme.toggle}
              className="inline-flex items-center justify-center h-9 w-9 rounded-xl border border-border/10 bg-surface1 hover:bg-surface2 transition"
              aria-label="Toggle theme"
            >
              {theme.theme === 'dark' ? <Sun className="h-4 w-4 text-muted" /> : <Moon className="h-4 w-4 text-muted" />}
            </button>
          </div>
        </header>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, icon, children }: { href: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl px-3 py-2 hover:bg-border/5 transition">
      <span className="inline-flex items-center gap-2">
        {icon ? <span className="text-muted">{icon}</span> : null}
        {children}
      </span>
    </Link>
  );
}
