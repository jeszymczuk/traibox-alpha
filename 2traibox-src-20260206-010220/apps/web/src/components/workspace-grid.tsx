import { cn } from '../lib/cn';

export function WorkspaceGrid({
  left,
  right,
  className
}: {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] items-start', className)}>
      <div className="min-w-0">{left}</div>
      <div className="min-w-0 lg:sticky lg:top-6 space-y-4">{right}</div>
    </div>
  );
}

