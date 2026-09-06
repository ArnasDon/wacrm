// ============================================================
// Inbound customer photos → provider image blocks, for the AI
// auto-reply path. Uses the account's own WhatsApp credentials to
// download the media server-side (the /api/whatsapp/media proxy is
// session-gated and unreachable from a background dispatch), then
// hands back a base64 `ChatImage` for `buildConversationContext`.
//
// Everything here degrades to `null` on any problem (unsupported
// format, too large, download failure, no config) — a photo the AI
// can't see must never break the reply, same "degrade, never fail"
// contract as the rest of auto-reply.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { downloadZernioWhatsAppMedia } from '@/lib/zernio/api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiProvider, ChatImage } from './types'

/** Formats every current Claude model and the GPT-4o family accept. */
const VISION_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

/** Provider ceilings: Anthropic 5 MB/image, OpenAI ~20 MB but base64
 *  inflation + token cost make anything this big a bad idea anyway. */
export const MAX_INBOUND_IMAGE_BYTES = 4 * 1024 * 1024

/** How many of the most recent customer photos the AI is shown for one
 *  reply — keeps token spend bounded when someone dumps an album. */
export const MAX_INBOUND_IMAGES_PER_REPLY = 4

/** A media URL/type is a photo we can actually send to the model. */
export function isSupportedInboundImage(
  mimeType: string | null | undefined,
  byteLength: number,
): boolean {
  if (!mimeType) return false
  const base = mimeType.split(';')[0].trim().toLowerCase()
  return VISION_MIME.has(base) && byteLength > 0 && byteLength <= MAX_INBOUND_IMAGE_BYTES
}

/** Every current Claude model is vision-capable. For OpenAI only the
 *  4o / 4.1 / 5 / o-series lines are — older `gpt-3.5*` / `gpt-4-0613`
 *  reject image parts, so we just don't send them. */
export function providerSupportsVision(provider: AiProvider, model: string): boolean {
  if (provider === 'anthropic') return true
  const m = model.toLowerCase()
  if (m.includes('gpt-3.5') || m.includes('instruct')) return false
  return (
    m.includes('4o') ||
    m.includes('gpt-4.1') ||
    m.includes('gpt-5') ||
    m.includes('gpt-4-turbo') ||
    /\bo[1345]\b/.test(m) ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  )
}

/** `/api/whatsapp/media/<id>` → `<id>`, or null if it isn't that shape. */
function mediaIdFromProxyUrl(url: string): string | null {
  const m = url.match(/^\/api\/whatsapp\/media\/([^/?#]+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

/**
 * A resolver `buildConversationContext` can call for each `image`
 * message it finds on a customer turn. Loads the account's
 * `whatsapp_config` once (lazily, cached in the closure), then
 * downloads + base64-encodes each photo through the same Meta / Zernio
 * paths the media proxy uses. Returns `null` for anything it can't or
 * shouldn't send.
 */
export function makeInboundImageResolver(
  db: SupabaseClient,
  accountId: string,
): (mediaUrl: string, mediaType: string | null) => Promise<ChatImage | null> {
  let configPromise: Promise<Record<string, unknown> | null> | null = null
  const loadConfig = () => {
    if (!configPromise) {
      configPromise = (async () => {
        const { data } = await db
          .from('whatsapp_config')
          .select('provider, access_token, zernio_api_key, zernio_account_id')
          .eq('account_id', accountId)
          .maybeSingle()
        return (data as Record<string, unknown> | null) ?? null
      })()
    }
    return configPromise
  }

  return async (mediaUrl, mediaType) => {
    try {
      const mediaId = mediaUrl.startsWith('/api/whatsapp/media/')
        ? mediaIdFromProxyUrl(mediaUrl)
        : null
      if (!mediaId) return null
      // Cheap early-out on the MIME the webhook already recorded, before
      // spending a download.
      if (mediaType && !isSupportedInboundImage(mediaType, MAX_INBOUND_IMAGE_BYTES)) {
        return null
      }

      const config = await loadConfig()
      if (!config) return null

      let bytes: Buffer
      let contentType: string | null
      if (config.provider === 'zernio') {
        const res = await downloadZernioWhatsAppMedia({
          apiKey: decrypt(config.zernio_api_key as string),
          accountId: config.zernio_account_id as string,
          mediaId,
        })
        bytes = Buffer.from(res.buffer)
        contentType = res.contentType
      } else {
        const info = await getMediaUrl({
          mediaId,
          accessToken: decrypt(config.access_token as string),
        })
        const res = await downloadMedia({
          downloadUrl: info.url,
          accessToken: decrypt(config.access_token as string),
        })
        bytes = res.buffer
        contentType = res.contentType || info.mimeType
      }

      const mime = (contentType || mediaType || '').split(';')[0].trim().toLowerCase()
      if (!isSupportedInboundImage(mime, bytes.byteLength)) return null

      return { mimeType: mime, dataBase64: bytes.toString('base64') }
    } catch (err) {
      console.warn('[ai inbound-image] could not attach a customer photo:', err)
      return null
    }
  }
}

export type InboundImageResolver = ReturnType<typeof makeInboundImageResolver>
