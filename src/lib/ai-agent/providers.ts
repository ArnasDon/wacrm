import type { AiAgent } from '@/types'

import type { AiAgentDecisionProvider } from './decision'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_PROVIDER_ERROR_MESSAGE = 'AI provider request failed'
const DEFAULT_OPENAI_PROVIDER_TIMEOUT_MS = 15_000
const AI_AGENT_DECISION_RESPONSE_FORMAT = {
  type: 'json_schema',
  name: 'ai_agent_decision',
  strict: false,
  schema: {
    type: 'object',
    additionalProperties: true,
    required: ['action', 'confidence'],
    properties: {
      action: { enum: ['reply', 'no_reply', 'handoff'] },
      text: { type: 'string' },
      reason: { type: 'string' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      deal_action: {
        type: 'object',
        additionalProperties: true,
        properties: {
          type: { enum: ['none', 'create', 'move', 'update'] },
        },
      },
    },
  },
} as const

export function resolveAiAgentDecisionProvider(agent: AiAgent): AiAgentDecisionProvider | null {
  if (agent.model_provider.trim().toLowerCase() !== 'openai') return null

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null

  return createOpenAiResponsesProvider({ apiKey })
}

export function createOpenAiResponsesProvider(input: {
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): AiAgentDecisionProvider {
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? DEFAULT_OPENAI_PROVIDER_TIMEOUT_MS

  return {
    async complete(request) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImpl(OPENAI_RESPONSES_URL, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: request.model,
            input: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            text: { format: AI_AGENT_DECISION_RESPONSE_FORMAT },
            max_output_tokens: request.maxOutputTokens,
          }),
        })

        if (!response.ok) throw new Error(OPENAI_PROVIDER_ERROR_MESSAGE)

        const payload = await response.json()
        const outputText = extractOpenAiOutputText(payload)
        if (!outputText) throw new Error(OPENAI_PROVIDER_ERROR_MESSAGE)
        return outputText
      } catch {
        throw new Error(OPENAI_PROVIDER_ERROR_MESSAGE)
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

export function extractOpenAiOutputText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string' && record.output_text.trim()) {
    return record.output_text
  }

  const output = Array.isArray(record.output) ? record.output : []
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const text = (part as Record<string, unknown>).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('').trim()
}
