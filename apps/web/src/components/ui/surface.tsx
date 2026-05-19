import { cn } from '../../lib/cn';

export function Surface({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <section
      className={cn(
        'rounded-2xl bg-surface1 border border-border/10 shadow-soft dark:shadow-softDark',
        className
      )}
    >
      {children}
    </section>
  );
}

