'use client'

import Link from 'next/link'
import { useState, type ComponentType, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, Clock, MessageSquare, UserPlus } from 'lucide-react'
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
  warning: 'bg-highlight text-highlight-foreground',
  serious: 'bg-status-serious/12 text-status-serious',
  calm: 'bg-muted text-muted-foreground',
}

const TILE_CLASS =
  'group animate-rise relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-4 py-4 text-left shadow-soft ring-1 transition-all duration-300 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

const SURFACE = {
  light: 'bg-card ring-foreground/[0.06]',
  ink: 'bg-ink text-ink-foreground ring-white/5',
} as const

function TileBody({
  icon: Icon,
  tone,
  value,
  label,
  meta,
  ink = false,
}: {
  icon: ComponentType<{ className?: string }>
  tone: Tone
  value: number
  label: string
  meta: ReactNode
  ink?: boolean
}) {
  return (
    <>
      <span
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-full',
          ink && tone === 'calm' ? 'bg-white/10 text-ink-foreground' : TONE_CLASS[tone],
        )}
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'text-3xl leading-none font-light tabular-nums',
              ink ? 'text-ink-foreground' : 'text-foreground',
            )}
          >
            {value}
          </span>
          <span className={cn('truncate text-sm', ink ? 'text-ink-foreground/90' : 'text-foreground/90')}>
            {label}
          </span>
        </span>
        <span className={cn('mt-1.5 block truncate text-xs', ink ? 'text-ink-muted' : 'text-muted-foreground')}>
          {meta}
        </span>
      </span>
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-full transition-transform group-hover:rotate-45',
          ink ? 'bg-white/10 text-ink-foreground' : 'bg-muted text-foreground/70',
        )}
      >
        <ArrowUpRight className="size-4" />
      </span>
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[78px] rounded-2xl" />
        ))}
      </div>
    )
  }

  const a = data.attention
  const oldest = a.oldestWaitingSince ? formatDuration(minutesBetween(a.oldestWaitingSince, now)) : null

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* The waiting queue is the one number that matters most, so it
          gets the dark "ink" card treatment. */}
      <Link href="/inbox?filter=waiting" className={cn(TILE_CLASS, SURFACE.ink)}>
        <TileBody
          ink
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
      <Link href="/inbox?filter=unassigned" className={cn(TILE_CLASS, SURFACE.light)} style={{ animationDelay: '60ms' }}>
        <TileBody
          icon={UserPlus}
          tone={a.unassigned > 0 ? 'warning' : 'calm'}
          value={a.unassigned}
          label={t('unassigned')}
          meta={t('onlineNow', { count: onlineCount })}
        />
      </Link>
      <Link href="/inbox?filter=expiring" className={cn(TILE_CLASS, SURFACE.light)} style={{ animationDelay: '120ms' }}>
        <TileBody
          icon={Clock}
          tone={a.windowsClosing > 0 ? 'serious' : 'calm'}
          value={a.windowsClosing}
          label={t('closing')}
          meta={t('closingMeta')}
        />
      </Link>
      <button
        type="button"
        className={cn(TILE_CLASS, SURFACE.light)}
        style={{ animationDelay: '180ms' }}
        onClick={() => setFailedOpen(true)}
      >
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
