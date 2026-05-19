'use client';

import { cn } from '../lib/cn';
import { Button } from './ui/button';
import { Surface } from './ui/surface';
import { StatusChip, type StatusTone } from './ui/status';

type CardAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
};

export function TradeCard({
  icon,
  title,
  status,
  traceId,
  primary,
  secondary,
  glassBox,
  children,
  right
}: {
  icon: React.ReactNode;
  title: string;
  status: { label: string; tone: StatusTone };
  traceId?: string;
  primary: CardAction;
  secondary?: CardAction;
  glassBox?: string[];
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <Surface className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/10 flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 text-muted">{icon}</div>
          <div>
            <div className="font-semibold leading-tight">{title}</div>
            <div className="mt-1 flex items-center gap-2">
              <StatusChip tone={status.tone} label={status.label} />
              {traceId ? <span className="text-xs text-muted">#{traceId}</span> : null}
            </div>
          </div>
        </div>
        <div className="text-xs text-muted">{right ?? new Date().toLocaleTimeString()}</div>
      </div>

      <div className="px-5 py-4">{children}</div>

      {glassBox && glassBox.length > 0 ? (
        <details className="px-5 pb-4">
          <summary className="text-xs text-muted cursor-pointer select-none">Why</summary>
          <ul className="mt-2 text-xs text-muted list-disc pl-4">
            {glassBox.slice(0, 6).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="px-5 py-4 border-t border-border/10 flex items-center gap-2">
        <Action action={primary} variant="primary" />
        {secondary ? <Action action={secondary} variant="secondary" /> : null}
      </div>
    </Surface>
  );
}

function Action({ action, variant }: { action: CardAction; variant: 'primary' | 'secondary' }) {
  if (action.href) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noreferrer"
        className={cn(
          variant === 'primary' ? 'bg-ink text-paper hover:bg-ink/90' : 'bg-surface2 text-ink border border-border/10 hover:bg-surface2/70',
          'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
          action.disabled ? 'opacity-50 pointer-events-none' : ''
        )}
      >
        {action.icon}
        {action.label}
      </a>
    );
  }

  return (
    <Button
      variant={variant === 'primary' ? 'ink' : 'secondary'}
      onClick={action.onClick}
      disabled={action.disabled}
      type="button"
    >
      {action.icon}
      {action.label}
    </Button>
  );
}
