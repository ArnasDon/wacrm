import type { ReactNode } from 'react'
import { Skeleton } from '@/components/dashboard/skeleton'
import { EmptyState } from '@/components/dashboard/empty-state'
import { cn } from '@/lib/utils'

/**
 * Shared card/header/loading/empty shell for every KPI chart — same
 * structure as the dashboard's own ResponseTimeChart (`border-border
 * bg-card` section, `border-b` header with title + description), so
 * the KPIs page visually matches the rest of the app instead of
 * introducing a second card style.
 */
export function ChartSection({
  title,
  description,
  loading,
  empty,
  emptyHint,
  headerExtra,
  className,
  bodyClassName,
  children,
}: {
  title: string
  description?: string
  loading: boolean
  /** True when there's nothing meaningful to plot. */
  empty?: boolean
  emptyHint?: string
  /** Right-aligned header slot — e.g. a small legend or total. */
  headerExtra?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section className={cn('rounded-xl border border-border bg-card', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {headerExtra}
      </header>
      <div className={cn('p-5', bodyClassName)}>
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : empty ? (
          <EmptyState title={title} hint={emptyHint} />
        ) : (
          children
        )}
      </div>
    </section>
  )
}
