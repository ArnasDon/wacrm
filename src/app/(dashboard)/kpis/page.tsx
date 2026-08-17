'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Download, Flame, Loader2, Percent, UserPlus, Wallet } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { formatCurrency } from '@/lib/currency'
import {
  daysAgoStart,
  formatDateRangeLabel,
  granularityForRangeDays,
  startOfLocalDay,
} from '@/lib/dashboard/date-utils'
import { loadKpiDataset, saveSpendForWindow, countWonDealsInWindow } from '@/lib/kpis/queries'
import {
  cac,
  conversionRate,
  conversionRateSeries,
  countQualifiedLeads,
  leadsSeries,
  periodDelta,
  qualifiedLeadsSeries,
  wonDealsSeries,
} from '@/lib/kpis/compute'
import { downloadKpiExcel } from '@/lib/kpis/export-excel'
import type { DateWindow, KpiDataset } from '@/lib/kpis/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { BarChart } from '@/components/tremor/bar-chart'
import { ChartSection } from '@/components/kpis/chart-section'
import { KpiLineChart } from '@/components/kpis/kpi-line-chart'
import { KpiDonutChart } from '@/components/kpis/kpi-donut-chart'
import { KpiFunnelChart } from '@/components/kpis/kpi-funnel-chart'
import { SpendInputCard } from '@/components/kpis/spend-input-card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type RangeDays = 7 | 30 | 90 | 365
const RANGE_OPTIONS: RangeDays[] = [7, 30, 90, 365]

function windowFor(range: RangeDays): DateWindow {
  return { start: daysAgoStart(range - 1), end: startOfLocalDay() }
}
function previousWindowFor(range: RangeDays): DateWindow {
  return { start: daysAgoStart(range * 2 - 1), end: daysAgoStart(range) }
}

interface CacHistoryPoint {
  label: string
  spend: number
  cac: number | null
}

