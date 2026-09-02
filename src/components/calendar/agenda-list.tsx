'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { CalendarDays, Video, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CalendarEvent } from '@/lib/google-calendar/types'
import { upcomingEvents, groupByDay, isSameDay } from '@/lib/calendar/grid'
import { formatEventRange } from './format'

const headFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/**
 * The "próximas citas" feed — every event from `from` onward, grouped
 * by day. This is the view that most directly answers "what's coming
 * up", so it's the calendar page's default.
 */
export function AgendaList({
  events,
  from,
  onSelectEvent,
}: {
  events: CalendarEvent[]
  from: Date
  onSelectEvent: (e: CalendarEvent) => void
}) {
  const t = useTranslations('Calendar')
  const groups = useMemo(
    () => groupByDay(upcomingEvents(events, from)),
    [events, from],
  )
  const today = new Date()

  if (groups.length === 0) {
    return (
      <div className="border-border text-muted-foreground flex flex-col items-center rounded-lg border border-dashed py-16 text-sm">
        <CalendarDays className="mb-3 h-8 w-8 opacity-50" />
        {t('agendaEmpty')}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.key}>
          <h3
            className={cn(
              'mb-2 text-sm font-semibold capitalize',
              isSameDay(group.day, today) ? 'text-primary' : 'text-foreground',
            )}
          >
            {isSameDay(group.day, today) ? `${t('today')} · ` : ''}
            {headFmt.format(group.day)}
          </h3>
          <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
            {group.events.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelectEvent(e)}
                  className="hover:bg-muted/50 flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors"
                >
                  <div className="text-muted-foreground w-28 shrink-0 text-xs tabular-nums">
                    {formatEventRange(e, t('allDay'))}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground truncate text-sm font-medium">
                      {e.summary}
                    </div>
                    {e.attendees.length > 0 || e.meetLink ? (
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-3 text-xs">
                        {e.attendees.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Users className="h-3 w-3" />
                            {e.attendees.length}
                          </span>
                        ) : null}
                        {e.meetLink ? (
                          <span className="inline-flex items-center gap-1">
                            <Video className="h-3 w-3" />
                            Meet
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
