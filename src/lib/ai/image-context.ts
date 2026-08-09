import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import type { AiImageMediaType, ChatImagePart } from './types'

const WHATSAPP_MEDIA_PATH = /^\/api\/whatsapp\/media\/([^/?#]+)$/
const SUPPORTED_IMAGE_TYPES = new Set<AiImageMediaType>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

// Anthropic accepts at most 10 MB per base64 image. A 5 MB binary becomes
// roughly 6.7 MB after base64 encoding and leaves room for the rest of the
// request. WhatsApp Cloud images already normally fit below this bound.
export const MAX_AI_IMAGE_BYTES = 5 * 1024 * 1024

interface WhatsAppConfigRow {
  access_token: string
}

export type ResolveAiImage = (mediaUrl: string) => Promise<ChatImagePart | null>

function supportedMediaType(value: string): AiImageMediaType | null {
  const normalized = value.split(';', 1)[0].trim().toLowerCase()
  return SUPPORTED_IMAGE_TYPES.has(normalized as AiImageMediaType)
    ? (normalized as AiImageMediaType)
    : null
}

/**
 * Resolve the CRM's authenticated WhatsApp media proxy into a provider-safe
 * data URL. Provider servers cannot open `/api/whatsapp/media/...` because it
 * requires the human operator's session cookie, so this server-side path
 * downloads the bytes from Meta with the account token instead.
 *
 * The account config is loaded lazily and cached for all images in one model
 * context. Failures are isolated per image: callers retain the textual image
 * placeholder and the conversation continues without vision.
 */
export function createWhatsAppImageResolver(
  db: WacrmSupabaseClient,
  accountId: string,
): ResolveAiImage {
  let tokenPromise: Promise<string | null> | null = null

  const accessToken = (): Promise<string | null> => {
    if (!tokenPromise) {
      tokenPromise = (async () => {
        const { data, error } = await db
          .from('whatsapp_config')
          .select('access_token')
          .eq('account_id', accountId)
          .maybeSingle()

        if (error || !data?.access_token) return null
        return decrypt((data as WhatsAppConfigRow).access_token)
      })().catch((error) => {
        console.error('[ai vision] WhatsApp token could not be loaded:', error)
        return null
      })
    }
    return tokenPromise
  }

  return async (mediaUrl: string): Promise<ChatImagePart | null> => {
    const match = mediaUrl.match(WHATSAPP_MEDIA_PATH)
    if (!match) return null

    try {
      const token = await accessToken()
      if (!token) return null

      const mediaId = decodeURIComponent(match[1])
      const media = await getMediaUrl({ mediaId, accessToken: token })
      const downloaded = await downloadMedia({
        downloadUrl: media.url,
        accessToken: token,
      })
      const downloadedType = supportedMediaType(downloaded.contentType)
      const mediaType =
        downloadedType ??
        (downloaded.contentType.split(';', 1)[0].trim().toLowerCase() === 'application/octet-stream'
          ? supportedMediaType(media.mimeType)
          : null)
      if (!mediaType || downloaded.buffer.byteLength > MAX_AI_IMAGE_BYTES) {
        return null
      }

      return {
        type: 'image_url',
        url: `data:${mediaType};base64,${downloaded.buffer.toString('base64')}`,
        mediaType,
      }
    } catch (error) {
      console.error('[ai vision] image could not be prepared:', {
        mediaUrl,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}
