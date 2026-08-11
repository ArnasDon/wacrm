import type { SupabaseClient } from '@supabase/supabase-js';

type DB = SupabaseClient;

export interface CalendarConnectionSummary {
  googleEmail: string;
}

/**
 * The signed-in user's own Google Calendar connection, or `null` if
 * they haven't connected one. RLS (`calendar_connections_own`,
 * migration 053) already restricts this to the caller's own row, so
 * no explicit `user_id` filter is needed — a bare select can't see
 * anyone else's connection regardless.
 */
export async function getMyCalendarConnection(db: DB): Promise<CalendarConnectionSummary | null> {
  const { data, error } = await db
    .from('calendar_connections')
    .select('google_email')
    .maybeSingle();
  if (error) throw error;
  return data ? { googleEmail: data.google_email } : null;
}

/**
 * Deletes the caller's own connection row. Takes `userId` explicitly
 * (rather than relying on RLS alone with an unfiltered `.delete()`)
 * so the query itself is scoped, not just enforced server-side — RLS
 * is still the real guarantee, this is belt-and-braces.
 */
export async function disconnectMyCalendar(db: DB, userId: string): Promise<void> {
  const { error } = await db.from('calendar_connections').delete().eq('user_id', userId);
  if (error) throw error;
}
