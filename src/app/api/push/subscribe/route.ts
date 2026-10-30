import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseSubscription } from '@/lib/push/payload'
import { isPushConfigured, saveSubscription } from '@/lib/push/server'

// Registers (or refreshes) this device's Web Push subscription.
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('viewer')
    const limit = checkRateLimit(`push-sub:${userId}`, { limit: 20, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    if (!isPushConfigured()) {
      return NextResponse.json({ error: 'Push is not configured on this server' }, { status: 503 })
    }
    const body = await request.json().catch(() => null)
    const sub = parseSubscription(body?.subscription)
    if (!sub) return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })

    const ok = await saveSubscription({
      accountId,
      userId,
      ...sub,
      userAgent: request.headers.get('user-agent'),
    })
    if (!ok) return NextResponse.json({ error: 'Could not save subscription' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
