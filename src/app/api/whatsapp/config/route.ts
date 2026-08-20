import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  ConfigConnectError,
  assertPhoneNumberUnclaimed,
  assertZernioAccountUnclaimed,
  connectMetaWhatsApp,
  connectZernioWhatsApp,
  setDefaultWhatsAppConfig,
} from '@/lib/whatsapp/config-connect'

/**
 * GET /api/whatsapp/config
 *
 * Lists every WhatsApp connection for the caller's account. No live
 * Meta/Zernio verification here — that would mean one outbound API
 * call per row on every settings page load, which doesn't scale past
 * a couple of numbers. Use GET /api/whatsapp/config/[id] ("Test
 * Connection" on a specific row) for the live check.
 *
 * Never returns secrets (access_token, zernio_api_key, verify_token,
 * zernio_webhook_secret) — only the metadata the list/health UI needs.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')

    const [{ data, error }, { data: accountRow }] = await Promise.all([
      supabase
        .from('whatsapp_config')
        .select(
          'id, provider, display_name, public_phone_number, phone_number_id, waba_id, zernio_account_id, status, is_default, connected_at, registered_at, subscribed_apps_at, last_registration_error'
        )
        .eq('account_id', accountId)
        .order('is_default', { ascending: false })
        .order('connected_at', { ascending: true, nullsFirst: false }),
      supabase
        .from('accounts')
        .select('whatsapp_number_limit')
        .eq('id', accountId)
        .maybeSingle(),
    ])

    if (error) {
      console.error('Error listing whatsapp_config:', error)
      return NextResponse.json({ error: 'Failed to load configuration' }, { status: 500 })
    }

    return NextResponse.json({
      configs: data ?? [],
      numberLimit: accountRow?.whatsapp_number_limit ?? 1,
    })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return toErrorResponse(error)
  }
}

/**
 * POST /api/whatsapp/config
 *
 * Adds a new WhatsApp connection to the caller's account. Verifies
 * credentials with Meta/Zernio first, then encrypts and stores. The
 * first connection an account ever creates is always the default;
 * later ones respect the `is_default` flag the caller sends (default
 * false), so adding a second number never silently steals the
 * "default" flag away from the first without the caller asking for it.
 *
 * To rotate credentials on an EXISTING connection, use
 * PATCH /api/whatsapp/config/[id] instead — this route only creates.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const body = await request.json()

    const [{ count: existingCount }, { data: accountRow }] = await Promise.all([
      supabase
        .from('whatsapp_config')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      supabase
        .from('accounts')
        .select('whatsapp_number_limit')
        .eq('id', accountId)
        .maybeSingle(),
    ])
    const isFirstConnection = (existingCount ?? 0) === 0

    // Number-limit gate — additional WhatsApp numbers cost Q200/number
    // (product decision, 2026-08-20), same "seat" pattern as
    // accounts.seat_limit for members.
    const numberLimit = accountRow?.whatsapp_number_limit ?? 1
    if ((existingCount ?? 0) >= numberLimit) {
      return NextResponse.json(
        {
          error:
            "No tienes cupos disponibles para agregar otro número de WhatsApp. Usa 'Solicitud de número adicional' para pedir un cupo más (Q200 por número).",
        },
        { status: 403 },
      )
    }
    const displayName: string | null =
      typeof body.display_name === 'string' && body.display_name.trim()
        ? body.display_name.trim()
        : null
    const publicPhoneNumber: string | null =
      typeof body.public_phone_number === 'string' && body.public_phone_number.trim()
        ? body.public_phone_number.trim()
        : null
    const requestedDefault = isFirstConnection || body.is_default === true

    if (body.provider === 'zernio') {
      return await createZernioWhatsAppConfig(supabase, accountId, userId, body, {
        displayName,
        publicPhoneNumber,
        makeDefault: requestedDefault,
      })
    }

    const { phone_number_id, waba_id, access_token, verify_token, pin } = body

    if (!access_token || !phone_number_id) {
      return NextResponse.json(
        { error: 'access_token and phone_number_id are required' },
        { status: 400 }
      )
    }

    if (pin !== undefined && pin !== null && pin !== '') {
      if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
        return NextResponse.json({ error: 'PIN must be exactly 6 digits.' }, { status: 400 })
      }
    }

    await assertPhoneNumberUnclaimed(phone_number_id, accountId)

    const connected = await connectMetaWhatsApp({
      phoneNumberId: phone_number_id,
      wabaId: waba_id || null,
      accessToken: access_token,
      verifyToken: verify_token || null,
      pin: pin || null,
      sameNumberAlreadyRegistered: false,
    })

    const { data: inserted, error: insertError } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        display_name: displayName,
        public_phone_number: publicPhoneNumber,
        is_default: requestedDefault,
        ...connected.row,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      console.error('Error inserting whatsapp_config:', insertError)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }

    if (requestedDefault && !isFirstConnection) {
      await setDefaultWhatsAppConfig(supabase, accountId, inserted.id)
    }

    if (connected.registrationError) {
      return NextResponse.json({
        success: false,
        saved: true,
        id: inserted.id,
        registered: false,
        registration_error: connected.registrationError,
        phone_info: connected.phoneInfo,
      })
    }

    return NextResponse.json({
      success: true,
      saved: true,
      id: inserted.id,
      registered: connected.registrationError == null,
      registration_skipped: connected.registrationSkipped,
      phone_info: connected.phoneInfo,
    })
  } catch (error) {
    if (error instanceof ConfigConnectError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('Error in WhatsApp config POST:', error)
    return toErrorResponse(error)
  }
}

async function createZernioWhatsAppConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  userId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any,
  opts: { displayName: string | null; publicPhoneNumber: string | null; makeDefault: boolean }
) {
  const { zernio_api_key, zernio_account_id } = body

  if (!zernio_api_key || !zernio_account_id) {
    return NextResponse.json(
      { error: 'zernio_api_key and zernio_account_id are required' },
      { status: 400 }
    )
  }

  await assertZernioAccountUnclaimed(zernio_account_id, accountId)

  const connected = await connectZernioWhatsApp({
    zernioApiKey: zernio_api_key,
    zernioAccountId: zernio_account_id,
    existingEncryptedSecret: null,
  })

  const { data: inserted, error: insertError } = await supabase
    .from('whatsapp_config')
    .insert({
      account_id: accountId,
      user_id: userId,
      display_name: opts.displayName,
      public_phone_number: opts.publicPhoneNumber,
      is_default: opts.makeDefault,
      ...connected.row,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    console.error('Error inserting whatsapp_config:', insertError)
    return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    saved: true,
    id: inserted.id,
    registered: true,
    registration_skipped: false,
    phone_info: connected.phoneInfo,
    webhook_secret: connected.webhookSecret,
  })
}
