import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  /**
   * Delta-mode secondary row: arrow + delta text. Omit when the metric
   * doesn't have a sensible comparison (e.g. total pipeline value).
   */
  delta?: {
    /** Positive / negative / zero drives arrow + color. */
    sign: number
    /** Pre-formatted delta, e.g. "+3 vs yesterday". */
    label: string
  }
  /** Used instead of `delta` when the metric has a static subtitle. */
  subtitle?: string
}

// Quiet-precision metric tile: uppercase micro-label, large tabular
// value, semantic delta. No icon chip — the number is the interface
// (docs/DESIGN.md §3).
export function MetricCard({ title, value, delta, subtitle }: MetricCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <p className="mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums text-foreground">
        {value}
      </p>
      {delta ? (
        <DeltaRow sign={delta.sign} label={delta.label} />
      ) : subtitle ? (
        <p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
    </div>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  // Delta colour is semantic (up = emerald, down = red), never the
  // accent — accent is reserved for interaction (docs/DESIGN.md §2).
  const tone =
    sign > 0
      ? 'text-emerald-600 dark:text-emerald-400'
      : sign < 0
        ? 'text-red-500 dark:text-red-400'
        : 'text-muted-foreground'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('mt-2.5 flex items-center gap-1 text-xs', tone)}>
      <Arrow className="h-3 w-3" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
