'use client';

import { type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, GitMerge, ShieldCheck } from 'lucide-react';

import { Surface } from './ui/surface';
import { cn } from '../lib/cn';

type PilotRecoveryCardProps = {
  title: string;
  summary: string;
  tone?: 'neutral' | 'warn' | 'error';
  checkpoints: string[];
  actions?: ReactNode;
};

export function PilotRecoveryCard({ title, summary, tone = 'neutral', checkpoints, actions }: PilotRecoveryCardProps) {
  const Icon = tone === 'error' ? AlertTriangle : tone === 'warn' ? GitMerge : ShieldCheck;
  return (
    <Surface
      className={cn(
        'overflow-hidden border p-5',
        tone === 'error' && 'border-error/20 bg-error/5',
        tone === 'warn' && 'border-warn/20 bg-warn/5',
        tone === 'neutral' && 'border-accent/15 bg-accent/5'
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <div
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
              tone === 'error' && 'border-error/20 bg-error/10 text-error',
              tone === 'warn' && 'border-warn/20 bg-warn/10 text-warn',
              tone === 'neutral' && 'border-accent/20 bg-accent/10 text-accent'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            Pilot recovery path
          </div>
          <h2 className="mt-3 text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{summary}</p>
          <div className="mt-4 grid gap-2 md:grid-cols-3">
            {checkpoints.map((checkpoint) => (
              <div key={checkpoint} className="flex items-start gap-2 rounded-2xl border border-border/10 bg-paper/70 px-3 py-3 text-xs leading-5 text-muted">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                <span>{checkpoint}</span>
              </div>
            ))}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
      </div>
    </Surface>
  );
}
