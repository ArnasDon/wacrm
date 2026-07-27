// ============================================================
// Platform-wide uazapi reseller credentials.
//
// One admin subscription backs every account's uazapi instance on
// this deployment (see migration 037's comment on the reseller
// model). Historically that meant UAZAPI_ADMIN_TOKEN / UAZAPI_BASE_URL
// env vars only — this module adds a DB-backed alternative
// (platform_settings, migration 039) so a non-technical operator can
// paste them once from Settings → WhatsApp instead of editing
// .env.local and restarting the app.
//
// Resolution order: DB row first, env vars as fallback — an operator
// who already has env vars set keeps working unchanged.
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { decrypt } from './encryption'

export interface UazapiPlatformCredentials {
  baseUrl: string
  adminToken: string
}

export class UazapiNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UazapiNotConfiguredError'
  }
}

// Untyped on purpose — matches the convention used for every other
// lazy service-role client in this codebase (e.g. the Meta webhook
// route), which avoids Supabase's generic inference collapsing
// chained queries to `never` when no generated Database schema exists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

// Cached after first resolution so every uazapi-api.ts call doesn't
// round-trip the DB. Invalidated explicitly after a save (see
// invalidateUazapiPlatformCredentialsCache) so the very next request
// picks up the new values — no restart needed.
let _cached: UazapiPlatformCredentials | null = null

export async function resolveUazapiPlatformCredentials(): Promise<UazapiPlatformCredentials> {
  if (_cached) return _cached

  const { data } = await supabaseAdmin()
    .from('platform_settings')
    .select('uazapi_admin_token, uazapi_base_url')
    .eq('id', true)
    .maybeSingle()

  let dbToken: string | null = null
  if (data?.uazapi_admin_token) {
    try {
      dbToken = decrypt(data.uazapi_admin_token)
    } catch (err) {
      console.error('[uazapi-platform-config] failed to decrypt stored admin token:', err)
    }
  }
  const dbBaseUrl = typeof data?.uazapi_base_url === 'string' ? data.uazapi_base_url.trim() : ''

  const baseUrl = (dbBaseUrl || process.env.UAZAPI_BASE_URL || '').replace(/\/+$/, '')
  const adminToken = dbToken || process.env.UAZAPI_ADMIN_TOKEN

  if (!baseUrl || !adminToken) {
    throw new UazapiNotConfiguredError(
      'uazapi is not configured for this deployment yet. An account owner can set it up in Settings → WhatsApp.',
    )
  }

  _cached = { baseUrl, adminToken }
  return _cached
}

/** Call after saving new platform_settings so the change takes effect immediately. */
export function invalidateUazapiPlatformCredentialsCache(): void {
  _cached = null
}
