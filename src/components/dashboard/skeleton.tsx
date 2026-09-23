import { cn } from '@/lib/utils';

/**
 * Shared skeleton primitive — a pulsing slate block sized to whatever
 * container it's dropped into. Used by every dashboard widget while
 * its data fetches.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} />;
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn('border-border bg-card rounded-xl border p-5', className)}
    >
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-8 w-20" />
      <Skeleton className="mt-2 h-3 w-16" />
    </div>
  );
}
