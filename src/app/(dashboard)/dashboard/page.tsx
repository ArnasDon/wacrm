"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  UserPlus,
  MessageCircleWarning,
  Clock,
  Tags,
} from 'lucide-react'

import {
  loadFirstResponseAvg,
  loadLeadsToday,
  loadUnansweredCount,
  loadUnclassifiedLeadsCount,
} from '@/lib/dashboard/queries'
import type { FirstResponseMetric, LeadsTodayMetric } from '@/lib/dashboard/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { AgendaWeek } from '@/components/dashboard/agenda-week'
import { TooltipProvider } from '@/components/ui/tooltip'

import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')

  const [leadsToday, setLeadsToday] = useState<LeadsTodayMetric | null>(null)
  const [leadsLoading, setLeadsLoading] = useState(true)

  const [unanswered, setUnanswered] = useState<number | null>(null)
  const [unansweredLoading, setUnansweredLoading] = useState(true)

  const [firstResponse, setFirstResponse] = useState<FirstResponseMetric | null>(null)
  const [firstResponseLoading, setFirstResponseLoading] = useState(true)

  const [unclassified, setUnclassified] = useState<number | null>(null)
  const [unclassifiedLoading, setUnclassifiedLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Each card fetches and fails independently — a slow or broken
    // query never blocks the other three skeletons from resolving.
    void loadLeadsToday(db)
      .then(setLeadsToday)
      .catch((err) => console.error('[dashboard] leads today failed:', err))
      .finally(() => setLeadsLoading(false))

    void loadUnansweredCount(db)
      .then(setUnanswered)
      .catch((err) => console.error('[dashboard] unanswered count failed:', err))
      .finally(() => setUnansweredLoading(false))

    void loadFirstResponseAvg(db)
      .then(setFirstResponse)
      .catch((err) => console.error('[dashboard] first response failed:', err))
      .finally(() => setFirstResponseLoading(false))

    void loadUnclassifiedLeadsCount(db)
      .then(setUnclassified)
      .catch((err) => console.error('[dashboard] unclassified leads failed:', err))
      .finally(() => setUnclassifiedLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* 4 KPI cards */}
      <TooltipProvider>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {leadsLoading || !leadsToday ? (
            <SkeletonCard />
          ) : (
            <MetricCard
              title={t('leadsToday')}
              value={leadsToday.current.toLocaleString()}
              icon={UserPlus}
              tint="purple"
              delta={{
                sign: leadsToday.current - leadsToday.previous,
                label: t('vsYesterday', { value: leadsDeltaValue(leadsToday) }),
              }}
            />
          )}

          {unansweredLoading || unanswered === null ? (
            <SkeletonCard />
          ) : (
            <MetricCard
              title={t('unansweredLeads')}
              value={unanswered.toLocaleString()}
              icon={MessageCircleWarning}
              tint="orange"
              highlighted
              subtitle={t('awaitingService')}
            />
          )}

          {firstResponseLoading || !firstResponse ? (
            <SkeletonCard />
          ) : (
            <MetricCard
              title={t('avgFirstResponse')}
              value={
                firstResponse.avgMinutes === null
                  ? '—'
                  : formatMinutesSeconds(firstResponse.avgMinutes)
              }
              icon={Clock}
              tint="blue"
              subtitle={t('target', { minutes: 5 })}
            />
          )}

          {unclassifiedLoading || unclassified === null ? (
            <SkeletonCard />
          ) : (
            <MetricCard
              title={t('unclassifiedLeads')}
              value={unclassified.toLocaleString()}
              icon={Tags}
              tint="amber"
              subtitle={t('needsCategorization')}
              href="/contacts?filter=unclassified"
              tooltip={t('unclassifiedLeadsTooltip')}
            />
          )}
        </div>
      </TooltipProvider>

      {/* Quick actions */}
      <QuickActions />

      {/* Agenda do dia */}
      <AgendaWeek />
    </div>
  )
}

// ------------------------------------------------------------

function leadsDeltaValue(metric: LeadsTodayMetric): string {
  const { current, previous } = metric
  if (previous === 0) return current === 0 ? '—' : `+${current}`
  const pct = Math.round(((current - previous) / previous) * 100)
  return `${pct > 0 ? '+' : ''}${pct}%`
}

function formatMinutesSeconds(avgMinutes: number): string {
  const totalSeconds = Math.round(avgMinutes * 60)
  const min = Math.floor(totalSeconds / 60)
  const sec = totalSeconds % 60
  return `${min}min ${sec}s`
}
