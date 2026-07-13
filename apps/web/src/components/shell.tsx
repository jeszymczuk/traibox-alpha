'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from './providers';
import { Mail, Moon, Sparkles, Sun, LayoutGrid, HandCoins, ShieldCheck, Receipt, Landmark, Settings, Users, Menu, Wallet, X } from 'lucide-react';
import { useTheme } from './theme';
import { cn } from '../lib/cn';

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
  const authHref = auth.status === 'authenticated' ? '/logout' : '/login';
  const authLabel = auth.status === 'authenticated' ? 'Logout' : 'Login';
  const theme = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {menuOpen ? <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-paper/75 backdrop-blur-sm lg:hidden" onClick={() => setMenuOpen(false)} /> : null}
      <aside className={cn('fixed inset-y-0 left-0 z-40 w-[280px] -translate-x-full overflow-y-auto border-r border-border/10 bg-surface1/95 p-4 backdrop-blur transition-transform lg:sticky lg:top-0 lg:h-dvh lg:w-auto lg:translate-x-0', menuOpen && 'translate-x-0')}>
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-ink text-paper grid place-items-center">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="font-semibold leading-tight">TRAIBOX</div>
            <div className="text-xs text-muted leading-tight">Iberia pilot</div>
          </div>
          <button type="button" aria-label="Close navigation" className="ml-auto rounded-xl border border-border/10 p-2 lg:hidden" onClick={() => setMenuOpen(false)}><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-1 text-sm">
          <NavLink href="/" icon={<LayoutGrid className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>My Space</NavLink>
          <NavLink href="/alpha" icon={<Sparkles className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Internal Alpha</NavLink>
          <NavLink href="/demo" icon={<Users className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>UI Demo</NavLink>
          <NavLink href="/partner" icon={<HandCoins className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Partner Portal</NavLink>
          <div className="pt-2">
            <div className="text-xs text-muted mb-1">Workspaces</div>
            <NavLink href="/intelligence" icon={<Sparkles className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Intelligence</NavLink>
            <NavLink href="/trades" icon={<LayoutGrid className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Trades</NavLink>
            <NavLink href="/finance" icon={<HandCoins className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Finance</NavLink>
            <NavLink href="/payments" icon={<Wallet className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Payments</NavLink>
            <NavLink href="/inbox" icon={<Mail className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Inbox</NavLink>
            <NavLink href="/network" icon={<Landmark className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Network</NavLink>
            <NavLink href="/clearance" icon={<ShieldCheck className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Clearance</NavLink>
            <NavLink href="/operations-center" icon={<Receipt className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Operations Center</NavLink>
            <NavLink href="/settings" icon={<Settings className="h-4 w-4" />} onNavigate={() => setMenuOpen(false)}>Settings</NavLink>
          </div>
          <NavLink href={authHref}>{authLabel}</NavLink>
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
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border/10 bg-paper/85 px-3 backdrop-blur md:px-5">
          <div className="flex items-center gap-2"><button type="button" aria-label="Open navigation" className="rounded-xl border border-border/10 bg-surface1 p-2 lg:hidden" onClick={() => setMenuOpen(true)}><Menu className="h-4 w-4" /></button><div className="text-sm text-muted">Readiness + Execution</div></div>
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

function NavLink({ href, icon, children, onNavigate }: { href: string; icon?: React.ReactNode; children: React.ReactNode; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} onClick={onNavigate} className={cn('block rounded-xl px-3 py-2 transition hover:bg-border/5', active && 'bg-accent/10 text-accent')}>
      <span className="inline-flex items-center gap-2">
        {icon ? <span className="text-muted">{icon}</span> : null}
        {children}
      </span>
    </Link>
  );
}
