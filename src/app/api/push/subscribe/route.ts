import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

/**
 * POST /api/push/subscribe
 *
 * Body: a raw PushSubscription (`{ endpoint, keys: { p256dh, auth } }`).
 * Upserts it against the signed-in user + their account. Idempotent —
 * the client calls this on every load to keep the row fresh, and the
 * SW calls it again from `pushsubscriptionchange` when the browser
 * rotates the endpoint.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();

    const body = (await request.json().catch(() => null)) as {
      endpoint?: unknown;
      keys?: { p256dh?: unknown; auth?: unknown };
    } | null;

    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : '';
    const auth = typeof body?.keys?.auth === 'string' ? body.keys.auth : '';
    if (!endpoint || !p256dh || !auth) {
      return NextResponse.json({ error: 'Invalid push subscription' }, { status: 400 });
    }

    const userAgent = request.headers.get('user-agent')?.slice(0, 400) ?? null;

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint,
        p256dh,
        auth,
        user_id: userId,
        account_id: accountId,
        user_agent: userAgent,
        failure_count: 0,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    );

    if (error) {
      console.error('[push/subscribe] upsert failed:', error);
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
