'use client'

// ============================================================
// /appointments — Calendario interno (agenda de citas).
//
// Reutiliza primitives existentes:
//   · contacts (contact_id) — sin mini contact manager
//   · /api/account/members (doctor/usuario responsable)
//   · appointment_resources (sala/recurso) — mínimo (id, name)
//   · components/ui/* (dialog, select, button, card, badge, tabs)
//   · date-utils (startOfLocalDay / localDayKey) — timezone local
//
// Vistas: Day / Week / Month. Filtros: doctor y sala. Navegación:
// previous / today / next. Crear/editar/reschedule/cancel desde un
// único dialog (sin wizard, sin booking público, sin disponibilidad).
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/use-auth'
import { startOfLocalDay, localDayKey } from '@/lib/dashboard/date-utils'
import { AppointmentDialog } from './appointment-dialog'

export type ViewMode = 'day' | 'week' | 'month'

export interface CalendarAppointment {
  id: string
  contact_id: string
  assigned_user_id: string
  resource_id: string | null
  start_at: string
  end_at: string
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
  notes: string | null
  contact_name?: string | null
  contact_phone?: string | null
  resource_name?: string | null
}

export interface CalendarMember {
  user_id: string
  full_name: string
}

export interface CalendarResource {
  id: string
  name: string
}

const STATUS_STYLE: Record<CalendarAppointment['status'], string> = {
  scheduled: 'border-blue-500/40 bg-blue-500/10 text-blue-300',
  confirmed: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  completed: 'border-slate-500/40 bg-slate-500/10 text-slate-300',
  cancelled: 'border-red-500/40 bg-red-500/10 text-red-300 line-through',
  no_show: 'border-red-500/40 bg-red-500/10 text-red-300',
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
}

