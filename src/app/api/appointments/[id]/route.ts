import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  updateAppointment,
  setAppointmentStatus,
  deleteAppointment,
  AppointmentError,
  type AppointmentStatus,
} from '@/lib/appointments/queries'

// ============================================================
// PATCH/DELETE /api/appointments/[id]
//
// PATCH — update de campos y/o reschedule (start_at/end_at) con
//         re-validación de conflictos. Detecta reschedule si cambian
//         las fechas → emite appointment_rescheduled; si no,
//         appointment_updated. El status se maneja aparte:
//         { status: 'completed'|'cancelled'|'no_show'|'confirmed' }
//         → emite el evento de lifecycle correspondiente.
// DELETE — borra la cita (admin+, como appointments_delete policy).
//
// Tenancy: todo filtrado por account_id de la sesión.
// ============================================================

const APPOINTMENT_STATUSES: AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
]

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const body = (await request.json()) as {
      contact_id?: unknown
      assigned_user_id?: unknown
      resource_id?: unknown
      start_at?: unknown
      end_at?: unknown
      status?: unknown
      notes?: unknown
    }

    // Transición de estado pura → evento de lifecycle.
    if (typeof body.status === 'string' && APPOINTMENT_STATUSES.includes(body.status as AppointmentStatus)) {
      const updated = await setAppointmentStatus(ctx.accountId, id, body.status as AppointmentStatus)
      return NextResponse.json({ appointment: updated })
    }

    if (body.start_at !== undefined && typeof body.start_at !== 'string') {
      return NextResponse.json({ error: 'start_at must be a string' }, { status: 400 })
    }
    if (body.end_at !== undefined && typeof body.end_at !== 'string') {
      return NextResponse.json({ error: 'end_at must be a string' }, { status: 400 })
    }

    const updated = await updateAppointment(
      ctx.accountId,
      id,
      {
        contact_id: body.contact_id as string | undefined,
        assigned_user_id: body.assigned_user_id as string | undefined,
        resource_id: body.resource_id === undefined ? undefined : (body.resource_id as string | null),
        start_at: body.start_at as string | undefined,
        end_at: body.end_at as string | undefined,
        notes: body.notes === undefined ? undefined : (body.notes as string | null),
      },
      body.start_at !== undefined || body.end_at !== undefined
        ? 'appointment_rescheduled'
        : 'appointment_updated',
    )
    return NextResponse.json({ appointment: updated })
  } catch (err) {
    if (err instanceof AppointmentError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    await deleteAppointment(ctx.accountId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AppointmentError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}