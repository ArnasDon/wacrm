import type { CalendarEvent } from '@/lib/google-calendar/types'
import { eventEdges, isSameDay } from '@/lib/calendar/grid'

// Presentation helpers for the calendar views. All rendering is in the
// viewer's local timezone (see grid.ts) — these just format it.

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

export function formatTime(d: Date): string {
  return timeFmt.format(d)
}

/** "14:00 – 15:00" for a timed event, "Todo el día" for an all-day one,
 *  with the end date appended when it spills past `start`'s day. */
export function formatEventRange(e: CalendarEvent, allDayLabel: string): string {
  const { start, end } = eventEdges(e)
  if (e.allDay) {
    // Google's all-day end is exclusive — a one-day event ends the next
    // midnight; show just the label unless it truly spans days.
    const lastDay = new Date(end.getTime() - 1)
    if (isSameDay(start, lastDay)) return allDayLabel
    const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
    return `${allDayLabel} · ${dateFmt.format(start)} – ${dateFmt.format(lastDay)}`
  }
  if (isSameDay(start, end)) return `${formatTime(start)} – ${formatTime(end)}`
  const withDay = new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
  return `${withDay.format(start)} – ${withDay.format(end)}`
}
