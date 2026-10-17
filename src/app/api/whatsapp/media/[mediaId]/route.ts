import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Punto 10, F-P10-3 — mediaId is an arbitrary, client-supplied path
    // param. Before ever spending a call to Meta (and handing back
    // bytes), confirm this exact mediaId actually belongs to a message
    // in a conversation of THIS caller's own account — never trust the
    // caller's own access_token/Meta's response alone to enforce that
    // boundary. Scoped to `accountId` (resolved above, exclusively from
    // the caller's own profile — never client-supplied) via the
    // RLS-scoped `supabase` client, so this can only ever confirm
    // ownership within rows the caller could already see; it can't be
    // used to probe another account's data. A miss (mediaId belongs to
    // no message at all, OR belongs to a message of a different
    // account) returns the SAME 404 either way — never revealing which
    // case it was. Mirrors the exact `conversations!inner(account_id)`
    // scoping pattern already used by the webhook's own
    // handleStatusUpdate() for the identical class of problem (a
    // Meta-side id that isn't guaranteed unique/scoped across tenants).
    const proxyPath = `/api/whatsapp/media/${mediaId}`
    const { data: ownedMessage, error: ownershipError } = await supabase
      .from('messages')
      .select('id, conversations!inner(account_id)')
      .eq('media_url', proxyPath)
      .eq('conversations.account_id', accountId)
      .limit(1)
      .maybeSingle()

    if (ownershipError) {
      console.error('[whatsapp/media] ownership check failed:', ownershipError)
      return NextResponse.json(
        { error: 'Failed to fetch media' },
        { status: 500 }
      )
    }
    if (!ownedMessage) {
      // Never distinguishes "doesn't exist" from "belongs to another
      // account" — both are indistinguishable 404s to the caller.
      return NextResponse.json(
        { error: 'Media not found' },
        { status: 404 }
      )
    }

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
