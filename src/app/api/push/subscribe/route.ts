// ============================================================
// POST /api/push/subscribe
//
// Custom feature (not part of the upstream wacrm template): stores a
// Web Push subscription for the signed-in user's device, so
// sendPushToAccount() (src/lib/push/send.ts) can reach it later. Goes
// through the normal RLS-scoped client — the push_subscriptions_insert
// policy already enforces user_id = auth.uid().
// ============================================================

import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount()

    const body = (await request.json().catch(() => null)) as {
      endpoint?: unknown
      keys?: { p256dh?: unknown; auth?: unknown }
    } | null

    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
    const p256dh = typeof body?.keys?.p256dh === 'string' ? body.keys.p256dh : ''
    const authKey = typeof body?.keys?.auth === 'string' ? body.keys.auth : ''

    if (!endpoint || !p256dh || !authKey) {
      return NextResponse.json(
        { error: 'endpoint, keys.p256dh and keys.auth are required' },
        { status: 400 },
      )
    }

    const { error } = await ctx.supabase.from('push_subscriptions').upsert(
      {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        endpoint,
        p256dh,
        auth_key: authKey,
        user_agent: request.headers.get('user-agent') ?? null,
      },
      { onConflict: 'endpoint' },
    )

    if (error) {
      console.error('[POST /api/push/subscribe] insert error:', error)
      return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