/** Bloque de cita reutilizado por las tres vistas. */
function AppointmentChip({
  a,
  onClick,
  compact = false,
}: {
  a: CalendarAppointment
  onClick: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-md border px-1.5 py-0.5 text-left text-[11px] leading-tight hover:brightness-125 ${STATUS_STYLE[a.status]}`}
    >
      <div className="font-medium">
        {compact ? '' : `${fmtTime(a.start_at)} `}
        {a.contact_name ?? 'Contact'}
      </div>
      {!compact && (
        <div className="truncate opacity-80">
          {a.assigned_user_id ? '' : ''}
          {a.resource_name ? ` · ${a.resource_name}` : ''}
        </div>
      )}
    </button>
  )
}

export default function AppointmentsPage() {
  const { profile, user } = useAuth()
  const [view, setView] = useState<ViewMode>('week')
  const [cursor, setCursor] = useState<Date>(() => startOfLocalDay())
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([])
  const [members, setMembers] = useState<CalendarMember[]>([])
  const [resources, setResources] = useState<CalendarResource[]>([])
  const [filterUser, setFilterUser] = useState<string>('')
  const [filterResource, setFilterResource] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarAppointment | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const isAdmin = profile?.account_role === 'admin' || profile?.account_role === 'owner'

  // Rango visible según vista (local day boundaries; timezone local).
  const range = useMemo(() => {
    const start = startOfLocalDay(cursor)
    const end = new Date(start)
    if (view === 'day') end.setDate(end.getDate() + 1)
    else if (view === 'week') end.setDate(end.getDate() + 7)
    else end.setMonth(end.getMonth() + 1)
    return { from: start.toISOString(), to: end.toISOString() }
  }, [cursor, view])

  // Doctor por defecto = el usuario logueado (caso principal: un doctor
  // agenda su propia cita). El filtro lo cambia.
  const defaultUser = user?.id ?? ''

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        from: range.from,
        to: range.to,
      })
      if (filterUser) params.set('assigned_user_id', filterUser)
      if (filterResource) params.set('resource_id', filterResource)

      const [apptsRes, membersRes, resourcesRes] = await Promise.all([
        fetch(`/api/appointments?${params}`, { cache: 'no-store' }),
        fetch('/api/account/members', { cache: 'no-store' }),
        fetch('/api/appointments/resources', { cache: 'no-store' }),
      ])
      const apptsJson = await apptsRes.json()
      const membersJson = await membersRes.json()
      const resourcesJson = await resourcesRes.json()
      if (!apptsRes.ok) throw new Error(apptsJson.error ?? 'failed to load appointments')
      setAppointments(apptsJson.rows ?? [])
      setMembers((membersJson.members ?? []).map((m: { user_id: string; full_name: string }) => ({
        user_id: m.user_id,
        full_name: m.full_name || 'Unnamed',
      })))
      setResources(resourcesJson.resources ?? [])
    } catch (err) {
      console.error('[appointments] load failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [range.from, range.to, filterUser, filterResource])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const openCreate = useCallback(() => {
    setEditing(null)
    setDialogOpen(true)
  }, [])

  const openEdit = useCallback((a: CalendarAppointment) => {
    setEditing(a)
    setDialogOpen(true)
  }, [])

  const navigate = useCallback((dir: -1 | 1) => {
    setCursor((c) => {
      const d = new Date(c)
      if (view === 'day') d.setDate(d.getDate() + dir)
      else if (view === 'week') d.setDate(d.getDate() + 7 * dir)
      else d.setMonth(d.getMonth() + dir)
      return d
    })
  }, [view])

  const goToday = useCallback(() => setCursor(startOfLocalDay()), [])

  // ── Día ──────────────────────────────────────────────────
  const dayAppointments = useMemo(
    () =>
      appointments
        .filter((a) => localDayKey(a.start_at) === localDayKey(cursor))
        .sort((a, b) => a.start_at.localeCompare(b.start_at)),
    [appointments, cursor],
  )

  const hourSlots = useMemo(() => {
    const slots: { hour: number; label: string }[] = []
    for (let h = 0; h < 24; h++) {
      slots.push({
        hour: h,
        label: new Date(new Date(cursor).setHours(h, 0, 0, 0)).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      })
    }
    return slots
  }, [cursor])

  // ── Semana ───────────────────────────────────────────────
  const weekDays = useMemo(() => {
    const start = startOfLocalDay(cursor)
    const day = start.getDay()
    const monday = new Date(start)
    monday.setDate(start.getDate() - ((day + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      return d
    })
  }, [cursor])

  // ── Mes ──────────────────────────────────────────────────
  const monthGrid = useMemo(() => {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const start = new Date(first)
    start.setDate(1 - start.getDay())
    const cells: Date[] = []
    for (let i = 0; i < 42; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      cells.push(d)
    }
    return cells
  }, [cursor])

  const apptsByDay = useMemo(() => {
    const map = new Map<string, CalendarAppointment[]>()
    for (const a of appointments) {
      const key = localDayKey(a.start_at)
      const list = map.get(key) ?? []
      list.push(a)
      map.set(key, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at))
    return map
  }, [appointments])

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Calendar</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-border">
            {(['day', 'week', 'month'] as ViewMode[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-sm capitalize ${
                  view === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => navigate(-1)} aria-label="Previous">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={goToday}>
              Today
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(1)} aria-label="Next">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> New
          </Button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Doctor</span>
          <select
            value={filterUser}
            onChange={(e) => setFilterUser(e.target.value)}
            className="rounded-md border border-border bg-muted px-2 py-1 text-sm"
          >
            <option value="">All doctors</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Room</span>
          <select
            value={filterResource}
            onChange={(e) => setFilterResource(e.target.value)}
            className="rounded-md border border-border bg-muted px-2 py-1 text-sm"
          >
            <option value="">All rooms</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {/* Cuerpo */}
      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : view === 'day' ? (
        <DayView
          cursor={cursor}
          appointments={dayAppointments}
          onEdit={openEdit}
          hourSlots={hourSlots}
        />
      ) : view === 'week' ? (
        <WeekView
          weekDays={weekDays}
          appointments={appointments}
          apptsByDay={apptsByDay}
          onEdit={openEdit}
        />
      ) : (
        <MonthView
          cursor={cursor}
          monthGrid={monthGrid}
          apptsByDay={apptsByDay}
          onEdit={openEdit}
          onDayClick={(d) => {
            setCursor(startOfLocalDay(d))
            setView('day')
          }}
        />
      )}

      <AppointmentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        members={members}
        resources={resources}
        defaultUserId={defaultUser}
        onSaved={refresh}
      />
    </div>
  )
}

// ------------------------------------------------------------
// Vistas
// ------------------------------------------------------------

function DayView({
  cursor,
  appointments,
  onEdit,
  hourSlots,
}: {
  cursor: Date
  appointments: CalendarAppointment[]
  onEdit: (a: CalendarAppointment) => void
  hourSlots: { hour: number; label: string }[]
}) {
  const byHour = useMemo(() => {
    const map = new Map<number, CalendarAppointment[]>()
    for (const a of appointments) {
      const h = new Date(a.start_at).getHours()
      const list = map.get(h) ?? []
      list.push(a)
      map.set(h, list)
    }
    return map
  }, [appointments])

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-medium text-muted-foreground">
          {fmtDayLabel(cursor)} — {appointments.length} appointment{appointments.length === 1 ? '' : 's'}
        </div>
        <div className="space-y-1">
          {hourSlots.map(({ hour, label }) => {
            const list = byHour.get(hour) ?? []
            return (
              <div key={hour} className="flex items-start gap-3 border-b border-border/50 py-1">
                <div className="w-14 shrink-0 text-right text-xs text-muted-foreground">{label}</div>
                <div className="flex min-h-6 flex-1 flex-col gap-1">
                  {list.length === 0 ? (
                    <div className="text-xs text-muted-foreground/40">—</div>
                  ) : (
                    list.map((a) => <AppointmentChip key={a.id} a={a} onClick={() => onEdit(a)} />)
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function WeekView({
  weekDays,
  appointments,
  apptsByDay,
  onEdit,
}: {
  weekDays: Date[]
  appointments: CalendarAppointment[]
  apptsByDay: Map<string, CalendarAppointment[]>
  onEdit: (a: CalendarAppointment) => void
}) {
  const todayKey = localDayKey(new Date())
  return (
    <Card>
      <CardContent className="p-4">
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((d) => {
            const key = localDayKey(d)
            const list = apptsByDay.get(key) ?? []
            const isToday = key === todayKey
            return (
              <div
                key={key}
                className={`min-h-40 rounded-md border p-1.5 ${
                  isToday ? 'border-primary/50 bg-primary/5' : 'border-border'
                }`}
              >
                <div className={`mb-1 text-center text-xs font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                  {WEEKDAYS[d.getDay()]} {d.getDate()}
                </div>
                <div className="space-y-1">
                  {list.map((a) => (
                    <AppointmentChip key={a.id} a={a} onClick={() => onEdit(a)} compact />
                  ))}
                  {list.length === 0 && (
                    <div className="text-center text-[10px] text-muted-foreground/40">—</div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function MonthView({
  cursor,
  monthGrid,
  apptsByDay,
  onEdit,
  onDayClick,
}: {
  cursor: Date
  monthGrid: Date[]
  apptsByDay: Map<string, CalendarAppointment[]>
  onEdit: (a: CalendarAppointment) => void
  onDayClick: (d: Date) => void
}) {
  const todayKey = localDayKey(new Date())
  const currentMonth = cursor.getMonth()
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {monthGrid.map((d) => {
            const key = localDayKey(d)
            const list = apptsByDay.get(key) ?? []
            const isToday = key === todayKey
            const inMonth = d.getMonth() === currentMonth
            return (
              <button
                key={key}
                type="button"
                onClick={() => onDayClick(d)}
                className={`min-h-20 rounded-md border p-1 text-left ${
                  isToday ? 'border-primary/50 bg-primary/5' : 'border-border'
                } ${inMonth ? '' : 'opacity-40'}`}
              >
                <div className={`text-xs font-medium ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
                  {d.getDate()}
                </div>
                <div className="mt-1 space-y-1">
                  {list.slice(0, 3).map((a) => (
                    <AppointmentChip key={a.id} a={a} onClick={() => onEdit(a)} compact />
                  ))}
                  {list.length > 3 && (
                    <div className="text-[10px] text-muted-foreground">+{list.length - 3} more</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}