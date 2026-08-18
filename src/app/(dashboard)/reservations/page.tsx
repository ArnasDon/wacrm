'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/hooks/use-auth'
import {
  CalendarDays,
  Clock3,
  Loader2,
  UserRound,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ListFilter,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReservationItem {
  id: string
  contact_id?: string | null
  service_id?: string | null
  contact_name: string
  contact_phone: string
  service_title: string
  scheduled_at: string
  duration: number | null
  status: 'confirmed' | 'pending' | 'cancelled' | 'completed'
  notes: string | null
  price: number | null
  currency: string | null
  payment_status: string | null
  cancelled_reason: string | null
}

type StatusFilter = 'Toutes' | 'confirmed' | 'pending' | 'cancelled' | 'completed'
type SortOrder = 'asc' | 'desc'

interface ContactOption {
  id: string
  name: string
  phone: string
}

interface ServiceOption {
  id: string
  title: string
  attributes: { duration?: string } | null
  price: number | null
}

interface ReservationFormData {
  contact_id: string
  service_id: string
  scheduled_date: string
  scheduled_time: string
  notes: string
}

const EMPTY_RESERVATION_FORM: ReservationFormData = {
  contact_id: '',
  service_id: '',
  scheduled_date: '',
  scheduled_time: '',
  notes: '',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDurationInMinutes(val: any): number {
  if (!val) return 30
  if (typeof val === 'number') return val > 0 ? val : 30
  if (typeof val === 'object' && val !== null) {
    if ('duration' in val) {
      return parseDurationInMinutes((val as any).duration)
    }
  }
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && 'duration' in parsed) {
          return parseDurationInMinutes(parsed.duration)
        }
      } catch {
        // ignore
      }
    }
    const clean = trimmed.toLowerCase()
    if (clean.includes('h')) {
      const parts = clean.split('h')
      const hours = parseInt(parts[0], 10) || 0
      const mins = parseInt(parts[1], 10) || 0
      const total = hours * 60 + mins
      return total > 0 ? total : 30
    }
    const num = parseInt(clean.replace(/[^0-9]/g, ''), 10)
    return num > 0 ? num : 30
  }
  return 30
}

function isToday(dateStr: string) {
  return dateStr.split('T')[0] === new Date().toISOString().split('T')[0]
}

function getDateKey(dateStr: string) {
  return dateStr.split('T')[0]
}

function getSlot(dateStr: string, duration?: number | null) {
  const start = new Date(dateStr)
  if (isNaN(start.getTime())) return '—'

  const startStr = start.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const dur = parseDurationInMinutes(duration)
  const end = new Date(start.getTime() + dur * 60 * 1000)
  const endStr = end.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return `${startStr} - ${endStr}`
}

function formatGroupDate(dateKey: string) {
  return new Date(dateKey).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  })
}

function statusConfig(status: ReservationItem['status']) {
  switch (status) {
    case 'confirmed':
      return {
        label: 'Confirmé',
        className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
        icon: CheckCircle2,
      }
    case 'pending':
      return {
        label: 'En attente',
        className: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
        icon: Clock,
      }
    case 'cancelled':
      return {
        label: 'Annulé',
        className: 'bg-red-500/10 text-red-500 border-red-500/20',
        icon: XCircle,
      }
    case 'completed':
      return {
        label: 'Terminé',
        className: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        icon: CheckCircle2,
      }
    default:
      return {
        label: status,
        className: 'bg-muted text-foreground border-border',
        icon: Clock,
      }
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-xl font-bold tabular-nums text-foreground">{value}</p>
      </div>
    </div>
  )
}

