import { Suspense } from 'react';

import { ExternalAccessPortal } from './portal-client';

export default function ExternalAccessPage() {
  return (
    <Suspense fallback={<ExternalAccessLoading />}>
      <ExternalAccessPortal />
    </Suspense>
  );
}

function ExternalAccessLoading() {
  return (
    <div className="min-h-dvh bg-paper p-6 text-ink">
      <div className="mx-auto max-w-4xl rounded-3xl border border-border/10 bg-surface1 p-6 shadow-soft dark:shadow-softDark">
        <div className="text-sm text-muted">Loading scoped access...</div>
      </div>
    </div>
  );
}
