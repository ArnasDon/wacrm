// ============================================================
// src/lib/appointments/queries.ts — primitiva Appointment (agenda
// interna). Solo consultas/escrituras con tenancy estricta por
// account_id (RLS + service-role: el admin client salta RLS, así que
// TODA query filtra account_id explícitamente — misma regla que
// /reports).
//
// Reutiliza: contacts (FK), auth.users (assigned_user_id),
// appointment_resources (sala), runAutomationsForTrigger (eventos →
// Automation). NO crea contacto/doctor/notas/scheduler nuevos.
// ============================================================

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { runAutomationsForTrigger } from '@/lib/automations/engine'

// ------------------------------------------------------------
// Loop de conversiones (prompt "cerrar el loop"): la cita emite sus
// eventos canónicos en tracking_events. appointment_booked al crear,
// appointment_showed al marcarla completed. Event_id DETERMINÍSTICO
// derivado de la cita (`appt_booked_<id>`): reintentos y re-ejecuciones
// producen el mismo event_id → el UNIQUE de tracking_events los
// descarta → Google/Meta reciben la conversión una sola vez. Se
// propaga la atribución del contacto (de donde vino el anuncio).
// ------------------------------------------------------------
async function recordConversionEvent(params: {
  accountId: string
  appointment: Appointment
  eventType: 'appointment_booked' | 'appointment_showed'
}): Promise<void> {
  const { accountId, appointment, eventType } = params
  const { data: contact } = await supabaseAdmin()
    .from('contacts')
    .select('attribution')
    .eq('id', appointment.contact_id)
    .eq('account_id', accountId)
    .maybeSingle()
  const eventId = `${eventType === 'appointment_booked' ? 'appt_booked' : 'appt_showed'}_${appointment.id}`
  const { error } = await supabaseAdmin()
    .from('tracking_events')
    .upsert(
      {
        account_id: accountId,
        contact_id: appointment.contact_id,
        appointment_id: appointment.id,
        event_id: eventId,
        event_type: eventType,
        attribution: (contact?.attribution as Record<string, unknown> | null) ?? null,
        payload: {
          appointment_id: appointment.id,
          appointment_start_at: appointment.start_at,
          appointment_end_at: appointment.end_at,
          appointment_status: appointment.status,
        },
      },
      { onConflict: 'event_id', ignoreDuplicates: true }
    )
  if (error) {
    console.error(`[appointments] ${eventType} event error:`, error)
  }
}

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'completed'
  | 'cancelled'
  | 'no_show'

export interface Appointment {
  id: string
  account_id: string
  contact_id: string
  assigned_user_id: string
  resource_id: string | null
  start_at: string
  end_at: string
  status: AppointmentStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export interface AppointmentWithMeta extends Appointment {
  contact_name?: string | null
  contact_phone?: string | null
  resource_name?: string | null
}

export interface AppointmentInput {
  contact_id: string
  assigned_user_id: string
  resource_id?: string | null
  start_at: string
  end_at: string
  status?: AppointmentStatus
  notes?: string | null
}

export class AppointmentError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AppointmentError'
    this.status = status
  }
}

// ------------------------------------------------------------
// Conflictos — overlap simple (sin motor de disponibilidad).
//   existing.start_at < new.end_at AND existing.end_at > new.start_at
// Solo se valida lo que realmente esté asignado: doctor (siempre) y
// sala (si resource_id != null). Se ignora la propia cita (`excludeId`)
// para permitir reschedule/update sin auto-conflicto.
// ------------------------------------------------------------
export async function findConflicts(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  input: { start_at: string; end_at: string; assigned_user_id: string; resource_id?: string | null },
  excludeId?: string,
): Promise<AppointmentWithMeta[]> {
  const overlap = (query: {
    from: string
    col: string
    val: string
  }) =>
    db
      .from('appointments')
      .select('id, contact_id, assigned_user_id, resource_id, start_at, end_at, status')
      .eq('account_id', accountId)
      .eq(query.col, query.val)
      .lt('start_at', input.end_at)
      .gt('end_at', input.start_at)
      .neq('status', 'cancelled')
      .order('start_at', { ascending: true })

  const byAssigned = await overlap({
    from: 'appointments',
    col: 'assigned_user_id',
    val: input.assigned_user_id,
  })
  let rows = (byAssigned.data ?? []) as AppointmentWithMeta[]

  if (input.resource_id) {
    const byResource = await overlap({
      from: 'appointments',
      col: 'resource_id',
      val: input.resource_id,
    })
    const resourceRows = (byResource.data ?? []) as AppointmentWithMeta[]
    const seen = new Set(rows.map((r) => r.id))
    rows = rows.concat(resourceRows.filter((r) => !seen.has(r.id)))
  }

  if (excludeId) rows = rows.filter((r) => r.id !== excludeId)
  return rows
}

