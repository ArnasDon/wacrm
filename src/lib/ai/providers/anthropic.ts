import { AiError } from '../types'
import type { ProviderArgs, ProviderResult } from './shared'

const ANTHROPIC_VERSION = '2023-06-01'

export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, maxTokens, structuredOutput } = args

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const signal = args.signal
    ? AbortSignal.any([controller.signal, args.signal])
    : controller.signal

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
        max_tokens: maxTokens,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        ...(structuredOutput
          ? {
              tools: [
                {
                  name: structuredOutput.name,
                  description:
                    structuredOutput.description ??
                    'Return exactly one structured response matching the provided schema.',
                  strict: true,
                  input_schema: structuredOutput.schema,
                },
              ],
              tool_choice: { type: 'tool', name: structuredOutput.name },
            }
          : {}),
      }),
      signal,
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
      throw modelIncompatible(`Anthropic rejected the structured-output contract: ${body.slice(0, 300)}`)
    }
    throw new AiError(`Anthropic request failed (${res.status}): ${body.slice(0, 300)}`, {
      code: 'provider_error',
      status: 502,
    })
  }

  let json: {
    content?: { type: string; text?: string; name?: string; input?: unknown }[]
    stop_reason?: string | null
    usage?: { input_tokens: number; output_tokens: number }
  }
  try {
    json = (await res.json()) as typeof json
  } catch {
    if (structuredOutput) {
      throw modelIncompatible('Anthropic returned an unreadable structured response.')
    }
    throw new AiError('Anthropic returned an unreadable response.', {
      code: 'provider_error',
      status: 502,
    })
  }
  const text = json.content?.find((c) => c.type === 'text')?.text ?? ''
  const usage = json.usage
    ? { promptTokens: json.usage.input_tokens, completionTokens: json.usage.output_tokens }
    : null

  if (structuredOutput) {
    if (json.stop_reason === 'max_tokens') {
      throw modelIncompatible('Anthropic truncated the structured response before it was complete.')
    }
    const toolUse = json.content?.find(
      (block) => block.type === 'tool_use' && block.name === structuredOutput.name,
    )
    if (!toolUse || !Object.prototype.hasOwnProperty.call(toolUse, 'input')) {
      throw modelIncompatible(`Anthropic did not call the required ${structuredOutput.name} tool.`)
    }
    return { text, structuredData: toolUse.input, usage }
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
