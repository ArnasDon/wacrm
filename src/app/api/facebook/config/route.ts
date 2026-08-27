import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyZernioAccount } from '@/lib/zernio/api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/** Mirrors src/app/api/instagram/config/route.ts's helper of the same name.
 *  Returns the caller's account plus their role, so write handlers can
 *  gate on `admin` in the route itself (defense in depth) instead of
 *  relying only on the `facebook_config` RLS policies (migration 041) —
 *  same bar every other channel/AI config route enforces. */
async function resolveAccount(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ accountId: string; role: string } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return { accountId: data.account_id as string, role: (data.account_role as string) ?? '' }
}

const WRITE_ROLES = new Set(['owner', 'admin'])

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

/**
 * GET /api/facebook/config
 *
 * Same contract as GET /api/instagram/config: always 200 outside auth
 * failures, with a `reason` the UI renders directly. Facebook has no
 * direct-Meta path in wacrm — every row is a Zernio connection.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const account = await resolveAccount(supabase, user.id)
    if (!account) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.' },
        { status: 200 },
      )
    }
    const accountId = account.accountId

    const { data: config, error: configError } = await supabase
      .from('facebook_config')
      .select('zernio_api_key, zernio_account_id, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching facebook_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No Facebook configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    let apiKey: string
    try {
      apiKey = decrypt(config.zernio_api_key)
    } catch (err) {
      console.error('[facebook/config GET] Zernio key decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored Zernio API key cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments. Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    try {
      const accountInfo = await verifyZernioAccount({ apiKey, accountId: config.zernio_account_id, expectedPlatform: 'facebook' })
      return NextResponse.json({
        connected: true,
        account_info: { username: accountInfo.username, name: accountInfo.displayName },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Zernio API error'
      console.error('[facebook/config GET] Zernio API verification failed:', message)
      return NextResponse.json(
        { connected: false, reason: 'zernio_api_error', message: `Zernio API rejected the credentials: ${message}` },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in Facebook config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/facebook/config
 *
 * Saves or updates the Facebook config for the authenticated user's
 * account. Always Zernio — verifies against Zernio's API, and
 * generates a webhook secret on first save (returned once in the
 * response) for the user to paste into their Zernio webhook settings.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const account = await resolveAccount(supabase, user.id)
    if (!account) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }
    if (!WRITE_ROLES.has(account.role)) {
      return NextResponse.json(
        { error: 'Solo un administrador puede cambiar la configuración de Facebook.' },
        { status: 403 },
      )
    }
    const accountId = account.accountId

    const body = await request.json()
    const { zernio_api_key, zernio_account_id } = body

    if (!zernio_api_key || !zernio_account_id) {
      return NextResponse.json({ error: 'zernio_api_key and zernio_account_id are required' }, { status: 400 })
    }

    const { data: existing } = await supabase
      .from('facebook_config')
      .select('id, zernio_webhook_secret')
      .eq('account_id', accountId)
      .maybeSingle()

    // Same "can't be claimed by two wacrm accounts" guarantee the
    // Instagram route enforces — see idx_facebook_config_zernio_account.
    const { data: claimed, error: claimedError } = await supabaseAdmin()
      .from('facebook_config')
      .select('account_id')
      .eq('zernio_account_id', zernio_account_id)
      .neq('account_id', accountId)
      .maybeSingle()

    if (claimedError) {
      console.error('Error checking zernio_account_id ownership:', claimedError)
      return NextResponse.json({ error: 'Failed to validate configuration' }, { status: 500 })
    }

    if (claimed) {
      return NextResponse.json(
        {
          error:
            'This Zernio account is already linked to another account on this instance. Each Zernio-connected Facebook Page can only be connected to one Chat Sandía account.',
        },
        { status: 409 }
      )
    }

    let accountInfo
    try {
      accountInfo = await verifyZernioAccount({ apiKey: zernio_api_key, accountId: zernio_account_id, expectedPlatform: 'facebook' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Zernio API error'
      console.error('Zernio API verification failed during save:', message)
      return NextResponse.json({ error: `Zernio API error: ${message}` }, { status: 400 })
    }

    // The webhook secret is generated once and kept stable across
    // re-saves — see the Instagram config route's identical comment.
    const isNewSecret = !existing?.zernio_webhook_secret
    const plaintextSecret = isNewSecret ? crypto.randomBytes(32).toString('hex') : null

    let encryptedApiKey: string
    let encryptedSecret: string | null
    try {
      encryptedApiKey = encrypt(zernio_api_key)
      encryptedSecret = plaintextSecret ? encrypt(plaintextSecret) : existing!.zernio_webhook_secret
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown encryption error'
      console.error('Encryption failed:', message)
      return NextResponse.json(
        {
          error:
            'Failed to encrypt credentials. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
        },
        { status: 500 }
      )
    }

    const baseRow = {
      zernio_api_key: encryptedApiKey,
      zernio_account_id,
      zernio_webhook_secret: encryptedSecret,
      fb_page_name: accountInfo.username ?? accountInfo.displayName ?? null,
      status: 'connected',
      connected_at: new Date().toISOString(),
      last_connection_error: null,
      updated_at: new Date().toISOString(),
    }

    if (existing) {
      const { error: updateError } = await supabase.from('facebook_config').update(baseRow).eq('account_id', accountId)
      if (updateError) {
        console.error('Error updating facebook_config:', updateError)
        return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
      }
    } else {
      const { error: insertError } = await supabase
        .from('facebook_config')
        .insert({ account_id: accountId, user_id: user.id, ...baseRow })
      if (insertError) {
        console.error('Error inserting facebook_config:', insertError)
        return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      saved: true,
      account_info: { username: accountInfo.username, name: accountInfo.displayName },
      webhook_secret: plaintextSecret,
    })
  } catch (error) {
    console.error('Error in Facebook config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/facebook/config
 *
 * Removes the authenticated user's account's Facebook configuration
 * row. Used by "Reset Configuration" to recover from a corrupted
 * encrypted token, or to start over.
 */
export async function DELETE() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const account = await resolveAccount(supabase, user.id)
    if (!account) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }
    if (!WRITE_ROLES.has(account.role)) {
      return NextResponse.json(
        { error: 'Solo un administrador puede cambiar la configuración de Facebook.' },
        { status: 403 },
      )
    }
    const accountId = account.accountId

    const { error: deleteError } = await supabase.from('facebook_config').delete().eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting facebook_config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in Facebook config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
