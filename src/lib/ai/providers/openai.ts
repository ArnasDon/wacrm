import { AiError } from '../types'
import type { ProviderArgs, ProviderResult } from './shared'

const MAX_OUTPUT_TOKENS = 1024

export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, responseFormat } = args

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
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
    throw new AiError(`OpenAI request failed (${res.status}): ${body.slice(0, 300)}`, {
      code: 'provider_error',
      status: 502,
    })
  }

  const json = (await res.json()) as {
    choices: { message: { content: string } }[]
    usage?: { prompt_tokens: number; completion_tokens: number }
  }
  const text = json.choices[0]?.message?.content ?? ''
  return {
    text,
    usage: json.usage
      ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
      : null,
  }
}
