'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarSync, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listAppointmentsByDateRange } from '@/lib/appointments/queries'
import { getWeekDates, localDayKey } from '@/lib/dashboard/date-utils'
import { AppointmentFormDialog } from '@/components/appointments/appointment-form-dialog'
import { AppointmentDetailSheet } from '@/components/appointments/appointment-detail-sheet'
import { Skeleton } from './skeleton'
import { Button } from '@/components/ui/button'
import type { Appointment, AppointmentType } from '@/types'
import { useTranslations } from 'next-intl'

// Left-border accent per appointment type — a quiet extra signal on
// the card, not one of the 3 required text lines (client/time/property).
const TYPE_BORDER_CLASSES: Record<AppointmentType, string> = {
  call: 'border-l-blue-500',
  visit: 'border-l-violet-500',
  meeting: 'border-l-emerald-500',
  proposal: 'border-l-amber-500',
  follow_up: 'border-l-orange-500',
  other: 'border-l-slate-400',
}

// Index 0..5 = Monday..Saturday, matching date-utils' WEEK_DAY_OFFSETS.
// Soft, dark-theme-safe accents — a top border strip + matching text
// tint on the day header, same visual language as the pipeline board's
// stage columns. Distinct from the app's primary violet so a day
// column never reads as a "selected/primary" affordance.
const DAY_BORDER_CLASSES = [
  'border-t-blue-500',
  'border-t-emerald-500',
  'border-t-purple-500',
  'border-t-orange-500',
  'border-t-rose-400',
  'border-t-amber-400',
]
const DAY_TEXT_CLASSES = [
  'text-blue-400',
  'text-emerald-400',
  'text-purple-400',
  'text-orange-400',
  'text-rose-300',
  'text-amber-300',
]

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function formatDayLabel(dateKey: string): string {
  const [, m, d] = dateKey.split('-')
  return `${d}/${m}`
}

/**
 * Self-contained "Agenda da Semana" section — fetches this week's
 * (Mon–Sat, see WEEK_DAY_OFFSETS) appointments itself and owns both
 * the create dialog and the click-through detail sheet. Kept separate
 * from the 4 KPI cards' loading lifecycle so a slow appointments
 * query never blocks the cards above it.
 */
export function AgendaWeek() {
  const t = useTranslations('Dashboard.agenda')
  const tDays = useTranslations('Dashboard.agenda.weekdays')
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [detailAppointment, setDetailAppointment] = useState<Appointment | null>(null)

  const todayKey = localDayKey(new Date())
  const weekDates = getWeekDates(new Date())
  const weekKey = weekDates.join(',')

  const load = useCallback(() => {
    setLoading(true)
    const db = createClient()
    listAppointmentsByDateRange(db, weekDates)
      .then((rows) => setAppointments(rows))
      .catch((err) => console.error('[dashboard] weekly appointments failed:', err))
      .finally(() => setLoading(false))
    // weekDates is a fresh array every render; weekKey (its stable
    // string form) is the real dependency so this doesn't refetch on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey])

  useEffect(() => {
    load()
  }, [load])

  const byDay = new Map<string, Appointment[]>()
  for (const d of weekDates) byDay.set(d, [])
  for (const a of appointments ?? []) byDay.get(a.scheduled_date)?.push(a)

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Preparation only — no OAuth/API wired up yet, see
              src/lib/calendar/google-calendar-provider.ts. */}
          <Button variant="outline" size="sm" disabled title={t('googleCalendarSoon')}>
            <CalendarSync className="h-4 w-4" />
            <span className="hidden sm:inline">{t('connectGoogleCalendar')}</span>
          </Button>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{t('newAppointment')}</span>
          </Button>
        </div>
      </header>

      <div className="overflow-x-auto p-4">
        {loading || appointments === null ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid min-w-[1020px] grid-cols-6 gap-3">
            {weekDates.map((dateKey, i) => {
              const dayAppointments = byDay.get(dateKey) ?? []
              const isToday = dateKey === todayKey
              return (
                <div
                  key={dateKey}
                  className={`flex flex-col rounded-lg border border-t-2 bg-card/50 ${DAY_BORDER_CLASSES[i]} ${
                    isToday ? 'border-border ring-1 ring-primary/40' : 'border-border'
                  }`}
                >
                  <div className="border-b border-border px-3 py-2">
                    <p className={`text-xs font-semibold uppercase tracking-wide ${DAY_TEXT_CLASSES[i]}`}>
                      {tDays(WEEKDAY_KEYS[i])}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatDayLabel(dateKey)}</p>
                  </div>
                  <div className="flex-1 space-y-2 p-2">
                    {dayAppointments.length === 0 ? (
                      <p className="py-6 text-center text-[11px] text-muted-foreground">
                        {t('emptyDay')}
                      </p>
                    ) : (
                      dayAppointments.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setDetailAppointment(a)}
                          className={`w-full rounded-md border border-l-2 border-border bg-card p-2.5 text-left transition-colors hover:border-primary/40 ${TYPE_BORDER_CLASSES[a.type]}`}
                        >
                          <p className="truncate text-sm font-semibold text-foreground">
                            {a.contact?.name || a.contact?.phone || t('noContactShort')}
                          </p>
                          <p className="mt-0.5 text-xs tabular-nums text-foreground/80">
                            {a.scheduled_time ? a.scheduled_time.slice(0, 5) : t('allDay')}
                          </p>
                          <p
                            className="mt-0.5 truncate text-[11px] text-muted-foreground"
                            title={a.property?.name ?? undefined}
                          >
                            {a.property?.name || t('noPropertyShort')}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <AppointmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultDate={todayKey}
        onSaved={load}
      />
      <AppointmentDetailSheet
        appointment={detailAppointment}
        onClose={() => setDetailAppointment(null)}
        onChanged={load}
      />
    </section>
  )
}
