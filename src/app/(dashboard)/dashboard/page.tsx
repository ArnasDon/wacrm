"use client"

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  MessageSquare,
  UserPlus,
  DollarSign,
  Send,
  Filter,
  Clock,
  TrendingUp,
} from 'lucide-react'

import {
  loadActivity,
  loadConversationsSeries,
  loadFunnelMetrics,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  FunnelMetricsBundle,
  MetricsBundle,
  PipelineDonutData,
  ResponseTimeSummary,
} from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { ConversationsChart } from '@/components/dashboard/conversations-chart'
import { PipelineDonut } from '@/components/dashboard/pipeline-donut'
import { ResponseTimeChart } from '@/components/dashboard/response-time-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'

type RangeDays = 7 | 30 | 90

export default function DashboardPage() {
  const t = useTranslations('dashboard')
  const { defaultCurrency } = useAuth()
  const [metrics, setMetrics] = useState<MetricsBundle | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const [funnelMetrics, setFunnelMetrics] = useState<FunnelMetricsBundle | null>(null)
  const [funnelMetricsLoading, setFunnelMetricsLoading] = useState(true)

  const [range, setRange] = useState<RangeDays>(30)
  // Keep a cache per range so switching tabs doesn't re-fetch what we
  // already have. Ranges the user hasn't opened yet stay null and
  // trigger a fetch on first view.
  const [series, setSeries] = useState<Record<RangeDays, ConversationsSeriesPoint[] | null>>({
    7: null,
    30: null,
    90: null,
  })
  const [seriesLoading, setSeriesLoading] = useState(true)

  const [pipeline, setPipeline] = useState<PipelineDonutData | null>(null)
  const [pipelineLoading, setPipelineLoading] = useState(true)

  const [responseTime, setResponseTime] = useState<ResponseTimeSummary | null>(null)
  const [responseTimeLoading, setResponseTimeLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadMetrics(db)
      .then((m) => setMetrics(m))
      .catch((err) => console.error('[dashboard] metrics failed:', err))
      .finally(() => setMetricsLoading(false))

    void loadFunnelMetrics(db)
      .then((m) => setFunnelMetrics(m))
      .catch((err) => console.error('[dashboard] funnel metrics failed:', err))
      .finally(() => setFunnelMetricsLoading(false))

    void loadConversationsSeries(db, 30)
      .then((s) => setSeries((prev) => ({ ...prev, 30: s })))
      .catch((err) => console.error('[dashboard] series failed:', err))
      .finally(() => setSeriesLoading(false))

    void loadPipelineDonut(db)
      .then((p) => setPipeline(p))
      .catch((err) => console.error('[dashboard] pipeline failed:', err))
      .finally(() => setPipelineLoading(false))

    void loadResponseTime(db)
      .then((r) => setResponseTime(r))
      .catch((err) => console.error('[dashboard] response time failed:', err))
      .finally(() => setResponseTimeLoading(false))

    // Fetch up to 50 so the biggest page-size option in the feed
    // (50 rows) is already in memory — switching sizes then becomes
    // a pure client-side slice with no extra round trip.
    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Range switch handler — kept in an event callback (not an effect)
  // so the setState calls stay out of the react-hooks/set-state-in-effect
  // rule's way. The cached bucket check means switching back to a
  // previously-viewed range is instant and doesn't re-fetch.
  const handleRangeChange = useCallback(
    (r: RangeDays) => {
      setRange(r)
      if (series[r] !== null) return
      setSeriesLoading(true)
      const db = createClient()
      loadConversationsSeries(db, r)
        .then((s) => setSeries((prev) => ({ ...prev, [r]: s })))
        .catch((err) => console.error('[dashboard] series failed:', err))
        .finally(() => setSeriesLoading(false))
    },
    [series],
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('header.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('header.subtitle')}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {metricsLoading || !metrics ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('metrics.activeConversations')}
              value={metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              delta={{
                sign: metrics.activeConversations.previous,
                label: deltaLabel(
                  t,
                  metrics.activeConversations.previous,
                  t('delta.suffixNewVsYesterday'),
                ),
              }}
            />
            <MetricCard
              title={t('metrics.newContactsToday')}
              value={metrics.newContactsToday.current.toLocaleString()}
              icon={UserPlus}
              delta={{
                sign:
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                label: deltaLabel(
                  t,
                  metrics.newContactsToday.current - metrics.newContactsToday.previous,
                  t('delta.suffixVsYesterday'),
                ),
              }}
            />
            <MetricCard
              title={t('metrics.openDealsValue')}
              value={formatCurrency(metrics.openDealsValue, defaultCurrency)}
              icon={DollarSign}
              subtitle={t('metrics.openDealsSubtitle', { count: metrics.openDealsCount })}
            />
            <MetricCard
              title={t('metrics.messagesSentToday')}
              value={metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
              delta={{
                sign:
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                label: deltaLabel(
                  t,
                  metrics.messagesSentToday.current - metrics.messagesSentToday.previous,
                  t('delta.suffixVsYesterday'),
                ),
              }}
            />
          </>
        )}
      </div>

      {/* Customer journey funnel (Kanban) */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">{t('funnel.title')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {funnelMetricsLoading || !funnelMetrics ? (
            Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          ) : (
            <>
              <MetricCard
                title={t('funnel.newLeadsToday')}
                value={funnelMetrics.newLeadsToday.current.toLocaleString()}
                icon={Filter}
                delta={{
                  sign:
                    funnelMetrics.newLeadsToday.current - funnelMetrics.newLeadsToday.previous,
                  label: deltaLabel(
                    t,
                    funnelMetrics.newLeadsToday.current - funnelMetrics.newLeadsToday.previous,
                    t('delta.suffixVsYesterday'),
                  ),
                }}
              />
              <MetricCard
                title={t('funnel.stalledLeads')}
                value={funnelMetrics.stalledLeads.toLocaleString()}
                icon={Clock}
                subtitle={t('funnel.stalledLeadsSubtitle')}
              />
              <MetricCard
                title={t('funnel.conversionRate')}
                value={
                  funnelMetrics.leadConversionRate === null
                    ? '—'
                    : `${funnelMetrics.leadConversionRate.toFixed(0)}%`
                }
                icon={TrendingUp}
                subtitle={t('funnel.conversionRateSubtitle', {
                  count: funnelMetrics.leadConversionCohortSize,
                })}
              />
            </>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Charts row */}
      {/* items-stretch (the grid default) stretches the two columns to
          match the tallest sibling; adding h-full on each wrapper and
          on the inner panels makes both cards actually fill that
          stretched height so their rounded borders line up. Without
          this, the pipeline card rendered at its natural (shorter)
          height while the line chart drove the row height. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="h-full lg:col-span-3">
          <ConversationsChart
            series={series}
            loading={seriesLoading}
            range={range}
            onRangeChange={handleRangeChange}
          />
        </div>
        <div className="h-full lg:col-span-2">
          <PipelineDonut
            data={pipeline}
            loading={pipelineLoading}
            currency={defaultCurrency}
          />
        </div>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={responseTime} loading={responseTimeLoading} />

      {/* Activity feed */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}

// ------------------------------------------------------------

function deltaLabel(
  t: ReturnType<typeof useTranslations>,
  delta: number,
  suffix: string,
): string {
  if (delta === 0) return t('delta.noChange', { suffix })
  const sign = delta > 0 ? '+' : ''
  return t('delta.change', { sign, value: delta.toLocaleString(), suffix })
}
