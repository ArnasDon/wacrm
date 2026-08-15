import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifyIgAccount } from '@/lib/instagram/api'
import { verifyZernioAccount } from '@/lib/zernio/api'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

/**
 * Resolve the caller's account_id from their profile. Mirrors
 * src/app/api/whatsapp/config/route.ts's helper of the same name —
 * kept as a local copy rather than a shared import so each config
 * route stays a self-contained file, same as the WhatsApp one.
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

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
 * GET /api/instagram/config
 *
 * Same contract as GET /api/whatsapp/config: always 200 outside auth
 * failures, with a `reason` the UI renders directly.
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

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { connected: false, reason: 'no_account', message: 'Your profile is not linked to an account.' },
        { status: 200 },
      )
    }

    const { data: config, error: configError } = await supabase
      .from('instagram_config')
      .select('provider, ig_account_id, access_token, zernio_api_key, zernio_account_id, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching instagram_config:', configError)
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
          message: 'No Instagram configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    if (config.provider === 'zernio') {
      let apiKey: string
      try {
        apiKey = decrypt(config.zernio_api_key!)
      } catch (err) {
        console.error('[instagram/config GET] Zernio key decryption failed:', err)
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
        const accountInfo = await verifyZernioAccount({ apiKey, accountId: config.zernio_account_id!, expectedPlatform: 'instagram' })
        return NextResponse.json({
          connected: true,
          account_info: { username: accountInfo.username, name: accountInfo.displayName },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown Zernio API error'
        console.error('[instagram/config GET] Zernio API verification failed:', message)
        return NextResponse.json(
          { connected: false, reason: 'zernio_api_error', message: `Zernio API rejected the credentials: ${message}` },
          { status: 200 }
        )
      }
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token!)
    } catch (err) {
      console.error('[instagram/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments. Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    try {
      const accountInfo = await verifyIgAccount({ igAccountId: config.ig_account_id!, accessToken })
      return NextResponse.json({ connected: true, account_info: accountInfo })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Meta API error'
      console.error('[instagram/config GET] Meta API verification failed:', message)
      return NextResponse.json(
        { connected: false, reason: 'meta_api_error', message: `Meta API rejected the credentials: ${message}` },
        { status: 200 }
      )
    }
  } catch (error) {
    console.error('Error in Instagram config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/instagram/config
 *
 * Saves or updates the Instagram config for the authenticated user's
 * account. Two providers, picked by `body.provider` (defaults to
 * 'meta' for backward compatibility with clients that predate the
 * Zernio option):
 *   - 'meta': verifies credentials with Meta directly, same as before.
 *   - 'zernio': verifies against Zernio's API instead, and additionally
 *     generates a webhook secret on first save (returned once in the
 *     response, same "shown once" contract Zernio's own API keys use)
 *     for the user to paste into their Zernio webhook settings.
 * Unlike WhatsApp, there is no phone-number registration or 2FA PIN
 * step — either provider only needs a connected-account id + a valid
 * credential to send/receive.
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

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const body = await request.json()
    const provider: 'meta' | 'zernio' = body.provider === 'zernio' ? 'zernio' : 'meta'

    const { data: existing } = await supabase
      .from('instagram_config')
      .select('id, zernio_webhook_secret')
      .eq('account_id', accountId)
      .maybeSingle()

    if (provider === 'zernio') {
      return await saveZernioConfig({ supabase, accountId, userId: user.id, existing, body })
    }
    return await saveMetaConfig({ supabase, accountId, userId: user.id, existing, body })
  } catch (error) {
    console.error('Error in Instagram config POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface SaveConfigArgs {
  supabase: Awaited<ReturnType<typeof createClient>>
  accountId: string
  userId: string
  existing: { id: string; zernio_webhook_secret: string | null } | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any
}

async function saveMetaConfig({ supabase, accountId, userId, existing, body }: SaveConfigArgs) {
  const { ig_account_id, page_id, access_token, verify_token } = body

  if (!access_token || !ig_account_id) {
    return NextResponse.json({ error: 'access_token and ig_account_id are required' }, { status: 400 })
  }

  // Reject if another account has already claimed this ig_account_id.
  // Same reasoning as the WhatsApp route's phone_number_id check: two
  // accounts sharing one IG account would make the webhook's routing
  // lookup ambiguous, silently dropping inbound messages.
  const { data: claimed, error: claimedError } = await supabaseAdmin()
    .from('instagram_config')
    .select('account_id')
    .eq('ig_account_id', ig_account_id)
    .neq('account_id', accountId)
    .maybeSingle()

  if (claimedError) {
    console.error('Error checking ig_account_id ownership:', claimedError)
    return NextResponse.json({ error: 'Failed to validate configuration' }, { status: 500 })
  }

  if (claimed) {
    return NextResponse.json(
      {
        error:
          'This Instagram account is already linked to another account on this instance. Each Instagram account can only be connected to one wacrm account.',
      },
      { status: 409 }
    )
  }

  let accountInfo
  try {
    accountInfo = await verifyIgAccount({ igAccountId: ig_account_id, accessToken: access_token })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error'
    console.error('Meta API verification failed during save:', message)
    return NextResponse.json({ error: `Meta API error: ${message}` }, { status: 400 })
  }

  let encryptedAccessToken: string
  let encryptedVerifyToken: string | null
  try {
    encryptedAccessToken = encrypt(access_token)
    encryptedVerifyToken = verify_token ? encrypt(verify_token) : null
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown encryption error'
    console.error('Encryption failed:', message)
    return NextResponse.json(
      {
        error:
          'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
      },
      { status: 500 }
    )
  }

  const baseRow = {
    provider: 'meta',
    ig_account_id,
    page_id: page_id || null,
    ig_username: accountInfo.username ?? null,
    access_token: encryptedAccessToken,
    verify_token: encryptedVerifyToken,
    // Cleared so a provider switch doesn't leave a stale Zernio
    // credential set sitting next to the newly-active Meta one.
    zernio_api_key: null,
    zernio_account_id: null,
    zernio_webhook_secret: null,
    status: 'connected',
    connected_at: new Date().toISOString(),
    last_connection_error: null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error: updateError } = await supabase.from('instagram_config').update(baseRow).eq('account_id', accountId)
    if (updateError) {
      console.error('Error updating instagram_config:', updateError)
      return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
    }
  } else {
    const { error: insertError } = await supabase
      .from('instagram_config')
      .insert({ account_id: accountId, user_id: userId, ...baseRow })
    if (insertError) {
      console.error('Error inserting instagram_config:', insertError)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true, saved: true, account_info: accountInfo })
}

async function saveZernioConfig({ supabase, accountId, userId, existing, body }: SaveConfigArgs) {
  const { zernio_api_key, zernio_account_id } = body

  if (!zernio_api_key || !zernio_account_id) {
    return NextResponse.json({ error: 'zernio_api_key and zernio_account_id are required' }, { status: 400 })
  }

  // Same "can't be claimed by two wacrm accounts" guarantee the Meta
  // path enforces on ig_account_id — see idx_instagram_config_zernio_account.
  const { data: claimed, error: claimedError } = await supabaseAdmin()
    .from('instagram_config')
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
          'This Zernio account is already linked to another account on this instance. Each Zernio-connected Instagram account can only be connected to one wacrm account.',
      },
      { status: 409 }
    )
  }

  let accountInfo
  try {
    accountInfo = await verifyZernioAccount({ apiKey: zernio_api_key, accountId: zernio_account_id, expectedPlatform: 'instagram' })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Zernio API error'
    console.error('Zernio API verification failed during save:', message)
    return NextResponse.json({ error: `Zernio API error: ${message}` }, { status: 400 })
  }

  // The webhook secret is generated once and kept stable across
  // re-saves — the user pastes it into Zernio's dashboard, so
  // regenerating it on every save would silently break signature
  // verification until they noticed and re-pasted it.
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
    provider: 'zernio',
    zernio_api_key: encryptedApiKey,
    zernio_account_id,
    zernio_webhook_secret: encryptedSecret,
    ig_username: accountInfo.username ?? null,
    // Cleared so a provider switch doesn't leave a stale Meta
    // credential set sitting next to the newly-active Zernio one.
    ig_account_id: null,
    page_id: null,
    access_token: null,
    verify_token: null,
    status: 'connected',
    connected_at: new Date().toISOString(),
    last_connection_error: null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error: updateError } = await supabase.from('instagram_config').update(baseRow).eq('account_id', accountId)
    if (updateError) {
      console.error('Error updating instagram_config:', updateError)
      return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 })
    }
  } else {
    const { error: insertError } = await supabase
      .from('instagram_config')
      .insert({ account_id: accountId, user_id: userId, ...baseRow })
    if (insertError) {
      console.error('Error inserting instagram_config:', insertError)
      return NextResponse.json({ error: 'Failed to save configuration' }, { status: 500 })
    }
  }

  return NextResponse.json({
    success: true,
    saved: true,
    account_info: { username: accountInfo.username, name: accountInfo.displayName },
    // Only present the one time it's generated — same "shown once"
    // contract as Zernio's own API keys. The UI must prompt the user
    // to copy it into Zernio's webhook settings immediately.
    webhook_secret: plaintextSecret,
  })
}

/**
 * DELETE /api/instagram/config
 *
 * Removes the authenticated user's account's Instagram configuration
 * row. Used by "Reset Configuration" to recover from a corrupted
 * encrypted token.
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

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const { error: deleteError } = await supabase.from('instagram_config').delete().eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting instagram_config:', deleteError)
      return NextResponse.json({ error: 'Failed to delete configuration' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in Instagram config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
