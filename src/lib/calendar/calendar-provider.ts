import type { CalendarEvent } from './calendar-event';

/**
 * Contract any external calendar integration (Google Calendar today,
 * others potentially later) must satisfy. No implementation lives
 * here — see google-calendar-provider.ts.
 */
export interface CalendarProvider {
  /** Matches AppointmentSyncStatus's implied provider — 'google_calendar'
   *  for GoogleCalendarProvider. Used for logging/future multi-provider
   *  branching, not persisted anywhere yet. */
  readonly id: string;
  createEvent(event: CalendarEvent): Promise<{ externalId: string }>;
  updateEvent(externalId: string, event: CalendarEvent): Promise<void>;
  deleteEvent(externalId: string): Promise<void>;
}
