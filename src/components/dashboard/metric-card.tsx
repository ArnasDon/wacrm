import Link from 'next/link'
import { ArrowDown, ArrowUp, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type MetricCardTint = 'purple' | 'orange' | 'blue' | 'green' | 'amber'

const TINT_ICON_CLASSES: Record<MetricCardTint, string> = {
  purple: 'bg-primary/10 text-primary',
  orange: 'bg-orange-500/10 text-orange-500',
  blue: 'bg-blue-500/10 text-blue-500',
  green: 'bg-emerald-500/10 text-emerald-500',
  amber: 'bg-amber-500/10 text-amber-500',
}

const TINT_HIGHLIGHT_CLASSES: Record<MetricCardTint, string> = {
  purple: 'border-primary/40 bg-primary/5',
  orange: 'border-orange-500/40 bg-orange-500/5',
  blue: 'border-blue-500/40 bg-blue-500/5',
  green: 'border-emerald-500/40 bg-emerald-500/5',
  amber: 'border-amber-500/40 bg-amber-500/5',
}

interface MetricCardProps {
  title: string
  /** Pre-formatted value for display (e.g. "42" or "$1,250"). */
  value: string
  icon: ComponentType<{ className?: string }>
  /** Icon background/text color. Defaults to the neutral muted style. */
  tint?: MetricCardTint
  /**
   * Extra visual weight (tinted border + background) for the one KPI
   * that most needs attention at a glance — e.g. unanswered leads.
   */
  highlighted?: boolean
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
  /** Makes the whole card a link — e.g. drilling into a filtered list. */
  href?: string
  /**
   * Discreet hover tooltip explaining how the metric is computed.
   * Requires an ancestor `<TooltipProvider>` (base-ui) — wrap the
   * card grid, not each card individually.
   */
  tooltip?: string
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  tint,
  highlighted,
  delta,
  subtitle,
  href,
  tooltip,
}: MetricCardProps) {
  const cardClassName = cn(
    'block rounded-xl border border-border bg-card p-5',
    href && 'transition-colors hover:border-muted-foreground/40',
    highlighted && tint && TINT_HIGHLIGHT_CLASSES[tint],
  )

  const body = (
    <>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <div
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg',
            tint ? TINT_ICON_CLASSES[tint] : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 break-words text-2xl leading-tight font-bold tabular-nums text-foreground sm:text-[28px]">
        {value}
      </p>
      {delta ? <DeltaRow sign={delta.sign} label={delta.label} /> : subtitle ? (
        <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>
      ) : null}
    </>
  )

  if (!tooltip) {
    return href ? (
      <Link href={href} className={cardClassName}>
        {body}
      </Link>
    ) : (
      <div className={cardClassName}>{body}</div>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={href ? <Link href={href} className={cardClassName} /> : <div className={cardClassName} />}
      >
        {body}
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

function DeltaRow({ sign, label }: { sign: number; label: string }) {
  const tone =
    sign > 0
      ? 'text-primary'
      : sign < 0
      ? 'text-red-400'
      : 'text-muted-foreground'
  const Arrow = sign > 0 ? ArrowUp : sign < 0 ? ArrowDown : Minus
  return (
    <div className={cn('mt-2 flex items-center gap-1 text-sm', tone)}>
      <Arrow className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{label}</span>
    </div>
  )
}
