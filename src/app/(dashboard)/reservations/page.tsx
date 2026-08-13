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
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReservationItem {
  id: string
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
  attributes: { duration?: string } | null  // ← CHANGÉ
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

function isToday(dateStr: string) {
  return dateStr.split('T')[0] === new Date().toISOString().split('T')[0]
}

function getDateKey(dateStr: string) {
  return dateStr.split('T')[0]
}

function getSlot(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  })
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
        label: 'Confirmée',
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
        label: 'Annulée',
        className: 'bg-red-500/10 text-red-500 border-red-500/20',
        icon: XCircle,
      }
    case 'completed':
      return {
        label: 'Terminée',
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
}: {
  reservation: ReservationItem
  onConfirm: (id: string) => void
  onCancel: (id: string) => void
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
      <div className="flex w-20 shrink-0 flex-col items-start gap-0.5">
        <p className="text-xs font-medium text-muted-foreground">
          {todayFlag ? "Aujourd'hui" : formatGroupDate(getDateKey(reservation.scheduled_at))}
        </p>
        <p className="flex items-center gap-1 text-base font-bold tabular-nums text-foreground">
          <Clock3 className="h-3.5 w-3.5 text-muted-foreground" />
          {getSlot(reservation.scheduled_at)}
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
  const [formData, setFormData] = useState<ReservationFormData>(EMPTY_RESERVATION_FORM)
  const [saving, setSaving] = useState(false)
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
        scheduled_at,
        duration,
        status,
        notes,
        price,
        currency,
        payment_status,
        cancelled_reason,
        contacts (name, phone),
        services (title)
      `)
      .eq('account_id', account.id)
      .order('scheduled_at', { ascending: true })

    if (error) {
      console.error('Failed to fetch reservations:', error)
    } else {
      const mapped: ReservationItem[] = (data ?? []).map((r: any) => ({
        id: r.id,
        scheduled_at: r.scheduled_at,
        duration: r.duration,
        status: r.status,
        notes: r.notes,
        price: r.price,
        currency: r.currency,
        payment_status: r.payment_status,
        cancelled_reason: r.cancelled_reason,
        contact_name: r.contacts?.name ?? '—',
        contact_phone: r.contacts?.phone ?? '',
        service_title: r.services?.title ?? '—',
      }))
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
      // .eq('status', 'active')  // Commenté pour le moment
      .order('title')

    if (servicesError) {
      console.error('Erreur services:', servicesError)
    }

    if (servicesData && servicesData.length > 0) {
      console.log('Exemple d\'attributes:', servicesData[0].attributes)
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

  async function handleSave() {
      console.log('=== VALEURS DU FORMULAIRE ===')
  console.log('contact_id:', formData.contact_id, 'type:', typeof formData.contact_id)
  console.log('service_id:', formData.service_id, 'type:', typeof formData.service_id)
  console.log('scheduled_date:', formData.scheduled_date)
  console.log('scheduled_time:', formData.scheduled_time)
  console.log('notes:', formData.notes)
  console.log('=== SERVICES DISPONIBLES ===')
  console.log('Services:', services.map(s => ({ id: s.id, title: s.title })))

  if (!formData.contact_id || !formData.service_id || !formData.scheduled_date || !formData.scheduled_time) {
    toast.error('Veuillez remplir tous les champs obligatoires')
    return
  }

  if (!account?.id) return
  setSaving(true)

  const scheduled_at = new Date(`${formData.scheduled_date}T${formData.scheduled_time}:00`).toISOString()
  const selectedService = services.find((s) => s.id === formData.service_id)

  const { error } = await supabase.from('reservations').insert({
    account_id: account.id,
    contact_id: formData.contact_id,
    service_id: formData.service_id,
    scheduled_at,
    duration: selectedService?.attributes?.duration ? parseInt(selectedService.attributes.duration) : null,
    price: selectedService?.price ?? null,
    notes: formData.notes.trim() || null,
    status: 'pending',
  })

  if (error) {
    toast.error('Erreur lors de la création')
    console.error(error)
  } else {
    toast.success('Réservation créée')
    setFormOpen(false)
    setFormData(EMPTY_RESERVATION_FORM)
    fetchReservations()
  }

  setSaving(false)
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
    { value: 'confirmed', label: 'Confirmées' },
    { value: 'pending', label: 'En attente' },
    { value: 'cancelled', label: 'Annulées' },
    { value: 'completed', label: 'Terminées' },
  ]

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  return (
    <div className="flex flex-col space-y-5">

      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
  <div>
    <h1 className="text-2xl font-bold text-foreground">Réservations</h1>
    <p className="text-sm text-muted-foreground">
      {stats.today > 0
        ? `${stats.today} réservation${stats.today > 1 ? 's' : ''} aujourd'hui`
        : "Aucune réservation aujourd'hui"}
    </p>
  </div>
  <Button onClick={() => { setFormData(EMPTY_RESERVATION_FORM); setFormOpen(true) }} className="gap-2">
    Nouvelle réservation
  </Button>
</div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Confirmées" value={stats.confirmed} color="bg-emerald-500" />
        <StatCard label="En attente" value={stats.pending} color="bg-amber-400" />
        <StatCard label="Annulées" value={stats.cancelled} color="bg-red-400" />
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
              ? 'Aucune réservation ne correspond aux filtres.'
              : 'Aucune réservation pour le moment.'}
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
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Nouvelle réservation</DialogTitle>
    </DialogHeader>

    <div className="flex flex-col gap-4 py-2">
      {/* Client */}
      <div className="flex flex-col gap-2">
        <Label>Contact *</Label>
        <select
          value={formData.contact_id}
          onChange={(e) => setFormData((f) => ({ ...f, contact_id: e.target.value }))}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.phone ? `· ${c.phone}` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Service */}
      <div className="flex flex-col gap-2">
        <Label>Service *</Label>
        <select
          value={formData.service_id}
          onChange={(e) => setFormData((f) => ({ ...f, service_id: e.target.value }))}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} 
              {s.attributes?.duration ? ` (${s.attributes.duration})` : ''}
              {s.price ? ` - ${s.price}€` : ''}
            </option>
          ))}
        </select>
  {services.length === 0 && (
    <p className="text-xs text-amber-600">
      ⚠️ Aucun service trouvé.
    </p>
  )}
</div>

      {/* Date + Heure */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label>Date *</Label>
          <Input
            type="date"
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
        Créer
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
    </div>
  )
}
