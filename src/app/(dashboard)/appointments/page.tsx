import AppointmentsPage from '@/components/appointments/appointments-page'

// /appointments — Calendario interno. SPA client: vistas Day/Week/Month,
// filtros por doctor/sala, crear/editar/reschedule/cancelar citas.
// Reutiliza date-utils (timezone local) y components/ui sin librerías nuevas.
export default function Page() {
  return <AppointmentsPage />
}