/** ¿El doctor o la sala ya tienen una cita que solape? (para mensajes de error) */
export function describeConflict(conflicts: AppointmentWithMeta[] | null | undefined): string | null {
  if (!conflicts || conflicts.length === 0) return null
  const first = conflicts[0]
  // toLocaleString depende del locale del entorno (server), que puede no
  // coincidir con el del cliente; usamos una representación estable para
  // que el mensaje y los tests no dependan de la máquina donde corre.
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { timeZone: 'UTC' })
  const span = `${fmt(first.start_at)} – ${fmt(first.end_at)}`
  return `Overlaps an existing appointment (${span})`
}

// ------------------------------------------------------------
// Load — rango + filtros opcionales (doctor / sala / contacto).
// Tenancy: account_id + filtros dentro del mismo account.
// ------------------------------------------------------------
export async function loadAppointments(
  accountId: string,
  opts: {
    from?: string
    to?: string
    assigned_user_id?: string
    resource_id?: string
    contact_id?: string
    status?: AppointmentStatus
  } = {},
): Promise<AppointmentWithMeta[]> {
  const db = supabaseAdmin()
  let query = db
    .from('appointments')
    .select(
      '*, contacts(name, phone), appointment_resources(name)',
    )
    .eq('account_id', accountId)

  if (opts.from) query = query.gte('start_at', opts.from)
  if (opts.to) query = query.lt('start_at', opts.to)
  if (opts.assigned_user_id) query = query.eq('assigned_user_id', opts.assigned_user_id)
  if (opts.resource_id) query = query.eq('resource_id', opts.resource_id)
  if (opts.contact_id) query = query.eq('contact_id', opts.contact_id)
  if (opts.status) query = query.eq('status', opts.status)

  query = query.order('start_at', { ascending: true })

  const { data, error } = await query
  if (error) throw new AppointmentError(500, error.message)
  return (data ?? []).map(flattenMeta)
}

function flattenMeta(row: Record<string, unknown>): AppointmentWithMeta {
  const contact = (row.contacts ?? null) as
    | { name?: string | null; phone?: string | null }
    | null
  const resource = (row.appointment_resources ?? null) as
    | { name?: string | null }
    | null
  const { contacts, appointment_resources, ...rest } = row
  return {
    ...(rest as unknown as Appointment),
    contact_name: contact?.name ?? null,
    contact_phone: contact?.phone ?? null,
    resource_name: resource?.name ?? null,
  }
}

// ------------------------------------------------------------
// Create / Update / Status
// ------------------------------------------------------------
export async function createAppointment(
  accountId: string,
  input: AppointmentInput,
): Promise<AppointmentWithMeta> {
  const db = supabaseAdmin()
  const conflicts = await findConflicts(db, accountId, input)
  if (conflicts.length > 0) {
    throw new AppointmentError(409, describeConflict(conflicts) ?? 'conflict')
  }
  const { data, error } = await db
    .from('appointments')
    .insert({
      account_id: accountId,
      contact_id: input.contact_id,
      assigned_user_id: input.assigned_user_id,
      resource_id: input.resource_id ?? null,
      start_at: input.start_at,
      end_at: input.end_at,
      status: input.status ?? 'scheduled',
      notes: input.notes ?? null,
    })
    .select(
      '*, contacts(name, phone), appointment_resources(name)',
    )
    .single()
  if (error) throw new AppointmentError(500, error.message)

  await dispatchAppointmentEvent(accountId, data as Appointment, 'appointment_created')
  // Loop de conversiones: la reserva ES el evento appointment_booked.
  await recordConversionEvent({
    accountId,
    appointment: data as Appointment,
    eventType: 'appointment_booked',
  })
  return flattenMeta(data as unknown as Record<string, unknown>)
}

/**
 * Update de campos (incluido reschedule: start_at/end_at) con
 * re-validación de conflictos. Reutiliza el mismo appointment.id.
 */
