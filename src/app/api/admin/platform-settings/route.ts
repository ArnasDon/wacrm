import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { platformAdminClient } from '@/lib/platform/admin-client'

/**
 * PATCH /api/admin/platform-settings  (platform admin only)
 *
 * Angel's bank details, shown to every company on Settings →
 * Facturación. Reads (including in the /admin editor itself) go
 * straight through the RLS-scoped client — SELECT is open to any
 * authenticated user (migration 056) — so this route only ever
 * handles the write, through the service-role client, gated to a
 * platform admin.
 */
export async function PATCH(request: Request) {
  try {
    await requirePlatformAdmin()
    const body = (await request.json()) as {
      bank_name?: unknown
      account_number?: unknown
      account_type?: unknown
      account_holder?: unknown
    }

    const toText = (v: unknown): string | null =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null

    const { data, error } = await platformAdminClient()
      .from('platform_settings')
      .update({
        bank_name: toText(body.bank_name),
        account_number: toText(body.account_number),
        account_type: toText(body.account_type),
        account_holder: toText(body.account_holder),
      })
      .eq('id', 1)
      .select('bank_name, account_number, account_type, account_holder')
      .single()
    if (error) throw error
    return NextResponse.json({ settings: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}
