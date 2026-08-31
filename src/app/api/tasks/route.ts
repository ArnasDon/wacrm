import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { MAX_TASK_NOTES, MAX_TASK_TITLE, isTaskStatus } from '@/lib/tasks/types';

// Follow-up tasks (migration 097). GET lists the account's tasks
// (filterable by contact / assignee / status); POST creates one.
// RLS-scoped read via the user client; service-role write after an
// `agent` role check so account_id / created_by can't be spoofed.

export async function GET(request: Request) {
  try {
    const { supabase, userId } = await getCurrentAccount();
    const params = new URL(request.url).searchParams;

    let query = supabase
      .from('tasks')
      .select('*')
      .order('status', { ascending: true }) // open before done
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    const contactId = params.get('contact_id');
    if (contactId) query = query.eq('contact_id', contactId);

    const dealId = params.get('deal_id');
    if (dealId) query = query.eq('deal_id', dealId);

    if (params.get('scope') === 'mine') query = query.eq('assigned_to', userId);

    const status = params.get('status');
    if (isTaskStatus(status)) query = query.eq('status', status);

    const { data, error } = await query.limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ tasks: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireRole('agent');
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TASK_TITLE) : '';
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const notes =
    typeof body.notes === 'string' && body.notes.trim()
      ? body.notes.trim().slice(0, MAX_TASK_NOTES)
      : null;

  let dueAt: string | null = null;
  if (typeof body.due_at === 'string' && body.due_at) {
    const ms = Date.parse(body.due_at);
    if (Number.isNaN(ms)) {
      return NextResponse.json({ error: 'due_at is not a valid date' }, { status: 400 });
    }
    dueAt = new Date(ms).toISOString();
  }

  const assignedTo =
    typeof body.assigned_to === 'string' && body.assigned_to ? body.assigned_to : null;
  const contactId =
    typeof body.contact_id === 'string' && body.contact_id ? body.contact_id : null;
  const dealId = typeof body.deal_id === 'string' && body.deal_id ? body.deal_id : null;

  const { data, error } = await supabaseAdmin()
    .from('tasks')
    .insert({
      account_id: ctx.accountId,
      created_by: ctx.userId,
      assigned_to: assignedTo,
      contact_id: contactId,
      deal_id: dealId,
      title,
      notes,
      due_at: dueAt,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data }, { status: 201 });
}
