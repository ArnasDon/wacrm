import type { ProviderResult } from '../types'
import { generateOpenAi } from './openai'
import type { ProviderArgs } from './shared'

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'

/**
 * DeepSeek's Chat Completions API is OpenAI-compatible — identical
 * request/response shape, identical tool-calling format (DeepSeek's own
 * docs show it via the `openai` SDK with just the base URL swapped). So
 * this isn't a new adapter, it's `generateOpenAi` pointed at a different
 * URL with DeepSeek's key and a correct provider label for error
 * messages. If DeepSeek's API ever genuinely diverges from OpenAI's,
 * this is the file that grows its own logic — until then, no
 * duplication.
 */
export async function generateDeepSeek(args: ProviderArgs): Promise<ProviderResult> {
  return generateOpenAi({ ...args, baseUrl: DEEPSEEK_URL, providerLabel: 'DeepSeek' })
}
