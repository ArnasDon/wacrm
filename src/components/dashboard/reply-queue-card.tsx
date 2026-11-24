'use client'

import Link from 'next/link'
import { ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  minutesBetween,
  waitTone,
  type DashboardOverview,
} from '@/lib/dashboard/overview'
import { cn } from '@/lib/utils'
import { initialsOf } from './initials'
import { useFormatDuration } from './use-format-duration'

const WAIT_CLASS = {
  critical: 'text-status-critical',
  warning: 'text-highlight',
  normal: 'text-ink-muted',
} as const

const WINDOW_WARNING_MINUTES = 120

// The reply queue is rendered as the dark "ink" feature card: it is
// the list a teammate works through, so it gets the strongest contrast.
export function ReplyQueueCard({ data, now }: { data: DashboardOverview | null; now: number }) {
  const t = useTranslations('Dashboard.overview.queue')
  const formatDuration = useFormatDuration()
  const names = new Map((data?.replies.team ?? []).map((m) => [m.userId, m.name]))
  const queue = data?.attention.queue ?? []

  return (
    <Card className="animate-rise h-full bg-ink text-ink-foreground ring-white/5">
      <CardHeader>
        <CardTitle className="text-ink-foreground">{t('title')}</CardTitle>
        <CardDescription className="text-ink-muted">{t('description')}</CardDescription>
        <CardAction className="flex items-center gap-3">
          {data ? (
            <span className="text-3xl leading-none font-extralight tabular-nums">
              {data.attention.waiting}
            </span>
          ) : null}
          <Link
            href="/inbox?filter=waiting"
            aria-label={t('openInbox')}
            title={t('openInbox')}
            className="flex size-9 items-center justify-center rounded-full bg-highlight text-highlight-foreground transition-transform hover:rotate-45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowUpRight className="size-4" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-3">
        {!data ? (
          <div className="space-y-2 px-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 w-full animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : queue.length === 0 ? (
          <div className="mx-2 flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 py-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-highlight text-highlight-foreground">
              <CheckCircle2 className="size-5" />
            </div>
            <p className="text-sm font-medium">{t('empty')}</p>
            <p className="max-w-xs text-xs text-ink-muted">{t('emptyHint')}</p>
          </div>
        ) : (
          <ul className="space-y-1">
            {queue.map((q) => {
              const waited = minutesBetween(q.waitingSince, now)
              const windowLeft = (new Date(q.windowClosesAt).getTime() - now) / 60_000
              const name = q.contactName || q.contactPhone || t('unknownContact')
              const assignee = q.assignedAgentId ? names.get(q.assignedAgentId) : null
              return (
                <li key={q.conversationId}>
                  <Link
                    href={`/inbox?c=${q.conversationId}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Avatar className="size-10 ring-1 ring-white/10">
                      {q.avatarUrl ? <AvatarImage src={q.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="bg-white/90 text-xs text-ink">{initialsOf(name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="truncate text-xs text-ink-muted">{q.preview || t('noPreview')}</p>
                      {windowLeft > 0 && windowLeft <= WINDOW_WARNING_MINUTES ? (
                        <Badge variant="outline" className="mt-1 border-status-serious/50 text-status-serious">
                          {t('windowLeft', { time: formatDuration(windowLeft) })}
                        </Badge>
                      ) : q.handedOff ? (
                        <Badge className="mt-1 bg-highlight text-highlight-foreground">
                          {t('handedOff')}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <p
                        className={cn(
                          'text-sm font-semibold tabular-nums',
                          WAIT_CLASS[waitTone(waited, data.replyTargetMinutes)],
                        )}
                      >
                        {formatDuration(waited)}
                      </p>
                      <p className="truncate text-xs text-ink-muted">
                        {assignee ?? (q.assignedAgentId ? t('assigned') : t('unassigned'))}
                      </p>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
