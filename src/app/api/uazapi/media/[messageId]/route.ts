import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProviderFromConfig, type WhatsAppConfigRow } from '@/lib/whatsapp/providers/factory'

const CACHE_BUCKET = 'chat-media'

/**
 * Deterministic (not timestamped) cache path — repeat requests for the same
 * message must hit the same object so we actually skip re-downloading from
 * Uazapi. No extension: the object's stored Content-Type (set at upload)
 * is what the public URL serves back, so we don't need to know the MIME
 * type before the first download.
 */
export function cachePath(accountId: string, externalMessageId: string): string {
  const safeId = externalMessageId.replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `account-${accountId}/uazapi-cache/${safeId}`
}

/**
 * On-demand media proxy for Uazapi, mirroring
 * `/api/whatsapp/media/[mediaId]` for Meta. `messageId` is the full
 * `owner:messageid` externalMessageId returned when the message was
 * received — Uazapi has no persistent CDN URL, so the first fetch runs
 * `POST /message/download` and caches the result in the `chat-media`
 * Storage bucket; every subsequent fetch for the same message is served
 * from that cache instead of hitting Uazapi again.
 *
 * This exists because a long conversation renders every message (and
 * every image) at once (no pagination in message-thread.tsx) — without
 * caching, opening it fires one concurrent /message/download per image,
 * which was observed hitting Uazapi's rate limiting in production
 * (200 responses with no base64Data payload).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  try {
    const { messageId } = await params
    if (!messageId) {
      return NextResponse.json({ error: 'Message ID is required' }, { status: 400 })
    }
    // decodeURIComponent — the `owner:messageid` id is passed URL-encoded
    // by the media_url stored on the message row (see the inbound
    // webhook, which builds `/api/uazapi/media/${encodeURIComponent(id)}`).
    const externalMessageId = decodeURIComponent(messageId)

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'Your profile is not linked to an account.' }, { status: 403 })
    }

    const path = cachePath(accountId, externalMessageId)

    // Best-effort cache read — a Storage hiccup should fall through to
    // Uazapi, not fail the whole request.
    try {
      const { data: cached } = await supabase.storage.from(CACHE_BUCKET).download(path)
      if (cached) {
        return new Response(cached, {
          status: 200,
          headers: {
            'Content-Type': cached.type || 'application/octet-stream',
            'Cache-Control': 'private, max-age=86400',
          },
        })
      }
    } catch {
      // Not cached (or transient Storage error) — fall through to Uazapi.
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('provider', 'uazapi')
      .single()

    if (configError || !config) {
      return NextResponse.json({ error: 'Uazapi not configured' }, { status: 400 })
    }

    const provider = getProviderFromConfig(config as WhatsAppConfigRow)
    const { buffer, contentType } = await provider.downloadMedia({
      mediaRef: externalMessageId,
    })

    // Best-effort cache write, deferred until after the response is sent —
    // a failed upload just means the next request re-downloads from
    // Uazapi; it must not delay or fail this response.
    after(async () => {
      const { error } = await supabase.storage.from(CACHE_BUCKET).upload(path, buffer, {
        contentType: contentType || 'application/octet-stream',
        upsert: true,
      })
      if (error) console.error('[uazapi-media] cache upload failed:', error.message)
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in Uazapi media GET:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
