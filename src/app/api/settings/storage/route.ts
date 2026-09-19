import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { scopedCollection, type AuthContext } from '@/lib/db/scoped'
import type { ProductDoc, StorageConfigDoc, StorageProvider } from '@/lib/db/types'
import { ConflictError, readJson, ValidationError } from '@/lib/http/errors'
import { bool, oneOf, optStr, str } from '@/lib/http/validate'
import { MediaError, TEST_PNG } from '@/lib/media/common'
import { getS3Preset, resolveEndpoint } from '@/lib/media/presets'
import { storeFromConfig } from '@/lib/media/storage'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { assertPublicUrl, UnsafeUrlError } from '@/lib/security/safe-fetch'
import { decrypt, encrypt, maskSecret } from '@/lib/security/secrets'

// ============================================================
// Settings → Storage. Each business brings its own Cloudinary account
// or S3-compatible bucket; secrets are encrypted at rest and only
// ever returned masked. Saving runs a real round-trip (upload a 1×1
// PNG into the business's folder, then delete it) so bad keys, bucket
// names or regions are caught before any product photo depends on them.
// ============================================================

// Separate from ALLOW_PRIVATE_AI_ENDPOINTS on purpose: allowing a local
// Ollama must not also open storage endpoints to the private network.
const allowPrivate = () => process.env.ALLOW_PRIVATE_ENDPOINTS === 'true'

function shape(rows: StorageConfigDoc[]) {
  const c = rows.find((r) => r.provider === 'cloudinary')
  const s = rows.find((r) => r.provider === 's3')
  return {
    active: rows.find((r) => r.isActive)?.provider ?? null,
    cloudinary: c?.cloudinary
      ? {
          cloudName: c.cloudinary.cloudName,
          apiKey: c.cloudinary.apiKey,
          apiSecretMasked: maskSecret(decrypt(c.cloudinary.apiSecretEnc)),
          isActive: c.isActive,
          lastTestAt: c.lastTestAt,
          lastTestOk: c.lastTestOk,
        }
      : null,
    s3: s?.s3
      ? {
          preset: s.s3.preset,
          region: s.s3.region,
          bucket: s.s3.bucket,
          endpoint: s.s3.endpoint,
          accessKeyId: s.s3.accessKeyId,
          secretMasked: maskSecret(decrypt(s.s3.secretAccessKeyEnc)),
          publicBaseUrl: s.s3.publicBaseUrl,
          forcePathStyle: s.s3.forcePathStyle,
          isActive: s.isActive,
          lastTestAt: s.lastTestAt,
          lastTestOk: s.lastTestOk,
        }
      : null,
  }
}

async function roundTrip(ctx: AuthContext, cfg: StorageConfigDoc): Promise<void> {
  const store = storeFromConfig(cfg)
  const probe = await store.upload({
    accountId: ctx.accountId,
    bytes: TEST_PNG,
    mime: 'image/png',
    imageId: `_connection-test-${Date.now()}`,
  })
  await store.remove(ctx.accountId, probe.publicId)
}

