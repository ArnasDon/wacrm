import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { listAccountSummaries } from '@/lib/db/platform'
import { toErrorResponse } from '@/lib/http/errors'

/** GET — every merchant on the platform, with health and usage. */
export async function GET() {
  try {
    await requirePlatformAdmin()
    return NextResponse.json({ accounts: await listAccountSummaries() })
  } catch (err) {
    return toErrorResponse(err)
  }
}
