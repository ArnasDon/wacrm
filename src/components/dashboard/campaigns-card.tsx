'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
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
import { ratio, type DashboardOverview } from '@/lib/dashboard/overview'
import { cn } from '@/lib/utils'
import { Skeleton } from './skeleton'
import { useFormatDuration } from './use-format-duration'

type Tone = 'good' | 'warning' | 'critical' | 'muted'

const STATUS_ICON = {
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
  muted: CheckCircle2,
} as const

const STATUS_CLASS: Record<Tone, string> = {
  good: 'text-status-good',
  warning: 'text-status-warning',
  critical: 'text-status-critical',
  muted: 'text-muted-foreground',
}

function HealthRow({ label, status, tone }: { label: ReactNode; status: string; tone: Tone }) {
  const Icon = STATUS_ICON[tone]
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="min-w-0 truncate text-foreground">{label}</span>
      <span className={cn('inline-flex shrink-0 items-center gap-1 text-xs font-medium', STATUS_CLASS[tone])}>
        <Icon className="size-3.5" aria-hidden />
        {status}
      </span>
    </li>
  )
}

export function CampaignsCard({ data }: { data: DashboardOverview | null }) {
  const t = useTranslations('Dashboard.overview.campaigns')
  const format = useFormatter()
  const formatDuration = useFormatDuration()
  const percent = (v: number | null) =>
    v == null ? t('none') : format.number(v, { style: 'percent', maximumFractionDigits: 1 })

  const c = data?.campaigns
  const b = c?.latestBroadcast
  const success = c ? ratio(c.automationRuns - c.automationFailed, c.automationRuns) : null

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Link href="/broadcasts" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('link')}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!data || !c ? (
          <Skeleton className="h-44 w-full" />
        ) : (
          <>
            {b ? (
              <Link
                href={`/broadcasts/${b.id}`}
                className="block rounded-lg pb-3 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate font-medium text-foreground">{b.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('sentAt', {
                      date: format.dateTime(new Date(b.at), { day: 'numeric', month: 'short' }),
                      count: b.recipients,
                    })}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-4 gap-0.5 overflow-hidden rounded-lg text-xs">
                  {[
                    { label: t('delivered'), value: format.number(b.delivered) },
                    { label: t('read'), value: percent(ratio(b.read, b.delivered)) },
                    { label: t('replied'), value: percent(ratio(b.replied, b.delivered)) },
                    { label: t('failed'), value: format.number(b.failed) },
                  ].map((s) => (
                    <div key={s.label} className="bg-muted/60 px-2 py-1.5">
                      <dd className="text-sm font-semibold text-foreground tabular-nums">{s.value}</dd>
                      <dt className="text-muted-foreground">{s.label}</dt>
                    </div>
                  ))}
                </dl>
              </Link>
            ) : (
              <p className="pb-3 text-sm text-muted-foreground">{t('noBroadcast')}</p>
            )}
            <ul className="divide-y divide-border border-t border-border">
              <HealthRow
                label={t('automations', { count: c.automationRuns })}
                status={c.automationRuns === 0 ? t('noRuns') : t('succeeded', { percent: percent(success) })}
                tone={c.automationRuns === 0 ? 'muted' : c.automationFailed > 0 ? 'warning' : 'good'}
              />
              <HealthRow
                label={c.topFailingFlow ? t('flowNamed', { name: c.topFailingFlow.name }) : t('flows')}
                status={c.flowFailed > 0 ? t('flowFailed', { count: c.flowFailed }) : t('flowsOk')}
                tone={c.flowFailed > 0 ? 'warning' : 'good'}
              />
              <HealthRow
                label={t('aiReplies', { count: data.replies.ai.replies })}
                status={
                  data.replies.ai.medianMinutes == null
                    ? t('none')
                    : t('aiMedian', { time: formatDuration(data.replies.ai.medianMinutes) })
                }
                tone={data.replies.ai.replies > 0 ? 'good' : 'muted'}
              />
              <HealthRow
                label={t('templates', { count: c.templatesApproved })}
                status={c.templatesRejected > 0 ? t('templatesRejected', { count: c.templatesRejected }) : t('templatesOk')}
                tone={c.templatesRejected > 0 ? 'critical' : 'good'}
              />
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
