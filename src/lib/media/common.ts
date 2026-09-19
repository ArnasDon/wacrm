// Shared, dependency-free media helpers (server-side use).

export class MediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaError'
  }
}

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp'

/** Identify the real type from magic bytes — the declared type is never trusted. */
export function sniffImage(bytes: Uint8Array): ImageMime | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png'
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'image/webp'
  return null
}

/** Every tenant's objects live under this prefix — uploads and deletes are pinned to it. */
export function tenantFolder(accountId: string): string {
  return `wacrm/${accountId}/products`
}

/** Read width/height from PNG / JPEG headers (best effort; 0 if unknown). */
export function imageSize(bytes: Uint8Array, mime: ImageMime): { width: number; height: number } {
  try {
    if (mime === 'image/png' && bytes.length > 24) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      return { width: dv.getUint32(16), height: dv.getUint32(20) }
    }
    if (mime === 'image/jpeg') {
      let i = 2
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) return { width: 0, height: 0 }
        const marker = bytes[i + 1]
        const len = (bytes[i + 2] << 8) | bytes[i + 3]
        // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] }
        }
        i += 2 + len
      }
    }
  } catch {
    /* fall through */
  }
  return { width: 0, height: 0 }
}

/** A 1×1 PNG used by the "Test connection" buttons. */
export const TEST_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

export interface StoredImage {
  publicId: string
  url: string
  width: number
  height: number
  bytes: number
}

/** What every storage backend implements. */
export interface MediaStore {
  provider: 'cloudinary' | 's3'
  /** WebP can't be sent as a WhatsApp image unless the store can convert it. */
  acceptsWebp: boolean
  upload(input: { accountId: string; bytes: Uint8Array; mime: ImageMime; imageId: string }): Promise<StoredImage>
  remove(accountId: string, publicId: string): Promise<void>
}
