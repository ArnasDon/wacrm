import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection } from '@/lib/db/scoped'
import type { MessageDoc } from '@/lib/db/types'
import { NotFoundError, ValidationError } from '@/lib/http/errors'
import { downloadMedia, getMediaUrl } from '@/lib/whatsapp/meta-api'
import { getWhatsAppCredentials } from '@/lib/whatsapp/store'

/**
 * GET — stream an inbound WhatsApp media file (e.g. a transfer
 * screenshot) to a signed-in member. The media id must belong to a
 * message IN THIS ACCOUNT — without that check any member of any
 * account could fetch arbitrary media ids through our token.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ mediaId: string }> }) {
  try {
    const auth = await getCurrentAccount()
    const { mediaId } = await ctx.params
    if (!/^\d{5,40}$/.test(mediaId)) throw new ValidationError('Invalid media id')

    const messages = await scopedCollection<MessageDoc>(auth, 'messages')
    const owned = await messages.findOne({ 'media.id': mediaId }, { projection: { _id: 1, media: 1 } })
    if (!owned) throw new NotFoundError('Media not found')

    const creds = await getWhatsAppCredentials(auth)
    if (!creds) throw new ValidationError('WhatsApp is not connected')
    const info = await getMediaUrl({ mediaId, accessToken: creds.accessToken })
    const { buffer, contentType } = await downloadMedia({ downloadUrl: info.url, accessToken: creds.accessToken })
    const type = contentType || info.mimeType || 'application/octet-stream'
    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': type,
        'cache-control': 'private, max-age=3600',
        // Never render user-supplied files as a page on our origin.
        'content-disposition': type.startsWith('image/') ? 'inline' : 'attachment',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
