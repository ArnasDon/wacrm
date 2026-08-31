import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';

// Task due-reminder sweep. For every open task that has come due,
// has an assignee, and hasn't been nudged yet, insert one
// `notifications` row for the assignee and stamp `reminder_sent_at`.
// The migration-095 AFTER INSERT trigger on `notifications` fans that
// out to the assignee's devices as a Web Push — one integration
// point, no push code here.
//
// Schedule it (pg_cron) at whatever cadence matches how precise the
// reminders need to be — every 5 min is plenty:
//   select cron.schedule('task-reminders-sweep', '*/5 * * * *', $$
//     select net.http_post(
//       url := '<base>/api/tasks/reminders/cron',
//       headers := jsonb_build_object('x-cron-secret', '<WEBHOOK_CRON_SECRET>')
//     ) $$);

const BATCH = 200;

function authorized(request: Request): boolean {
  const expected = process.env.TASKS_CRON_SECRET ?? process.env.WEBHOOK_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface DueTask {
  id: string;
  account_id: string;
  assigned_to: string;
  contact_id: string | null;
  title: string;
}

export async function GET(request: Request) {
  const configured = process.env.TASKS_CRON_SECRET ?? process.env.WEBHOOK_CRON_SECRET;
  if (!configured) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = supabaseAdmin();
  const nowIso = new Date().toISOString();

  const { data: due, error } = await db
    .from('tasks')
    .select('id, account_id, assigned_to, contact_id, title')
    .eq('status', 'open')
    .is('reminder_sent_at', null)
    .not('assigned_to', 'is', null)
    .lte('due_at', nowIso)
    .order('due_at', { ascending: true })
    .limit(BATCH);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const tasks = (due ?? []) as DueTask[];
  if (tasks.length === 0) {
    return NextResponse.json({ nudged: 0 });
  }

  // Contact names for the notification body (best effort).
  const contactIds = [...new Set(tasks.map((t) => t.contact_id).filter(Boolean) as string[])];
  const names = new Map<string, string>();
  if (contactIds.length) {
    const { data: contacts } = await db
      .from('contacts')
      .select('id, name')
      .in('id', contactIds);
    for (const c of (contacts ?? []) as { id: string; name: string | null }[]) {
      if (c.name) names.set(c.id, c.name);
    }
  }

  let nudged = 0;
  for (const task of tasks) {
    const who = task.contact_id ? names.get(task.contact_id) : null;
    const { error: insErr } = await db.from('notifications').insert({
      account_id: task.account_id,
      user_id: task.assigned_to,
      type: 'task_due',
      contact_id: task.contact_id,
      title: `Tarea pendiente: ${task.title}`,
      body: who ? `Contacto: ${who}` : null,
    });
    if (insErr) {
      console.error('[tasks/reminders] notification insert failed', task.id, insErr.message);
      continue;
    }
    await db.from('tasks').update({ reminder_sent_at: nowIso }).eq('id', task.id);
    nudged += 1;
  }

  return NextResponse.json({ nudged });
}
