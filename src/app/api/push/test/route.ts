import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { sendPushToAccount } from '@/lib/push/server'

// Sends a real push to the caller's own devices, through the real push
// service. This is the honest "is it working end to end?" check.
export async function POST() {
  try {
    const { accountId, userId } = await requireRole('viewer')
    const limit = checkRateLimit(`push-test:${userId}`, { limit: 5, windowMs: 60_000 })
    if (!limit.success) return rateLimitResponse(limit)

    const result = await sendPushToAccount(
      accountId,
      {
        v: 1,
        conversationId: '',
        title: 'Test notification',
        body: 'Push is working. New customer messages will show up like this.',
        url: '/inbox',
        tag: 'wacrm-push-test',
        ts: Date.now(),
        test: true,
      },
      { userId },
    )
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
