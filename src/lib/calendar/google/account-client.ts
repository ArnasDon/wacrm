import type { CalendarConfig } from '@/lib/eter/repo/calendar-config.repo'
import {
  createEvent,
  deleteEvent,
  getBusySlots,
  googleOAuthCredentialsFromEnv,
  refreshAccessToken,
  updateEvent,
  type BusyInterval,
  type CalendarEvent,
  type CalendarEventInput,
  type HttpClient,
} from './client'

// ============================================================
// Binds the low-level Google client (client.ts) to one account's
// calendar connection: exchanges the decrypted refresh token for an
// access token once, then exposes calendarId/timezone-scoped methods so
// tool handlers never juggle tokens or ids themselves.
//
// Google refresh tokens rarely rotate, but when they do, the new one
// must be persisted or every future refresh fails — `rotatedRefreshToken`
// surfaces that so the caller (the tool-executor setup, which already
// holds the account's `db` + `accountId`) can call
// `updateCalendarConfigRefreshToken` when it's non-null. This module
// deliberately does NOT persist it itself — it has no business knowing
// about `calendar_configs` writes, only reads via the `CalendarConfig`
// it's given.
// ============================================================

export interface AccountCalendarClient {
  calendarId: string
  timezone: string
  /** Non-null only when Google rotated the refresh token on this
   *  exchange — see the module doc above. */
  rotatedRefreshToken: string | null
  getBusySlots(range: { start: Date; end: Date }): Promise<BusyInterval[]>
  createEvent(input: Omit<CalendarEventInput, 'timezone'>): Promise<CalendarEvent>
  updateEvent(eventId: string, input: Omit<CalendarEventInput, 'timezone'>): Promise<CalendarEvent>
  deleteEvent(eventId: string): Promise<void>
}

export async function createAccountCalendarClient(
  config: CalendarConfig,
  http?: HttpClient,
): Promise<AccountCalendarClient> {
  const creds = googleOAuthCredentialsFromEnv()
  const tokens = await refreshAccessToken(config.refreshToken, creds, http)

  return {
    calendarId: config.calendarId,
    timezone: config.timezone,
    rotatedRefreshToken: tokens.rotatedRefreshToken,
    getBusySlots: (range) => getBusySlots(tokens.accessToken, config.calendarId, range, http),
    createEvent: (input) =>
      createEvent(tokens.accessToken, config.calendarId, { ...input, timezone: config.timezone }, http),
    updateEvent: (eventId, input) =>
      updateEvent(
        tokens.accessToken,
        config.calendarId,
        eventId,
        { ...input, timezone: config.timezone },
        http,
      ),
    deleteEvent: (eventId) => deleteEvent(tokens.accessToken, config.calendarId, eventId, http),
  }
}
