'use client'

import Link from 'next/link'
import { useState, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, ChevronRight, Clock, MessageSquare, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { DashboardOverview } from '@/lib/dashboard/overview'
import { minutesBetween } from '@/lib/dashboard/overview'
import { cn } from '@/lib/utils'
import { FailedMessagesDialog } from './failed-messages-dialog'
import { Skeleton } from './skeleton'
import { useFormatDuration } from './use-format-duration'

type Tone = 'critical' | 'warning' | 'serious' | 'calm'

const TONE_CLASS: Record<Tone, string> = {
  critical: 'bg-status-critical/12 text-status-critical',
  warning: 'bg-status-warning/14 text-status-warning',
  serious: 'bg-status-serious/12 text-status-serious',
  calm: 'bg-muted text-muted-foreground',
}

const TILE_CLASS =
  'group flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3 text-left ring-1 ring-foreground/10 transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function TileBody({
  icon: Icon,
  tone,
  value,
  label,
  meta,
}: {
  icon: ComponentType<{ className?: string }>
  tone: Tone
  value: number
  label: string
  meta: ReactNode
}) {
  return (
    <>
      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', TONE_CLASS[tone])}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="text-xl leading-none font-semibold text-foreground tabular-nums">{value}</span>
          <span className="truncate text-sm text-foreground/90">{label}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{meta}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </>
  )
}

export function AttentionRow({
  data,
  now,
  onlineCount,
}: {
  data: DashboardOverview | null
  now: number
  onlineCount: number
}) {
  const t = useTranslations('Dashboard.overview.attention')
  const formatDuration = useFormatDuration()
  const [failedOpen, setFailedOpen] = useState(false)

  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[66px] rounded-xl" />
        ))}
      </div>
    )
  }

  const a = data.attention
  const oldest = a.oldestWaitingSince ? formatDuration(minutesBetween(a.oldestWaitingSince, now)) : null

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Link href="/inbox?filter=waiting" className={TILE_CLASS}>
        <TileBody
          icon={MessageSquare}
          tone={a.waitingOverTarget > 0 ? 'critical' : a.waiting > 0 ? 'warning' : 'calm'}
          value={a.waiting}
          label={t('waiting')}
          meta={
            oldest
              ? t('waitingMeta', { wait: oldest, count: a.waitingOverTarget })
              : t('waitingNone')
          }
        />
      </Link>
      <Link href="/inbox?filter=unassigned" className={TILE_CLASS}>
        <TileBody
          icon={UserPlus}
          tone={a.unassigned > 0 ? 'warning' : 'calm'}
          value={a.unassigned}
          label={t('unassigned')}
          meta={t('onlineNow', { count: onlineCount })}
        />
      </Link>
      <Link href="/inbox?filter=expiring" className={TILE_CLASS}>
        <TileBody
          icon={Clock}
          tone={a.windowsClosing > 0 ? 'serious' : 'calm'}
          value={a.windowsClosing}
          label={t('closing')}
          meta={t('closingMeta')}
        />
      </Link>
      <button type="button" className={TILE_CLASS} onClick={() => setFailedOpen(true)}>
        <TileBody
          icon={AlertTriangle}
          tone={a.failed > 0 ? 'critical' : 'calm'}
          value={a.failed}
          label={t('failed')}
          meta={t('failedMeta')}
        />
      </button>
      <FailedMessagesDialog
        open={failedOpen}
        onOpenChange={setFailedOpen}
        messages={a.failedMessages}
        total={a.failed}
      />
    </div>
  )
}
