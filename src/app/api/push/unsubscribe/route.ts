import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { deleteSubscription } from '@/lib/push/server'

export async function POST(request: Request) {
  try {
    const { userId } = await requireRole('viewer')
    const body = await request.json().catch(() => null)
    if (typeof body?.endpoint !== 'string' || body.endpoint.length > 2048) {
      return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
    }
    await deleteSubscription(userId, body.endpoint)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
