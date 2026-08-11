import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { createGoogleCalendarProviderForUser, CalendarSyncService } from '@/lib/calendar';
import type { Appointment } from '@/types';

/**
 * POST /api/calendar/sync  — body { appointmentId }
 *
 * Pushes one appointment to the caller's connected Google Calendar
 * (create if it has no external_calendar_id yet, else update).
 * Called fire-and-forget from appointment-form-dialog.tsx right after
 * a create/update save succeeds — see that component for why this is
 * never allowed to block or fail the save itself.
 *
 * Appointments have no assignee field (every appointment's `user_id`
 * is whoever was signed in when it was created — see
 * appointment-form-dialog.tsx), so "the caller" and "the appointment
 * owner" are always the same person; no cross-user connection lookup
 * is needed here.
 *
 * Always 200 — "not connected" and "sync failed" are both reported in
 * the body, not as HTTP errors, since neither means the request
 * itself was invalid.
 */
export async function POST(request: Request) {
  try {
    const { userId, supabase } = await getCurrentAccount();
    const { appointmentId } = (await request.json()) as { appointmentId?: string };
    if (!appointmentId) {
      return NextResponse.json({ error: 'appointmentId is required' }, { status: 400 });
    }

    const { data: appointment, error: fetchError } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', appointmentId)
      .maybeSingle<Appointment>();
    if (fetchError) throw fetchError;
    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const provider = await createGoogleCalendarProviderForUser(supabase, userId);
    if (!provider) {
      return NextResponse.json({ synced: false, reason: 'not_connected' });
    }

    try {
      await new CalendarSyncService(supabase, provider).sync(appointment);
      return NextResponse.json({ synced: true });
    } catch (err) {
      // CalendarSyncService already persisted sync_status = 'error' on
      // the appointment row — this is a soft failure, not a 500.
      console.error('[calendar/sync] sync failed:', err);
      return NextResponse.json({ synced: false, reason: 'sync_failed' });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/calendar/sync  — body { externalCalendarId }
 *
 * Removes one event from the caller's Google Calendar. Takes the
 * external id directly rather than an appointmentId because this is
 * always called right *before* the local appointment row is deleted
 * (see appointment-detail-sheet.tsx) — by the time it would matter,
 * the row is already gone.
 */
export async function DELETE(request: Request) {
  try {
    const { userId, supabase } = await getCurrentAccount();
    const { externalCalendarId } = (await request.json()) as { externalCalendarId?: string };
    if (!externalCalendarId) {
      return NextResponse.json({ error: 'externalCalendarId is required' }, { status: 400 });
    }

    const provider = await createGoogleCalendarProviderForUser(supabase, userId);
    if (!provider) {
      return NextResponse.json({ deleted: false, reason: 'not_connected' });
    }

    try {
      await provider.deleteEvent(externalCalendarId);
      return NextResponse.json({ deleted: true });
    } catch (err) {
      console.error('[calendar/sync] delete failed:', err);
      return NextResponse.json({ deleted: false, reason: 'delete_failed' });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
