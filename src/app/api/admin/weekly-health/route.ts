import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { loadWeeklyHealth, pickChatsToRead } from '@/lib/admin/weekly-health'

/**
 * GET /api/admin/weekly-health  (platform admin only)
 * Graded per-company health for the last 7 days + chats worth reading.
 */
export async function GET() {
  try {
    await requirePlatformAdmin()
    const db = platformAdminClient()
    const rows = await loadWeeklyHealth(db)
    const companies = await Promise.all(
      rows.map(async (row) => ({ ...row, chats: await pickChatsToRead(db, row.account_id) })),
    )
    return NextResponse.json({ companies })
  } catch (error) {
    return toErrorResponse(error)
  }
}
