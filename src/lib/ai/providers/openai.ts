import { AiError } from '../types'
import type { ProviderArgs, ProviderResult } from './shared'

export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, maxTokens, responseFormat, structuredOutput } = args

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
        max_completion_tokens: maxTokens,
        ...(structuredOutput
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: {
                  name: structuredOutput.name,
                  strict: true,
                  schema: structuredOutput.schema,
                },
              },
            }
          : responseFormat
            ? { response_format: { type: responseFormat } }
            : {}),
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
    if (structuredOutput && res.status === 400) {
      throw modelIncompatible(`OpenAI rejected the structured-output contract: ${body.slice(0, 300)}`)
    }
    throw new AiError(`OpenAI request failed (${res.status}): ${body.slice(0, 300)}`, {
      code: 'provider_error',
      status: 502,
    })
  }

  let json: {
    choices?: {
      finish_reason?: string | null
      message?: { content?: string | null; refusal?: string | null }
    }[]
    usage?: { prompt_tokens: number; completion_tokens: number }
  }
  try {
    json = (await res.json()) as typeof json
  } catch {
    if (structuredOutput) {
      throw modelIncompatible('OpenAI returned an unreadable structured response.')
    }
    throw new AiError('OpenAI returned an unreadable response.', {
      code: 'provider_error',
      status: 502,
    })
  }
  const choice = json.choices?.[0]
  const text = choice?.message?.content ?? ''
  const usage = json.usage
    ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens }
    : null

  if (structuredOutput) {
    if (choice?.message?.refusal) {
      throw modelIncompatible(`OpenAI refused the structured request: ${choice.message.refusal}`)
    }
    if (choice?.finish_reason === 'length') {
      throw modelIncompatible('OpenAI truncated the structured response before it was complete.')
    }
    if (!choice || typeof choice.message?.content !== 'string' || !choice.message.content) {
      throw modelIncompatible('OpenAI did not return structured response content.')
    }

    let structuredData: unknown
    try {
      structuredData = JSON.parse(choice.message.content)
    } catch {
      throw modelIncompatible('OpenAI returned content that was not valid structured JSON.')
    }

    return { text, structuredData, usage }
  }

  return {
    text,
    usage,
  }
}

function modelIncompatible(detail: string): AiError {
  return new AiError(
    `${detail} Choose a compatible model in Settings → AI agent (/settings?tab=ai-agent).`,
    { code: 'model_incompatible', status: 422 },
  )
}
