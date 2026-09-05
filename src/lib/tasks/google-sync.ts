import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createGoogleTask,
  deleteGoogleTask,
  updateGoogleTask,
  type GoogleTaskRef,
} from '@/lib/google-calendar/tasks-api'

// ============================================================
// Thin orchestration between the tasks API routes (src/app/api/
// tasks/*.ts) and the Google Tasks client (google-calendar/tasks-
// api.ts): does the "call Google, then persist the result on the CRM
// task row" bookkeeping, and — the important part — swallows every
// failure. Mirroring a task into Google is a nice-to-have layered on
// top of the CRM's own task/reminder system (which works regardless);
// a slow or erroring Google API must never turn into a failed task
// create/update/delete for the owner. Every export here is meant to
// be called as `void syncX(...).catch(...)` (or already catches
// internally) from a route handler that has already sent its own
// response, or is safe to run before it either way.
// ============================================================

/** Fire right after a task is inserted. Best-effort end to end —
 *  logs and returns on any failure, including "Google Calendar isn't
 *  connected for this account" (createGoogleTask itself returns
 *  `null` for that case, not an error). */
export async function syncNewTaskToGoogle(
  db: SupabaseClient,
  accountId: string,
  taskId: string,
  args: { title: string; notes: string | null; dueISO: string | null },
): Promise<void> {
  try {
    const ref = await createGoogleTask(db, accountId, {
      title: args.title,
      notes: args.notes,
      dueISO: args.dueISO,
    })
    if (!ref) return
    const { error } = await db
      .from('tasks')
      .update({ google_task_id: ref.googleTaskId, google_task_list_id: ref.googleTaskListId })
      .eq('id', taskId)
    if (error) console.error('[tasks/google-sync] failed to persist google_task_id:', error)
  } catch (err) {
    console.error('[tasks/google-sync] create failed:', err)
  }
}

/** Fire right after a task update that touched title/notes/due_at/
 *  status. No-ops when the task was never mirrored (`google_task_id`
 *  is null) — see the migration 103 comment for why that's not
 *  retried here. */
export async function syncUpdatedTaskToGoogle(
  db: SupabaseClient,
  accountId: string,
  task: {
    google_task_id: string | null
    google_task_list_id: string | null
  },
  patch: { title?: string; notes?: string | null; dueISO?: string | null; done?: boolean },
): Promise<void> {
  if (!task.google_task_id || !task.google_task_list_id) return
  const ref: GoogleTaskRef = {
    googleTaskId: task.google_task_id,
    googleTaskListId: task.google_task_list_id,
  }
  try {
    await updateGoogleTask(db, accountId, ref, patch)
  } catch (err) {
    console.error('[tasks/google-sync] update failed:', err)
  }
}

/** Fire right after a task delete. No-ops when it was never mirrored. */
export async function syncDeletedTaskToGoogle(
  db: SupabaseClient,
  accountId: string,
  task: { google_task_id: string | null; google_task_list_id: string | null },
): Promise<void> {
  if (!task.google_task_id || !task.google_task_list_id) return
  const ref: GoogleTaskRef = {
    googleTaskId: task.google_task_id,
    googleTaskListId: task.google_task_list_id,
  }
  try {
    await deleteGoogleTask(db, accountId, ref)
  } catch (err) {
    console.error('[tasks/google-sync] delete failed:', err)
  }
}
