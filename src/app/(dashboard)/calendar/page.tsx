'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { readResponseJson } from '@/lib/http/response-json'
import type { CalendarEvent, CalendarEventsResponse } from '@/lib/google-calendar/types'
import {
  addDays,
  addMonths,
  monthGridDays,
  startOfDay,
  startOfWeek,
} from '@/lib/calendar/grid'
import { MonthGrid } from '@/components/calendar/month-grid'
import { WeekGrid } from '@/components/calendar/week-grid'
import { AgendaList } from '@/components/calendar/agenda-list'
import { EventDetailsDialog } from '@/components/calendar/event-details-dialog'

type View = 'month' | 'week' | 'agenda'

const VIEW_STORAGE_KEY = 'sandia:calendar:view'
const AGENDA_DAYS = 45

const monthLabelFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const rangeLabelFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })

/** Visible [start, end) for a view+anchor. The month view over-scans to
 *  its 6-week grid so trailing/leading days show their events too. */
function visibleRange(view: View, anchor: Date): { start: Date; end: Date } {
  if (view === 'agenda') {
    const start = startOfDay(anchor)
    return { start, end: addDays(start, AGENDA_DAYS) }
  }
  if (view === 'week') {
    const start = startOfWeek(anchor)
    return { start, end: addDays(start, 7) }
  }
  const grid = monthGridDays(anchor)
  return { start: grid[0], end: addDays(grid[grid.length - 1], 1) }
}

export default function CalendarPage() {
  const t = useTranslations('Calendar')

  const [view, setView] = useState<View>('agenda')
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [state, setState] = useState<
    { kind: 'ok'; email: string | null } | { kind: 'disconnected'; reason?: string } | { kind: 'error'; message: string } | null
  >(null)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)

  // Restore the last-used view (per-browser convenience only).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY)
      if (saved === 'month' || saved === 'week' || saved === 'agenda') setView(saved)
    } catch {
      /* private mode / blocked storage — fine, keep the default */
    }
  }, [])

  const changeView = useCallback((next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const range = useMemo(() => visibleRange(view, anchor), [view, anchor])
  const rangeKey = `${range.start.getTime()}-${range.end.getTime()}`
  const lastFetched = useRef<string>('')

  const load = useCallback(
    async (opts?: { manual?: boolean }) => {
      if (opts?.manual) setRefreshing(true)
      else setLoading(true)
      try {
        const res = await fetch(
          `/api/google-calendar/events?start=${encodeURIComponent(range.start.toISOString())}&end=${encodeURIComponent(range.end.toISOString())}`,
        )
        const data = await readResponseJson<CalendarEventsResponse>(res)
        if (!res.ok) {
          setState({ kind: 'error', message: t('errorGeneric') })
          setEvents([])
        } else if (!data.connected) {
          setState({ kind: 'disconnected', reason: data.reason })
          setEvents([])
        } else {
          setState({ kind: 'ok', email: data.calendar_email ?? null })
          setEvents(data.events)
        }
      } catch {
        setState({ kind: 'error', message: t('errorGeneric') })
        setEvents([])
      } finally {
        setLoading(false)
        setRefreshing(false)
        lastFetched.current = rangeKey
      }
    },
    [range.start, range.end, rangeKey, t],
  )

  // Refetch whenever the visible window changes.
  useEffect(() => {
    if (lastFetched.current === rangeKey) return
    void load()
  }, [rangeKey, load])

  const goToday = () => setAnchor(startOfDay(new Date()))
  const step = (dir: -1 | 1) => {
    setAnchor((prev) =>
      view === 'month' ? addMonths(prev, dir) : addDays(prev, dir * (view === 'week' ? 7 : AGENDA_DAYS)),
    )
  }

  const headerLabel = useMemo(() => {
    if (view === 'month') return monthLabelFmt.format(anchor)
    if (view === 'week') {
      const s = startOfWeek(anchor)
      return `${rangeLabelFmt.format(s)} – ${rangeLabelFmt.format(addDays(s, 6))}`
    }
    return `${rangeLabelFmt.format(range.start)} – ${rangeLabelFmt.format(addDays(range.end, -1))}`
  }, [view, anchor, range.start, range.end])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="text-primary h-5 w-5" />
          <h1 className="text-foreground text-lg font-semibold">{t('title')}</h1>
        </div>

        {/* View toggle */}
        <div className="border-border bg-card inline-flex rounded-lg border p-1">
          {(['agenda', 'week', 'month'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                view === v
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`view_${v}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-header: navigation + label + refresh */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={t('previous')}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-md border p-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t('next')}
            className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-md border p-1.5"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="border-border text-foreground hover:bg-muted ml-1 rounded-md border px-2.5 py-1.5 text-sm"
          >
            {t('today')}
          </button>
          <span className="text-foreground ml-2 text-sm font-medium capitalize">{headerLabel}</span>
        </div>

        <button
          type="button"
          onClick={() => load({ manual: true })}
          disabled={refreshing || loading}
          className="border-border text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          {t('refresh')}
        </button>
      </div>

      {/* Connected-account strip */}
      {state?.kind === 'ok' && state.email ? (
        <p className="text-muted-foreground text-xs">
          {t('connectedAs', { email: state.email })}
        </p>
      ) : null}

      {/* Body */}
      {loading ? (
        <div className="bg-muted/40 h-96 animate-pulse rounded-lg" />
      ) : state?.kind === 'disconnected' ? (
        <div className="border-border flex flex-col items-center rounded-lg border border-dashed py-16 text-center">
          <CalendarDays className="text-muted-foreground mb-3 h-10 w-10" />
          <h3 className="text-foreground text-base font-medium">{t('notConnectedTitle')}</h3>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">
            {state.reason === 'token_error' ? t('reconnectBody') : t('notConnectedBody')}
          </p>
          <Link
            href="/settings?tab=google-calendar"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium"
          >
            {t('goToSettings')}
          </Link>
        </div>
      ) : state?.kind === 'error' ? (
        <div className="border-border text-muted-foreground rounded-lg border border-dashed py-16 text-center text-sm">
          {state.message}
        </div>
      ) : view === 'month' ? (
        <MonthGrid
          anchor={anchor}
          events={events}
          onSelectEvent={setSelected}
          onSelectDay={(day) => {
            setAnchor(day)
            changeView('agenda')
          }}
        />
      ) : view === 'week' ? (
        <WeekGrid anchor={anchor} events={events} onSelectEvent={setSelected} />
      ) : (
        <AgendaList events={events} from={range.start} onSelectEvent={setSelected} />
      )}

      {state?.kind === 'ok' ? (
        <a
          href="https://calendar.google.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('openGoogleCalendar')}
        </a>
      ) : null}

      <EventDetailsDialog event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
