import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  createAppointment,
  loadAppointments,
  AppointmentError,
} from '@/lib/appointments/queries'

// ============================================================
// GET/POST /api/appointments
//
// GET  — lista citas en un rango con filtros opcionales
//        (?from=&to=&assigned_user_id=&resource_id=&contact_id=&status=)
// POST — crea una cita con validación de conflictos (doctor + sala)
//        y emite appointment_created a Automation.
//
// Solo agent+ (requireRole). La tenancy sale de la sesión (accountId).
// ============================================================

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const url = new URL(request.url)
    const from = url.searchParams.get('from') ?? undefined
    const to = url.searchParams.get('to') ?? undefined
    const assignedUserId = url.searchParams.get('assigned_user_id') ?? undefined
    const resourceId = url.searchParams.get('resource_id') ?? undefined
    const contactId = url.searchParams.get('contact_id') ?? undefined
    const status = url.searchParams.get('status') ?? undefined

    const rows = await loadAppointments(ctx.accountId, {
      from,
      to,
      assigned_user_id: assignedUserId,
      resource_id: resourceId,
      contact_id: contactId,
      status: status as never,
    })
    return NextResponse.json({ rows })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const body = (await request.json()) as {
      contact_id?: unknown
      assigned_user_id?: unknown
      resource_id?: unknown
      start_at?: unknown
      end_at?: unknown
      status?: unknown
      notes?: unknown
    }

    if (
      typeof body.contact_id !== 'string' ||
      typeof body.assigned_user_id !== 'string' ||
      typeof body.start_at !== 'string' ||
      typeof body.end_at !== 'string'
    ) {
      return NextResponse.json(
        { error: 'contact_id, assigned_user_id, start_at and end_at are required' },
        { status: 400 },
      )
    }
    if (new Date(body.end_at) <= new Date(body.start_at)) {
      return NextResponse.json({ error: 'end_at must be after start_at' }, { status: 400 })
    }

    const appointment = await createAppointment(ctx.accountId, {
      contact_id: body.contact_id,
      assigned_user_id: body.assigned_user_id,
      resource_id: typeof body.resource_id === 'string' ? body.resource_id : null,
      start_at: body.start_at,
      end_at: body.end_at,
      status: body.status as never,
      notes: typeof body.notes === 'string' ? body.notes : null,
    })
    return NextResponse.json({ appointment }, { status: 201 })
  } catch (err) {
    if (err instanceof AppointmentError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
