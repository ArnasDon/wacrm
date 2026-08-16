// ============================================================
// Shared "connect a WhatsApp number" logic for the config API.
//
// Extracted so POST /api/whatsapp/config (create a new connection) and
// PATCH /api/whatsapp/config/[id] (rotate credentials on an existing
// one) run the exact same Meta/Zernio verification + registration
// steps instead of two copies drifting apart. Every function here is
// pure orchestration — no auth, no Supabase row I/O beyond the
// cross-account "already claimed" check, which needs the service-role
// client to see rows RLS would otherwise hide.
// ============================================================

import crypto from 'node:crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api'
import { verifyZernioAccount } from '@/lib/zernio/api'
import { encrypt } from '@/lib/whatsapp/encryption'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
export function whatsAppConfigAdminClient() {
  if (!_adminClient) {
    _adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

export class ConfigConnectError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ConfigConnectError'
    this.status = status
  }
}

/**
 * wacrm is single-tenant-per-WhatsApp-number even post-multi-number:
 * a given Meta phone number still maps to exactly one Chat Sandía
 * account (across ALL of that account's connections), because the
 * inbound webhook resolves the owning account by `phone_number_id`
 * alone. Letting two accounts bind the same number would make the
 * webhook's lookup ambiguous. `excludeConfigId` lets an update ignore
 * the row it's editing.
 */
export async function assertPhoneNumberUnclaimed(
  phoneNumberId: string,
  accountId: string,
  excludeConfigId?: string
): Promise<void> {
  let query = whatsAppConfigAdminClient()
    .from('whatsapp_config')
    .select('id, account_id')
    .eq('phone_number_id', phoneNumberId)
    .neq('account_id', accountId)
  if (excludeConfigId) query = query.neq('id', excludeConfigId)
  const { data: claimed, error } = await query.maybeSingle()

  if (error) {
    console.error('Error checking phone_number_id ownership:', error)
    throw new ConfigConnectError('Failed to validate configuration', 500)
  }
  if (claimed) {
    throw new ConfigConnectError(
      'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one Chat Sandía account.',
      409
    )
  }
}

/** Same guarantee as {@link assertPhoneNumberUnclaimed}, for Zernio-provider rows. */
export async function assertZernioAccountUnclaimed(
  zernioAccountId: string,
  accountId: string,
  excludeConfigId?: string
): Promise<void> {
  let query = whatsAppConfigAdminClient()
    .from('whatsapp_config')
    .select('id, account_id')
    .eq('zernio_account_id', zernioAccountId)
    .neq('account_id', accountId)
  if (excludeConfigId) query = query.neq('id', excludeConfigId)
  const { data: claimed, error } = await query.maybeSingle()

  if (error) {
    console.error('Error checking zernio_account_id ownership:', error)
    throw new ConfigConnectError('Failed to validate configuration', 500)
  }
  if (claimed) {
    throw new ConfigConnectError(
      'This Zernio account is already linked to another account on this instance. Each Zernio-connected WhatsApp number can only be connected to one Chat Sandía account.',
      409
    )
  }
}

