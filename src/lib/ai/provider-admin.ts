import 'server-only'
import type { AIProviderDoc } from '@/lib/db/types'
import { ValidationError } from '@/lib/http/errors'
import { assertPublicUrl, UnsafeUrlError } from '@/lib/security/safe-fetch'
import { decrypt, maskSecret } from '@/lib/security/secrets'

export function shapeProvider(p: AIProviderDoc) {
  return {
    id: p._id,
    label: p.label,
    kind: p.kind,
    preset: p.preset,
    baseUrl: p.baseUrl,
    model: p.model,
    isDefault: p.isDefault,
    apiKeyMasked: p.apiKeyEnc ? maskSecret(decrypt(p.apiKeyEnc)) : null,
    lastTestAt: p.lastTestAt,
    lastTestOk: p.lastTestOk,
  }
}

/** Validate a base URL for presets that allow a custom one (Ollama, LM Studio, vLLM). */
export async function validateBaseUrl(raw: string | null): Promise<string | null> {
  if (!raw) return null
  try {
    const url = await assertPublicUrl(raw, { allowPrivate: process.env.ALLOW_PRIVATE_AI_ENDPOINTS === 'true' })
    return url.toString().replace(/\/+$/, '')
  } catch (err) {
    if (err instanceof UnsafeUrlError) {
      throw new ValidationError(
        `${err.message}. Local model servers (Ollama / LM Studio) need ALLOW_PRIVATE_AI_ENDPOINTS=true on a single-tenant install.`,
      )
    }
    throw err
  }
}

