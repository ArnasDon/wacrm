'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { useRealtime } from '@/hooks/use-realtime'
import { Button } from '@/components/ui/button'
import { loadActivity } from '@/lib/dashboard/queries'
import type { ActivityItem } from '@/lib/dashboard/types'
import {
  browserTimeZone,
  loadOverview,
  needsSetup,
  parseOverviewRange,
  type DashboardOverview,
  type OverviewRange,
} from '@/lib/dashboard/overview'
import { derivePresence } from '@/lib/presence'

import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { AttentionRow } from '@/components/dashboard/attention-row'
import { CampaignsCard } from '@/components/dashboard/campaigns-card'
import { KpiRow } from '@/components/dashboard/kpi-row'
import { MessageVolumeCard } from '@/components/dashboard/message-volume-card'
import { OverviewHeader } from '@/components/dashboard/overview-header'
import { PipelineCard } from '@/components/dashboard/pipeline-card'
import { ReplyQueueCard } from '@/components/dashboard/reply-queue-card'
import { SetupChecklist } from '@/components/dashboard/setup-checklist'
import { TeamCard } from '@/components/dashboard/team-card'

const POLL_MS = 60_000
const REALTIME_DEBOUNCE_MS = 2_000

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageInner />
    </Suspense>
  )
}

function DashboardPageInner() {
  const t = useTranslations('Dashboard.overview')
  const router = useRouter()
  const searchParams = useSearchParams()
  const range = parseOverviewRange(searchParams.get('range'))
  const { defaultCurrency, profile } = useAuth()

  const [overview, setOverview] = useState<DashboardOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())
  const requestRef = useRef(0)
  const debounceRef = useRef<number | null>(null)

  const refresh = useCallback((days: OverviewRange) => {
    const request = ++requestRef.current
    loadOverview(createClient(), days, browserTimeZone())
      .then((data) => {
        if (request !== requestRef.current) return
        setOverview(data)
        setFailed(false)
        setNow(Date.now())
      })
      .catch((err) => {
        if (request !== requestRef.current) return
        console.error('[dashboard] overview failed:', err)
        setFailed(true)
      })
  }, [])

  useEffect(() => {
    refresh(range)
  }, [range, refresh])

  useEffect(() => {
    loadActivity(createClient(), 50)
      .then(setActivity)
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))
  }, [])

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now())
      if (document.visibilityState === 'visible') refresh(range)
    }, POLL_MS)
    return () => window.clearInterval(tick)
  }, [range, refresh])

  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    },
    [],
  )

  const scheduleRefresh = useCallback(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => refresh(range), REALTIME_DEBOUNCE_MS)
  }, [range, refresh])

  useRealtime({
    channelName: 'dashboard-overview',
    onMessageEvent: scheduleRefresh,
    onConversationEvent: scheduleRefresh,
  })

  const handleRangeChange = useCallback(
    (next: OverviewRange) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('range', String(next))
      setFailed(false)
      router.replace(`/dashboard?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const data = overview?.days === range ? overview : null

  const onlineCount = useMemo(
    () =>
      (overview?.replies.team ?? []).filter(
        (m) => derivePresence(m.presence ?? undefined, m.lastSeenAt, now) === 'online',
      ).length,
    [overview, now],
  )

  if (failed && !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
        <p className="text-sm text-muted-foreground">{t('loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => refresh(range)}>
          {t('retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <OverviewHeader
        data={data}
        now={now}
        name={profile?.full_name ?? null}
        range={range}
        onRangeChange={handleRangeChange}
      />

      {data && needsSetup(data.setup) ? (
        <SetupChecklist setup={data.setup} />
      ) : (
        <>
          <AttentionRow data={data} now={now} onlineCount={onlineCount} />
          <KpiRow data={data} currency={defaultCurrency} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <MessageVolumeCard data={data} />
            <ReplyQueueCard data={data} now={now} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <PipelineCard data={data} currency={defaultCurrency} />
            <TeamCard data={data} now={now} />
            <div className="lg:col-span-2 2xl:col-span-1">
              <CampaignsCard data={data} />
            </div>
          </div>

          <ActivityFeed items={activity} loading={activityLoading} />
        </>
      )}
    </div>
  )
}
