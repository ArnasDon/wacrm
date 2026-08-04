import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment, AppointmentStatus, AppointmentType } from '@/types';

type DB = SupabaseClient;

// ------------------------------------------------------------
// Appointments — the Agenda module backing "Agenda do Dia" on the
// dashboard today, and a monthly calendar / reminders / WhatsApp /
// Google Calendar sync later (migration 041). Kept as a standalone
// data layer so those future surfaces can reuse these functions
// instead of the dashboard reaching into appointments directly.
// ------------------------------------------------------------

export async function listAppointmentsByDate(db: DB, dateKey: string): Promise<Appointment[]> {
  const { data, error } = await db
    .from('appointments')
    .select('*, contact:contacts(id, name, phone)')
    .eq('scheduled_date', dateKey)
    .neq('status', 'cancelled')
    // Timed appointments sort chronologically first; an untimed entry
    // (no scheduled_time) reads as "sometime today" and sorts last.
    .order('scheduled_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Appointment[];
}

export interface SaveAppointmentInput {
  accountId: string;
  userId: string;
  title: string;
  description: string | null;
  type: AppointmentType;
  scheduledDate: string;
  scheduledTime: string | null;
  contactId: string | null;
}

export async function createAppointment(db: DB, input: SaveAppointmentInput): Promise<void> {
  const { error } = await db.from('appointments').insert({
    account_id: input.accountId,
    user_id: input.userId,
    title: input.title,
    description: input.description,
    type: input.type,
    scheduled_date: input.scheduledDate,
    scheduled_time: input.scheduledTime,
    contact_id: input.contactId,
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
      type: input.type,
      scheduled_date: input.scheduledDate,
      scheduled_time: input.scheduledTime,
      contact_id: input.contactId,
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
