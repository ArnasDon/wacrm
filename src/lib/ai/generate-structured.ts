import { toJSONSchema, type ZodType } from 'zod'
import { generateAnthropic } from './providers/anthropic'
import { generateOpenAi } from './providers/openai'
import { AiError, type AiConfig, type AiUsage } from './types'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_TOKENS = 4096
const DEFAULT_CONTRACT_NAME = 'emit_automation_turn'
const DEFAULT_CONTRACT_DESCRIPTION =
  'Return exactly one structured response that matches the provided JSON schema.'

export interface GenerateStructuredArgs<T> {
  config: AiConfig
  schema: ZodType<T>
  systemPrompt: string
  userPrompt: string
  name?: string
  maxTokens?: number
  timeoutMs?: number
}

export interface GenerateStructuredResult<T> {
  data: T
  usage: AiUsage | null
}

export async function generateStructured<T>(
  args: GenerateStructuredArgs<T>,
): Promise<GenerateStructuredResult<T>> {
  const {
    config,
    schema,
    systemPrompt,
    userPrompt,
    name = DEFAULT_CONTRACT_NAME,
    maxTokens = DEFAULT_MAX_TOKENS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = args

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages: [{ role: 'user' as const, content: userPrompt }],
    timeoutMs,
    maxTokens,
    structuredOutput: {
      name,
      description: DEFAULT_CONTRACT_DESCRIPTION,
      schema: toJSONSchema(schema) as Record<string, unknown>,
    },
  }

  let result: { structuredData?: unknown; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw modelIncompatible(`Unsupported AI provider: ${config.provider}`)
  }

  if (!Object.prototype.hasOwnProperty.call(result, 'structuredData')) {
    throw modelIncompatible('The selected model did not return a native structured result.')
  }

  const parsed = schema.safeParse(result.structuredData)
  if (!parsed.success) {
    throw modelIncompatible('The selected model returned data that does not match the required schema.')
  }

  return { data: parsed.data, usage: result.usage }
}

function modelIncompatible(detail: string): AiError {
  return new AiError(
    `${detail} Choose a compatible model in Settings → AI agent (/settings?tab=ai-agent).`,
    { code: 'model_incompatible', status: 422 },
  )
}
