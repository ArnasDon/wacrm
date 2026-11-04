'use client'

import { useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { BarChart } from '@/components/tremor/bar-chart'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  bucketDate,
  busiestBucket,
  busiestHours,
  type DashboardOverview,
} from '@/lib/dashboard/overview'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

type View = 'time' | 'hours'

export function MessageVolumeCard({ data }: { data: DashboardOverview | null }) {
  const t = useTranslations('Dashboard.overview.volume')
  const format = useFormatter()
  const [view, setView] = useState<View>('time')

  const hourLabel = (hour: number) =>
    format.dateTime(new Date(2000, 0, 1, hour), { hour: 'numeric' })

  const incomingLabel = t('incoming')
  const outgoingLabel = t('outgoing')
  const averageLabel = t('averageIncoming')

  const series = data?.volume.series ?? []
  const byHour = data?.unit === 'hour'
  const totalIn = series.reduce((sum, p) => sum + p.incoming, 0)
  const totalOut = series.reduce((sum, p) => sum + p.outgoing, 0)
  const busiest = busiestBucket(series)
  const peakHours = busiestHours(data?.volume.hourly ?? [])
  const days = data?.days ?? 1

  const timeData = series.map((p) => {
    const d = bucketDate(p.t)
    return {
      label: byHour
        ? hourLabel(d.getHours())
        : format.dateTime(d, days <= 7 ? { weekday: 'short' } : { day: 'numeric', month: 'short' }),
      [incomingLabel]: p.incoming,
      [outgoingLabel]: p.outgoing,
    }
  })

  const hoursData = (data?.volume.hourly ?? []).map((count, hour) => ({
    label: hourLabel(hour),
    [averageLabel]: Math.round((count / days) * 10) / 10,
  }))

  const busiestLabel = busiest
    ? byHour
      ? hourLabel(bucketDate(busiest.t).getHours())
      : format.dateTime(bucketDate(busiest.t), { weekday: 'short', day: 'numeric', month: 'short' })
    : t('none')

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{view === 'time' ? t('description') : t('hoursDescription')}</CardDescription>
        <CardAction>
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList>
              <TabsTrigger value="time" className="px-2.5 text-xs">
                {byHour ? t('byHour') : t('byDay')}
              </TabsTrigger>
              <TabsTrigger value="hours" className="px-2.5 text-xs">
                {t('busiestHours')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {!data ? (
          <Skeleton className="h-[260px] w-full" />
        ) : totalIn + totalOut === 0 ? (
          <EmptyState icon={MessageSquare} title={t('empty')} hint={t('emptyHint')} className="flex-1" />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:flex-wrap">
              {view === 'time' ? (
                <>
                  <Stat label={incomingLabel} value={format.number(totalIn)} />
                  <Stat label={outgoingLabel} value={format.number(totalOut)} />
                  <Stat
                    label={byHour ? t('perHour') : t('perDay')}
                    value={format.number(totalIn / Math.max(1, series.length), { maximumFractionDigits: 0 })}
                  />
                  <Stat label={byHour ? t('busiestHour') : t('busiestDay')} value={busiestLabel} />
                </>
              ) : (
                <>
                  <Stat
                    label={t('peakHour')}
                    value={peakHours[0] != null ? hourLabel(peakHours[0]) : t('none')}
                  />
                  <Stat
                    label={t('secondPeak')}
                    value={peakHours[1] != null ? hourLabel(peakHours[1]) : t('none')}
                  />
                </>
              )}
            </dl>
            {view === 'time' ? (
              <BarChart
                className="min-h-[240px] flex-1"
                data={timeData}
                index="label"
                categories={[incomingLabel, outgoingLabel]}
                colors={['teal', 'violet']}
                type="stacked"
                yAxisWidth={36}
                legendPosition="right"
                valueFormatter={(v) => format.number(v)}
              />
            ) : (
              <BarChart
                className="min-h-[240px] flex-1"
                data={hoursData}
                index="label"
                categories={[averageLabel]}
                colors={['teal']}
                yAxisWidth={36}
                showLegend={false}
                valueFormatter={(v) => format.number(v, { maximumFractionDigits: 1 })}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold text-foreground tabular-nums">{value}</dd>
    </div>
  )
}
