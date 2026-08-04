import type { CalendarEvent } from './calendar-event';
import type { CalendarProvider } from './calendar-provider';

/**
 * NOT IMPLEMENTED. Scaffolding only — no OAuth, no Google API calls.
 * Every method throws so a future implementer gets a clear signal
 * instead of a silent no-op, and so CalendarSyncService's error path
 * is exercised the same way it will be once this is real.
 *
 * Wiring this up for real needs, roughly:
 *   1. An OAuth consent flow + per-account token storage (a new
 *      `calendar_connections` table — account_id, provider, access/
 *      refresh tokens, scopes, connected_at).
 *   2. The `googleapis` client (or a direct REST call) using those
 *      tokens to hit the Google Calendar API.
 *   3. `isConfigured()` below actually checking for a stored
 *      connection instead of always returning false.
 *   4. Wiring CalendarSyncService into appointment create/update (and
 *      probably a "Conectar Google Calendar" settings flow — see the
 *      disabled button already placed in the Agenda da Semana header).
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = 'google_calendar';

  isConfigured(): boolean {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature required by CalendarProvider; stub never reads it
  async createEvent(event: CalendarEvent): Promise<{ externalId: string }> {
    throw new Error('GoogleCalendarProvider is not implemented yet.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature required by CalendarProvider; stub never reads it
  async updateEvent(externalId: string, event: CalendarEvent): Promise<void> {
    throw new Error('GoogleCalendarProvider is not implemented yet.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature required by CalendarProvider; stub never reads it
  async deleteEvent(externalId: string): Promise<void> {
    throw new Error('GoogleCalendarProvider is not implemented yet.');
  }
}
