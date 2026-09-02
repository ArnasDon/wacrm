'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { CalendarEvent } from '@/lib/google-calendar/types'
import { weekDays, eventsForDay, isSameDay, eventEdges } from '@/lib/calendar/grid'
import { formatTime } from './format'

const headFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric' })

/**
 * Seven day-columns, each a time-sorted list of that day's events.
 * Deliberately not an hour-ruler grid — for a demos/meetings calendar
 * a readable per-day list carries the same information without the
 * fragility (overlap math, drag targets, scroll sync) an hour grid
 * needs.
 */
export function WeekGrid({
  anchor,
  events,
  onSelectEvent,
}: {
  anchor: Date
  events: CalendarEvent[]
  onSelectEvent: (e: CalendarEvent) => void
}) {
  const days = useMemo(() => weekDays(anchor), [anchor])
  const today = new Date()

  return (
    <div className="border-border grid grid-cols-1 overflow-hidden rounded-lg border sm:grid-cols-7">
      {days.map((day) => {
        const dayEvents = eventsForDay(events, day)
        const isToday = isSameDay(day, today)
        return (
          <div
            key={day.toISOString()}
            className="border-border min-h-40 border-b sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <div
              className={cn(
                'border-border border-b px-2 py-1.5 text-center text-xs font-medium capitalize',
                isToday ? 'bg-primary/10 text-primary' : 'bg-muted/40 text-muted-foreground',
              )}
            >
              {headFmt.format(day)}
            </div>
            <div className="space-y-1 p-1.5">
              {dayEvents.length === 0 ? (
                <div className="text-muted-foreground/60 px-1 py-2 text-center text-[11px]">–</div>
              ) : (
                dayEvents.map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onSelectEvent(e)}
                    className="bg-primary/10 text-primary hover:bg-primary/20 w-full rounded px-1.5 py-1 text-left text-[11px] leading-tight"
                    title={e.summary}
                  >
                    <div className="tabular-nums opacity-70">
                      {e.allDay ? '' : formatTime(eventEdges(e).start)}
                    </div>
                    <div className="truncate font-medium">{e.summary}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
