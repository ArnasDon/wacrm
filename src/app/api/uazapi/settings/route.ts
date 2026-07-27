import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { invalidateUazapiPlatformCredentialsCache } from '@/lib/whatsapp/uazapi-platform-config'

/**
 * GET /api/uazapi/settings
 *
 * Whether the platform-wide uazapi reseller credentials (Server URL +
 * Admin Token) are set up, and the base URL to display — the admin
 * token itself is never returned, mirroring how `whatsapp_config`
 * never sends `access_token` back to the client.
 */
export async function GET() {
  try {
    const { supabase } = await requireRole('owner')

    const { data, error } = await supabase
      .from('platform_settings')
      .select('uazapi_base_url, uazapi_admin_token')
      .eq('id', true)
      .maybeSingle()

    if (error) {
      console.error('[uazapi/settings] error loading platform_settings:', error)
      return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 })
    }

    return NextResponse.json({
      configured: Boolean(data?.uazapi_base_url && data?.uazapi_admin_token),
      baseUrl: data?.uazapi_base_url ?? null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/uazapi/settings
 *
 * Owner-only. Saves the platform-wide uazapi Server URL + Admin Token
 * (encrypted), then invalidates the in-memory cache in
 * uazapi-platform-config.ts so the very next request picks up the new
 * values without a server restart.
 *
 * `adminToken` may be omitted (or blank) when a token is already
 * saved — this lets the owner edit just the Server URL without having
 * to re-paste the secret every time. It's required on first setup,
 * since there's nothing to fall back to yet.
 */
export async function POST(request: Request) {
  try {
    const { supabase, userId } = await requireRole('owner')

    const body = await request.json().catch(() => ({}))
    const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : ''
    const adminTokenInput = typeof body?.adminToken === 'string' ? body.adminToken.trim() : ''

    if (!baseUrl) {
      return NextResponse.json({ error: 'Server URL is required.' }, { status: 400 })
    }
    if (!/^https?:\/\//.test(baseUrl)) {
      return NextResponse.json(
        { error: 'Server URL must start with http:// or https://' },
        { status: 400 },
      )
    }

    let encryptedAdminToken: string
    if (adminTokenInput) {
      encryptedAdminToken = encrypt(adminTokenInput)
    } else {
      const { data: existing } = await supabase
        .from('platform_settings')
        .select('uazapi_admin_token')
        .eq('id', true)
        .maybeSingle()
      if (!existing?.uazapi_admin_token) {
        return NextResponse.json({ error: 'Admin Token is required.' }, { status: 400 })
      }
      encryptedAdminToken = existing.uazapi_admin_token
    }

    const { error } = await supabase.from('platform_settings').upsert({
      id: true,
      uazapi_base_url: baseUrl,
      uazapi_admin_token: encryptedAdminToken,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    })

    if (error) {
      console.error('[uazapi/settings] error saving platform_settings:', error)
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
    }

    invalidateUazapiPlatformCredentialsCache()

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/uazapi/settings
 *
 * Owner-only. Removes the platform-wide uazapi credentials entirely.
 * After this, `resolveUazapiPlatformCredentials()` falls back to
 * `UAZAPI_BASE_URL`/`UAZAPI_ADMIN_TOKEN` env vars if set, or throws
 * `UazapiNotConfiguredError` — accounts that already paired via QR
 * code keep their own `whatsapp_config` row untouched; they just
 * can't send/receive until credentials are set again.
 */
export async function DELETE() {
  try {
    const { supabase } = await requireRole('owner')

    const { error } = await supabase.from('platform_settings').delete().eq('id', true)
    if (error) {
      console.error('[uazapi/settings] error deleting platform_settings:', error)
      return NextResponse.json({ error: 'Failed to remove credentials' }, { status: 500 })
    }

    invalidateUazapiPlatformCredentialsCache()

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