export default function KpisPage() {
  const t = useTranslations('Kpis')
  const { user, accountId, canEditSettings, defaultCurrency, profileLoading } = useAuth()

  const [range, setRange] = useState<RangeDays>(30)
  const [dataset, setDataset] = useState<KpiDataset | null>(null)
  const [loading, setLoading] = useState(true)
  const [cacHistory, setCacHistory] = useState<CacHistoryPoint[]>([])
  const [savingSpend, setSavingSpend] = useState(false)
  const [exporting, setExporting] = useState(false)

  const granularity = granularityForRangeDays(range)

  const load = useCallback(() => {
    setLoading(true)
    const db = createClient()
    const window = windowFor(range)
    const previousWindow = previousWindowFor(range)

    loadKpiDataset(db, window, previousWindow, granularity)
      .then(async (ds) => {
        setDataset(ds)
        if (ds.spendHistory.length === 0) {
          setCacHistory([])
          return
        }
        // CAC per saved period needs that period's own won-deal count,
        // not just the currently-viewed window's — a small bounded
        // set of extra queries (one per spend entry an admin has ever
        // logged), fetched after the main dataset so it never blocks
        // the rest of the page from rendering.
        const counts = await Promise.all(
          ds.spendHistory.map((entry) =>
            countWonDealsInWindow(db, {
              start: new Date(`${entry.period_start}T00:00:00`),
              end: new Date(`${entry.period_end}T00:00:00`),
            }),
          ),
        )
        setCacHistory(
          ds.spendHistory.map((entry, i) => ({
            label: formatDateRangeLabel(new Date(`${entry.period_start}T00:00:00`), new Date(`${entry.period_end}T00:00:00`)),
            spend: entry.amount,
            cac: cac(entry.amount, counts[i]),
          })),
        )
      })
      .catch((err) => {
        console.error('[kpis] load failed:', err)
        toast.error(t('loadFailed'))
      })
      .finally(() => setLoading(false))
  }, [range, granularity, t])

  useEffect(() => {
    load()
  }, [load])

  const handleSaveSpend = useCallback(
    async (amount: number) => {
      if (!accountId || !user || !dataset) return
      setSavingSpend(true)
      try {
        const db = createClient()
        await saveSpendForWindow(db, accountId, user.id, dataset.window, amount, defaultCurrency)
        toast.success(t('cac.saveSuccess'))
        load()
      } catch (err) {
        console.error('[kpis] save spend failed:', err)
        toast.error(t('cac.saveFailed'))
      } finally {
        setSavingSpend(false)
      }
    },
    [accountId, user, dataset, defaultCurrency, t, load],
  )

  const handleExport = useCallback(async () => {
    if (!dataset) return
    setExporting(true)
    try {
      await downloadKpiExcel(dataset, defaultCurrency, granularity)
    } catch (err) {
      console.error('[kpis] export failed:', err)
      toast.error(t('exportFailed'))
    } finally {
      setExporting(false)
    }
  }, [dataset, defaultCurrency, granularity, t])

  const derived = useMemo(() => {
    if (!dataset) return null
    const leadsCount = dataset.leads.length
    const qualifiedCount = countQualifiedLeads(dataset.leads)
    const wonCount = dataset.wonDeals.length
    const rate = conversionRate(wonCount, leadsCount)
    const previousRate = conversionRate(dataset.previousWonCount, dataset.previousLeadsCount)
    const spend = dataset.currentPeriodSpend?.amount ?? null
    const cacValue = spend != null ? cac(spend, wonCount) : null

    return {
      leadsCount,
      qualifiedCount,
      wonCount,
      rate,
      previousRate,
      cacValue,
      leadsSeries: leadsSeries(dataset.leads, dataset.window, dataset.granularity),
      qualifiedSeries: qualifiedLeadsSeries(dataset.leads, dataset.window, dataset.granularity),
      conversionSeries: conversionRateSeries(dataset.leads, dataset.wonDeals, dataset.window, dataset.granularity),
      wonSeries: wonDealsSeries(dataset.wonDeals, dataset.window, dataset.granularity),
      funnel: [
        { name: t('funnel.leads'), value: leadsCount, color: '#3b82f6' },
        { name: t('funnel.qualified'), value: qualifiedCount, color: '#f59e0b' },
        { name: t('funnel.won'), value: wonCount, color: '#10b981' },
      ],
      temperature: [
        { name: t('temperature.hot'), value: dataset.temperature.hot, color: '#ef4444' },
        { name: t('temperature.warm'), value: dataset.temperature.warm, color: '#f59e0b' },
        { name: t('temperature.cold'), value: dataset.temperature.cold, color: '#3b82f6' },
        { name: t('temperature.unclassified'), value: dataset.temperature.unclassified, color: '#6b7280' },
      ].filter((s) => s.value > 0),
      comparison: [
        { metric: t('funnel.leads'), [t('comparison.current')]: leadsCount, [t('comparison.previous')]: dataset.previousLeadsCount },
        { metric: t('funnel.qualified'), [t('comparison.current')]: qualifiedCount, [t('comparison.previous')]: 0 },
        { metric: t('funnel.won'), [t('comparison.current')]: wonCount, [t('comparison.previous')]: dataset.previousWonCount },
      ],
    }
  }, [dataset, t])

  // ---- Access gate ------------------------------------------------
  if (profileLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }
  if (!canEditSettings) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-lg font-semibold text-foreground">{t('adminOnlyTitle')}</h1>
        <p className="max-w-sm text-sm text-muted-foreground">{t('adminOnlyHint')}</p>
      </div>
    )
  }

  const rangeLabel = (r: RangeDays) => (r === 365 ? t('rangeYear') : t('rangeDays', { count: r }))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  range === r ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {rangeLabel(r)}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || loading || !dataset}
          >
            {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            {t('downloadExcel')}
          </Button>
        </div>
      </div>

      {dataset && (
        <p className="text-xs text-muted-foreground">
          {t('periodLabel', { range: formatDateRangeLabel(dataset.window.start, dataset.window.end) })}
        </p>
      )}

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !dataset || !derived ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title={t('cards.leadsGenerated')}
              value={derived.leadsCount.toLocaleString()}
              icon={UserPlus}
              delta={periodDelta(derived.leadsCount, dataset.previousLeadsCount, t('vsPreviousPeriod'))}
            />
            <MetricCard
              title={t('cards.qualifiedLeads')}
              value={derived.qualifiedCount.toLocaleString()}
              icon={Flame}
              subtitle={t('cards.qualifiedSubtitle', { pct: derived.leadsCount > 0 ? Math.round((derived.qualifiedCount / derived.leadsCount) * 100) : 0 })}
            />
            <MetricCard
              title={t('cards.conversionRate')}
              value={derived.rate == null ? '—' : `${derived.rate.toFixed(1)}%`}
              icon={Percent}
              delta={
                derived.rate != null && derived.previousRate != null
                  ? periodDelta(derived.rate, derived.previousRate, t('vsPreviousPeriod'), { unit: 'pp', decimals: 1 })
                  : undefined
              }
              subtitle={derived.rate == null ? t('cards.noLeadsYet') : undefined}
            />
            <MetricCard
              title={t('cards.cac')}
              value={derived.cacValue == null ? '—' : formatCurrency(derived.cacValue, defaultCurrency)}
              icon={Wallet}
              subtitle={derived.cacValue == null ? t('cards.cacSubtitleMissing') : t('cards.cacSubtitle', { count: derived.wonCount })}
            />
          </>
        )}
      </div>

      {/* Trend charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSection title={t('charts.leadsGenerated')} description={t('charts.leadsGeneratedDesc')} loading={loading} empty={dataset ? derived!.leadsCount === 0 : false}>
          {derived && <KpiLineChart data={derived.leadsSeries} granularity={granularity} color="blue" />}
        </ChartSection>
        <ChartSection title={t('charts.qualifiedLeads')} description={t('charts.qualifiedLeadsDesc')} loading={loading} empty={dataset ? derived!.qualifiedCount === 0 : false}>
          {derived && <KpiLineChart data={derived.qualifiedSeries} granularity={granularity} color="amber" />}
        </ChartSection>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSection title={t('charts.conversionRate')} description={t('charts.conversionRateDesc')} loading={loading} empty={dataset ? derived!.leadsCount === 0 : false}>
          {derived && (
            <KpiLineChart
              data={derived.conversionSeries}
              granularity={granularity}
              color="emerald"
              valueFormatter={(v) => `${v.toFixed(0)}%`}
            />
          )}
        </ChartSection>
        <ChartSection
          title={t('charts.temperature')}
          description={t('charts.temperatureDesc')}
          loading={loading}
          empty={dataset ? derived!.leadsCount === 0 : false}
          bodyClassName="p-5 pb-2"
        >
          {derived && (
            <KpiDonutChart
              data={derived.temperature}
              centerValue={derived.leadsCount}
              centerLabel={t('cards.leadsGenerated')}
            />
          )}
        </ChartSection>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartSection title={t('charts.funnel')} description={t('charts.funnelDesc')} loading={loading} empty={dataset ? derived!.leadsCount === 0 : false}>
          {derived && <KpiFunnelChart stages={derived.funnel} />}
        </ChartSection>
        <ChartSection title={t('charts.comparison')} description={t('charts.comparisonDesc')} loading={loading} empty={dataset ? derived!.leadsCount === 0 && derived!.wonCount === 0 : false}>
          {derived && (
            <BarChart
              data={derived.comparison}
              index="metric"
              categories={[t('comparison.current'), t('comparison.previous')]}
              colors={['violet', 'gray']}
              showLegend
              yAxisWidth={40}
              className="h-[260px]"
            />
          )}
        </ChartSection>
      </div>

      {/* CAC */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SpendInputCard
          savedAmount={dataset?.currentPeriodSpend?.amount ?? null}
          wonCount={derived?.wonCount ?? 0}
          currency={defaultCurrency}
          saving={savingSpend}
          canEdit={canEditSettings}
          onSave={handleSaveSpend}
        />
        <ChartSection
          title={t('charts.cacHistory')}
          description={t('charts.cacHistoryDesc')}
          loading={loading}
          empty={cacHistory.length === 0}
          emptyHint={t('charts.cacHistoryEmptyHint')}
        >
          <BarChart
            data={cacHistory.map((p) => ({ period: p.label, [t('cards.cac')]: p.cac ?? 0 }))}
            index="period"
            categories={[t('cards.cac')]}
            colors={['fuchsia']}
            valueFormatter={(v) => formatCurrency(v, defaultCurrency)}
            showLegend={false}
            yAxisWidth={56}
            className="h-[260px]"
          />
        </ChartSection>
      </div>
    </div>
  )
}
