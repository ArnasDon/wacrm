'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'

import { buttonVariants } from '@/components/ui/button'
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DashboardOverview } from '@/lib/dashboard/overview'
import { derivePresence, type PresenceStatus } from '@/lib/presence'
import { cn } from '@/lib/utils'
import { initialsOf } from './initials'
import { Skeleton } from './skeleton'
import { useFormatDuration } from './use-format-duration'

const PRESENCE_CLASS: Record<PresenceStatus, string> = {
  online: 'bg-status-good',
  away: 'bg-status-warning',
  offline: 'bg-muted-foreground/50',
}

export function TeamCard({ data, now }: { data: DashboardOverview | null; now: number }) {
  const t = useTranslations('Dashboard.overview.team')
  const format = useFormatter()
  const formatDuration = useFormatDuration()
  const members = data?.replies.team ?? []
  const maxOpen = Math.max(1, ...members.map((m) => m.open))
  const target = data?.replyTargetMinutes ?? 5

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
        <CardAction>
          <Link href="/settings?tab=members" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            {t('link')}
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2">
        {!data ? (
          <Skeleton className="mx-2 h-40" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('member')}</TableHead>
                <TableHead className="text-right">{t('open')}</TableHead>
                <TableHead className="text-right">{t('replies')}</TableHead>
                <TableHead className="text-right">{t('median')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const presence = derivePresence(m.presence ?? undefined, m.lastSeenAt, now)
                const name = m.name || t('teammate')
                return (
                  <TableRow key={m.userId}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar size="sm">
                          {m.avatarUrl ? <AvatarImage src={m.avatarUrl} alt="" /> : null}
                          <AvatarFallback className="text-[10px]">{initialsOf(name)}</AvatarFallback>
                          <AvatarBadge className={PRESENCE_CLASS[presence]} />
                        </Avatar>
                        <span className="truncate">{name}</span>
                        <span className="sr-only">{t(`presence.${presence}`)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span className="inline-flex items-center gap-2">
                        {format.number(m.open)}
                        <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-muted sm:inline-block">
                          <span
                            className="block h-full rounded-full bg-foreground/60"
                            style={{ width: `${(m.open / maxOpen) * 100}%` }}
                          />
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{format.number(m.replies)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right tabular-nums',
                        m.medianMinutes != null && m.medianMinutes > target && 'text-status-serious',
                      )}
                    >
                      {m.medianMinutes == null ? t('none') : formatDuration(m.medianMinutes)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {data.replies.ai.replies > 0 ? (
                <TableRow>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        <AvatarFallback className="bg-primary-soft text-primary">
                          <Sparkles className="size-3" />
                        </AvatarFallback>
                      </Avatar>
                      {t('ai')}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{t('none')}</TableCell>
                  <TableCell className="text-right tabular-nums">{format.number(data.replies.ai.replies)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {data.replies.ai.medianMinutes == null ? t('none') : formatDuration(data.replies.ai.medianMinutes)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
