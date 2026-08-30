import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { sendPushToUser } from '@/lib/push/send';

/**
 * POST /api/push/fanout  (called by the `on_notification_push_fanout`
 * DB trigger via pg_net — see migration 095)
 *
 * Body: `{ notification_id }`. Loads the row, turns it into a push
 * payload, and delivers it to that user's devices. Secret-gated with
 * `x-cron-secret` (PUSH_FANOUT_SECRET, falling back to
 * WEBHOOK_CRON_SECRET).
 */
function authorized(request: Request): boolean {
  const expected = process.env.PUSH_FANOUT_SECRET ?? process.env.WEBHOOK_CRON_SECRET;
  if (!expected) return false;
  const supplied = request.headers.get('x-cron-secret') ?? '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!(process.env.PUSH_FANOUT_SECRET ?? process.env.WEBHOOK_CRON_SECRET)) {
    return NextResponse.json({ error: 'push fanout not configured' }, { status: 503 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { notification_id?: unknown } | null;
  const id = typeof body?.notification_id === 'string' ? body.notification_id : '';
  if (!id) {
    return NextResponse.json({ error: 'notification_id is required' }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const { data: n, error } = await admin
    .from('notifications')
    .select('id, user_id, title, body, conversation_id, type')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[push/fanout] lookup failed:', error);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
  if (!n) {
    // Row deleted between insert and fanout — nothing to do.
    return NextResponse.json({ sent: 0, pruned: 0 });
  }

  const url = n.conversation_id ? `/inbox?c=${n.conversation_id}` : '/notifications';
  const result = await sendPushToUser(admin, n.user_id as string, {
    title: (n.title as string) || 'Chat Sandía',
    body: (n.body as string | null) ?? undefined,
    url,
    tag: n.id as string,
  });

  return NextResponse.json(result);
}
