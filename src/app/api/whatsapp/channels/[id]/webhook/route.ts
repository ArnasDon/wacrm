import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { subscribeWabaToApp } from '@/lib/whatsapp/meta-api'
import { CHANNEL_PUBLIC_COLUMNS } from '@/lib/whatsapp/channels'
import { inspectChannel, metaFailure } from '@/lib/whatsapp/channel-connect'

/**
 * POST /api/whatsapp/channels/:id/webhook
 *
 * Takes this channel's webhooks back from another platform. Re-subscribing
 * the WABA to this app without an override callback clears a WABA-level
 * `override_callback_uri` another integration set, so Meta delivers the
 * number's messages and statuses here again. Re-reads the number and
 * returns the updated channel (its `webhook_url` shows the result).
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
    if (!row || !row.waba_id) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }

    let accessToken: string
    try {
      accessToken = decrypt(row.access_token)
    } catch {
      return NextResponse.json(
        { error: 'The stored access token cannot be decrypted. Disconnect the channel and connect it again.' },
        { status: 400 },
      )
    }

    const ctx = { phoneNumberId: row.phone_number_id, wabaId: row.waba_id }
    try {
      await subscribeWabaToApp({ wabaId: row.waba_id, accessToken })
    } catch (err) {
      return metaFailure(err, 'subscribe_waba', ctx)
    }

    const inspected = await inspectChannel({ wabaId: row.waba_id, phoneNumberId: row.phone_number_id, accessToken })
    if ('response' in inspected) return inspected.response

    const now = new Date().toISOString()
    const { data: channel, error } = await supabase
      .from('whatsapp_config')
      .update({ ...inspected.snapshot, subscribed_apps_at: now, meta_synced_at: now, updated_at: now })
      .eq('id', id)
      .eq('account_id', accountId)
      .select(CHANNEL_PUBLIC_COLUMNS)
      .single()
    if (error || !channel) {
      return NextResponse.json({ error: 'Failed to save the channel.' }, { status: 500 })
    }
    return NextResponse.json({ channel })
  } catch (err) {
    return toErrorResponse(err)
  }
}
