'use client'

import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { buttonVariants } from '@/components/ui/button'
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
import { EmptyState } from './empty-state'
import { initialsOf } from './initials'
import { Skeleton } from './skeleton'
import { useFormatDuration } from './use-format-duration'

const WAIT_CLASS = {
  critical: 'text-status-critical',
  warning: 'text-status-warning',
  normal: 'text-muted-foreground',
} as const

const WINDOW_WARNING_MINUTES = 120

export function ReplyQueueCard({ data, now }: { data: DashboardOverview | null; now: number }) {
  const t = useTranslations('Dashboard.overview.queue')
  const formatDuration = useFormatDuration()
  const names = new Map((data?.replies.team ?? []).map((m) => [m.userId, m.name]))

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Link href="/inbox?filter=waiting" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('openInbox')}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col px-2">
        {!data ? (
          <div className="space-y-2 px-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : data.attention.queue.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={t('empty')} hint={t('emptyHint')} className="mx-2 flex-1" />
        ) : (
          <ul className="space-y-0.5">
            {data.attention.queue.map((q) => {
              const waited = minutesBetween(q.waitingSince, now)
              const windowLeft = (new Date(q.windowClosesAt).getTime() - now) / 60_000
              const name = q.contactName || q.contactPhone || t('unknownContact')
              const assignee = q.assignedAgentId ? names.get(q.assignedAgentId) : null
              return (
                <li key={q.conversationId}>
                  <Link
                    href={`/inbox?c=${q.conversationId}`}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <Avatar>
                      {q.avatarUrl ? <AvatarImage src={q.avatarUrl} alt="" /> : null}
                      <AvatarFallback className="text-xs">{initialsOf(name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{name}</p>
                      <p className="truncate text-xs text-muted-foreground">{q.preview || t('noPreview')}</p>
                      {windowLeft > 0 && windowLeft <= WINDOW_WARNING_MINUTES ? (
                        <Badge variant="outline" className="mt-1 border-status-serious/40 text-status-serious">
                          {t('windowLeft', { time: formatDuration(windowLeft) })}
                        </Badge>
                      ) : q.handedOff ? (
                        <Badge variant="secondary" className="mt-1">
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
                      <p className="truncate text-xs text-muted-foreground">
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
