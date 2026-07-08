'use client';

import Link from 'next/link';
import { AlertTriangle, Building2, Loader2, Lock } from 'lucide-react';

import { Button, buttonClassName } from './ui/button';

/**
 * Shared gate for module pages: sign-in → org selection → loading → error,
 * in that order, before rendering the workspace content. Page-specific empty
 * states (no data, not found) stay in the pages themselves.
 */
export function WorkspaceGuard({
  authStatus,
  orgId,
  loaded = true,
  error = null,
  onRetry,
  module,
  children
}: {
  authStatus: 'loading' | 'authenticated' | 'unauthenticated';
  orgId: string | null;
  loaded?: boolean;
  error?: string | null;
  onRetry?: () => void;
  module: string;
  children: React.ReactNode;
}) {
  if (authStatus === 'loading') {
    return (
      <div className="flex items-center gap-2 py-24 text-sm text-text-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking session…
      </div>
    );
  }

  if (authStatus !== 'authenticated') {
    return (
      <div className="pay-empty">
        <div className="ic">
          <Lock className="h-6 w-6" />
        </div>
        <h2>Sign in to open {module}</h2>
        <p>{module} needs an authenticated session and an organization.</p>
        <div className="pe-cta">
          <Link href="/login" className={buttonClassName()}>
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  if (!orgId) {
    return (
      <div className="pay-empty">
        <div className="ic">
          <Building2 className="h-6 w-6" />
        </div>
        <h2>Select an organization</h2>
        <p>Pick an org in the sidebar to load {module.toLowerCase()}.</p>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex items-center gap-2 py-24 text-sm text-text-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading {module.toLowerCase()}…
      </div>
    );
  }

  if (error) {
    return (
      <div className="pay-empty">
        <div className="ic">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h2>Couldn&rsquo;t load {module}</h2>
        <p>{error}</p>
        {onRetry ? (
          <div className="pe-cta">
            <Button onClick={onRetry}>Retry</Button>
          </div>
        ) : null}
      </div>
    );
  }

  return <>{children}</>;
}
