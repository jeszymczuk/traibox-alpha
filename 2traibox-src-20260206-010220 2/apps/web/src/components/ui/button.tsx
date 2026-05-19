'use client';

import { forwardRef } from 'react';

import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'ink' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export const buttonClassName = (opts?: { variant?: ButtonVariant; size?: ButtonSize }) => {
  const variant = opts?.variant ?? 'primary';
  const size = opts?.size ?? 'md';

  return cn(
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition',
    'focus:outline-none focus:ring-2 focus:ring-accent/60 focus:ring-offset-2 focus:ring-offset-paper',
    'disabled:opacity-50 disabled:pointer-events-none',
    size === 'sm' ? 'px-3 py-2 text-xs' : 'px-4 py-2 text-sm',
    variant === 'primary' && 'bg-accent text-white hover:bg-accent/90',
    variant === 'ink' && 'bg-ink text-paper border border-border/10 hover:bg-ink/90',
    variant === 'secondary' && 'bg-surface2 text-ink border border-border/10 hover:bg-surface2/70',
    variant === 'ghost' && 'bg-transparent text-muted hover:bg-border/5',
    variant === 'danger' && 'bg-error text-white hover:bg-error/90'
  );
};

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }
>(function Button({ className, variant, size, ...props }, ref) {
  return <button ref={ref} className={cn(buttonClassName({ variant, size }), className)} {...props} />;
});
