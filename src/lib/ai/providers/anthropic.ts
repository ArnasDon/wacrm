import { AiError } from '../types'
import type { ProviderArgs, ProviderResult } from './shared'

const MAX_OUTPUT_TOKENS = 1024
const ANTHROPIC_VERSION = '2023-06-01'

export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: controller.signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new AiError('AI provider request timed out.', { code: 'provider_timeout', status: 504 })
    }
    throw new AiError('Could not reach the AI provider.', { code: 'provider_unreachable', status: 502 })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new AiError(`Anthropic request failed (${res.status}): ${body.slice(0, 300)}`, {
      code: 'provider_error',
      status: 502,
    })
  }

  const json = (await res.json()) as {
    content: { type: string; text?: string }[]
    usage?: { input_tokens: number; output_tokens: number }
  }
  const text = json.content.find((c) => c.type === 'text')?.text ?? ''
  return {
    text,
    usage: json.usage
      ? { promptTokens: json.usage.input_tokens, completionTokens: json.usage.output_tokens }
      : null,
  }
}