function ReservationRow({
  reservation,
  onConfirm,
  onCancel,
  onEdit,
  onDelete,
}: {
  reservation: ReservationItem
  onConfirm: (id: string) => void
  onCancel: (id: string) => void
  onEdit: (reservation: ReservationItem) => void
  onDelete: (reservation: ReservationItem) => void
}) {
  const config = statusConfig(reservation.status)
  const StatusIcon = config.icon
  const todayFlag = isToday(reservation.scheduled_at)

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-card px-4 py-4 transition-colors sm:flex-row sm:items-center sm:gap-4 ${
        todayFlag ? 'border-primary/30' : 'border-border'
      }`}
    >
      {/* Time block */}
      <div className="flex w-36 shrink-0 flex-col items-start gap-0.5">
        <p className="text-xs font-medium text-muted-foreground">
          {todayFlag ? "Aujourd'hui" : formatGroupDate(getDateKey(reservation.scheduled_at))}
        </p>
        <p className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-foreground">
          <Clock3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span>{getSlot(reservation.scheduled_at, reservation.duration)}</span>
        </p>
      </div>

      {/* Divider */}
      <div className="hidden h-10 w-px bg-border sm:block" />

      {/* Main info */}
      <div className="flex flex-1 flex-col gap-1">
        <p className="font-semibold text-foreground leading-tight">{reservation.service_title}</p>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <UserRound className="h-3.5 w-3.5" />
          {reservation.contact_name}
          {reservation.contact_phone && (
            <span className="text-xs">· {reservation.contact_phone}</span>
          )}
        </p>
        {reservation.notes && (
          <p className="mt-1 text-xs text-muted-foreground italic line-clamp-1">
            {reservation.notes}
          </p>
        )}
      </div>

      {/* Status badge + actions */}
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${config.className}`}
        >
          <StatusIcon className="h-3 w-3" />
          {config.label}
        </span>

        {reservation.status === 'pending' && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 text-xs"
              onClick={() => onConfirm(reservation.id)}
            >
              Confirmer
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-red-400/30 text-red-500 hover:bg-red-500/10 hover:text-red-500 text-xs"
              onClick={() => onCancel(reservation.id)}
            >
              Annuler
            </Button>
          </div>
        )}

        {/* Menu 3 points */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              />
            }
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-36 bg-popover text-popover-foreground ring-border">
            <DropdownMenuItem onClick={() => onEdit(reservation)}>
              <Pencil className="mr-2 h-4 w-4" />
              Modifier
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(reservation)}
              className="text-red-400 focus:text-red-400"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReservationsPage() {
  const supabase = createClient()
  const { account } = useAuth()

  const [reservations, setReservations] = useState<ReservationItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('Toutes')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const [formOpen, setFormOpen] = useState(false)
  const [editingReservation, setEditingReservation] = useState<ReservationItem | null>(null)
  const [formData, setFormData] = useState<ReservationFormData>(EMPTY_RESERVATION_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ReservationItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [services, setServices] = useState<ServiceOption[]>([])

  // -------------------------------------------------------------------
  // Fetch
  // -------------------------------------------------------------------

  const fetchReservations = useCallback(async () => {
    if (!account?.id) return
    setLoading(true)

    const { data, error } = await supabase
      .from('reservations')
      .select(`
        id,
        contact_id,
        service_id,
        scheduled_at,
        duration,
        status,
        notes,
        price,
        currency,
        payment_status,
        cancelled_reason,
        contacts (name, phone),
        services (title, attributes)
      `)
      .eq('account_id', account.id)
      .order('scheduled_at', { ascending: true })

    if (error) {
      console.error('Failed to fetch reservations:', error)
      toast.error('Erreur lors du chargement des rendez-vous')
    } else {
      const mapped: ReservationItem[] = (data ?? []).map((r: any) => {
        const effectiveDuration = parseDurationInMinutes(r.duration || r.services?.attributes)
        return {
          id: r.id,
          contact_id: r.contact_id,
          service_id: r.service_id,
          scheduled_at: r.scheduled_at,
          duration: effectiveDuration,
          status: r.status,
          notes: r.notes,
          price: r.price,
          currency: r.currency,
          payment_status: r.payment_status,
          cancelled_reason: r.cancelled_reason,
          contact_name: r.contacts?.name ?? '—',
          contact_phone: r.contacts?.phone ?? '',
          service_title: r.services?.title ?? '—',
        }
      })
      setReservations(mapped)
    }

    setLoading(false)
  }, [supabase, account?.id])

  useEffect(() => {
    fetchReservations()
  }, [fetchReservations])

  // -------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------

  const fetchOptions = useCallback(async () => {
    if (!account?.id) return

    try {
      // Récupérer les contacts
      const { data: contactsData, error: contactsError } = await supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('account_id', account.id)
        .order('name')

      if (contactsError) {
        console.error('Erreur contacts:', contactsError)
      }

      // Récupérer les services avec attributes
      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select('id, title, attributes, price')
        .eq('account_id', account.id)
        .order('title')

      if (servicesError) {
        console.error('Erreur services:', servicesError)
      }

      setContacts((contactsData ?? []) as ContactOption[])
      setServices((servicesData ?? []) as ServiceOption[])
    } catch (error) {
      console.error('Erreur:', error)
    }
  }, [supabase, account?.id])

  useEffect(() => {
    fetchOptions()
  }, [fetchOptions])

  function openCreateModal() {
    setEditingReservation(null)
    setFormData(EMPTY_RESERVATION_FORM)
    setFormOpen(true)
  }

  function openEditModal(reservation: ReservationItem) {
    setEditingReservation(reservation)
    const dateObj = new Date(reservation.scheduled_at)
    const dateStr = dateObj.toISOString().split('T')[0]
    const timeStr = dateObj.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })

    setFormData({
      contact_id: reservation.contact_id || '',
      service_id: reservation.service_id || '',
      scheduled_date: dateStr,
      scheduled_time: timeStr,
      notes: reservation.notes || '',
    })
    setFormOpen(true)
  }

  async function handleSave() {
    if (!formData.contact_id || !formData.service_id || !formData.scheduled_date || !formData.scheduled_time) {
      toast.error('Veuillez remplir tous les champs obligatoires')
      return
    }

    if (!account?.id) return

    const scheduledDateObj = new Date(`${formData.scheduled_date}T${formData.scheduled_time}:00`)
    if (isNaN(scheduledDateObj.getTime())) {
      toast.error('Date ou heure invalide')
      return
    }

    const now = new Date()
    if (scheduledDateObj.getTime() <= now.getTime()) {
      toast.error("La date et l'heure du rendez-vous doivent être postérieures à la date et heure actuelles")
      return
    }

    const selectedService = services.find((s) => s.id === formData.service_id)
    const newDuration = parseDurationInMinutes(selectedService?.attributes?.duration)
    const newStartTime = scheduledDateObj.getTime()
    const newEndTime = newStartTime + newDuration * 60 * 1000

    setSaving(true)

    try {
      // Vérifier les conflits de créneau pour ce service
      let query = supabase
        .from('reservations')
        .select('id, service_id, scheduled_at, duration, status')
        .eq('account_id', account.id)
        .eq('service_id', formData.service_id)
        .in('status', ['pending', 'confirmed'])

      if (editingReservation) {
        query = query.neq('id', editingReservation.id)
      }

      const { data: existingReservations, error: conflictErr } = await query

      if (conflictErr) {
        console.error('Erreur vérification conflits:', conflictErr)
      } else if (existingReservations && existingReservations.length > 0) {
        for (const existing of existingReservations) {
          const existingStart = new Date(existing.scheduled_at).getTime()
          const existingDuration = parseDurationInMinutes(existing.duration)
          const existingEnd = existingStart + existingDuration * 60 * 1000

          // Deux créneaux se chevauchent si newStart < existingEnd && newEnd > existingStart
          if (newStartTime < existingEnd && newEndTime > existingStart) {
            const conflictStartTime = new Date(existingStart).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })
            const conflictEndTime = new Date(existingEnd).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
            })
            const conflictDate = new Date(existingStart).toLocaleDateString('fr-FR', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })

            toast.error(
              `Ce service est déjà réservé le ${conflictDate} de ${conflictStartTime} à ${conflictEndTime}. Veuillez choisir un autre créneau.`
            )
            setSaving(false)
            return
          }
        }
      }

      const scheduled_at = scheduledDateObj.toISOString()

      const payload = {
        account_id: account.id,
        contact_id: formData.contact_id,
        service_id: formData.service_id,
        scheduled_at,
        duration: newDuration,
        price: selectedService?.price ?? null,
        notes: formData.notes.trim() || null,
        ...(editingReservation ? { updated_at: new Date().toISOString() } : { status: 'pending' }),
      }

      const { error } = editingReservation
        ? await supabase
            .from('reservations')
            .update(payload)
            .eq('id', editingReservation.id)
        : await supabase.from('reservations').insert(payload)

      if (error) {
        toast.error(editingReservation ? 'Erreur lors de la modification' : 'Erreur lors de la création du rendez-vous')
        console.error(error)
      } else {
        toast.success(editingReservation ? 'Rendez-vous modifié avec succès' : 'Rendez-vous créé avec succès')
        setFormOpen(false)
        setEditingReservation(null)
        setFormData(EMPTY_RESERVATION_FORM)
        fetchReservations()
      }
    } catch (err) {
      console.error(err)
      toast.error('Erreur lors de la sauvegarde du rendez-vous')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    try {
      const { error } = await supabase
        .from('reservations')
        .delete()
        .eq('id', deleteTarget.id)

      if (error) throw error

      toast.success('Rendez-vous supprimé')
      setDeleteTarget(null)
      fetchReservations()
    } catch (err: any) {
      console.error('Erreur suppression:', err)
      toast.error(err?.message || 'Erreur lors de la suppression')
    } finally {
      setDeleting(false)
    }
  }

  async function handleConfirm(id: string) {
    await supabase
      .from('reservations')
      .update({ status: 'confirmed', updated_at: new Date().toISOString() })
      .eq('id', id)
    setReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'confirmed' } : r))
    )
  }

  async function handleCancel(id: string) {
    await supabase
      .from('reservations')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', id)
    setReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r))
    )
  }

  // -------------------------------------------------------------------
  // Stats
  // -------------------------------------------------------------------

  const stats = useMemo(() => ({
    confirmed: reservations.filter((r) => r.status === 'confirmed').length,
    pending: reservations.filter((r) => r.status === 'pending').length,
    cancelled: reservations.filter((r) => r.status === 'cancelled').length,
    today: reservations.filter((r) => isToday(r.scheduled_at)).length,
  }), [reservations])

  // -------------------------------------------------------------------
  // Filter + sort + group
  // -------------------------------------------------------------------

  const filtered = useMemo(() => {
    let list = reservations.filter((r) => {
      const matchSearch =
        !search.trim() ||
        r.contact_name.toLowerCase().includes(search.toLowerCase()) ||
        r.service_title.toLowerCase().includes(search.toLowerCase())
      const matchStatus = statusFilter === 'Toutes' || r.status === statusFilter
      return matchSearch && matchStatus
    })

    list = [...list].sort((a, b) =>
      sortOrder === 'asc'
        ? a.scheduled_at.localeCompare(b.scheduled_at)
        : b.scheduled_at.localeCompare(a.scheduled_at)
    )

    return list
  }, [reservations, search, statusFilter, sortOrder])

  const grouped = useMemo(() => {
    const map = new Map<string, ReservationItem[]>()
    for (const r of filtered) {
      const key = getDateKey(r.scheduled_at)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(r)
    }
    return map
  }, [filtered])

  const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
    { value: 'Toutes', label: 'Toutes' },
    { value: 'confirmed', label: 'Confirmés' },
    { value: 'pending', label: 'En attente' },
    { value: 'cancelled', label: 'Annulés' },
    { value: 'completed', label: 'Terminés' },
  ]

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="flex flex-col space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Rendez-vous</h1>
          <p className="text-sm text-muted-foreground">
            {stats.today > 0
              ? `${stats.today} rendez-vous aujourd'hui`
              : "Aucun rendez-vous aujourd'hui"}
          </p>
        </div>
        <Button onClick={openCreateModal} className="gap-2">
          <Plus className="h-4 w-4" />
          Nouveau rendez-vous
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Confirmés" value={stats.confirmed} color="bg-emerald-500" />
        <StatCard label="En attente" value={stats.pending} color="bg-amber-400" />
        <StatCard label="Annulés" value={stats.cancelled} color="bg-red-400" />
        <StatCard label="Aujourd'hui" value={stats.today} color="bg-primary" />
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher client ou service…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
          <ListFilter className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === f.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSortOrder((s) => (s === 'asc' ? 'desc' : 'asc'))}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {sortOrder === 'asc' ? 'Plus proche en premier' : 'Plus lointain en premier'}
          {sortOrder === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-xl border border-border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement…
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-card text-center">
          <CalendarDays className="h-8 w-8 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">
            {search || statusFilter !== 'Toutes'
              ? 'Aucun rendez-vous ne correspond aux filtres.'
              : 'Aucun rendez-vous pour le moment.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[...grouped.entries()].map(([date, items]) => (
            <div key={date} className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {isToday(date + 'T00:00:00') ? (
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-primary animate-pulse" />
                      Aujourd'hui
                    </span>
                  ) : (
                    formatGroupDate(date)
                  )}
                </p>
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">{items.length} rdv</span>
              </div>

              <div className="flex flex-col gap-2">
                {items.map((r) => (
                  <ReservationRow
                    key={r.id}
                    reservation={r}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    onEdit={openEditModal}
                    onDelete={setDeleteTarget}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Création / Modification de rendez-vous */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingReservation ? 'Modifier le rendez-vous' : 'Nouveau rendez-vous'}
            </DialogTitle>
            <DialogDescription>
              {editingReservation
                ? 'Modifiez les détails du rendez-vous.'
                : 'Planifiez un nouveau rendez-vous pour un contact.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* Client */}
            <div className="flex flex-col gap-2">
              <Label>Contact *</Label>
              <div className="rounded-lg border border-input bg-muted/20 p-2">
                <select
                  value={formData.contact_id}
                  onChange={(e) => setFormData((f) => ({ ...f, contact_id: e.target.value }))}
                  style={{ fontFamily: 'monospace' }}
                  className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" hidden />
                  {contacts.map((c) => {
                    const name = c.name ?? ''
                    const phone = c.phone ?? ''
                    const label = phone ? name.padEnd(30, '\u00a0') + phone : name
                    return (
                      <option key={c.id} value={c.id}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            {/* Service */}
            <div className="flex flex-col gap-2">
              <Label>Service *</Label>
              <div className="rounded-lg border border-input bg-muted/20 p-2">
                <select
                  value={formData.service_id}
                  onChange={(e) => setFormData((f) => ({ ...f, service_id: e.target.value }))}
                  style={{ fontFamily: 'monospace' }}
                  className="w-full rounded-md bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" hidden />
                  {services.map((s) => {
                    const title = s.title ?? ''
                    const suffix = [
                      s.attributes?.duration ? `${s.attributes.duration}` : '',
                      s.price ? `${s.price}€` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')
                    const label = suffix ? title.padEnd(30, '\u00a0') + suffix : title
                    return (
                      <option key={s.id} value={s.id}>
                        {label}
                      </option>
                    )
                  })}
                </select>
              </div>
              {services.length === 0 && (
                <p className="text-xs text-amber-600">⚠️ Aucun service trouvé.</p>
              )}
            </div>

            {/* Date + Heure */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  min={todayStr}
                  value={formData.scheduled_date}
                  onChange={(e) => setFormData((f) => ({ ...f, scheduled_date: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Heure *</Label>
                <Input
                  type="time"
                  value={formData.scheduled_time}
                  onChange={(e) => setFormData((f) => ({ ...f, scheduled_time: e.target.value }))}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-2">
              <Label>Notes</Label>
              <textarea
                rows={3}
                placeholder="Instructions particulières…"
                value={formData.notes}
                onChange={(e) => setFormData((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingReservation ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de suppression */}
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer le rendez-vous</DialogTitle>
            <DialogDescription>
              Êtes-vous sûr de vouloir supprimer ce rendez-vous ? Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Annuler
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

