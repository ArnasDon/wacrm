"use client"

import { Clock } from 'lucide-react'
import { DOW_SHORT_MON_FIRST } from '@/lib/dashboard/date-utils'
import type { ResponseTimeSummary } from '@/lib/dashboard/types'
import { BarChart } from '@/components/tremor/bar-chart'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'

interface ResponseTimeChartProps {
  data: ResponseTimeSummary | null
  loading: boolean
  /** Minutes. Surfaced as a "target" pill in the header. The
   *  hand-rolled SVG version drew this as a horizontal dashed
   *  line on the chart; Tremor BarChart doesn't expose Recharts
   *  primitives, so we promote it to the header for now. A
   *  follow-up can introduce an overlay or extend the vendored
   *  BarChart with a `referenceLines` prop. */
  thresholdMinutes?: number
}

import { useTranslations } from 'next-intl'

// Single category, single colour — the data is "average minutes
// per weekday". Tremor expects categories as the second tuple in
// the row object, so we shape the buckets into
// `{ day: 'Mon', 'Avg minutes': 4.2 }` rows below.
const CATEGORY = 'Avg minutes'

export function ResponseTimeChart({
  data,
  loading,
  thresholdMinutes = 5,
}: ResponseTimeChartProps) {
  const t = useTranslations('Dashboard.responseTimeChart')
  const hasData = data?.buckets.some((b) => b.avgMinutes != null) ?? false

  // Map buckets → Tremor rows. Null `avgMinutes` (no samples)
  // collapses to 0; the chart will render an empty slot for it.
  // We attach `samples` on the row so a future customTooltip can
  // surface "no samples" copy without losing the data shape.
  const chartData =
    data?.buckets.map((b, i) => ({
      day: DOW_SHORT_MON_FIRST[i],
      [CATEGORY]: b.avgMinutes ?? 0,
      samples: b.samples,
    })) ?? []

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <div className="flex items-center gap-3 text-right text-xs">
          {thresholdMinutes > 0 && (
            <span className="rounded-full border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-medium text-rose-300 tabular-nums">
              {t('target', { minutes: thresholdMinutes })}
            </span>
          )}
          {data && (data.thisWeekAvg != null || data.lastWeekAvg != null) && (
            <div>
              <div className="text-muted-foreground">
                {t('thisWeek')}{' '}
                <span className="font-medium text-foreground tabular-nums">
                  {fmt(data.thisWeekAvg)}
                </span>
              </div>
              <div className="text-muted-foreground">
                {t('lastWeek')}{' '}
                <span className="tabular-nums">{fmt(data.lastWeekAvg)}</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[260px] w-full" />
        ) : !hasData ? (
          <EmptyState
            icon={Clock}
            title={t('noReplies')}
            hint={t('noRepliesHint')}
          />
        ) : (
          <BarChart
            data={chartData}
            index="day"
            categories={[CATEGORY]}
            // 'violet' maps to Tailwind's `fill-violet-500` — matches
            // the brand accent the hand-rolled bars used (#7c3aed).
            colors={['violet']}
            valueFormatter={(value) => `${value.toFixed(1)}m`}
            showLegend={false}
            yAxisWidth={48}
            // Compact height so the chart sits well inside the card
            // without dominating the row alongside the donut + activity feed.
            className="h-[260px]"
          />
        )}
      </div>
    </section>
  )
}

function fmt(mins: number | null): string {
  if (mins == null) return '—'
  if (mins < 1) return `${Math.max(1, Math.round(mins * 60))}s`
  if (mins < 60) return `${mins.toFixed(1)}m`
  return `${(mins / 60).toFixed(1)}h`
}
