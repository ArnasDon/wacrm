import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import { isPhoneNumberIdClaimedElsewhere } from '@/lib/db/unscoped'
import type { WhatsAppConfigDoc } from '@/lib/db/types'
import { ConflictError, readJson, ValidationError } from '@/lib/http/errors'
import { optStr } from '@/lib/http/validate'
import { decrypt, encrypt } from '@/lib/security/secrets'
import { registerPhoneNumber, subscribeWabaToApp, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'

/** GET — connection status (any member). Tokens never leave the server. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const configs = await scopedCollection<WhatsAppConfigDoc>(ctx, 'whatsapp_configs')
    const cfg = await configs.findOne({})
    if (!cfg) return NextResponse.json({ connected: false })
    let live: { ok: boolean; message?: string } = { ok: true }
    try {
      await verifyPhoneNumber({ phoneNumberId: cfg.phoneNumberId, accessToken: decrypt(cfg.accessTokenEnc) })
    } catch (err) {
      live = { ok: false, message: (err as Error).message.slice(0, 200) }
    }
    return NextResponse.json({
      connected: true,
      healthy: live.ok,
      error: live.message ?? null,
      phoneNumberId: cfg.phoneNumberId,
      wabaId: cfg.wabaId,
      displayPhone: cfg.displayPhone,
      verifiedName: cfg.verifiedName,
      hasVerifyToken: !!cfg.verifyTokenEnc,
      hasAppSecret: !!cfg.appSecretEnc || !!process.env.META_APP_SECRET,
      appSecretFromEnv: !cfg.appSecretEnc && !!process.env.META_APP_SECRET,
      lastWebhookAt: cfg.lastWebhookAt ?? null,
      lastWebhookError: cfg.lastWebhookError ?? null,
      lastWebhookErrorAt: cfg.lastWebhookErrorAt ?? null,
      webhookPath: '/api/whatsapp/webhook',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST — connect / update the WhatsApp Cloud API number. Admin+. */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await readJson(request)
    const configs = await scopedCollection<WhatsAppConfigDoc>(ctx, 'whatsapp_configs')
    // Editing one field (an app secret, say) shouldn't mean re-pasting
    // the access token — blanks fall back to what's already stored.
    const existing = await configs.findOne({})
    const phoneNumberId = optStr(body.phoneNumberId, 'phoneNumberId', 40) ?? existing?.phoneNumberId
    if (!phoneNumberId) throw new ValidationError('Phone number ID is required')
    if (!/^\d{5,40}$/.test(phoneNumberId)) throw new ValidationError('Phone number ID must be digits')
    const wabaId = optStr(body.wabaId, 'wabaId', 40) ?? existing?.wabaId ?? null
    if (wabaId && !/^\d{5,40}$/.test(wabaId)) throw new ValidationError('WABA ID must be digits')
    const accessToken = optStr(body.accessToken, 'accessToken', 1000) ?? (existing ? decrypt(existing.accessTokenEnc) : null)
    if (!accessToken) throw new ValidationError('Access token is required')
    const verifyToken = optStr(body.verifyToken, 'verifyToken', 200)
    const appSecret = optStr(body.appSecret, 'appSecret', 200)
    if (appSecret && !/^[a-f0-9]{16,64}$/i.test(appSecret)) {
      throw new ValidationError('App secret should be the hex string from Meta → App settings → Basic')
    }
    const pin = optStr(body.pin, 'pin', 6)
    if (pin && !/^\d{6}$/.test(pin)) throw new ValidationError('PIN must be exactly 6 digits')

    if (await isPhoneNumberIdClaimedElsewhere(phoneNumberId, ctx.accountId)) {
      throw new ConflictError('This WhatsApp number is already connected to another account on this server')
    }

    let info
    try {
      info = await verifyPhoneNumber({ phoneNumberId, accessToken })
    } catch (err) {
      throw new ValidationError(`Meta rejected these credentials: ${(err as Error).message.slice(0, 200)}`)
    }

    await configs.findOneAndUpdate(
      {},
      {
        $set: {
          phoneNumberId,
          wabaId,
          accessTokenEnc: encrypt(accessToken),
          verifyTokenEnc: verifyToken ? encrypt(verifyToken) : (existing?.verifyTokenEnc ?? null),
          displayPhone: info.display_phone_number ?? null,
          verifiedName: info.verified_name ?? null,
          // Leaving the field blank keeps the secret already saved.
          ...(appSecret ? { appSecretEnc: encrypt(appSecret) } : {}),
        },
        $setOnInsert: {
          ...(appSecret ? {} : { appSecretEnc: null }),
          lastWebhookAt: null,
          lastWebhookError: null,
          lastWebhookErrorAt: null,
        },
      },
      { upsert: true },
    )

    // Best-effort follow-ups; failures are reported, not fatal.
    const warnings: string[] = []
    if (pin) {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken, pin })
      } catch (err) {
        warnings.push(`Registration: ${(err as Error).message.slice(0, 150)}`)
      }
    }
    if (wabaId) {
      try {
        await subscribeWabaToApp({ wabaId, accessToken })
      } catch (err) {
        warnings.push(`Webhook subscription: ${(err as Error).message.slice(0, 150)}`)
      }
    }
    return NextResponse.json({ ok: true, displayPhone: info.display_phone_number, warnings })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE — disconnect. Admin+. */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin')
    const configs = await scopedCollection<WhatsAppConfigDoc>(ctx, 'whatsapp_configs')
    await configs.deleteMany({})
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
