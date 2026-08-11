"use client"

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { loadActivity, loadChannelActivity, loadTodayQueue } from '@/lib/dashboard/queries'
import type {
  ActivityItem,
  ChannelActivity as ChannelActivityData,
  TodayQueueData,
  TodayQueueDeal,
} from '@/lib/dashboard/types'
import type { Deal, PipelineStage } from '@/types'

import { QuickActions } from '@/components/dashboard/quick-actions'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { ChannelActivity } from '@/components/dashboard/channel-activity'
import { TodayQueue } from '@/components/dashboard/today-queue'
import { DealForm } from '@/components/pipelines/deal-form'

import { useTranslations } from 'next-intl'

export default function DashboardPage() {
  const t = useTranslations('Dashboard.todayQueue')

  const [queue, setQueue] = useState<TodayQueueData | null>(null)
  const [queueLoading, setQueueLoading] = useState(true)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [activityLoading, setActivityLoading] = useState(true)

  // Correo y llamadas: actividad que antes vivía como dos pestañas de
  // /reports, donde eran contadores sueltos sin conectar con ningún resultado.
  const [channels, setChannels] = useState<ChannelActivityData | null>(null)
  const [channelsLoading, setChannelsLoading] = useState(true)

  // Editor de deals (DealSheet) — mismo flujo que el pipeline: clic en la
  // card de la cola abre la ventana lateral edit deal.
  const [dealFormOpen, setDealFormOpen] = useState(false)
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
  const [stages, setStages] = useState<PipelineStage[]>([])
  const [pipelineId, setPipelineId] = useState('')

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
    void loadChannelActivity(db)
      .then((c) => setChannels(c))
      .catch((err) => console.error('[dashboard] channel activity failed:', err))
      .finally(() => setChannelsLoading(false))

    void loadActivity(db, 50)
      .then((a) => setActivity(a))
      .catch((err) => console.error('[dashboard] activity failed:', err))
      .finally(() => setActivityLoading(false))

    // Stages + pipeline del editor de deals (lista completa del primer
    // pipeline, como en /pipelines).
    void (async () => {
      try {
        const db2 = createClient()
        const p = await db2
          .from('pipelines')
          .select('id')
          .order('created_at')
          .limit(1)
          .maybeSingle()
        if (!p.data) return
        setPipelineId(p.data.id)
        const s = await db2
          .from('pipeline_stages')
          .select('id, name, color, pipeline_id, position')
          .eq('pipeline_id', p.data.id)
          .order('position')
        setStages((s.data ?? []) as PipelineStage[])
      } catch (err) {
        console.error('[dashboard] deal form stages failed:', err)
      }
    })()
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // La card de la cola trae TodayQueueDeal (shape reducido); lo armamos
  // como Deal mínimo para abrir el DealSheet con los datos que trae.
  const handleEditDeal = useCallback((qd: TodayQueueDeal) => {
    const d = qd as unknown as Deal
    setEditingDeal(d)
    setDealFormOpen(true)
  }, [])

  const handleSaved = useCallback(() => {
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
      <TodayQueue
        data={queue}
        loading={queueLoading}
        onEditDeal={handleEditDeal}
      />

      {/* Quick actions */}
      <QuickActions />

      {/* Activity feed (timeline) — se mantiene debajo de la cola */}
      <ChannelActivity data={channels} loading={channelsLoading} />

      <ActivityFeed items={activity} loading={activityLoading} />

      {/* Editor de deal (DealSheet) desde la cola de hoy */}
      <DealForm
        open={dealFormOpen}
        onOpenChange={setDealFormOpen}
        deal={editingDeal}
        pipelineId={pipelineId}
        stages={stages}
        onSaved={handleSaved}
      />
    </div>
  )
}