import { google, type Auth, type calendar_v3 } from 'googleapis';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { createGoogleOAuth2Client } from './google-oauth-client';
import type { CalendarEvent } from './calendar-event';
import type { CalendarProvider } from './calendar-provider';

// No stored per-account timezone anywhere in wacrm today —
// `scheduled_date`/`scheduled_time` are naive local values and
// date-utils.ts treats "today" as the *browser's* local timezone.
// For a self-hosted, effectively single-tenant CRM, the server's own
// runtime timezone is the closest available proxy for "the
// business's timezone" and is what we send Google alongside every
// timed event's `dateTime` (Google requires either a UTC offset or a
// paired `timeZone` — our naive strings have neither on their own).
const SERVER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000; // 1h — see CalendarEvent's doc comment on endAt

/**
 * Formats a `Date` back into a naive `YYYY-MM-DDTHH:mm:ss` string
 * using its LOCAL getters (getFullYear/getHours/etc — which reflect
 * the Node process's own timezone, i.e. SERVER_TIME_ZONE). Deliberately
 * not `.toISOString()`, which normalizes to UTC digits: pairing those
 * with `timeZone: SERVER_TIME_ZONE` below would tell Google to
 * interpret UTC wall-clock numbers as if they were server-local,
 * silently shifting the time by the server's UTC offset whenever
 * that offset isn't zero.
 */
function toLocalIsoString(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function toGoogleEvent(event: CalendarEvent): calendar_v3.Schema$Event {
  if (event.allDay) {
    // Google's all-day events use date-only start/end, with `end`
    // exclusive — a single-day event's end is the *next* calendar day.
    const start = event.startAt.slice(0, 10);
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    return {
      summary: event.title,
      description: event.description ?? undefined,
      start: { date: start },
      end: { date: end.toISOString().slice(0, 10) },
    };
  }

  const endAt =
    event.endAt ??
    toLocalIsoString(new Date(new Date(event.startAt).getTime() + DEFAULT_EVENT_DURATION_MS));

  return {
    summary: event.title,
    description: event.description ?? undefined,
    start: { dateTime: event.startAt, timeZone: SERVER_TIME_ZONE },
    end: { dateTime: endAt, timeZone: SERVER_TIME_ZONE },
  };
}

/** True for the "this event/calendar no longer exists" shape of a
 *  googleapis error — deleting something already gone should be a
 *  no-op, not a thrown error. */
function isGoneError(err: unknown): boolean {
  const status =
    (err as { code?: number })?.code ?? (err as { response?: { status?: number } })?.response?.status;
  return status === 404 || status === 410;
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly id = 'google_calendar';

  private constructor(private readonly calendar: calendar_v3.Calendar) {}

  static fromClient(oauth2Client: Auth.OAuth2Client): GoogleCalendarProvider {
    return new GoogleCalendarProvider(google.calendar({ version: 'v3', auth: oauth2Client }));
  }

  async createEvent(event: CalendarEvent): Promise<{ externalId: string }> {
    const { data } = await this.calendar.events.insert({
      calendarId: 'primary',
      requestBody: toGoogleEvent(event),
    });
    if (!data.id) {
      throw new Error('Google Calendar accepted the event but returned no id.');
    }
    return { externalId: data.id };
  }

  async updateEvent(externalId: string, event: CalendarEvent): Promise<void> {
    // Deliberately doesn't special-case a 404/410 (event deleted on
    // Google's side out-of-band) by recreating: CalendarProvider's
    // `updateEvent` returns void, so a recreated event's new id would
    // have nowhere to go without either changing that interface or
    // having CalendarSyncService re-fetch state after every update.
    // Simplest correct behavior: propagate the error — sync_status
    // ends up 'error', same as any other failed update — and let the
    // next edit's sync attempt (which re-reads external_calendar_id
    // fresh) surface the same error again rather than silently
    // piling up duplicate events on Google's side.
    await this.calendar.events.update({
      calendarId: 'primary',
      eventId: externalId,
      requestBody: toGoogleEvent(event),
    });
  }

  async deleteEvent(externalId: string): Promise<void> {
    try {
      await this.calendar.events.delete({ calendarId: 'primary', eventId: externalId });
    } catch (err) {
      if (isGoneError(err)) return;
      throw err;
    }
  }
}

interface StoredConnection {
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
}

async function persistRefreshedTokens(
  db: SupabaseClient,
  userId: string,
  tokens: Auth.Credentials,
): Promise<void> {
  const update: Record<string, string> = {};
  if (tokens.access_token) update.access_token_encrypted = encrypt(tokens.access_token);
  // Google only sends a new refresh_token when it rotates one (rare);
  // most refreshes only carry a new access_token + expiry.
  if (tokens.refresh_token) update.refresh_token_encrypted = encrypt(tokens.refresh_token);
  if (tokens.expiry_date) update.token_expires_at = new Date(tokens.expiry_date).toISOString();
  if (Object.keys(update).length === 0) return;

  const { error } = await db.from('calendar_connections').update(update).eq('user_id', userId);
  if (error) {
    // Best-effort: the in-flight calendar operation this refresh was
    // for still succeeds either way. Worst case, the next call
    // refreshes again — mildly wasteful, not broken.
    console.error('[GoogleCalendarProvider] failed to persist refreshed tokens:', error);
  }
}

/**
 * Loads the given user's stored Google Calendar connection (if any)
 * and returns a ready-to-use provider. Returns `null` — not an error
 * — when the user hasn't connected a calendar, so callers can treat
 * "not connected" as a normal, silent no-op rather than a failure.
 *
 * The returned provider auto-refreshes its access token on demand
 * (via `googleapis`' own refresh-on-401 handling) and persists the
 * refreshed token back to `calendar_connections` through `db` — pass
 * a client with write access to that table (the session-scoped SSR
 * client is fine; RLS already restricts each user to their own row).
 */
export async function createGoogleCalendarProviderForUser(
  db: SupabaseClient,
  userId: string,
): Promise<GoogleCalendarProvider | null> {
  const { data, error } = await db
    .from('calendar_connections')
    .select('access_token_encrypted, refresh_token_encrypted, token_expires_at')
    .eq('user_id', userId)
    .maybeSingle<StoredConnection>();
  if (error) throw error;
  if (!data) return null;

  // redirect_uri is only needed for the authorization-code exchange
  // (connect/callback routes); refreshing an existing token doesn't
  // use it, so an empty string is fine here.
  const oauth2Client = createGoogleOAuth2Client('');
  oauth2Client.setCredentials({
    access_token: decrypt(data.access_token_encrypted),
    refresh_token: decrypt(data.refresh_token_encrypted),
    expiry_date: new Date(data.token_expires_at).getTime(),
  });
  oauth2Client.on('tokens', (tokens) => {
    void persistRefreshedTokens(db, userId, tokens);
  });

  return GoogleCalendarProvider.fromClient(oauth2Client);
}
