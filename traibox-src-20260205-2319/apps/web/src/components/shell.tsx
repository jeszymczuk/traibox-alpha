'use client';

import Link from 'next/link';
import { useAuth } from './providers';
import { isSupabaseEnabled } from '../lib/auth';

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

  return (
    <div className="min-h-dvh grid grid-cols-[260px_1fr]">
      <aside className="border-r border-black/10 bg-paper/50 p-4">
        <div className="font-semibold text-lg">TRAIBOX</div>
        <div className="mt-4 space-y-1 text-sm">
          <NavLink href="/">My Space</NavLink>
          <NavLink href="/demo">UI Demo</NavLink>
          <NavLink href="/partner">Partner Portal</NavLink>
          {showAuth ? <NavLink href={authHref}>{authLabel}</NavLink> : null}
          <div className="mt-3">
            <div className="text-xs text-muted mb-1">Org</div>
            <select
              value={orgId ?? ''}
              onChange={(e) => onOrgChange(e.target.value || null)}
              className="w-full rounded-xl border border-black/10 bg-paper px-2 py-2 text-sm"
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
        <header className="h-14 border-b border-black/10 flex items-center justify-between px-5">
          <div className="text-sm text-muted">Chat + Cards MVP</div>
          {headerRight}
        </header>
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="block rounded-xl px-3 py-2 hover:bg-black/5">
      {children}
    </Link>
  );
}
