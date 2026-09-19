import 'server-only'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type { StorageConfigDoc, StorageProvider } from '@/lib/db/types'
import { getAppBaseUrl } from '@/lib/http/base-url'
import { decrypt } from '@/lib/security/secrets'
import { cloudinaryStore } from './cloudinary'
import { MediaError, type MediaStore } from './common'
import { s3Store, type S3Credentials } from './s3'

// ============================================================
// Per-business media storage. Each account configures its own
// Cloudinary or S3-compatible bucket in Settings → Storage; secrets
// are encrypted in MongoDB and read through scopedCollection, so one
// business's uploads can only ever use that business's credentials.
// ============================================================

export function mediaProxyPath(accountId: string, imageId: string): string {
  return `/api/media/${accountId}/${imageId}`
}

/** Absolute URL for third parties (WhatsApp fetches images by link). */
export function absoluteMediaUrl(url: string): string {
  return url.startsWith('/') ? `${getAppBaseUrl()}${url}` : url
}

export function s3Credentials(cfg: StorageConfigDoc): S3Credentials {
  if (!cfg.s3) throw new MediaError('S3 settings missing')
  return {
    region: cfg.s3.region,
    bucket: cfg.s3.bucket,
    endpoint: cfg.s3.endpoint,
    accessKeyId: cfg.s3.accessKeyId,
    secretAccessKey: decrypt(cfg.s3.secretAccessKeyEnc),
    publicBaseUrl: cfg.s3.publicBaseUrl,
    forcePathStyle: cfg.s3.forcePathStyle,
  }
}

export function storeFromConfig(cfg: StorageConfigDoc): MediaStore {
  if (cfg.provider === 'cloudinary') {
    if (!cfg.cloudinary) throw new MediaError('Cloudinary settings missing')
    return cloudinaryStore({
      cloudName: cfg.cloudinary.cloudName,
      apiKey: cfg.cloudinary.apiKey,
      apiSecret: decrypt(cfg.cloudinary.apiSecretEnc),
    })
  }
  return s3Store(s3Credentials(cfg), { proxyUrl: (imageId) => mediaProxyPath(cfg.accountId, imageId) })
}

/** The store new uploads go to, or null when the business hasn't set one up. */
export async function getActiveStore(ctx: AuthContext): Promise<MediaStore | null> {
  const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
  const cfg = await configs.findOne({ isActive: true })
  return cfg ? storeFromConfig(cfg) : null
}

/** The store that holds an existing image (may differ from the active one). */
export async function getStoreFor(ctx: AuthContext, provider: StorageProvider): Promise<MediaStore | null> {
  const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
  const cfg = await configs.findOne({ provider })
  return cfg ? storeFromConfig(cfg) : null
}

export async function hasActiveStore(ctx: AuthContext): Promise<boolean> {
  const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
  return (await configs.countDocuments({ isActive: true })) > 0
}
