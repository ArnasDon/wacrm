// ============================================================
// Pure date-grid helpers for the calendar page. No React, no
// timezone library — the CRM calendar renders in the viewer's
// local time (owner + agents are all in one place), so plain
// `Date` arithmetic in local time is exactly right here and keeps
// this unit-testable.
// ============================================================

import type { CalendarEvent } from '@/lib/google-calendar/types'

/** Sunday-start, matching Google Calendar's own default grid. */
export const WEEK_STARTS_ON = 0

export function startOfDay(d: Date): Date {
  const out = new Date(d)
  out.setHours(0, 0, 0, 0)
  return out
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d)
  out.setMonth(out.getMonth() + n, 1)
  return out
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function startOfWeek(d: Date): Date {
  const out = startOfDay(d)
  out.setDate(out.getDate() - ((out.getDay() - WEEK_STARTS_ON + 7) % 7))
  return out
}

/** The 7 days of the week containing `anchor`. */
export function weekDays(anchor: Date): Date[] {
  const first = startOfWeek(anchor)
  return Array.from({ length: 7 }, (_, i) => addDays(first, i))
}

/**
 * The 42 days (6 weeks) of a month grid for `anchor`'s month —
 * leading/trailing days spill into the previous/next month so the
 * grid is always a full rectangle.
 */
export function monthGridDays(anchor: Date): Date[] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const gridStart = startOfWeek(firstOfMonth)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}

/** Parses an event edge — an RFC3339 `dateTime` or a bare `YYYY-MM-DD`
 *  (all-day), which `new Date()` would otherwise read as UTC midnight
 *  and shift a day in western timezones. */
export function parseEventDate(value: string, allDay: boolean): Date {
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(value)
}

export interface EventEdges {
  start: Date
  end: Date
}

export function eventEdges(e: CalendarEvent): EventEdges {
  return {
    start: parseEventDate(e.start, e.allDay),
    end: parseEventDate(e.end, e.allDay),
  }
}

/** Events that touch `day` at all (covers multi-day spans). Sorted by
 *  start, with all-day events first. */
export function eventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = startOfDay(day)
  const dayEnd = addDays(dayStart, 1)
  return events
    .filter((e) => {
      const { start, end } = eventEdges(e)
      // Google's all-day `end.date` is exclusive; timed `end` is a real
      // instant. Either way: overlaps [dayStart, dayEnd).
      return start < dayEnd && end > dayStart
    })
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return eventEdges(a).start.getTime() - eventEdges(b).start.getTime()
    })
}

/** Upcoming events from `from` onward, ascending — the agenda view's feed. */
export function upcomingEvents(events: CalendarEvent[], from: Date): CalendarEvent[] {
  return [...events]
    .filter((e) => eventEdges(e).end > from)
    .sort((a, b) => eventEdges(a).start.getTime() - eventEdges(b).start.getTime())
}

/** Groups events by calendar day (local), preserving ascending order —
 *  `{ key: 'YYYY-MM-DD', day: Date, events: [] }[]`. */
export function groupByDay(
  events: CalendarEvent[],
): { key: string; day: Date; events: CalendarEvent[] }[] {
  const groups: { key: string; day: Date; events: CalendarEvent[] }[] = []
  for (const e of events) {
    const day = startOfDay(eventEdges(e).start)
    const key = `${day.getFullYear()}-${day.getMonth() + 1}-${day.getDate()}`
    const existing = groups.find((g) => g.key === key)
    if (existing) existing.events.push(e)
    else groups.push({ key, day, events: [e] })
  }
  return groups
}
