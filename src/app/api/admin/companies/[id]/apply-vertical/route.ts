import { NextResponse } from 'next/server'
import { requirePlatformAdmin, toErrorResponse } from '@/lib/auth/account'
import { platformAdminClient } from '@/lib/platform/admin-client'
import { applyVerticalKit } from '@/lib/verticals/seed'
import { isVerticalSlug } from '@/lib/verticals'

/**
 * POST /api/admin/companies/[id]/apply-vertical
 *
 * Platform-admin only. Sets `accounts.industry_vertical` and seeds the
 * vertical's starter kit (custom fields, pipeline, flows, KB scaffolds,
 * a couple of settings) — idempotently. See `src/lib/verticals/`.
 *
 * To just relabel a company without seeding, use
 * `PATCH /api/admin/companies/[id]` with `{ set_vertical }`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requirePlatformAdmin()
    const { id } = await params
    const body = (await request.json().catch(() => null)) as { vertical?: unknown } | null
    if (!body || !isVerticalSlug(body.vertical)) {
      return NextResponse.json(
        { error: "El vertical debe ser 'generic' o 'hotel'." },
        { status: 400 },
      )
    }

    const admin = platformAdminClient()
    const { data: account, error: acctErr } = await admin
      .from('accounts')
      .select('id, owner_user_id')
      .eq('id', id)
      .maybeSingle()
    if (acctErr) {
      return NextResponse.json({ error: acctErr.message }, { status: 500 })
    }
    if (!account) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    }

    const summary = await applyVerticalKit({
      db: admin,
      accountId: id,
      actingUserId: account.owner_user_id as string,
      vertical: body.vertical,
    })

    return NextResponse.json({ result: summary })
  } catch (err) {
    return toErrorResponse(err)
  }
}
