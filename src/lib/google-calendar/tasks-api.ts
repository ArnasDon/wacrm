import type { SupabaseClient } from '@supabase/supabase-js'
import { getValidAccessToken, googleFetch, GoogleCalendarError } from './oauth'

// ============================================================
// Mirrors a CRM task (migration 097) into Google Tasks — a separate
// Google API (tasks.googleapis.com) from the Calendar API in api.ts,
// but authorized by the same OAuth connection (see the `tasks` scope
// added in oauth.ts). Every function here is meant to be called
// best-effort from src/app/api/tasks/*.ts: a Google-side failure
// (not connected, insufficient scope on an account that connected
// before this feature existed, a transient error) must never fail the
// underlying CRM task create/update/delete — callers wrap these in
// try/catch and log, never propagate.
//
// The one Google Tasks list every account has is addressed by the
// literal alias '@default' — there is no "create a list" step needed.
// ============================================================

const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'

/** Stored verbatim on the CRM task row alongside the returned task id
 *  — see the migration 103 comment for why. */
export const DEFAULT_TASK_LIST_ID = '@default'

/** `true` only when the account has a Google Calendar connection on
 *  file. Callers check this first so a Sheets-only account (or one
 *  that never connected Google at all) skips straight past Google
 *  Tasks with no wasted round trip or noisy error. */
export async function hasGoogleCalendarConnected(
  db: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const { data } = await db
    .from('google_calendar_config')
    .select('status')
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as { status: string } | null)?.status === 'connected'
}

interface GoogleTaskResource {
  id: string
  title?: string
  notes?: string
  due?: string
  status?: string
}

export interface CreateGoogleTaskArgs {
  title: string
  notes?: string | null
  /** ISO 8601. Google Tasks only ever displays the DATE portion of
   *  this in its own UI (the API accepts a full timestamp, but the
   *  time-of-day is not shown to the user there) — the CRM's own
   *  due-time reminder is unaffected, this only mirrors the date. */
  dueISO?: string | null
}

export interface GoogleTaskRef {
  googleTaskId: string
  googleTaskListId: string
}

/** Creates the mirrored task. Returns `null` (never throws) when the
 *  account has no Google Calendar connection — the one case that is
 *  not a failure, just "nothing to mirror to". A genuine API error
 *  still throws `GoogleCalendarError`, for the caller's own
 *  try/catch+log to swallow. */
export async function createGoogleTask(
  db: SupabaseClient,
  accountId: string,
  args: CreateGoogleTaskArgs,
): Promise<GoogleTaskRef | null> {
  if (!(await hasGoogleCalendarConnected(db, accountId))) return null

  const accessToken = await getValidAccessToken(db, accountId)
  const res = await googleFetch(
    `${TASKS_API}/lists/${DEFAULT_TASK_LIST_ID}/tasks`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: args.title,
        notes: args.notes || undefined,
        due: args.dueISO || undefined,
      }),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleCalendarError(`Google Tasks creation failed: ${body}`, 502)
  }
  const data = (await res.json()) as GoogleTaskResource
  return { googleTaskId: data.id, googleTaskListId: DEFAULT_TASK_LIST_ID }
}

export interface UpdateGoogleTaskArgs {
  title?: string
  /** `null` clears the note; `undefined` leaves it untouched. */
  notes?: string | null
  /** `null` clears the due date; `undefined` leaves it untouched. */
  dueISO?: string | null
  done?: boolean
}

/** Patches an already-mirrored task. Silently does nothing when the
 *  account's Google connection is gone (disconnected since the task
 *  was created) — same "not an error" reasoning as createGoogleTask. */
export async function updateGoogleTask(
  db: SupabaseClient,
  accountId: string,
  ref: GoogleTaskRef,
  patch: UpdateGoogleTaskArgs,
): Promise<void> {
  if (!(await hasGoogleCalendarConnected(db, accountId))) return

  const body: Record<string, unknown> = {}
  if (patch.title !== undefined) body.title = patch.title
  if (patch.notes !== undefined) body.notes = patch.notes
  if (patch.dueISO !== undefined) body.due = patch.dueISO
  if (patch.done !== undefined) body.status = patch.done ? 'completed' : 'needsAction'
  if (Object.keys(body).length === 0) return

  const accessToken = await getValidAccessToken(db, accountId)
  const res = await googleFetch(
    `${TASKS_API}/lists/${encodeURIComponent(ref.googleTaskListId)}/tasks/${encodeURIComponent(ref.googleTaskId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) {
    const body2 = await res.text().catch(() => '')
    throw new GoogleCalendarError(`Google Tasks update failed: ${body2}`, 502)
  }
}

/** Deletes a mirrored task. A 404 (already gone on Google's side —
 *  e.g. the owner deleted it there directly) is treated as success,
 *  not an error: the end state the caller wants (no such Google Task)
 *  is already true. */
export async function deleteGoogleTask(
  db: SupabaseClient,
  accountId: string,
  ref: GoogleTaskRef,
): Promise<void> {
  if (!(await hasGoogleCalendarConnected(db, accountId))) return

  const accessToken = await getValidAccessToken(db, accountId)
  const res = await googleFetch(
    `${TASKS_API}/lists/${encodeURIComponent(ref.googleTaskListId)}/tasks/${encodeURIComponent(ref.googleTaskId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '')
    throw new GoogleCalendarError(`Google Tasks deletion failed: ${body}`, 502)
  }
}
