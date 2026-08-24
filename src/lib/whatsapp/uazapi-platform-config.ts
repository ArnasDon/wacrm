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

// Previously cached in a module-level variable after first resolution,
// to save a DB round-trip on every uazapi-api.ts call. Removed: on a
// serverless deployment (Vercel) each invocation can land on a
// different warm lambda instance, each with its OWN copy of this
// module's memory — invalidating the cache in the instance that
// handled the settings save (see the old
// invalidateUazapiPlatformCredentialsCache export, kept below as a
// no-op for callers) did nothing for every OTHER already-warm
// instance, which kept serving the stale admin token until Vercel
// happened to recycle it. That surfaced as intermittent "uazapi API
// error: Unauthorized" — e.g. the account that happened to hit a
// fresh instance right after a credentials change worked, while
// another account hitting an older warm instance kept 401ing with
// the same request, for no reason visible from the request itself.
// A single extra `platform_settings` read per call is cheap enough
// (this only runs on instance create/connect/status, never per
// message) that correctness wins over the saved round-trip.
export async function resolveUazapiPlatformCredentials(): Promise<UazapiPlatformCredentials> {
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

  return { baseUrl, adminToken }
}

/**
 * No-op — kept so existing callers (uazapi/settings's POST/DELETE)
 * don't need touching. There's no cache to invalidate anymore; see
 * resolveUazapiPlatformCredentials's comment for why it was removed.
 */
export function invalidateUazapiPlatformCredentialsCache(): void {}
