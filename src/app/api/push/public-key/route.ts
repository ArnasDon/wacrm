import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getVapid } from '@/lib/push/server'

// Returns the PUBLIC VAPID key at runtime (so self-hosters can set it as a
// normal environment variable without rebuilding the image).
export async function GET() {
  try {
    await requireRole('viewer')
    const vapid = getVapid()
    return NextResponse.json({
      configured: vapid !== null,
      publicKey: vapid?.publicKey ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
