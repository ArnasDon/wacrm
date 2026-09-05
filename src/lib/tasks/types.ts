// Follow-up tasks — shapes shared by the API, the hook and the UI.
// Migration 097_tasks.sql.

export const TASK_STATUSES = ['open', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  account_id: string;
  created_by: string;
  assigned_to: string | null;
  contact_id: string | null;
  deal_id: string | null;
  title: string;
  notes: string | null;
  due_at: string | null;
  status: TaskStatus;
  completed_at: string | null;
  reminder_sent_at: string | null;
  /** Set once this task is mirrored into Google Tasks (migration 103)
   *  — both null if the account has no Google Calendar connection, or
   *  the mirror attempt failed. See src/lib/tasks/google-sync.ts. */
  google_task_id: string | null;
  google_task_list_id: string | null;
  created_at: string;
  updated_at: string;
}

export const MAX_TASK_TITLE = 200;
export const MAX_TASK_NOTES = 2000;

export function isTaskStatus(v: unknown): v is TaskStatus {
  return typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);
}

/** open + past its due date */
export function isOverdue(task: Pick<Task, 'status' | 'due_at'>, now = Date.now()): boolean {
  return task.status === 'open' && task.due_at != null && Date.parse(task.due_at) < now;
}
