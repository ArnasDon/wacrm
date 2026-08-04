'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { listAppointmentsByDate } from '@/lib/appointments/queries'
import { localDayKey } from '@/lib/dashboard/date-utils'
import { AppointmentFormDialog } from '@/components/appointments/appointment-form-dialog'
import { EmptyState } from './empty-state'
import { Skeleton } from './skeleton'
import { Button } from '@/components/ui/button'
import type { Appointment, AppointmentType } from '@/types'
import { useTranslations } from 'next-intl'

const TYPE_DOT_CLASSES: Record<AppointmentType, string> = {
  call: 'bg-blue-500',
  visit: 'bg-violet-500',
  meeting: 'bg-emerald-500',
  proposal: 'bg-amber-500',
  follow_up: 'bg-orange-500',
  other: 'bg-slate-400',
}

/**
 * Self-contained "Agenda do Dia" section — fetches today's
 * appointments itself and owns the create-dialog, the same way
 * QuickActions is a drop-in with no required props. Kept separate
 * from the 4 KPI cards' loading lifecycle so a slow appointments
 * query never blocks the cards above it.
 */
export function AgendaToday() {
  const t = useTranslations('Dashboard.agenda')
  const tAppt = useTranslations('Appointments')
  const [appointments, setAppointments] = useState<Appointment[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const todayKey = localDayKey(new Date())

  const load = useCallback(() => {
    setLoading(true)
    const db = createClient()
    listAppointmentsByDate(db, todayKey)
      .then((rows) => setAppointments(rows))
      .catch((err) => console.error('[dashboard] appointments failed:', err))
      .finally(() => setLoading(false))
  }, [todayKey])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t('title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('description')}</p>
        </div>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">{t('newAppointment')}</span>
        </Button>
      </header>

      <div className="p-5">
        {loading || appointments === null ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : appointments.length === 0 ? (
          <EmptyState icon={CalendarClock} title={t('empty')} />
        ) : (
          <ul className="divide-y divide-border">
            {appointments.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="flex items-center gap-3 sm:w-40 sm:shrink-0">
                  <span className="w-14 shrink-0 text-sm font-medium tabular-nums text-foreground">
                    {a.scheduled_time ? a.scheduled_time.slice(0, 5) : t('allDay')}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${TYPE_DOT_CLASSES[a.type]}`} />
                    {tAppt(`type.${a.type}`)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{a.title}</p>
                  {a.description && (
                    <p className="truncate text-xs text-muted-foreground">{a.description}</p>
                  )}
                </div>
                <p className="truncate text-sm text-muted-foreground sm:w-40 sm:shrink-0">
                  {a.contact?.name || a.contact?.phone || tAppt('noContact')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AppointmentFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultDate={todayKey}
        onSaved={load}
      />
    </section>
  )
}
