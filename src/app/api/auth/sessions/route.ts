import { NextResponse } from 'next/server'
import { getCurrentAccount } from '@/lib/auth/account'
import { destroyAllSessions } from '@/lib/auth/session'
import { getDb } from '@/lib/db/mongo'
import type { SessionDoc } from '@/lib/db/types'
import { toErrorResponse } from '@/lib/http/errors'

/** GET — your active sessions (devices). */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const db = await getDb()
    const rows = await db
      .collection<SessionDoc>('sessions')
      .find({ userId: ctx.userId, expiresAt: { $gt: new Date() } })
      .sort({ lastSeenAt: -1 })
      .limit(50)
      .toArray()
    return NextResponse.json({
      sessions: rows.map((s) => ({
        id: s._id,
        current: s._id === ctx.sessionId,
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — sign out every other device. */
export async function DELETE() {
  try {
    const ctx = await getCurrentAccount()
    await destroyAllSessions(ctx.userId, ctx.sessionId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
