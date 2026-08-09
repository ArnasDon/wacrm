import { DEFAULT_COMMERCIAL_STRATEGY } from '../src/lib/ai/commercial-strategy'
import { AI_PROVIDER_DEFAULT_MODEL } from '../src/lib/ai/defaults'
import { DEFAULT_GOLDEN_SET } from '../src/lib/ai/eval/golden-set'
import { runEvalSuite } from '../src/lib/ai/eval/run'
import {
  DEFAULT_CUSTOMER_PERSONAS,
  simulateCustomerConversation,
} from '../src/lib/ai/eval/simulate-customer'
import type { AiConfig, AiProvider } from '../src/lib/ai/types'

function optionalNumber(name: string): number | null {
  const value = process.env[name]
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`)
  return parsed
}

function loadConfig(): AiConfig {
  const provider = (process.env.WACRM_EVAL_PROVIDER ?? 'openai') as AiProvider
  if (provider !== 'openai' && provider !== 'anthropic') {
    throw new Error('WACRM_EVAL_PROVIDER must be openai or anthropic.')
  }
  const apiKey = process.env.WACRM_EVAL_API_KEY?.trim()
  if (!apiKey) throw new Error('WACRM_EVAL_API_KEY is required.')

  return {
    provider,
    model:
      process.env.WACRM_EVAL_MODEL?.trim() ??
      AI_PROVIDER_DEFAULT_MODEL[provider],
    apiKey,
    systemPrompt: process.env.WACRM_EVAL_SYSTEM_PROMPT?.trim() || null,
    commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    bufferWindowSeconds: 12,
    maxReplyChunks: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }
}

async function main() {
  const config = loadConfig()
  const result = await runEvalSuite(config, DEFAULT_GOLDEN_SET, {
    baselineScore: optionalNumber('WACRM_EVAL_BASELINE'),
    minimumScore: optionalNumber('WACRM_EVAL_MINIMUM') ?? 0.75,
    allowedRegression:
      optionalNumber('WACRM_EVAL_ALLOWED_REGRESSION') ?? 0.02,
  })

  const simulations =
    process.env.WACRM_EVAL_SIMULATE === '1'
      ? await Promise.all(
          DEFAULT_CUSTOMER_PERSONAS.map(async (persona) => ({
            persona: persona.id,
            result: await simulateCustomerConversation(config, persona),
          })),
        )
      : []

  const report = {
    provider: config.provider,
    model: config.model,
    generated_at: new Date().toISOString(),
    evaluation: result,
    simulations,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!result.passed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
