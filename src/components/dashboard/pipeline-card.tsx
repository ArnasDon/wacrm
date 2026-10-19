'use client'

import Link from 'next/link'
import { useState } from 'react'
import { AlertTriangle, GitBranch } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency } from '@/lib/currency'
import { ratio, type DashboardOverview } from '@/lib/dashboard/overview'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

export function PipelineCard({
  data,
  currency,
}: {
  data: DashboardOverview | null
  currency: string
}) {
  const t = useTranslations('Dashboard.overview.pipeline')
  const format = useFormatter()
  const [chosen, setChosen] = useState<string | null>(null)

  const pipelines = data?.pipeline.pipelines ?? []
  const pipelineId = chosen && pipelines.some((p) => p.id === chosen) ? chosen : (pipelines[0]?.id ?? null)
  const stages = (data?.pipeline.stages ?? []).filter((s) => s.pipelineId === pipelineId)
  const maxValue = Math.max(1, ...stages.map((s) => s.totalValue))
  const openValue = stages.reduce((sum, s) => sum + s.totalValue, 0)
  const openDeals = stages.reduce((sum, s) => sum + s.dealCount, 0)
  const stats = data?.pipeline.stats.find((s) => s.pipelineId === pipelineId) ?? null
  const winRate = stats ? ratio(stats.won, stats.won + stats.lost) : null
  const pipelineName = pipelines.find((p) => p.id === pipelineId)?.name

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          {pipelines.length > 1 ? (
            <Select value={pipelineId ?? ''} onValueChange={(v) => setChosen(String(v))}>
              <SelectTrigger size="sm" className="max-w-40" aria-label={t('choosePipeline')}>
                <SelectValue>{pipelineName}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Link href="/pipelines" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              {t('link')}
            </Link>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        {!data ? (
          <Skeleton className="h-44 w-full" />
        ) : openDeals === 0 ? (
          <EmptyState icon={GitBranch} title={t('empty')} hint={t('emptyHint')} className="flex-1" />
        ) : (
          <ul className="space-y-2.5">
            {stages.map((s) => (
              <li key={s.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-foreground">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{t('deals', { count: s.dealCount })}</p>
                </div>
                <div className="h-4 rounded bg-muted">
                  <div
                    className="h-full rounded bg-primary"
                    style={{ width: `${(s.totalValue / maxValue) * 100}%` }}
                  />
                </div>
                <span className="text-right font-medium text-foreground tabular-nums">
                  {formatCurrency(s.totalValue, currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {data ? (
          <div className="mt-auto space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
              <span>
                {t('open')}{' '}
                <b className="font-semibold text-foreground tabular-nums">{formatCurrency(openValue, currency)}</b>
              </span>
              <span>
                {t('winRate')}{' '}
                <b className="font-semibold text-foreground tabular-nums">
                  {winRate == null ? t('none') : format.number(winRate, { style: 'percent' })}
                </b>
              </span>
              <span>
                {t('avgToWin')}{' '}
                <b className="font-semibold text-foreground tabular-nums">
                  {stats?.avgDaysToWin == null
                    ? t('none')
                    : t('days', { count: Math.max(1, Math.round(stats.avgDaysToWin)) })}
                </b>
              </span>
            </div>
            {stats && stats.idleDeals > 0 ? (
              <Link
                href="/pipelines"
                className="flex items-center gap-1.5 text-status-serious hover:underline"
              >
                <AlertTriangle className="size-3.5" aria-hidden />
                {t('idle', { count: stats.idleDeals })}
              </Link>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
