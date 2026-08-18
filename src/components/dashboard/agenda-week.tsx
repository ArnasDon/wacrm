'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarSync, Check, ChevronLeft, ChevronRight, Info, LogOut, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import { listAppointmentsByDateRange, updateAppointmentStatus } from '@/lib/appointments/queries'
// Imported from the leaf module, not the '@/lib/calendar' barrel —
// that barrel also re-exports GoogleCalendarProvider, which pulls in
// `googleapis` (Node-only: relies on Node's http2/crypto, no browser
// build). This file is a client component, so it must not import
// anything that transitively drags that in.
import { getMyCalendarConnection, disconnectMyCalendar } from '@/lib/calendar/connection-queries'
import { getWeekDates, localDayKey, startOfLocalDay } from '@/lib/dashboard/date-utils'
import { AppointmentFormDialog } from '@/components/appointments/appointment-form-dialog'
import { AppointmentDetailSheet } from '@/components/appointments/appointment-detail-sheet'
import { Skeleton } from './skeleton'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { Appointment, AppointmentStatus, AppointmentType } from '@/types'
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
  const { user } = useAuth()
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  // undefined = let the dialog fall back to today (its own default);
  // set to a specific dateKey when opened from a day card's own "+" so
  // that exact day (from weekDates, not "today") is pre-filled — see
  // openNewAppointment.
  const [formDefaultDate, setFormDefaultDate] = useState<string | undefined>(undefined)
  const [detailAppointment, setDetailAppointment] = useState<Appointment | null>(null)

  // 0 = current week (the Mon-Sat span containing today, every day of
  // the week including Sunday), 1 = next week. Navigation is capped to
  // these two — "máximo 2 semanas de referência" — so Previous/Next
  // just clamp instead of ever reaching a 3rd week.
  const [weekOffset, setWeekOffset] = useState<0 | 1>(0)

  // null = not connected, undefined = still loading, string = connected email.
  const [calendarEmail, setCalendarEmail] = useState<string | null | undefined>(undefined)
  const [disconnecting, setDisconnecting] = useState(false)

  const loadCalendarConnection = useCallback(() => {
    if (!user) return
    const db = createClient()
    getMyCalendarConnection(db)
      .then((conn) => setCalendarEmail(conn?.googleEmail ?? null))
      .catch((err) => {
        console.error('[dashboard] calendar connection lookup failed:', err)
        setCalendarEmail(null)
      })
  }, [user])

  useEffect(() => {
    loadCalendarConnection()
  }, [loadCalendarConnection])

  // The OAuth callback (src/app/api/calendar/google/callback) redirects
  // here with ?calendar=connected|error — surface it once, then strip
  // the param so a refresh doesn't re-toast. Reads window.location
  // directly (rather than next/navigation's useSearchParams) so this
  // stays a plain client-only effect with no Suspense-boundary
  // requirement — the whole dashboard page is already 'use client',
  // and this only ever needs to run once, right after landing here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('calendar')
    if (!status) return
    if (status === 'connected') {
      toast.success(t('calendarConnectedToast'))
      loadCalendarConnection()
    } else if (status === 'error') {
      toast.error(t('calendarConnectError'))
    }
    params.delete('calendar')
    const query = params.toString()
    window.history.replaceState(null, '', query ? `/dashboard?${query}` : '/dashboard')
    // Runs once per mount — this param only ever appears right after
    // the OAuth redirect lands here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleDisconnect() {
    if (!user) return
    setDisconnecting(true)
    try {
      const db = createClient()
      await disconnectMyCalendar(db, user.id)
      setCalendarEmail(null)
      toast.success(t('calendarDisconnectedToast'))
    } catch (err) {
      console.error('[dashboard] calendar disconnect failed:', err)
      toast.error(t('calendarDisconnectFailed'))
    } finally {
      setDisconnecting(false)
    }
  }

  const todayKey = localDayKey(new Date())
  // Always the calendar week actually containing today (Mon-Sat) — no
  // day-of-week special case. Appointments must stay visible through
  // their whole Mon-Sat span regardless of what day "today" is,
  // including Sunday; the agenda never jumps ahead on its own.
  const weekAnchor = startOfLocalDay(new Date())
  weekAnchor.setDate(weekAnchor.getDate() + weekOffset * 7)
  const weekDates = getWeekDates(weekAnchor)
  const weekKey = weekDates.join(',')

  const goToPreviousWeek = () => setWeekOffset(0)
  const goToNextWeek = () => setWeekOffset(1)
  const goToToday = () => setWeekOffset(0)

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

  function openNewAppointment(dateKey?: string) {
    setFormDefaultDate(dateKey)
    setFormOpen(true)
  }

  // Single source of truth for the completed state: the same
  // `status` column the "Feito" button in AppointmentDetailSheet
  // writes to (via updateAppointmentStatus). Updates local state
  // optimistically so the checkbox/card reflect instantly, then
  // reverts on failure.
  async function handleToggleComplete(appointment: Appointment) {
    const previousStatus = appointment.status
    const nextStatus: AppointmentStatus = previousStatus === 'completed' ? 'scheduled' : 'completed'
    setAppointments((prev) =>
      (prev ?? []).map((a) => (a.id === appointment.id ? { ...a, status: nextStatus } : a)),
    )
    try {
      const db = createClient()
      await updateAppointmentStatus(db, appointment.id, nextStatus)
    } catch (err) {
      console.error('[dashboard] appointment status toggle failed:', err)
      setAppointments((prev) =>
        (prev ?? []).map((a) => (a.id === appointment.id ? { ...a, status: previousStatus } : a)),
      )
      toast.error(t('toastCompleteFailed'))
    }
  }

  const byDay = new Map<string, Appointment[]>()
  for (const d of weekDates) byDay.set(d, [])
  for (const a of appointments ?? []) byDay.get(a.scheduled_date)?.push(a)

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('description')}
            {weekOffset === 1 ? ` · ${t('viewingNextWeek')}` : ''}
          </p>
        </div>
        {/* Right-side group — calendar connect + the week nav cluster,
            in that order, pinned to the header's top-right corner (no
            longer a 3rd flex child floating between title and here —
            see git history for the "Novo Compromisso" button this
            slot used to hold, removed per spec). */}
        <div className="flex items-center gap-2">
          {calendarEmail ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
              title={t('calendarDisconnect')}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t('calendarConnectedAs', { email: calendarEmail })}</span>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={calendarEmail === undefined}
              render={<a href="/api/calendar/google/connect" />}
            >
              <CalendarSync className="h-4 w-4" />
              <span className="hidden sm:inline">{t('connectGoogleCalendar')}</span>
            </Button>
          )}
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goToPreviousWeek}
              disabled={weekOffset === 0}
              aria-label={t('previousWeek')}
              title={t('previousWeek')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={weekOffset === 0 ? 'secondary' : 'ghost'}
              size="sm"
              onClick={goToToday}
              className="px-3 text-xs"
            >
              {t('today')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={goToNextWeek}
              disabled={weekOffset === 1}
              aria-label={t('nextWeek')}
              title={t('nextWeek')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
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
          <TooltipProvider>
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
                  <div className="flex items-start justify-between gap-1 border-b border-border px-3 py-2">
                    <div>
                      <p className={`text-xs font-semibold uppercase tracking-wide ${DAY_TEXT_CLASSES[i]}`}>
                        {tDays(WEEKDAY_KEYS[i])}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{formatDayLabel(dateKey)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openNewAppointment(dateKey)}
                      aria-label={t('addAppointment')}
                      title={t('addAppointment')}
                      className="shrink-0 text-muted-foreground"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 space-y-2 p-2">
                    {dayAppointments.length === 0 ? (
                      <p className="py-6 text-center text-[11px] text-muted-foreground">
                        {t('emptyDay')}
                      </p>
                    ) : (
                      dayAppointments.map((a) => {
                        // 3rd line is conditional on type: Visita/Proposta are
                        // about a specific listing, so the property name stays
                        // (current behavior). Every other type (Ligação,
                        // Reunião, Follow-up, Outro) shows the appointment's
                        // Título instead — a property name is often empty or
                        // irrelevant for those (e.g. "elaborar aditivo
                        // contratual"), and every appointment always has a
                        // título (required field), unlike Descrição.
                        const showsProperty = a.type === 'visit' || a.type === 'proposal'
                        const thirdLineText = showsProperty ? a.property?.name || t('noPropertyShort') : a.title
                        // Native `title` attribute as a plain hover fallback
                        // (works with just the mouse, no JS) alongside the
                        // dedicated info icon below, which also works on tap.
                        const thirdLineTitleAttr = showsProperty ? (a.property?.name ?? undefined) : a.title
                        const isCompleted = a.status === 'completed'
                        return (
                          // A `<div role="button">`, not a native `<button>`:
                          // the info icon below is itself a real `<button>`
                          // (TooltipTrigger), and nesting button-in-button is
                          // invalid HTML — the browser closes the outer one
                          // the instant it hits the inner one, breaking the
                          // card's layout. onKeyDown mirrors the Enter/Space
                          // activation a real button gets for free.
                          <div
                            key={a.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setDetailAppointment(a)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setDetailAppointment(a)
                              }
                            }}
                            className={`relative w-full cursor-pointer rounded-md border border-l-2 border-border bg-card p-2.5 pr-7 text-left transition-colors hover:border-primary/40 ${
                              isCompleted ? 'border-l-[#00E5FF] opacity-[0.45]' : TYPE_BORDER_CLASSES[a.type]
                            }`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                // Keep the card's own onClick (open detail
                                // sheet) from also firing on a checkbox
                                // click — see the card's role="button"
                                // comment above for why this can't be a
                                // native nested <button>-in-<button> either
                                // way; this is the checkbox itself, not
                                // nested inside another button.
                                e.stopPropagation()
                                handleToggleComplete(a)
                              }}
                              aria-label={t('toggleCompleteLabel')}
                              aria-pressed={isCompleted}
                              className={`absolute right-3 top-3 flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[6px] border-[1.5px] transition-colors ${
                                isCompleted
                                  ? 'border-[#00E5FF] bg-[#00E5FF]'
                                  : 'border-[#334155] bg-transparent hover:border-[#64748B]'
                              }`}
                            >
                              {isCompleted && <Check className="h-3 w-3 text-black" strokeWidth={2} />}
                            </button>
                            <p
                              className={`truncate text-sm font-semibold text-foreground ${isCompleted ? 'line-through' : ''}`}
                            >
                              {a.contact?.name || a.contact?.phone || a.client_name || t('noContactShort')}
                            </p>
                            <p className="mt-0.5 text-xs tabular-nums text-foreground/80">
                              {a.scheduled_time ? a.scheduled_time.slice(0, 5) : t('allDay')}
                            </p>
                            <div className="mt-0.5 flex items-center gap-1">
                              <p
                                className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
                                title={thirdLineTitleAttr}
                              >
                                {thirdLineText}
                              </p>
                              <Tooltip>
                                <TooltipTrigger
                                  type="button"
                                  aria-label={t('appointmentDetailsLabel')}
                                  // Stops the click from also bubbling up to
                                  // the card's own onClick (which would open
                                  // the full detail sheet on top of the
                                  // tooltip) — this is meant to be a quick
                                  // peek, not a navigation.
                                  onClick={(e) => e.stopPropagation()}
                                  className="shrink-0 text-muted-foreground/60 hover:text-foreground"
                                >
                                  <Info className="size-3" />
                                </TooltipTrigger>
                                <TooltipContent className="block max-w-56">
                                  {/* TooltipContent's own base class is
                                      `inline-flex items-center` (built for a
                                      short one-line label) — wrapping in a
                                      single flex-col child isolates our
                                      multi-paragraph content from that row
                                      layout so título/descrição/observações
                                      stack instead of sitting side by side. */}
                                  <div className="flex flex-col gap-1 text-left">
                                    <p className="font-medium">{a.title}</p>
                                    {a.description ? <p className="text-background/80">{a.description}</p> : null}
                                    {a.notes ? <p className="text-background/80">{a.notes}</p> : null}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          </TooltipProvider>
        )}
      </div>

      <AppointmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultDate={formDefaultDate}
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
