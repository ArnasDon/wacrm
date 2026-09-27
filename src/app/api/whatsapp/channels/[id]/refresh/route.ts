import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { CHANNEL_PUBLIC_COLUMNS } from '@/lib/whatsapp/channels'
import { inspectChannel } from '@/lib/whatsapp/channel-connect'

/**
 * POST /api/whatsapp/channels/:id/refresh
 *
 * Re-reads the number from Meta with the stored token and updates the
 * cached quality / tier / names. A Meta failure answers with the same
 * actionable `{ error, field, meta }` shape as connecting.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const { data: row } = await supabase
      .from('whatsapp_config')
      .select('id, phone_number_id, waba_id, access_token')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!row) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }
    if (!row.waba_id) {
      return NextResponse.json(
        { error: 'This channel has no WABA ID saved. Disconnect it and connect it again.' },
        { status: 400 }
      )
    }

    let accessToken: string
    try {
      accessToken = decrypt(row.access_token)
    } catch {
      return NextResponse.json(
        {
          error:
            'The stored access token cannot be decrypted — ENCRYPTION_KEY changed since this channel was connected. Disconnect it and connect it again.',
        },
        { status: 400 }
      )
    }

    const inspected = await inspectChannel({
      wabaId: row.waba_id,
      phoneNumberId: row.phone_number_id,
      accessToken,
    })
    if ('response' in inspected) return inspected.response

    const now = new Date().toISOString()
    const { data: channel, error } = await supabase
      .from('whatsapp_config')
      .update({ ...inspected.snapshot, meta_synced_at: now, updated_at: now })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(CHANNEL_PUBLIC_COLUMNS)
      .single()

    if (error || !channel) {
      console.error('[whatsapp/channels refresh] update failed:', error)
      return NextResponse.json({ error: 'Failed to save the refreshed details.' }, { status: 500 })
    }
    return NextResponse.json({ channel })
  } catch (err) {
    return toErrorResponse(err)
  }
}
