import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment, AppointmentStatus, AppointmentType } from '@/types';

type DB = SupabaseClient;

// ------------------------------------------------------------
// Appointments — the Agenda module backing "Agenda da Semana" on the
// dashboard, and future monthly calendar / reminders / Google
// Calendar sync (migrations 041, 045). Kept as a standalone data
// layer so those future surfaces can reuse these functions instead
// of the dashboard reaching into appointments directly.
// ------------------------------------------------------------

const APPOINTMENT_SELECT = '*, contact:contacts(id, name, phone), property:properties(id, name)';

export async function listAppointmentsByDate(db: DB, dateKey: string): Promise<Appointment[]> {
  const { data, error } = await db
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .eq('scheduled_date', dateKey)
    .neq('status', 'cancelled')
    // Timed appointments sort chronologically first; an untimed entry
    // (no scheduled_time) reads as "sometime today" and sorts last.
    .order('scheduled_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Appointment[];
}

/**
 * All appointments across a set of local-day keys (e.g. the 6 keys
 * from getWeekDates) in one round trip. Grouping by day and sorting
 * within each day is the caller's job (AgendaWeek does it client-side
 * — the row count here is small enough that a second query per day
 * would just be more round trips for no benefit).
 */
export async function listAppointmentsByDateRange(
  db: DB,
  dateKeys: string[],
): Promise<Appointment[]> {
  if (dateKeys.length === 0) return [];
  const { data, error } = await db
    .from('appointments')
    .select(APPOINTMENT_SELECT)
    .in('scheduled_date', dateKeys)
    .neq('status', 'cancelled')
    .order('scheduled_date', { ascending: true })
    .order('scheduled_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Appointment[];
}

export interface SaveAppointmentInput {
  accountId: string;
  userId: string;
  title: string;
  description: string | null;
  notes: string | null;
  type: AppointmentType;
  scheduledDate: string;
  scheduledTime: string | null;
  scheduledEndTime: string | null;
  contactId: string | null;
  propertyId: string | null;
}

export async function createAppointment(db: DB, input: SaveAppointmentInput): Promise<void> {
  const { error } = await db.from('appointments').insert({
    account_id: input.accountId,
    user_id: input.userId,
    title: input.title,
    description: input.description,
    notes: input.notes,
    type: input.type,
    scheduled_date: input.scheduledDate,
    scheduled_time: input.scheduledTime,
    scheduled_end_time: input.scheduledEndTime,
    contact_id: input.contactId,
    property_id: input.propertyId,
  });
  if (error) throw error;
}

export async function updateAppointment(
  db: DB,
  id: string,
  input: SaveAppointmentInput,
): Promise<void> {
  const { error } = await db
    .from('appointments')
    .update({
      title: input.title,
      description: input.description,
      notes: input.notes,
      type: input.type,
      scheduled_date: input.scheduledDate,
      scheduled_time: input.scheduledTime,
      scheduled_end_time: input.scheduledEndTime,
      contact_id: input.contactId,
      property_id: input.propertyId,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function updateAppointmentStatus(
  db: DB,
  id: string,
  status: AppointmentStatus,
): Promise<void> {
  const { error } = await db.from('appointments').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function deleteAppointment(db: DB, id: string): Promise<void> {
  const { error } = await db.from('appointments').delete().eq('id', id);
  if (error) throw error;
}
