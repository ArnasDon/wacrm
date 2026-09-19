import 'server-only'
import { createHash } from 'node:crypto'
import { MediaError, tenantFolder, type ImageMime, type MediaStore, type StoredImage } from './common'

// ============================================================
// Cloudinary backend (REST, signed server-side uploads — no SDK).
// Credentials come from the business's own Storage settings
// (encrypted in MongoDB), never from the environment.
// ============================================================

export interface CloudinaryCredentials {
  cloudName: string
  apiKey: string
  apiSecret: string
}

/** Cloudinary signature: sha1 of sorted "k=v&k=v" + api_secret. */
function sign(params: Record<string, string>, secret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return createHash('sha1').update(payload + secret).digest('hex')
}

function apiBase(cfg: CloudinaryCredentials): string {
  if (!/^[a-z0-9_-]{1,64}$/i.test(cfg.cloudName)) throw new MediaError('Invalid Cloudinary cloud name')
  return `https://api.cloudinary.com/v1_1/${cfg.cloudName}`
}

export function cloudinaryStore(cfg: CloudinaryCredentials): MediaStore {
  return {
    provider: 'cloudinary',
    acceptsWebp: true, // delivery URLs convert to JPEG for WhatsApp (f_jpg)

    async upload({ accountId, bytes, mime }: { accountId: string; bytes: Uint8Array; mime: ImageMime }): Promise<StoredImage> {
      const params: Record<string, string> = {
        folder: tenantFolder(accountId),
        timestamp: String(Math.floor(Date.now() / 1000)),
        // Incoming transformation: cap the stored original at 2000px so
        // 12 MP phone photos don't eat storage or WhatsApp's 5 MB limit.
        transformation: 'c_limit,w_2000,h_2000',
      }
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mime }))
      for (const [k, v] of Object.entries(params)) form.append(k, v)
      form.append('api_key', cfg.apiKey)
      form.append('signature', sign(params, cfg.apiSecret))

      const res = await fetch(`${apiBase(cfg)}/image/upload`, { method: 'POST', body: form }).catch(() => {
        throw new MediaError('Could not reach Cloudinary')
      })
      const json = (await res.json().catch(() => ({}))) as {
        public_id?: string
        secure_url?: string
        width?: number
        height?: number
        bytes?: number
        error?: { message?: string }
      }
      if (res.status === 401) throw new MediaError('Cloudinary rejected the API key / secret')
      if (!res.ok || !json.public_id || !json.secure_url) {
        throw new MediaError(`Cloudinary upload failed${json.error?.message ? `: ${json.error.message}` : ''}`)
      }
      return {
        publicId: json.public_id,
        url: json.secure_url,
        width: json.width ?? 0,
        height: json.height ?? 0,
        bytes: json.bytes ?? bytes.length,
      }
    },

    async remove(accountId: string, publicId: string): Promise<void> {
      // Defense in depth: never destroy anything outside this tenant's folder.
      if (!publicId.startsWith(`${tenantFolder(accountId)}/`)) throw new MediaError('Refusing to delete a foreign image')
      const params = { public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)), invalidate: 'true' }
      const body = new URLSearchParams({ ...params, api_key: cfg.apiKey, signature: sign(params, cfg.apiSecret) })
      const res = await fetch(`${apiBase(cfg)}/image/destroy`, { method: 'POST', body }).catch(() => null)
      // "not found" is fine — the goal state (image gone) is reached.
      if (res && !res.ok && res.status !== 404) throw new MediaError(`Cloudinary delete failed (${res.status})`)
    },
  }
}
