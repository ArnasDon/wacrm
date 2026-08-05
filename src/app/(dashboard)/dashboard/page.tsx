"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadActivity, loadTodayQueue } from '@/lib/dashboard/queries'
import type { ActivityItem, TodayQueueData } from '@/lib/dashboard/types'

import { QuickActions } from '@/components/dashboard/quick-actions'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { TodayQueue } from '@/components/dashboard/today-queue'

import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('Dashboard.todayQueue')

  const [queue, setQueue] = useState<TodayQueueData | null>(null)
  const [queueLoading, setQueueLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  const loadAll = useCallback(() => {
    const db = createClient()

    // Kick everything off in parallel. Each block has its own
    // setState + finally so a slow query doesn't hold up faster
    // sections — each widget shows its own skeleton independently.
    void loadTodayQueue(db)
      .then((q) => setQueue(q))
      .catch((err) => console.error('[dashboard] today queue failed:', err))
      .finally(() => setQueueLoading(false))

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
      </div>

      {/* Cola de Hoy — la vista principal (DAD §7.4). Reemplaza el bloque
          MetricCards/charts del overview: el SDR ve "por llamar hoy",
          "esperando cliente" y "nurturing", no 12 columnas. */}
      <TodayQueue data={queue} loading={queueLoading} />

      {/* Quick actions */}
      <QuickActions />

      {/* Activity feed (timeline) — se mantiene debajo de la cola */}
      <ActivityFeed items={activity} loading={activityLoading} />
    </div>
  )
}
