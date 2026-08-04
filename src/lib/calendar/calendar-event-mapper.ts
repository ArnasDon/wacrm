import type { Appointment } from '@/types';
import type { CalendarEvent } from './calendar-event';

/**
 * Turns a wacrm Appointment into the provider-agnostic shape
 * CalendarProvider implementations consume. Combines scheduled_date +
 * scheduled_time into a local ISO instant; an appointment with no
 * time maps to an all-day event. scheduled_end_time (migration 046),
 * when present, maps straight to endAt — otherwise providers fall
 * back to their own default duration, per CalendarEvent's doc comment.
 */
export function mapAppointmentToCalendarEvent(appointment: Appointment): CalendarEvent {
  const allDay = !appointment.scheduled_time;
  const startAt = allDay
    ? `${appointment.scheduled_date}T00:00:00`
    : `${appointment.scheduled_date}T${appointment.scheduled_time}`;
  const endAt =
    !allDay && appointment.scheduled_end_time
      ? `${appointment.scheduled_date}T${appointment.scheduled_end_time}`
      : null;

  return {
    title: appointment.title,
    description:
      [appointment.description, appointment.notes].filter(Boolean).join('\n\n') || null,
    startAt,
    endAt,
    allDay,
  };
}
