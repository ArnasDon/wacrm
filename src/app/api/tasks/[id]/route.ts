import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { MAX_TASK_NOTES, MAX_TASK_TITLE, isTaskStatus } from '@/lib/tasks/types';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, { params }: Ctx) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const patch: Record<string, unknown> = {};

  if (typeof body.title === 'string') {
    const title = body.title.trim().slice(0, MAX_TASK_TITLE);
    if (!title) return NextResponse.json({ error: 'title cannot be empty' }, { status: 400 });
    patch.title = title;
  }
  if (body.notes !== undefined) {
    patch.notes =
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim().slice(0, MAX_TASK_NOTES)
        : null;
  }
  if (body.assigned_to !== undefined) {
    patch.assigned_to =
      typeof body.assigned_to === 'string' && body.assigned_to ? body.assigned_to : null;
  }
  if (body.due_at !== undefined) {
    if (body.due_at === null || body.due_at === '') {
      patch.due_at = null;
    } else if (typeof body.due_at === 'string') {
      const ms = Date.parse(body.due_at);
      if (Number.isNaN(ms)) {
        return NextResponse.json({ error: 'due_at is not a valid date' }, { status: 400 });
      }
      patch.due_at = new Date(ms).toISOString();
    }
    // A rescheduled task should nudge again.
    patch.reminder_sent_at = null;
  }
  if (body.status !== undefined) {
    if (!isTaskStatus(body.status)) {
      return NextResponse.json({ error: 'invalid status' }, { status: 400 });
    }
    patch.status = body.status;
    patch.completed_at = body.status === 'done' ? new Date().toISOString() : null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin()
    .from('tasks')
    .update(patch)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ task: data });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }
  const { id } = await params;

  const { error } = await supabaseAdmin()
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
