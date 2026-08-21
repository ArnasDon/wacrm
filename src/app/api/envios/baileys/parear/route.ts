import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getOrCreateConnection } from '@/lib/baileys/connection'

/**
 * Starts (or reuses) the account's Baileys connection. Same level as
 * configuring `whatsapp_config` — requires 'admin'. Doesn't wait for
 * the QR to arrive (that's an async socket event) — the pairing
 * screen polls GET /api/envios/baileys/status afterwards, same
 * "polling simples" convention as the rest of Envios/Campaigns.
 */
export async function POST() {
  try {
    const { accountId } = await requireRole('admin')
    await getOrCreateConnection(accountId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
