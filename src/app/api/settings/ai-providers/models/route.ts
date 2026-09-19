import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { AIProviderError, listModels } from '@/lib/ai/client'
import { getPreset } from '@/lib/ai/presets'
import { validateBaseUrl } from '@/lib/ai/provider-admin'
import { isId } from '@/lib/db/ids'
import { scopedCollection } from '@/lib/db/scoped'
import type { AIProviderDoc } from '@/lib/db/types'
import { NotFoundError, readJson, ValidationError } from '@/lib/http/errors'
import { optStr, str } from '@/lib/http/validate'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/security/secrets'

/**
 * POST — models the provider currently serves for this key.
 *   { providerId }                       — a saved provider
 *   { preset, apiKey?, baseUrl? }        — preview while adding one (key not stored)
 * Admin+.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limit = checkRateLimit(`integration:${ctx.userId}`, RATE_LIMITS.integrationTest)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await readJson(request)

    let provider: AIProviderDoc
    if (body.providerId !== undefined) {
      if (!isId(body.providerId)) throw new ValidationError('Invalid provider')
      const providers = await scopedCollection<AIProviderDoc>(ctx, 'ai_providers')
      const found = await providers.findById(body.providerId)
      if (!found) throw new NotFoundError('AI provider not found')
      provider = found
    } else {
      const preset = getPreset(str(body.preset, 'preset', { max: 40 }))
      if (!preset) throw new ValidationError('Unknown provider preset')
      const apiKey = optStr(body.apiKey, 'apiKey', 400)
      // Transient in-memory doc — never persisted.
      provider = {
        _id: '',
        accountId: ctx.accountId,
        label: preset.label,
        kind: preset.kind,
        preset: preset.id,
        baseUrl: preset.customBaseUrl ? await validateBaseUrl(optStr(body.baseUrl, 'baseUrl', 300) ?? preset.baseUrl) : null,
        apiKeyEnc: apiKey ? encrypt(apiKey) : null,
        model: preset.defaultModel,
        isDefault: false,
        lastTestAt: null,
        lastTestOk: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }

    try {
      return NextResponse.json({ models: await listModels(provider) })
    } catch (err) {
      if (err instanceof AIProviderError) throw new ValidationError(err.message)
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
