import { DEFAULT_COMMERCIAL_STRATEGY } from '../src/lib/ai/commercial-strategy'
import { AI_PROVIDER_DEFAULT_MODEL } from '../src/lib/ai/defaults'
import { createFixtureTools } from '../src/lib/ai/eval/fixture-tools'
import { CATALOG_GOLDEN_SET } from '../src/lib/ai/eval/golden-set'
import { runEvalSuite } from '../src/lib/ai/eval/run'
import {
  CATALOG_CUSTOMER_PERSONAS,
  simulateCustomerConversation,
} from '../src/lib/ai/eval/simulate-customer'
import type { AiConfig, AiProvider } from '../src/lib/ai/types'

/**
 * Tool-decision layer for the eval suite: does the agent reach for
 * search_catalog/get_style_opinion/schedule_visit at the right moments,
 * against a fictional loja-de-roupa catalogue (see fixture-tools.ts)?
 * `npm run eval:agent` never wires any tools in, so a regression here
 * was previously invisible to it.
 *
 *   WACRM_EVAL_PROVIDER=openai WACRM_EVAL_API_KEY=... npm run eval:catalog
 */
function loadConfig(): AiConfig {
  const provider = (process.env.WACRM_EVAL_PROVIDER ?? 'openai') as AiProvider
  if (provider !== 'openai' && provider !== 'anthropic') {
    throw new Error('WACRM_EVAL_PROVIDER must be openai or anthropic.')
  }
  const apiKey = process.env.WACRM_EVAL_API_KEY?.trim()
  if (!apiKey) throw new Error('WACRM_EVAL_API_KEY is required.')

  return {
    provider,
    model: process.env.WACRM_EVAL_MODEL?.trim() ?? AI_PROVIDER_DEFAULT_MODEL[provider],
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

  const evaluation = await runEvalSuite(config, CATALOG_GOLDEN_SET, {
    minimumScore: Number(process.env.WACRM_EVAL_MINIMUM ?? 0.75),
  })

  const simulations = await Promise.all(
    CATALOG_CUSTOMER_PERSONAS.map(async (persona) => {
      const fixture = createFixtureTools()
      const result = await simulateCustomerConversation(config, persona, {
        tools: fixture.tools,
        executeTool: fixture.executeTool,
      })
      return { persona: persona.id, toolCalls: fixture.recordedCalls(), ...result }
    }),
  )

  const report = {
    provider: config.provider,
    model: config.model,
    generated_at: new Date().toISOString(),
    evaluation,
    simulations,
  }
  console.log(JSON.stringify(report, null, 2))
  if (!evaluation.passed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
