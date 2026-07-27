import type { ProviderResult } from '../types'
import { generateChatCompletion } from './openai-compatible'
import type { ProviderArgs } from './shared'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENROUTER_URL = `${OPENROUTER_BASE_URL}/chat/completions`

/**
 * Optional attribution headers. OpenRouter uses them to credit the app
 * on its public leaderboards; they are not auth and the call works
 * without them, so `HTTP-Referer` is only sent when the deployment has
 * declared a canonical URL.
 */
function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-Title': 'wacrm' }
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (site) headers['HTTP-Referer'] = site
  return headers
}

/**
 * Call OpenRouter's Chat Completions endpoint with the caller's own key.
 * OpenRouter is a gateway: one key reaches every model in its catalogue,
 * addressed as `vendor/model-id` (e.g. `anthropic/claude-sonnet-4.5`) in
 * `config.model`. The wire format is OpenAI's, so this is the shared
 * chat-completions call pointed at a different base URL.
 */
export async function generateOpenRouter(
  args: ProviderArgs,
): Promise<ProviderResult> {
  return generateChatCompletion(args, {
    url: OPENROUTER_URL,
    label: 'OpenRouter',
    headers: attributionHeaders(),
  })
}
