import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { verifyZernioAccount } from '@/lib/zernio/api'
import {
  ConfigConnectError,
  assertPhoneNumberUnclaimed,
  assertZernioAccountUnclaimed,
  connectMetaWhatsApp,
  connectZernioWhatsApp,
  setDefaultWhatsAppConfig,
} from '@/lib/whatsapp/config-connect'

/**
 * GET /api/whatsapp/config/[id]
 *
 * Live health check for ONE connection — decrypts its stored
 * credentials and pings Meta/Zernio. This is what GET
 * /api/whatsapp/config used to do for the account's single row;
 * post-multi-number it's scoped per-row so the list page doesn't have
 * to make N live API calls just to render.
 *
 * Response shape mirrors the pre-multi-number route so the existing
 * "Test Connection" UI logic keeps working unmodified:
 *   { connected: true,  phone_info: {...} }
 *   { connected: false, reason: 'no_config' | 'token_corrupted' | 'meta_api_error' | 'zernio_api_error', message, needs_reset? }
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { id } = await context.params

    const { data: config, error } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('Error fetching whatsapp_config:', error)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }
    if (!config) {
      return NextResponse.json(
        { connected: false, reason: 'no_config', message: 'Connection not found.' },
        { status: 200 }
      )
    }

    if (config.provider === 'zernio') {
      let zApiKey: string
      try {
        zApiKey = decrypt(config.zernio_api_key)
      } catch (err) {
        console.error('[whatsapp/config/[id] GET] Zernio key decryption failed:', err)
        return NextResponse.json(
          {
            connected: false,
            reason: 'token_corrupted',
            needs_reset: true,
            message:
              'The stored Zernio API key cannot be decrypted with the current ENCRYPTION_KEY. Delete this connection and re-add it.',
          },
          { status: 200 }
        )
      }
      try {
        const accountInfo = await verifyZernioAccount({
          apiKey: zApiKey,
          accountId: config.zernio_account_id,
          expectedPlatform: 'whatsapp',
        })
        return NextResponse.json({
          connected: true,
          phone_info: { display_phone_number: accountInfo.username, verified_name: accountInfo.displayName },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Zernio API error'
        return NextResponse.json(
          { connected: false, reason: 'zernio_api_error', message: `Zernio API rejected the credentials: ${message}` },
          { status: 200 }
        )
      }
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config/[id] GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Delete this connection and re-add it.',
        },
        { status: 200 }
      )
    }

    try {
      const phoneInfo = await verifyPhoneNumber({ phoneNumberId: config.phone_number_id, accessToken })
      return NextResponse.json({ connected: true, phone_info: phoneInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      return NextResponse.json(
        { connected: false, reason: 'meta_api_error', message: `Meta API rejected the credentials: ${message}` },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in WhatsApp config/[id] GET:', error)
    return toErrorResponse(error)
  }
}

/**
 * PATCH /api/whatsapp/config/[id]
 *
 * Update one connection: display_name, is_default, and/or rotate its
 * credentials. Credential fields are only re-verified with Meta/Zernio
 * when the caller actually sends them — editing just the display name
 * or flipping the default flag never touches the network.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const body = await request.json()

    const { data: existing, error: fetchError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 })
    }

    const fieldsToUpdate: Record<string, unknown> = {}
    if (typeof body.display_name === 'string') {
      fieldsToUpdate.display_name = body.display_name.trim() || null
    }
    if (typeof body.public_phone_number === 'string') {
      fieldsToUpdate.public_phone_number = body.public_phone_number.trim() || null
    }

    let phoneInfo: unknown = null
    let registrationError: string | null = null
    let registrationSkipped = false

    if (existing.provider === 'zernio') {
      const hasCredentialUpdate = 'zernio_api_key' in body || 'zernio_account_id' in body
      if (hasCredentialUpdate) {
        if (!body.zernio_api_key) {
          return NextResponse.json(
            { error: 'Please re-enter the Zernio API Key to save changes' },
            { status: 400 }
          )
        }
        const nextAccountId = body.zernio_account_id || existing.zernio_account_id
        if (nextAccountId !== existing.zernio_account_id) {
          await assertZernioAccountUnclaimed(nextAccountId, accountId, id)
        }
        const connected = await connectZernioWhatsApp({
          zernioApiKey: body.zernio_api_key,
          zernioAccountId: nextAccountId,
          existingEncryptedSecret: existing.zernio_webhook_secret,
        })
        Object.assign(fieldsToUpdate, connected.row)
        phoneInfo = connected.phoneInfo
        if (connected.webhookSecret) fieldsToUpdate._webhook_secret_plaintext = connected.webhookSecret
      }
    } else {
      const hasCredentialUpdate =
        'access_token' in body || 'phone_number_id' in body || 'waba_id' in body || 'verify_token' in body || 'pin' in body
      if (hasCredentialUpdate) {
        if (!body.access_token) {
          return NextResponse.json(
            { error: 'Please re-enter the Access Token to save changes' },
            { status: 400 }
          )
        }
        const nextPhoneNumberId = body.phone_number_id || existing.phone_number_id
        if (nextPhoneNumberId !== existing.phone_number_id) {
          await assertPhoneNumberUnclaimed(nextPhoneNumberId, accountId, id)
        }
        const connected = await connectMetaWhatsApp({
          phoneNumberId: nextPhoneNumberId,
          wabaId: body.waba_id || existing.waba_id || null,
          accessToken: body.access_token,
          verifyToken: body.verify_token || null,
          pin: body.pin || null,
          sameNumberAlreadyRegistered:
            nextPhoneNumberId === existing.phone_number_id && existing.registered_at != null,
        })
        Object.assign(fieldsToUpdate, connected.row)
        phoneInfo = connected.phoneInfo
        registrationError = connected.registrationError
        registrationSkipped = connected.registrationSkipped
      }
    }

    // Plaintext secrets never get written to the row — pop it back off
    // before persisting, but keep it around to return once to the caller.
    const webhookSecretToReturn = fieldsToUpdate._webhook_secret_plaintext as string | undefined
    delete fieldsToUpdate._webhook_secret_plaintext

    if (Object.keys(fieldsToUpdate).length > 0) {
      const { error: updateError } = await supabase
        .from('whatsapp_config')
        .update(fieldsToUpdate)
        .eq('id', id)
        .eq('account_id', accountId)
      if (updateError) {
        console.error('Error updating whatsapp_config:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    }

    if (body.is_default === true) {
      await setDefaultWhatsAppConfig(supabase, accountId, id)
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: registrationError == null,
      registration_error: registrationError,
      registration_skipped: registrationSkipped,
      phone_info: phoneInfo,
      webhook_secret: webhookSecretToReturn ?? null,
    })
  } catch (error) {
    if (error instanceof ConfigConnectError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in WhatsApp config/[id] PATCH:', error)
    return toErrorResponse(error)
  }
}

/**
 * DELETE /api/whatsapp/config/[id]
 *
 * Removes one connection. Conversations pinned to it fall back to no
 * number (ON DELETE SET NULL on conversations.whatsapp_config_id) —
 * the next reply from those threads resolves to the account's
 * (possibly new) default instead. If the deleted row WAS the default
 * and other connections remain, the most recently connected one is
 * promoted automatically so the account is never left without one.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params

    const { data: existing } = await supabase
      .from('whatsapp_config')
      .select('id, is_default')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (!existing) {
      return NextResponse.json({ error: 'Connection not found.' }, { status: 404 })
    }

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    if (existing.is_default) {
      const { data: remaining } = await supabase
        .from('whatsapp_config')
        .select('id')
        .eq('account_id', accountId)
        .order('connected_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (remaining) {
        await supabase.from('whatsapp_config').update({ is_default: true }).eq('id', remaining.id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config/[id] DELETE:', error)
    return toErrorResponse(error)
  }
}
