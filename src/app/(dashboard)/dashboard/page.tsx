"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  UserPlus,
  MessageCircleWarning,
  Clock,
  Calendar,
} from 'lucide-react'

import {
  loadFirstResponseAvg,
  loadLeadsToday,
  loadUnansweredCount,
} from '@/lib/dashboard/queries'
import type { FirstResponseMetric, LeadsTodayMetric } from '@/lib/dashboard/types'
import { listAppointmentsByDate } from '@/lib/appointments/queries'
import { localDayKey } from '@/lib/dashboard/date-utils'
import type { Appointment } from '@/types'

import { MetricCard } from '@/components/dashboard/metric-card'
import { SkeletonCard } from '@/components/dashboard/skeleton'
import { QuickActions } from '@/components/dashboard/quick-actions'
import { AgendaToday } from '@/components/dashboard/agenda-today'

import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('Dashboard.page')

  const [leadsToday, setLeadsToday] = useState<LeadsTodayMetric | null>(null)
  const [leadsLoading, setLeadsLoading] = useState(true)

  const [unanswered, setUnanswered] = useState<number | null>(null)
  const [unansweredLoading, setUnansweredLoading] = useState(true)

  const [firstResponse, setFirstResponse] = useState<FirstResponseMetric | null>(null)
  const [firstResponseLoading, setFirstResponseLoading] = useState(true)

  const [appointmentsToday, setAppointmentsToday] = useState<Appointment[] | null>(null)
  const [appointmentsLoading, setAppointmentsLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()
    const todayKey = localDayKey(new Date())

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

    void listAppointmentsByDate(db, todayKey)
      .then(setAppointmentsToday)
      .catch((err) => console.error('[dashboard] appointments card failed:', err))
      .finally(() => setAppointmentsLoading(false))
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const nextAppointment = appointmentsToday?.[0]

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>
      </div>

      {/* 4 KPI cards */}
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

        {appointmentsLoading || appointmentsToday === null ? (
          <SkeletonCard />
        ) : (
          <MetricCard
            title={t('appointmentsToday')}
            value={
              appointmentsToday.length === 0
                ? t('noAppointments')
                : t('appointmentsCount', { count: appointmentsToday.length })
            }
            icon={Calendar}
            tint="green"
            subtitle={
              nextAppointment?.scheduled_time
                ? t('nextAt', { time: nextAppointment.scheduled_time.slice(0, 5) })
                : undefined
            }
          />
        )}
      </div>

      {/* Quick actions */}
      <QuickActions />

      {/* Agenda do dia */}
      <AgendaToday />
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
