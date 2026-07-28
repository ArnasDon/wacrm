// ============================================================
// Shared "resolve config → build provider → retry across phone
// variants" core. Every send call site (inbox composer, automations,
// flows, reactions, both broadcast paths) is refactored to go
// through `getProviderForAccount` + `sendWithPhoneRetry` instead of
// each reimplementing decrypt→config-lookup→retry→persist on its own
// — that duplication (five-plus independent copies before this file
// existed) is exactly what this module exists to kill.
//
// `meta-api.ts` and `phone-utils.ts` are unchanged by this refactor;
// this file only orchestrates them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt, isLegacyFormat } from './encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from './phone-utils'
import { MetaProvider } from './providers/meta-provider'
import { UazapiProvider } from './providers/uazapi-provider'
import { ZapiProvider } from './providers/zapi-provider'
import type { WhatsAppProvider, ProviderConfig } from './provider-types'
import { resolveUazapiPlatformCredentials } from './uazapi-platform-config'

export class WhatsAppNotConfiguredError extends Error {
  constructor(
    message = 'WhatsApp not configured. Please set up your WhatsApp integration first.',
  ) {
    super(message)
    this.name = 'WhatsAppNotConfiguredError'
  }
}

/**
 * Load the account's `whatsapp_config` row and decrypt whichever
 * credential column matches its `provider`. Self-heals a legacy CBC
 * ciphertext to GCM in place (fire-and-forget), mirroring the
 * upgrade-on-read pattern already used for `access_token` in
 * `send-message.ts` and the webhook route.
 *
 * Throws `WhatsAppNotConfiguredError` if the row is missing or the
 * columns required for its provider aren't populated — the same
 * runtime check the DB's `whatsapp_config_provider_columns_check`
 * enforces at the schema level (defense in depth: the constraint
 * stops a bad row from ever being written; this stops a read racing
 * a half-written one from crashing downstream with a confusing
 * decrypt error instead of a clear "not configured").
 */
export async function resolveProviderConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<ProviderConfig> {
  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single()

  if (error || !config) {
    throw new WhatsAppNotConfiguredError()
  }

  if (config.provider === 'uazapi') {
    if (!config.uazapi_instance_id || !config.uazapi_token) {
      throw new WhatsAppNotConfiguredError()
    }
    const token = decrypt(config.uazapi_token)
    if (isLegacyFormat(config.uazapi_token)) {
      void db
        .from('whatsapp_config')
        .update({ uazapi_token: encrypt(token) })
        .eq('id', config.id)
        .then(({ error: upgradeError }: { error: { message: string } | null }) => {
          if (upgradeError) {
            console.warn(
              '[send-core] uazapi_token GCM upgrade failed:',
              upgradeError.message,
            )
          }
        })
    }
    // Only the server URL is needed for sending/status calls (the
    // admin token is only ever used for instance creation/deletion,
    // handled separately by the /api/uazapi/instance routes).
    const { baseUrl } = await resolveUazapiPlatformCredentials()
    return { provider: 'uazapi', instanceId: config.uazapi_instance_id, token, baseUrl }
  }

  if (config.provider === 'zapi') {
    if (!config.zapi_instance_id || !config.zapi_token) {
      throw new WhatsAppNotConfiguredError()
    }
    // zapi_token has no legacy CBC rows to upgrade — the column (and
    // AES-256-GCM encryption of it) were introduced together, unlike
    // access_token/uazapi_token which predate the GCM switch.
    const token = decrypt(config.zapi_token)
    const clientToken = config.zapi_client_token ? decrypt(config.zapi_client_token) : undefined
    return {
      provider: 'zapi',
      instanceId: config.zapi_instance_id,
      token,
      clientToken,
    }
  }

  if (!config.phone_number_id || !config.access_token) {
    throw new WhatsAppNotConfiguredError()
  }
  const accessToken = decrypt(config.access_token)
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error: upgradeError }: { error: { message: string } | null }) => {
        if (upgradeError) {
          console.warn(
            '[send-core] access_token GCM upgrade failed:',
            upgradeError.message,
          )
        }
      })
  }
  return { provider: 'meta', phoneNumberId: config.phone_number_id, accessToken }
}

/**
 * Construct a `WhatsAppProvider` from an already-resolved config.
 * Split from `getProviderForAccount` so callers that already have a
 * `ProviderConfig` on hand (e.g. a broadcast plan computed earlier in
 * the same request) don't need to re-query the DB.
 */
export function buildProvider(config: ProviderConfig): WhatsAppProvider {
  if (config.provider === 'meta') {
    return new MetaProvider(config)
  }
  if (config.provider === 'uazapi') {
    return new UazapiProvider(config)
  }
  if (config.provider === 'zapi') {
    return new ZapiProvider(config)
  }
  throw new Error(`Unsupported WhatsApp provider: ${(config as ProviderConfig).provider}`)
}

export async function getProviderForAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<WhatsAppProvider> {
  const config = await resolveProviderConfig(db, accountId)
  return buildProvider(config)
}

/**
 * Retry a phone-number-scoped send across plausible trunk-prefix
 * variants (see `phone-utils.ts::phoneVariants`) — a "recipient not
 * in allowed list" error means the number on file differs from ours
 * only by a leading 0. Returns the provider's result plus whichever
 * variant worked, so the caller can persist the corrected number back
 * onto the contact (as `send-message.ts` already does today).
 *
 * `attempt` must throw on failure. Only errors matching
 * `isRecipientNotAllowedError` trigger another variant — everything
 * else (a malformed template, an auth error, a network failure)
 * propagates immediately, since retrying those against five phone
 * spellings would just be five times slower to fail the same way.
 */
export async function sendWithPhoneRetry<T>(
  phone: string,
  attempt: (variant: string) => Promise<T>,
): Promise<{ result: T; workingPhone: string }> {
  const sanitized = sanitizePhoneForMeta(phone)
  if (!isValidE164(sanitized)) {
    throw new Error('Invalid phone number format')
  }

  const variants = phoneVariants(sanitized)
  let lastError: unknown = null

  for (const variant of variants) {
    try {
      const result = await attempt(variant)
      return { result, workingPhone: variant }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(message)) {
        throw err
      }
      lastError = err
    }
  }

  throw lastError
}

/**
 * Substitute {{1}}, {{2}}, … positional placeholders in a free-text
 * broadcast body with per-recipient values — the same convention
 * Meta's template params already use. uazapi has no template engine
 * of its own to do this substitution, so broadcast delivery does it
 * here before calling `provider.sendText`/`sendMedia`. A placeholder
 * with no matching param index is left as-is rather than blanked, so
 * a mismatched mapping is visible in the sent message instead of
 * silently disappearing.
 */
export function interpolateBodyText(bodyText: string, params: string[]): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, indexStr) => {
    const idx = parseInt(indexStr, 10) - 1
    return idx >= 0 && idx < params.length ? params[idx] : match
  })
}
