'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CalendarDays, Clock3, Loader2, Sparkles, UserRound } from 'lucide-react'

interface ReservationItem {
  id: string
  customer: string
  service: string
  date: string
  slot: string
  status: 'Confirmée' | 'En attente' | 'Annulée'
  notes?: string
}

const initialReservations: ReservationItem[] = [
  {
    id: 'res-001',
    customer: 'Amina Benali',
    service: 'Consultation premium',
    date: '2026-08-10',
    slot: '09:30',
    status: 'Confirmée',
    notes: 'Besoin d’un accompagnement complet.',
  },
  {
    id: 'res-002',
    customer: 'Youssef K.',
    service: 'Audit stratégie',
    date: '2026-08-11',
    slot: '14:00',
    status: 'En attente',
    notes: 'À confirmer avec le client.',
  },
  {
    id: 'res-003',
    customer: 'Sara D.',
    service: 'Session découverte',
    date: '2026-08-13',
    slot: '16:15',
    status: 'Annulée',
    notes: 'Client indisponible.',
  },
]

function badgeClass(status: ReservationItem['status']) {
  switch (status) {
    case 'Confirmée':
      return 'bg-green-500/10 text-green-600 border-green-500/20'
    case 'En attente':
      return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
    case 'Annulée':
      return 'bg-red-500/10 text-red-600 border-red-500/20'
    default:
      return 'bg-muted text-foreground'
  }
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export default function ReservationsPage() {
  const [reservations, setReservations] = useState<ReservationItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setReservations(initialReservations)
      setLoading(false)
    }, 300)

    return () => window.clearTimeout(timer)
  }, [])

  const stats = useMemo(() => {
    const confirmed = reservations.filter((item) => item.status === 'Confirmée').length
    const pending = reservations.filter((item) => item.status === 'En attente').length
    const cancelled = reservations.filter((item) => item.status === 'Annulée').length

    return { confirmed, pending, cancelled }
  }, [reservations])

  return (
    <div className="flex flex-col space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Réservations</h1>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Confirmées</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{stats.confirmed}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">En attente</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{stats.pending}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Annulées</p>
          <p className="mt-2 text-2xl font-semibold text-foreground">{stats.cancelled}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Chargement des réservations…
          </div>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {reservations.map((reservation) => (
            <div key={reservation.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-foreground">{reservation.service}</p>
                  <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <UserRound className="h-4 w-4" />
                    {reservation.customer}
                  </p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${badgeClass(reservation.status)}`}>
                  {reservation.status}
                </span>
              </div>

              <div className="mt-4 space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4" />
                  <span>{formatDate(reservation.date)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4" />
                  <span>{reservation.slot}</span>
                </div>
              </div>

              {reservation.notes ? (
                <div className="mt-4 rounded-lg border border-dashed border-border bg-background/70 p-3 text-sm text-foreground/80">
                  {reservation.notes}
                </div>
              ) : null}

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4" />
                  Réservation fictive
                </div>
                <Button type="button" variant="outline" size="sm">
                  Voir détail
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