export async function updateAppointment(
  accountId: string,
  id: string,
  patch: Partial<AppointmentInput>,
  event: 'appointment_updated' | 'appointment_rescheduled',
): Promise<AppointmentWithMeta> {
  const db = supabaseAdmin()

  const { data: current } = await db
    .from('appointments')
    .select('*')
    .eq('id', id)
    .eq('account_id', accountId)
    .maybeSingle()
  if (!current) throw new AppointmentError(404, 'Appointment not found')

  const merged: AppointmentInput = {
    contact_id: (patch.contact_id as string) ?? current.contact_id,
    assigned_user_id: (patch.assigned_user_id as string) ?? current.assigned_user_id,
    resource_id: patch.resource_id !== undefined ? patch.resource_id : current.resource_id,
    start_at: (patch.start_at as string) ?? current.start_at,
    end_at: (patch.end_at as string) ?? current.end_at,
    status: (patch.status as AppointmentStatus) ?? current.status,
    notes: patch.notes !== undefined ? patch.notes : current.notes,
  }

  // Reschedule / reassign → re-validar overlap (sin auto-conflicto).
  const conflicts = await findConflicts(db, accountId, merged, id)
  if (conflicts.length > 0) {
    throw new AppointmentError(409, describeConflict(conflicts) ?? 'conflict')
  }

  const { data, error } = await db
    .from('appointments')
    .update({
      contact_id: merged.contact_id,
      assigned_user_id: merged.assigned_user_id,
      resource_id: merged.resource_id,
      start_at: merged.start_at,
      end_at: merged.end_at,
      status: merged.status,
      notes: merged.notes,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('account_id', accountId)
    .select('*, contacts(name, phone), appointment_resources(name)')
    .single()
  if (error) throw new AppointmentError(500, error.message)

  await dispatchAppointmentEvent(accountId, data as Appointment, event)
  // Loop de conversiones: la cita realizada (completed) ES el evento
  // appointment_showed. Solo en la transición scheduled/confirmed → completed.
  if (merged.status === 'completed' && current.status !== 'completed') {
    await recordConversionEvent({
      accountId,
      appointment: data as Appointment,
      eventType: 'appointment_showed',
    })
  }
  return flattenMeta(data as unknown as Record<string, unknown>)
}

/** Transiciones de estado (complete / cancel / no_show / confirm). */
export async function setAppointmentStatus(
  accountId: string,
  id: string,
  status: AppointmentStatus,
): Promise<AppointmentWithMeta> {
  const event: Record<AppointmentStatus, string> = {
    scheduled: 'appointment_updated',
    confirmed: 'appointment_updated',
    completed: 'appointment_completed',
    cancelled: 'appointment_cancelled',
    no_show: 'appointment_no_show',
  }
  return updateAppointment(accountId, id, { status }, event[status] as 'appointment_updated')
}

export async function deleteAppointment(accountId: string, id: string): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db
    .from('appointments')
    .delete()
    .eq('id', id)
    .eq('account_id', accountId)
  if (error) throw new AppointmentError(500, error.message)
}

// ------------------------------------------------------------
// Eventos → Automation
//
// La cita emite su lifecycle (appointment.created, .cancelled, …) y
// Automation decide qué hacer (confirmación por WhatsApp/email, tareas
// de seguimiento en no_show, etc.). Nada de esto es scheduler nuevo: el
// engine existente (wait step + pending_executions + cron) maneja
// reminders relativos vía vars.appointment_start_at.
// ------------------------------------------------------------
async function dispatchAppointmentEvent(
  accountId: string,
  appointment: Appointment,
  triggerType: Parameters<typeof runAutomationsForTrigger>[0]['triggerType'],
): Promise<void> {
  try {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: appointment.contact_id,
      context: {
        vars: {
          appointment_id: appointment.id,
          appointment_start_at: appointment.start_at,
          appointment_end_at: appointment.end_at,
          appointment_status: appointment.status,
          appointment_assigned_user_id: appointment.assigned_user_id,
          appointment_resource_id: appointment.resource_id,
        },
      },
    })
  } catch (err) {
    console.error(`[appointments] ${triggerType} dispatch failed:`, err)
  }
}

// ------------------------------------------------------------
// Resources (salas) — CRUD mínimo
// ------------------------------------------------------------
export interface AppointmentResource {
  id: string
  account_id: string
  name: string
}

export async function listResources(accountId: string): Promise<AppointmentResource[]> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('appointment_resources')
    .select('*')
    .eq('account_id', accountId)
    .order('name', { ascending: true })
  if (error) throw new AppointmentError(500, error.message)
  return (data ?? []) as AppointmentResource[]
}

export async function createResource(accountId: string, name: string): Promise<AppointmentResource> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('appointment_resources')
    .insert({ account_id: accountId, name })
    .select('*')
    .single()
  if (error) throw new AppointmentError(500, error.message)
  return data as AppointmentResource
}

export async function deleteResource(accountId: string, id: string): Promise<void> {
  const db = supabaseAdmin()
  const { error } = await db
    .from('appointment_resources')
    .delete()
    .eq('id', id)
    .eq('account_id', accountId)
  if (error) throw new AppointmentError(500, error.message)
}
