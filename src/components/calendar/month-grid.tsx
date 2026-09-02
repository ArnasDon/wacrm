'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { CalendarEvent } from '@/lib/google-calendar/types'
import {
  monthGridDays,
  eventsForDay,
  isSameDay,
  eventEdges,
  WEEK_STARTS_ON,
} from '@/lib/calendar/grid'
import { formatTime } from './format'

const MAX_CHIPS = 3

const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })

export function MonthGrid({
  anchor,
  events,
  onSelectEvent,
  onSelectDay,
}: {
  anchor: Date
  events: CalendarEvent[]
  onSelectEvent: (e: CalendarEvent) => void
  onSelectDay: (day: Date) => void
}) {
  const t = useTranslations('Calendar')
  const days = useMemo(() => monthGridDays(anchor), [anchor])
  const today = new Date()
  // Weekday headers, localized, starting on the same day as the grid.
  const weekdayLabels = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(2024, 0, 7 + ((WEEK_STARTS_ON + i) % 7)) // 2024-01-07 is a Sunday
        return weekdayFmt.format(d)
      }),
    [],
  )

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <div className="border-border grid grid-cols-7 border-b">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="text-muted-foreground bg-muted/40 px-2 py-1.5 text-center text-xs font-medium uppercase"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsForDay(events, day)
          const inMonth = day.getMonth() === anchor.getMonth()
          const isToday = isSameDay(day, today)
          const shown = dayEvents.slice(0, MAX_CHIPS)
          const overflow = dayEvents.length - shown.length

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(day)}
              className={cn(
                'border-border min-h-24 border-b border-r p-1.5 text-left align-top transition-colors last:border-r-0 [&:nth-child(7n)]:border-r-0',
                inMonth ? 'bg-card hover:bg-muted/50' : 'bg-muted/20 hover:bg-muted/40',
              )}
            >
              <div
                className={cn(
                  'mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs',
                  isToday
                    ? 'bg-primary text-primary-foreground font-semibold'
                    : inMonth
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                )}
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {shown.map((e) => (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onSelectEvent(e)
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.stopPropagation()
                        ev.preventDefault()
                        onSelectEvent(e)
                      }
                    }}
                    className="bg-primary/10 text-primary hover:bg-primary/20 truncate rounded px-1 py-0.5 text-[11px] leading-tight"
                    title={e.summary}
                  >
                    {!e.allDay ? (
                      <span className="tabular-nums opacity-70">
                        {formatTime(eventEdges(e).start)}{' '}
                      </span>
                    ) : null}
                    {e.summary}
                  </div>
                ))}
                {overflow > 0 ? (
                  <div className="text-muted-foreground px-1 text-[11px]">
                    {t('moreCount', { count: overflow })}
                  </div>
                ) : null}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
