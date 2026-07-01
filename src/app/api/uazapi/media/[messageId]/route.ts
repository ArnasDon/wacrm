import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProviderFromConfig, type WhatsAppConfigRow } from '@/lib/whatsapp/providers/factory'

/**
 * On-demand media proxy for Uazapi, mirroring
 * `/api/whatsapp/media/[mediaId]` for Meta. `messageId` is the full
 * `owner:messageid` externalMessageId returned when the message was
 * received — Uazapi has no persistent CDN URL, so every fetch re-runs
 * `POST /message/download`.
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
    // decodeURIComponent — the `owner:messageid` id is passed URL-encoded
    // by the media_url stored on the message row (see the inbound
    // webhook, which builds `/api/uazapi/media/${encodeURIComponent(id)}`).
    const { buffer, contentType } = await provider.downloadMedia({
      mediaRef: decodeURIComponent(messageId),
    })

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        // Shorter than Meta's proxy cache — re-downloading from Uazapi
        // is cheap and this avoids serving a stale error response
        // indefinitely if the first fetch raced a not-yet-synced media.
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Error in Uazapi media GET:', error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 500 })
  }
}