async function validatedUrl(raw: string, field: string, opts: { https?: boolean } = {}): Promise<string> {
  try {
    const url = await assertPublicUrl(raw, { allowPrivate: allowPrivate() })
    if (opts.https && url.protocol !== 'https:') throw new UnsafeUrlError('must use https')
    return url.toString().replace(/\/+$/, '')
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ValidationError(`${field}: ${err.message}`)
    throw err
  }
}

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
    return NextResponse.json(shape(await configs.find({}).toArray()))
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PUT — save + verify + make active.
 *   { provider: 'cloudinary', cloudName, apiKey, apiSecret? }
 *   { provider: 's3', preset, region, bucket, accountId? (R2), endpoint? (custom),
 *     accessKeyId, secretAccessKey?, publicBaseUrl?, forcePathStyle? }
 * Omitted secrets keep the stored value.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)
    const provider = oneOf(body.provider, 'provider', ['cloudinary', 's3'] as const)
    const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
    const existing = await configs.findOne({ provider })

    const draft: StorageConfigDoc = {
      _id: existing?._id ?? '',
      accountId: ctx.accountId,
      provider,
      isActive: true,
      cloudinary: null,
      s3: null,
      lastTestAt: null,
      lastTestOk: null,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    }

    if (provider === 'cloudinary') {
      const cloudName = str(body.cloudName, 'cloudName', { max: 64 })
      if (!/^[a-z0-9_-]+$/i.test(cloudName)) throw new ValidationError('Cloud name has invalid characters')
      const apiKey = str(body.apiKey, 'apiKey', { max: 64 })
      const secret = optStr(body.apiSecret, 'apiSecret', 128)
      const apiSecretEnc = secret ? encrypt(secret) : existing?.cloudinary?.apiSecretEnc
      if (!apiSecretEnc) throw new ValidationError('API secret is required')
      draft.cloudinary = { cloudName, apiKey, apiSecretEnc }
    } else {
      const preset = getS3Preset(str(body.preset, 'preset', { max: 20 }))
      if (!preset) throw new ValidationError('Unknown storage preset')
      const region = str(body.region ?? preset.defaultRegion, 'region', { max: 40 })
      if (!/^[a-z0-9-]+$/i.test(region)) throw new ValidationError('Region has invalid characters')
      const bucket = str(body.bucket, 'bucket', { max: 63 })
      if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new ValidationError('Bucket name is not valid')
      const r2Account = optStr(body.accountId, 'accountId', 64)
      if (preset.needsAccountId && !(r2Account && /^[a-f0-9]{32}$/i.test(r2Account))) {
        throw new ValidationError('Cloudflare account ID (32 hex characters) is required for R2')
      }
      const rawEndpoint = resolveEndpoint(preset, { region, accountId: r2Account ?? undefined, custom: optStr(body.endpoint, 'endpoint', 300) ?? undefined })
      if (preset.id === 'custom' && !rawEndpoint) throw new ValidationError('Endpoint URL is required')
      const endpoint = rawEndpoint ? await validatedUrl(rawEndpoint, 'Endpoint') : null
      const publicRaw = optStr(body.publicBaseUrl, 'publicBaseUrl', 300)
      const publicBaseUrl = publicRaw ? await validatedUrl(publicRaw, 'Public URL', { https: true }) : null
      const secret = optStr(body.secretAccessKey, 'secretAccessKey', 256)
      const secretAccessKeyEnc = secret ? encrypt(secret) : existing?.s3?.secretAccessKeyEnc
      if (!secretAccessKeyEnc) throw new ValidationError('Secret access key is required')
      draft.s3 = {
        preset: preset.id,
        region,
        bucket,
        endpoint,
        accessKeyId: str(body.accessKeyId, 'accessKeyId', { max: 128 }),
        secretAccessKeyEnc,
        publicBaseUrl,
        forcePathStyle: bool(body.forcePathStyle, 'forcePathStyle', preset.forcePathStyle),
      }
    }

    try {
      await roundTrip(ctx, draft)
    } catch (err) {
      if (err instanceof MediaError) throw new ValidationError(`Connection test failed: ${err.message}`)
      throw err
    }

    await configs.findOneAndUpdate(
      { provider },
      {
        $set: {
          provider,
          isActive: true,
          cloudinary: draft.cloudinary,
          s3: draft.s3,
          lastTestAt: new Date(),
          lastTestOk: true,
        },
      },
      { upsert: true },
    )
    // One active store: new uploads go here from now on.
    await configs.updateMany({ provider: { $ne: provider } }, { $set: { isActive: false } })
    return NextResponse.json(shape(await configs.find({}).toArray()))
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** POST { action: 'test' | 'activate', provider } */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)
    const action = oneOf(body.action, 'action', ['test', 'activate'] as const)
    const provider = oneOf(body.provider, 'provider', ['cloudinary', 's3'] as const) as StorageProvider
    const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
    const cfg = await configs.findOne({ provider })
    if (!cfg) throw new ValidationError('That storage is not set up')

    if (action === 'activate') {
      await configs.updateMany({}, { $set: { isActive: false } })
      await configs.updateById(cfg._id, { $set: { isActive: true } })
      return NextResponse.json(shape(await configs.find({}).toArray()))
    }
    let ok = true
    let message = 'Connected — test upload and delete succeeded'
    try {
      await roundTrip(ctx, cfg)
    } catch (err) {
      ok = false
      message = err instanceof MediaError ? err.message : 'Connection failed'
    }
    await configs.updateById(cfg._id, { $set: { lastTestAt: new Date(), lastTestOk: ok } })
    return NextResponse.json({ ok, message, ...shape(await configs.find({}).toArray()) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/** DELETE ?provider= — refused while product photos still live there. */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const provider = oneOf(new URL(request.url).searchParams.get('provider'), 'provider', ['cloudinary', 's3'] as const)
    const products = await scopedCollection<ProductDoc>(ctx, 'products')
    const inUse = await products.countDocuments(
      provider === 'cloudinary'
        ? { $or: [{ 'images.provider': 'cloudinary' }, { images: { $elemMatch: { provider: { $exists: false } } } }] }
        : { 'images.provider': provider },
    )
    if (inUse > 0) {
      throw new ConflictError(`${inUse} product${inUse === 1 ? ' still has' : 's still have'} photos stored here — delete or replace them first`)
    }
    const configs = await scopedCollection<StorageConfigDoc>(ctx, 'storage_configs')
    await configs.deleteMany({ provider })
    return NextResponse.json(shape(await configs.find({}).toArray()))
  } catch (err) {
    return toErrorResponse(err)
  }
}
