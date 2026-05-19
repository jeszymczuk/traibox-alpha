'use client';

import { Loader2 } from 'lucide-react';

import { cn } from '../../lib/cn';

export type StatusTone = 'neutral' | 'success' | 'warn' | 'error' | 'loading';

export function StatusChip({ tone, label, className }: { tone: StatusTone; label: string; className?: string }) {
  const cls =
    tone === 'success'
      ? 'bg-success/10 text-success border-success/20'
      : tone === 'warn'
        ? 'bg-warn/10 text-warn border-warn/20'
        : tone === 'error'
          ? 'bg-error/10 text-error border-error/20'
          : tone === 'loading'
            ? 'bg-accent/10 text-accent border-accent/20'
            : 'bg-border/5 text-ink/70 border-border/10';

  return (
    <span className={cn('inline-flex items-center gap-2 text-xs px-2 py-1 rounded-lg border', cls, className)}>
      {tone === 'loading' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {label}
    </span>
  );
}

export function StatusDot({ tone, className }: { tone: StatusTone; className?: string }) {
  const cls =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'error'
          ? 'bg-error'
          : tone === 'loading'
            ? 'bg-accent'
            : 'bg-border/30';
  return <span className={cn('inline-block h-2 w-2 rounded-full', cls, className)} />;
}