export interface MetaConnectionResult {
  row: {
    provider: 'meta'
    phone_number_id: string
    waba_id: string | null
    access_token: string
    verify_token: string | null
    zernio_api_key: null
    zernio_account_id: null
    zernio_webhook_secret: null
    status: 'connected' | 'disconnected'
    connected_at: string | null
    registered_at: string | null
    subscribed_apps_at: string | null
    last_registration_error: string | null
    updated_at: string
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  phoneInfo: any
  registrationError: string | null
  registrationSkipped: boolean
}

/**
 * Verify with Meta, encrypt credentials, and (best-effort) register the
 * phone number for inbound webhooks + subscribe the WABA to this app.
 * Throws {@link ConfigConnectError} only on the "credentials rejected
 * by Meta" / "encryption failed" paths — a failed /register call is
 * reported in the result instead of thrown, matching the original
 * single-connection route's behavior (the row still saves so the user
 * can retry without re-entering everything).
 */
export async function connectMetaWhatsApp(params: {
  phoneNumberId: string
  wabaId: string | null
  accessToken: string
  verifyToken: string | null
  pin: string | null
  /** Same number, already registered before (e.g. editing display_name
   *  only) — skips re-registering unless a fresh PIN was supplied. */
  sameNumberAlreadyRegistered: boolean
}): Promise<MetaConnectionResult> {
  const { phoneNumberId, wabaId, accessToken, verifyToken, pin, sameNumberAlreadyRegistered } =
    params

  let phoneInfo
  try {
    phoneInfo = await verifyPhoneNumber({ phoneNumberId, accessToken })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    throw new ConfigConnectError(`Meta API error: ${message}`, 400)
  }

  let encryptedAccessToken: string
  let encryptedVerifyToken: string | null
  try {
    encryptedAccessToken = encrypt(accessToken)
    encryptedVerifyToken = verifyToken ? encrypt(verifyToken) : null
  } catch {
    throw new ConfigConnectError(
      'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
      500
    )
  }

  let registeredAt: string | null = null
  let registrationError: string | null = null
  let registrationSkipped = false

  const needsRegistration = !sameNumberAlreadyRegistered || (typeof pin === 'string' && pin.length > 0)
  if (needsRegistration) {
    if (!pin) {
      // Meta TEST numbers have no PIN to set — best-effort skip, same
      // as the original single-connection route.
      registrationSkipped = true
    } else {
      try {
        await registerPhoneNumber({ phoneNumberId, accessToken, pin })
        registeredAt = new Date().toISOString()
      } catch (err) {
        registrationError = err instanceof Error ? err.message : 'Unknown Meta API error'
        console.error('Phone number /register failed:', registrationError)
      }
    }
  } else {
    registeredAt = new Date().toISOString()
  }

  let subscribedAppsAt: string | null = null
  if (wabaId) {
    try {
      await subscribeWabaToApp({ wabaId, accessToken })
      subscribedAppsAt = new Date().toISOString()
    } catch (err) {
      console.warn(
        'WABA subscribed_apps failed (non-fatal):',
        err instanceof Error ? err.message : String(err)
      )
    }
  }

  return {
    row: {
      provider: 'meta',
      phone_number_id: phoneNumberId,
      waba_id: wabaId || null,
      access_token: encryptedAccessToken,
      verify_token: encryptedVerifyToken,
      zernio_api_key: null,
      zernio_account_id: null,
      zernio_webhook_secret: null,
      status: registrationError ? 'disconnected' : 'connected',
      connected_at: registrationError ? null : new Date().toISOString(),
      registered_at: registrationError ? null : registeredAt,
      subscribed_apps_at: subscribedAppsAt,
      last_registration_error: registrationError,
      updated_at: new Date().toISOString(),
    },
    phoneInfo,
    registrationError,
    registrationSkipped,
  }
}

export interface ZernioConnectionResult {
  row: {
    provider: 'zernio'
    zernio_api_key: string
    zernio_account_id: string
    zernio_webhook_secret: string
    phone_number_id: null
    waba_id: null
    access_token: null
    verify_token: null
    registered_at: null
    subscribed_apps_at: null
    last_registration_error: null
    status: 'connected'
    connected_at: string
    updated_at: string
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  phoneInfo: any
  /** Plaintext — only ever returned once, right after a fresh secret is minted. */
  webhookSecret: string | null
}

export async function connectZernioWhatsApp(params: {
  zernioApiKey: string
  zernioAccountId: string
  /** Existing encrypted secret, if rotating credentials on an already-connected row. */
  existingEncryptedSecret: string | null
}): Promise<ZernioConnectionResult> {
  const { zernioApiKey, zernioAccountId, existingEncryptedSecret } = params

  let accountInfo
  try {
    accountInfo = await verifyZernioAccount({
      apiKey: zernioApiKey,
      accountId: zernioAccountId,
      expectedPlatform: 'whatsapp',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Zernio API error'
    throw new ConfigConnectError(`Zernio API error: ${message}`, 400)
  }

  const isNewSecret = !existingEncryptedSecret
  const plaintextSecret = isNewSecret ? crypto.randomBytes(32).toString('hex') : null

  let encryptedApiKey: string
  let encryptedSecret: string
  try {
    encryptedApiKey = encrypt(zernioApiKey)
    encryptedSecret = plaintextSecret ? encrypt(plaintextSecret) : existingEncryptedSecret!
  } catch {
    throw new ConfigConnectError(
      'Failed to encrypt credentials. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
      500
    )
  }

  return {
    row: {
      provider: 'zernio',
      zernio_api_key: encryptedApiKey,
      zernio_account_id: zernioAccountId,
      zernio_webhook_secret: encryptedSecret,
      phone_number_id: null,
      waba_id: null,
      access_token: null,
      verify_token: null,
      registered_at: null,
      subscribed_apps_at: null,
      last_registration_error: null,
      status: 'connected',
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    phoneInfo: { display_phone_number: accountInfo.username, verified_name: accountInfo.displayName },
    webhookSecret: plaintextSecret,
  }
}

/**
 * Make `configId` the account's only default row. Two sequential
 * updates rather than one atomic statement — acceptable here because
 * this only runs from an admin-gated settings action (low write
 * concurrency), and the partial unique index
 * (idx_whatsapp_config_one_default_per_account) still rejects any
 * accidental double-default outright rather than silently allowing it.
 */
export async function setDefaultWhatsAppConfig(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  accountId: string,
  configId: string
): Promise<void> {
  await supabase
    .from('whatsapp_config')
    .update({ is_default: false })
    .eq('account_id', accountId)
    .neq('id', configId)
    .eq('is_default', true)

  await supabase.from('whatsapp_config').update({ is_default: true }).eq('id', configId)
}
