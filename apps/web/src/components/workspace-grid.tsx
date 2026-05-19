import { cn } from '../lib/cn';

export function WorkspaceGrid({
  left,
  right,
  className,
  leftClassName,
  rightClassName
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
}) {
  return (
    <div className={cn('grid gap-6 items-start', className ?? 'lg:grid-cols-[minmax(0,1fr)_380px]')}>
      <div className={cn('min-w-0', leftClassName)}>{left}</div>
      <div className={cn('min-w-0 space-y-4', rightClassName ?? 'lg:sticky lg:top-6')}>{right}</div>
    </div>
  );
}
