import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { hasMinRole } from '@/lib/auth/roles'
import { registerPhoneNumber, subscribeWabaToApp } from '@/lib/whatsapp/meta-api'
import { explainMetaError, metaErrorPayload } from '@/lib/whatsapp/meta-error-explain'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { CHANNEL_PUBLIC_COLUMNS } from '@/lib/whatsapp/channels'
import {
  CHANNEL_NAME_MAX,
  inspectChannel,
  metaFailure,
  parseColor,
  parseCredentials,
  phoneNumberConflict,
  verifyTokenForNewChannel,
} from '@/lib/whatsapp/channel-connect'

// Service-role client — only for the cross-account phone_number_id
// conflict check, which RLS would otherwise hide.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

function webhookUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_WHATSAPP_WEBHOOK_URL
  if (explicit) return explicit
  const base = (process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, '')
  return `${base}/api/whatsapp/webhook`
}

/**
 * GET /api/whatsapp/channels
 *
 * Every channel of the caller's account (no tokens), plus the webhook
 * settings to paste into Meta. The verify token is only returned to
 * admins — it's what lets a caller pass Meta's webhook handshake.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId, role } = await requireRole('viewer')

    const { data: channels, error } = await supabase
      .from('whatsapp_config')
      .select(CHANNEL_PUBLIC_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[whatsapp/channels GET] list failed:', error)
      return NextResponse.json({ error: 'Failed to load channels.' }, { status: 500 })
    }

    let verifyToken: string | null = null
    if (hasMinRole(role, 'admin')) {
      const { data: tokenRows } = await supabase
        .from('whatsapp_config')
        .select('verify_token')
        .eq('account_id', accountId)
        .not('verify_token', 'is', null)
        .order('created_at', { ascending: true })
        .limit(1)
      const cipher = tokenRows?.[0]?.verify_token as string | undefined
      if (cipher) {
        try {
          verifyToken = decrypt(cipher)
        } catch {
          // Key changed since the token was saved — the page shows it as unset.
        }
      }
    }

    return NextResponse.json({
      channels: channels ?? [],
      can_manage: hasMinRole(role, 'admin'),
      webhook: { url: webhookUrl(request), verify_token: verifyToken },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/whatsapp/channels
 *
 * Connect a new number. Body: { waba_id, phone_number_id, access_token,
 * name?, color?, pin? }. Re-checks the credentials with Meta (the
 * verify step's answer could be stale), registers the number when a
 * two-step PIN is given, subscribes the WABA to this app, then saves.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const creds = parseCredentials(body)
    if (creds instanceof NextResponse) return creds

    const pin = typeof body.pin === 'string' ? body.pin.trim() : ''
    if (pin && !/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'Two-step verification PIN must be exactly 6 digits.', field: 'pin' },
        { status: 400 }
      )
    }

    const conflict = await phoneNumberConflict(supabaseAdmin(), accountId, creds.phoneNumberId)
    if (conflict) return conflict

    const inspected = await inspectChannel(creds)
    if ('response' in inspected) return inspected.response
    const { snapshot } = inspected

    const rawName = typeof body.name === 'string' ? body.name.trim() : ''
    const name = (rawName || snapshot.verified_name || snapshot.display_phone_number || 'WhatsApp').slice(
      0,
      CHANNEL_NAME_MAX
    )
    const color = parseColor(body.color) ?? '#25D366'
    const metaCtx = { phoneNumberId: creds.phoneNumberId, wabaId: creds.wabaId }

    // Registration routes this number's inbound events to this app.
    // Needs the 2FA PIN; Meta test numbers have none and are
    // pre-registered, so without a PIN we skip it (issue #242).
    let registeredAt: string | null = null
    let registrationError: string | null = null
    let registrationMeta: ReturnType<typeof metaErrorPayload> | null = null
    if (pin) {
      try {
        await registerPhoneNumber({
          phoneNumberId: creds.phoneNumberId,
          accessToken: creds.accessToken,
          pin,
        })
        registeredAt = new Date().toISOString()
      } catch (err) {
        const explained = explainMetaError(err, 'register', metaCtx)
        registrationError = explained.summary
        registrationMeta = metaErrorPayload(explained)
        console.error('[whatsapp/channels] /register failed:', explained.metaMessage, registrationMeta)
      }
    }

    // Without this subscription Meta delivers nothing, so it fails the
    // connect outright rather than saving a channel that never receives.
    try {
      await subscribeWabaToApp({ wabaId: creds.wabaId, accessToken: creds.accessToken })
    } catch (err) {
      return metaFailure(err, 'subscribe_waba', metaCtx)
    }

    let encryptedAccessToken: string
    let encryptedVerifyToken: string
    try {
      encryptedAccessToken = encrypt(creds.accessToken)
      encryptedVerifyToken = await verifyTokenForNewChannel(supabase, accountId)
    } catch (err) {
      console.error('[whatsapp/channels] encryption failed:', err instanceof Error ? err.message : err)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt the access token. Check that ENCRYPTION_KEY is a valid 64-character hex string.',
        },
        { status: 500 }
      )
    }

    // The first channel becomes the default one.
    const { count } = await supabase
      .from('whatsapp_config')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)

    const now = new Date().toISOString()
    const { data: channel, error: insertError } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        name,
        color,
        is_default: (count ?? 0) === 0,
        phone_number_id: creds.phoneNumberId,
        waba_id: creds.wabaId,
        access_token: encryptedAccessToken,
        verify_token: encryptedVerifyToken,
        status: registrationError ? 'disconnected' : 'connected',
        connected_at: registrationError ? null : now,
        registered_at: registeredAt,
        subscribed_apps_at: now,
        last_registration_error: registrationError,
        ...snapshot,
        meta_synced_at: now,
        updated_at: now,
      })
      .select(CHANNEL_PUBLIC_COLUMNS)
      .single()

    if (insertError || !channel) {
      console.error('[whatsapp/channels] insert failed:', insertError)
      return NextResponse.json({ error: 'Failed to save the channel.' }, { status: 500 })
    }

    return NextResponse.json(
      {
        channel,
        registered: registeredAt != null,
        registration_skipped: !pin,
        registration_error: registrationError,
        meta: registrationMeta,
      },
      { status: 201 }
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
