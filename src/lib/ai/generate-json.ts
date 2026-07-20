import { AiError, type AiConfig, type AiUsage } from './types'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

const DEFAULT_TIMEOUT_MS = 30_000

export interface GenerateJsonArgs {
  config: AiConfig
  /** Task-specific instructions. A JSON-only directive is appended
   *  automatically — don't repeat "respond with JSON" here. */
  systemPrompt: string
  userPrompt: string
}

export interface GenerateJsonResult<T> {
  data: T
  usage: AiUsage | null
}

/**
 * Provider-agnostic structured-output call. OpenAI gets native JSON
 * mode; Anthropic has no equivalent in the raw Messages API used here,
 * so both providers also get a strict "JSON only" system-prompt suffix,
 * and the response is parsed tolerantly (direct JSON.parse, falling
 * back to the first balanced {...} substring) to survive a model that
 * wraps the object in prose or a markdown fence.
 */
export async function generateJson<T>(args: GenerateJsonArgs): Promise<GenerateJsonResult<T>> {
  const { config, systemPrompt, userPrompt } = args
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: `${systemPrompt}\n\nRespond with ONLY a single valid JSON object. No prose, no markdown code fences, no explanation before or after.`,
    messages: [{ role: 'user' as const, content: userPrompt }],
    timeoutMs: DEFAULT_TIMEOUT_MS,
    responseFormat: 'json_object' as const,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  const parsed = extractJson(result.text)
  if (parsed === null) {
    throw new AiError('The model did not return valid JSON.', { code: 'invalid_json_response' })
  }
  return { data: parsed as T, usage: result.usage }
}

function extractJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    // fall through to brace-matching
  }
  const start = raw.indexOf('{')
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '{') depth++
    else if (raw[i] === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(raw.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}
