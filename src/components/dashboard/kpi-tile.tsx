'use client'

import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, Info, Minus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Change } from '@/lib/dashboard/overview'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'

const TONE_CLASS = {
  good: 'bg-status-good/12 text-status-good',
  bad: 'bg-status-critical/12 text-status-critical',
  neutral: 'bg-muted text-muted-foreground',
} as const

export function DeltaBadge({ change }: { change: Change }) {
  const t = useTranslations('Dashboard.overview.kpi')
  const Icon = change.trend === 'up' ? ArrowUp : change.trend === 'down' ? ArrowDown : Minus
  const label =
    change.percent == null
      ? change.trend === 'flat'
        ? t('noComparison')
        : t('new')
      : `${Math.abs(change.percent)}%`
  const srLabel =
    change.tone === 'good' ? t('better') : change.tone === 'bad' ? t('worse') : t('unchanged')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
        TONE_CLASS[change.tone],
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
      <span className="sr-only">{srLabel}</span>
    </span>
  )
}

export function KpiTile({
  title,
  info,
  value,
  unit,
  change,
  comparisonLabel,
  footer,
}: {
  title: string
  info: string
  value: ReactNode
  unit?: ReactNode
  change: Change
  comparisonLabel: string
  footer: ReactNode
}) {
  return (
    <Card size="sm" className="gap-2 px-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">{title}</span>
        <Tooltip>
          <TooltipTrigger
            className="inline-flex shrink-0 rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={info}
          >
            <Info className="size-3.5" />
          </TooltipTrigger>
          <TooltipContent>{info}</TooltipContent>
        </Tooltip>
      </div>
      <p className="text-2xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
        {value}
        {unit ? <span className="ml-1 text-sm font-medium text-muted-foreground">{unit}</span> : null}
      </p>
      <div className="flex items-center justify-between gap-2">
        <DeltaBadge change={change} />
        <span className="truncate text-xs text-muted-foreground">{comparisonLabel}</span>
      </div>
      {footer}
    </Card>
  )
}

export function KpiTileSkeleton() {
  return (
    <Card size="sm" className="gap-3 px-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-9 w-full" />
    </Card>
  )
}

export function TargetBar({ value, target }: { value: number | null; target: number }) {
  const t = useTranslations('Dashboard.overview.kpi')
  const max = target * 2
  const fill = value == null ? 0 : Math.min(100, (value / max) * 100)
  const onTarget = value != null && value <= target
  return (
    <div className="pt-1.5" role="img" aria-label={t('target', { minutes: target })}>
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', onTarget ? 'bg-status-good' : 'bg-status-serious')}
          style={{ width: `${fill}%` }}
        />
        <div className="absolute -inset-y-1 left-1/2 w-0.5 rounded-full bg-foreground/70" />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>0</span>
        <span>{t('target', { minutes: target })}</span>
        <span>{t('targetMax', { minutes: max })}</span>
      </div>
    </div>
  )
}
