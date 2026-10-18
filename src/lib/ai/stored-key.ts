import type { AiProvider } from './types'
import { normalizeOpenAiCompatibleBaseUrl } from './providers/openai-compatible'

export interface StoredAiCredentials {
  provider: AiProvider
  base_url: string | null
}

function sameEndpoint(a: string | null, b: string | null): boolean {
  try {
    return (
      normalizeOpenAiCompatibleBaseUrl(a ?? '') ===
      normalizeOpenAiCompatibleBaseUrl(b ?? '')
    )
  } catch {
    return false
  }
}

export function canReuseStoredAiKey(
  stored: StoredAiCredentials | null | undefined,
  provider: AiProvider,
  baseUrl: string | null,
): boolean {
  if (!stored || stored.provider !== provider) return false
  if (provider !== 'openai_compatible') return true
  return sameEndpoint(stored.base_url, baseUrl)
}
