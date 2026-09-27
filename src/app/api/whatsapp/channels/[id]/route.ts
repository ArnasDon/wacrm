import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { CHANNEL_PUBLIC_COLUMNS } from '@/lib/whatsapp/channels'
import { CHANNEL_NAME_MAX, parseColor } from '@/lib/whatsapp/channel-connect'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/whatsapp/channels/:id
 *
 * Body: { name?, color?, is_default?: true }. Making a channel the
 * default clears the flag on the account's other channels first — the
 * partial unique index (migration 043) allows one default per account.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const update: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) {
        return NextResponse.json({ error: 'Channel name cannot be empty.', field: 'name' }, { status: 400 })
      }
      if (name.length > CHANNEL_NAME_MAX) {
        return NextResponse.json(
          { error: `Channel name must be ${CHANNEL_NAME_MAX} characters or fewer.`, field: 'name' },
          { status: 400 }
        )
      }
      update.name = name
    }
    if (body.color !== undefined) {
      const color = parseColor(body.color)
      if (!color) {
        return NextResponse.json(
          { error: 'Color must be a hex code like #25D366.', field: 'color' },
          { status: 400 }
        )
      }
      update.color = color
    }
    const makeDefault = body.is_default === true
    if (Object.keys(update).length === 0 && !makeDefault) {
      return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (!existing) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }

    if (makeDefault) {
      const { error: clearError } = await supabase
        .from('whatsapp_config')
        .update({ is_default: false })
        .eq('account_id', accountId)
        .neq('id', id)
        .eq('is_default', true)
      if (clearError) {
        console.error('[whatsapp/channels PATCH] clearing default failed:', clearError)
        return NextResponse.json({ error: 'Failed to change the default channel.' }, { status: 500 })
      }
      update.is_default = true
    }

    update.updated_at = new Date().toISOString()
    const { data: channel, error } = await supabase
      .from('whatsapp_config')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(CHANNEL_PUBLIC_COLUMNS)
      .single()

    if (error || !channel) {
      console.error('[whatsapp/channels PATCH] update failed:', error)
      return NextResponse.json({ error: 'Failed to update the channel.' }, { status: 500 })
    }
    return NextResponse.json({ channel })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/whatsapp/channels/:id
 *
 * Disconnects the number from this workspace. Conversations keep their
 * history; their channel link is nulled (FK ON DELETE SET NULL), so
 * replies fall back to the default channel. Deleting the default
 * promotes the oldest remaining channel.
 */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { id } = await params
    const { supabase, accountId } = await requireRole('admin')

    const { data: removed, error } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, is_default')
      .maybeSingle()

    if (error) {
      console.error('[whatsapp/channels DELETE] failed:', error)
      return NextResponse.json({ error: 'Failed to disconnect the channel.' }, { status: 500 })
    }
    if (!removed) {
      return NextResponse.json({ error: 'Channel not found.' }, { status: 404 })
    }

    if (removed.is_default) {
      const { data: next } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .limit(1)
      if (next?.[0]) {
        await supabase.from('whatsapp_config').update({ is_default: true }).eq('id', next[0].id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
