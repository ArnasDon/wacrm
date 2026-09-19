import 'server-only'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'
import { MediaError, imageSize, tenantFolder, type ImageMime, type MediaStore, type StoredImage } from './common'

// ============================================================
// S3-compatible backend: Amazon S3, Cloudflare R2, DigitalOcean
// Spaces, Backblaze B2, Wasabi, MinIO…
//
// Objects are written PRIVATE (no ACLs — most buckets block them).
// Delivery is either
//   - `publicBaseUrl` + key, when the merchant exposes the bucket via
//     a CDN / public bucket URL, or
//   - the app's own proxy `/api/media/<accountId>/<imageId>`, which
//     streams the object with the merchant's credentials. That works
//     with fully private buckets and still gives WhatsApp a public
//     HTTPS URL to fetch.
// ============================================================

export interface S3Credentials {
  region: string
  bucket: string
  endpoint: string | null
  accessKeyId: string
  secretAccessKey: string
  publicBaseUrl: string | null
  forcePathStyle: boolean
}

const EXT: Record<ImageMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function client(cfg: S3Credentials): S3Client {
  return new S3Client({
    region: cfg.region || 'auto',
    endpoint: cfg.endpoint ?? undefined,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    maxAttempts: 2,
  })
}

function explain(err: unknown, action: string): MediaError {
  if (err instanceof S3ServiceException) {
    const code = err.name
    if (code === 'NoSuchBucket') return new MediaError('Bucket not found — check the bucket name and region')
    if (code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') return new MediaError('The access key or secret is wrong')
    if (code === 'AccessDenied') return new MediaError(`Access denied — the key needs s3:${action} on this bucket`)
    if (code === 'PermanentRedirect' || code === 'AuthorizationHeaderMalformed') return new MediaError('Wrong region for this bucket')
    return new MediaError(`Storage error: ${code}`)
  }
  return new MediaError('Could not reach the storage service — check the endpoint')
}

export function s3Store(cfg: S3Credentials, opts: { proxyUrl: (imageId: string) => string }): MediaStore {
  return {
    provider: 's3',
    // No image conversion here — WhatsApp image messages accept only JPEG/PNG.
    acceptsWebp: false,

    async upload({ accountId, bytes, mime, imageId }): Promise<StoredImage> {
      const key = `${tenantFolder(accountId)}/${imageId}.${EXT[mime]}`
      try {
        await client(cfg).send(
          new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: key,
            Body: bytes,
            ContentType: mime,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        )
      } catch (err) {
        throw explain(err, 'PutObject')
      }
      const url = cfg.publicBaseUrl ? `${cfg.publicBaseUrl.replace(/\/+$/, '')}/${key}` : opts.proxyUrl(imageId)
      return { publicId: key, url, ...imageSize(bytes, mime), bytes: bytes.length }
    },

    async remove(accountId: string, key: string): Promise<void> {
      if (!key.startsWith(`${tenantFolder(accountId)}/`)) throw new MediaError('Refusing to delete a foreign object')
      try {
        await client(cfg).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
      } catch (err) {
        throw explain(err, 'DeleteObject')
      }
    },
  }
}

/** Stream one object (for the private-bucket proxy). */
export async function s3GetObject(
  cfg: S3Credentials,
  key: string,
): Promise<{ body: ReadableStream; contentType: string | undefined; length: number | undefined }> {
  try {
    const out = await client(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
    if (!out.Body) throw new MediaError('Empty object')
    return {
      body: out.Body.transformToWebStream(),
      contentType: out.ContentType,
      length: out.ContentLength,
    }
  } catch (err) {
    if (err instanceof MediaError) throw err
    throw explain(err, 'GetObject')
  }
}
