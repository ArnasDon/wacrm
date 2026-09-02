import { describe, it, expect } from 'vitest'
import type { CalendarEvent } from '@/lib/google-calendar/types'
import {
  monthGridDays,
  weekDays,
  eventsForDay,
  upcomingEvents,
  groupByDay,
  parseEventDate,
  isSameDay,
} from './grid'

function evt(partial: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'start' | 'end' | 'allDay'>): CalendarEvent {
  return {
    summary: 'Test',
    description: null,
    location: null,
    status: 'confirmed',
    htmlLink: null,
    meetLink: null,
    attendees: [],
    organizerEmail: null,
    ...partial,
  }
}

describe('monthGridDays', () => {
  it('always returns a full 6-week rectangle starting on a Sunday', () => {
    const days = monthGridDays(new Date(2026, 8, 15)) // September 2026
    expect(days).toHaveLength(42)
    expect(days[0].getDay()).toBe(0) // Sunday
    // Sept 1 2026 is a Tuesday, so the grid starts on Aug 30.
    expect(days[0].getMonth()).toBe(7) // August
    expect(days[0].getDate()).toBe(30)
  })
})

describe('weekDays', () => {
  it('returns Sunday..Saturday for the week containing the anchor', () => {
    const days = weekDays(new Date(2026, 8, 11)) // Fri Sep 11 2026
    expect(days).toHaveLength(7)
    expect(days[0].getDay()).toBe(0)
    expect(days.some((d) => isSameDay(d, new Date(2026, 8, 11)))).toBe(true)
  })
})

describe('parseEventDate', () => {
  it('reads an all-day YYYY-MM-DD as local midnight, not UTC', () => {
    const d = parseEventDate('2026-09-11', true)
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8)
    expect(d.getDate()).toBe(11)
    expect(d.getHours()).toBe(0)
  })
})

describe('eventsForDay', () => {
  const sep11 = new Date(2026, 8, 11)

  it('includes a timed event on that calendar day', () => {
    const e = evt({ id: 'a', start: '2026-09-11T16:00:00-06:00', end: '2026-09-11T17:00:00-06:00', allDay: false })
    expect(eventsForDay([e], sep11).map((x) => x.id)).toEqual(['a'])
  })

  it('excludes an all-day event whose exclusive end is that day', () => {
    // A one-day all-day event on Sep 10 has end date 2026-09-11 (exclusive).
    const e = evt({ id: 'b', start: '2026-09-10', end: '2026-09-11', allDay: true })
    expect(eventsForDay([e], sep11)).toHaveLength(0)
    expect(eventsForDay([e], new Date(2026, 8, 10)).map((x) => x.id)).toEqual(['b'])
  })

  it('includes a multi-day span on an interior day and sorts all-day first', () => {
    const span = evt({ id: 'span', start: '2026-09-10', end: '2026-09-13', allDay: true })
    const timed = evt({ id: 'timed', start: '2026-09-11T09:00:00-06:00', end: '2026-09-11T10:00:00-06:00', allDay: false })
    const out = eventsForDay([timed, span], sep11).map((x) => x.id)
    expect(out).toEqual(['span', 'timed'])
  })
})

describe('upcomingEvents / groupByDay', () => {
  it('drops events that already ended and groups the rest by day in order', () => {
    const past = evt({ id: 'past', start: '2026-09-01T09:00:00-06:00', end: '2026-09-01T10:00:00-06:00', allDay: false })
    const soon = evt({ id: 'soon', start: '2026-09-11T16:00:00-06:00', end: '2026-09-11T17:00:00-06:00', allDay: false })
    const later = evt({ id: 'later', start: '2026-09-11T18:00:00-06:00', end: '2026-09-11T19:00:00-06:00', allDay: false })
    const next = evt({ id: 'next', start: '2026-09-12T08:00:00-06:00', end: '2026-09-12T09:00:00-06:00', allDay: false })

    const from = new Date(2026, 8, 5)
    const upcoming = upcomingEvents([later, past, next, soon], from)
    expect(upcoming.map((e) => e.id)).toEqual(['soon', 'later', 'next'])

    const groups = groupByDay(upcoming)
    expect(groups).toHaveLength(2)
    expect(groups[0].events.map((e) => e.id)).toEqual(['soon', 'later'])
    expect(groups[1].events.map((e) => e.id)).toEqual(['next'])
  })
})
