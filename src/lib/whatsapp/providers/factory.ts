/**
 * Provider factory — turns a `whatsapp_config` row into the matching
 * `WhatsAppProvider` implementation. Every outbound call site should
 * go through this instead of reading `access_token` / `uazapi_*`
 * columns directly, so provider-specific plumbing stays in one place.
 */

import { decrypt } from '../encryption'
import { MetaProvider } from './meta'
import { UazapiProvider } from './uazapi'
import type { WhatsAppProvider } from './types'

/**
 * Minimal shape read from `whatsapp_config` — matches the columns
 * added in migration 029. Callers can pass the full Supabase row;
 * extra fields are ignored.
 */
export interface WhatsAppConfigRow {
  provider: string
  phone_number_id?: string | null
  access_token?: string | null
  uazapi_instance_token?: string | null
  uazapi_base_url?: string | null
}

export function getProviderFromConfig(config: WhatsAppConfigRow): WhatsAppProvider {
  if (config.provider === 'uazapi') {
    if (!config.uazapi_instance_token || !config.uazapi_base_url) {
      throw new Error('Uazapi config is missing instance_token or base_url')
    }
    return new UazapiProvider({
      instanceToken: decrypt(config.uazapi_instance_token),
      baseUrl: config.uazapi_base_url,
    })
  }

  if (!config.phone_number_id || !config.access_token) {
    throw new Error('Meta config is missing phone_number_id or access_token')
  }
  return new MetaProvider({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  })
}
