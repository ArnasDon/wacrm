import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/push/unsubscribe
 * Body: `{ endpoint }`. Deletes that subscription if it belongs to the
 * caller (RLS also enforces it). Best-effort — a missing row is fine.
 */
export async function POST(request: Request) {
  try {
    const { supabase, userId } = await getCurrentAccount();
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    if (!endpoint) {
      return NextResponse.json({ error: 'endpoint is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', userId);

    if (error) {
      console.error('[push/unsubscribe] delete failed:', error);
      return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
